const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// key สำหรับเซ็น token — เปลี่ยนเป็นค่าลับของคุณตอนขึ้น production
const JWT_SECRET = process.env.JWT_SECRET || 'tuyen-dev-secret';

// ---------- Data layer ----------
// ถ้า DATABASE_URL ยังไม่ใช่ของจริง (placeholder) → ใช้ dev mode เก็บในหน่วยความจำ
const dbUrl = process.env.DATABASE_URL || '';
const isDevMode = !/^postgres(ql)?:\/\//.test(dbUrl) || dbUrl.includes('YOUR-PASSWORD');
let pool = null;

if (isDevMode) {
  console.log('⚠️  กำลังรันใน DEV MODE (ไม่พบ DATABASE_URL จริง) — ข้อมูลจะหายเมื่อปิดเซิร์ฟเวอร์');
}

if (!isDevMode) {
  pool = new Pool({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false }
  });
}

// หน่วยความจำสำหรับ dev mode
const mem = { users: [], foods: [], userSeq: 1, foodSeq: 1 };

async function findUserByEmail(email) {
  if (!isDevMode) {
    const r = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    return r.rows[0] || null;
  }
  return mem.users.find(u => u.email === email) || null;
}

async function createUser(email, passwordHash) {
  if (!isDevMode) {
    const r = await pool.query(
      'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING *',
      [email, passwordHash]
    );
    return r.rows[0];
  }
  const user = {
    id: String(mem.userSeq++),
    email,
    password_hash: passwordHash,
    created_at: new Date().toISOString()
  };
  mem.users.push(user);
  return user;
}

async function getFoods(userId) {
  if (!isDevMode) {
    const r = await pool.query('SELECT * FROM foods WHERE user_id = $1 ORDER BY expiry_date ASC NULLS LAST', [userId]);
    return r.rows;
  }
  return mem.foods
    .filter(f => f.user_id === userId)
    .sort((a, b) => (a.expiry_date || '9999').localeCompare(b.expiry_date || '9999'));
}

async function insertFood(fields, userId) {
  if (!isDevMode) {
    const r = await pool.query(
      'INSERT INTO foods (name, category, expiry_date, note, user_id) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [fields.name, fields.category, fields.expiry_date, fields.note, userId]
    );
    return r.rows[0];
  }
  const food = {
    id: mem.foodSeq++,
    name: fields.name,
    category: fields.category,
    expiry_date: fields.expiry_date || null,
    note: fields.note || null,
    user_id: userId,
    created_at: new Date().toISOString()
  };
  mem.foods.push(food);
  return food;
}

async function updateFood(id, fields, userId) {
  if (!isDevMode) {
    const r = await pool.query(
      'UPDATE foods SET name = $1, category = $2, expiry_date = $3, note = $4 WHERE id = $5 AND user_id = $6 RETURNING *',
      [fields.name, fields.category, fields.expiry_date, fields.note, id, userId]
    );
    return r.rows[0] || null;
  }
  const food = mem.foods.find(f => f.id === Number(id) && f.user_id === userId);
  if (!food) return null;
  Object.assign(food, fields);
  return food;
}

async function deleteFood(id, userId) {
  if (!isDevMode) {
    const r = await pool.query('DELETE FROM foods WHERE id = $1 AND user_id = $2 RETURNING *', [id, userId]);
    return r.rows[0] || null;
  }
  const idx = mem.foods.findIndex(f => f.id === Number(id) && f.user_id === userId);
  if (idx === -1) return null;
  return mem.foods.splice(idx, 1)[0];
}

// สร้างตารางที่จำเป็น (เฉพาะโหมด PostgreSQL)
if (!isDevMode) {
  (async () => {
    try {
      await pool.query(
        'CREATE TABLE IF NOT EXISTS users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text UNIQUE NOT NULL, password_hash text NOT NULL, created_at timestamptz DEFAULT now())'
      );
      await pool.query('ALTER TABLE foods ADD COLUMN IF NOT EXISTS user_id uuid');
      console.log('[migrate] ตารางพร้อมใช้งาน');
    } catch (err) {
      console.error('[migrate] ข้ามไป:', err.message);
    }
  })();
}

// ---------- Auth ----------

// ตรวจสอบ Bearer token (JWT ของเรา หรือ Supabase ถ้ามีค่า) → req.user { id, email }
async function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบ' });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = { id: payload.id, email: payload.email };
    return next();
  } catch (err) { /* ไม่ใช่ JWT ของเรา → ลอง Supabase */ }

  const supabaseUrl = process.env.SUPABASE_URL || '';
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || '';
  if (supabaseUrl) {
    try {
      const { createClient } = require('@supabase/supabase-js');
      const sbClient = createClient(supabaseUrl, supabaseAnonKey);
      const { data, error } = await sbClient.auth.getUser(token);
      if (!error && data.user) {
        req.user = { id: data.user.id, email: data.user.email };
        return next();
      }
    } catch (e) { /* fall through */ }
  }

  return res.status(401).json({ error: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่' });
}

// สมัครสมาชิก (อีเมล + รหัสผ่าน)
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const cleanEmail = String(email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail)) {
      return res.status(400).json({ error: 'อีเมลไม่ถูกต้อง' });
    }
    if (!password || String(password).length < 6) {
      return res.status(400).json({ error: 'รหัสผ่านต้องอย่างน้อย 6 ตัวอักษร' });
    }
    if (await findUserByEmail(cleanEmail)) {
      return res.status(409).json({ error: 'อีเมลนี้ลงทะเบียนแล้ว ลองเข้าสู่ระบบแทน' });
    }
    const hash = await bcrypt.hash(String(password), 10);
    const user = await createUser(cleanEmail, hash);
    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
    res.status(201).json({ token, email: user.email });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// เข้าสู่ระบบ
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const cleanEmail = String(email || '').trim().toLowerCase();
    const user = await findUserByEmail(cleanEmail);
    if (!user) return res.status(401).json({ error: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' });

    const ok = await bcrypt.compare(String(password || ''), user.password_hash);
    if (!ok) return res.status(401).json({ error: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' });

    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, email: user.email });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// เช็คผู้ใช้ปัจจุบันจาก token (ใช้ตอนโหลดหน้า / ตรวจ session)
app.get('/api/auth/me', authMiddleware, (req, res) => {
  res.json({ id: req.user.id, email: req.user.email });
});

// ---------- Foods (ทุกเส้นทางต้องล็อกอินก่อน) ----------

app.get('/api/foods', authMiddleware, async (req, res) => {
  try {
    res.json(await getFoods(req.user.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// เพิ่มรายการอาหารใหม่ (expiry_date ว่าง = ไม่มีวันหมดอายุ)
app.post('/api/foods', authMiddleware, async (req, res) => {
  try {
    const { name, category, expiry_date, note } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'ต้องระบุชื่ออาหาร' });
    }
    const food = await insertFood(
      {
        name: String(name).trim(),
        category: (category || '').trim(),
        expiry_date: expiry_date || null,
        note: (note || '').trim()
      },
      req.user.id
    );
    res.status(201).json(food);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// แก้ไขรายการอาหาร (เฉพาะของตัวเอง)
app.put('/api/foods/:id', authMiddleware, async (req, res) => {
  try {
    const { name, category, expiry_date, note } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'ต้องระบุชื่ออาหาร' });
    }
    const food = await updateFood(
      req.params.id,
      {
        name: String(name).trim(),
        category: (category || '').trim(),
        expiry_date: expiry_date || null,
        note: (note || '').trim()
      },
      req.user.id
    );
    if (!food) return res.status(404).json({ error: 'ไม่พบรายการอาหาร' });
    res.json(food);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ลบรายการอาหาร (เฉพาะของตัวเอง)
app.delete('/api/foods/:id', authMiddleware, async (req, res) => {
  try {
    const food = await deleteFood(req.params.id, req.user.id);
    if (!food) return res.status(404).json({ error: 'ไม่พบรายการอาหาร' });
    res.json(food);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Static (เปิด http://localhost:3000 เพื่อเข้าเว็บ) ----------
app.use(express.static(path.join(__dirname, 'tuyen')));

app.listen(3000, () => {
  console.log('Server is running on http://localhost:3000');
});