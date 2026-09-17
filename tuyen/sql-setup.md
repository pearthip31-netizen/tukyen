# ตั้งค่า Supabase (ที่เก็บข้อมูล + backend)

แอปนี้ใช้ **Supabase เป็น backend ทั้งหมด** — ไม่ต้องรัน Node/Express อีกต่อไป
แค่ 3 ขั้นตอนด้านล่าง แล้วเปิด `tuyen/index.html` (หรือเปิดผ่าน static server) ได้เลย

---

## ขั้นตอนที่ 1 — สร้างตาราง `foods` ใน Supabase

1. ไปที่ **Supabase Dashboard → SQL Editor** (ปุ่ม ˅ ข้าง "New query")
2. วางโค้ดด้านล่าง แล้วกด **Run**

```sql
-- ตารางเก็บรายการอาหาร แยกตามผู้ใช้
create table if not exists public.foods (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null,
  category    text,
  expiry_date date,
  note        text,
  created_at  timestamptz not null default now()
);

-- ปิดการเข้าถึงแบบสาธารณะ เปิด Row Level Security
alter table public.foods enable row level security;

-- นโยบาย: ดู/เพิ่ม/แก้/ลบได้เฉพาะของตัวเอง (auth.uid())
drop policy if exists "foods_select_own" on public.foods;
create policy "foods_select_own" on public.foods
  for select using (auth.uid() = user_id);

drop policy if exists "foods_insert_own" on public.foods;
create policy "foods_insert_own" on public.foods
  for insert with check (auth.uid() = user_id);

drop policy if exists "foods_update_own" on public.foods;
create policy "foods_update_own" on public.foods
  for update using (auth.uid() = user_id);

drop policy if exists "foods_delete_own" on public.foods;
create policy "foods_delete_own" on public.foods
  for delete using (auth.uid() = user_id);
```

> ตั้งชื่อโปรเจกต์ใน Supabase เป็นอะไรก็ได้ เพียงแต่ต้องใช้ตารางชื่อ `foods` ตามนี้

---

## ขั้นตอนที่ 2 — ใส่ค่าเชื่อมต่อ

เปิดหน้าเว็บแล้วกด **"⚙️ ตั้งค่าเชื่อมต่อ Supabase"** บนหน้า login แล้วกรอก:

| ช่อง | เอาจากที่ไหน |
|------|-------------|
| **Project URL** | Supabase → **Project Settings → API** → ช่อง `Project URL` |
| **anon public key** | Supabase → **Project Settings → API** → ช่อง `anon public` |

ค่าจะถูกบันทึกใน localStorage ของเบราว์เซอร์ (ไม่ต้องแก้โค้ดอีก)
หรือจะใส่ถาวรในไฟล์ `tuyen/config.js` ก็ได้

---

## ขั้นตอนที่ 3 — ใช้ได้เลย

- เปิดหน้าเว็บ → สมัครสมาชิกด้วยอีเมล (Supabase ตั้งค่าเริ่มต้นให้ **ยืนยันอีเมล** → ไปกดลิงก์ในเมลก่อนถึงจะล็อกอิน)
- ล็อกอินเข้าสำเร็จ → อยู่หน้า `index.html` → เพิ่ม/แก้/ลบอาหารได้ ข้อมูลถูกบันทึกลงตาราง `foods` ต่อผู้ใช้

---

## หมายเหตุ (ถ้าอยากให้สมัครแล้วเข้าได้ทันที ไม่ต้องยืนยันอีเมล)

Supabase → **Authentication → Sign In / Up → Email** → ปิดสวิตช์ **"Confirm email"**
(สำหรับการเรียน/เทสต์สะดวก แต่ถ้าเปิดไว้ปลอดภัยกว่า — ได้ทั้งสองแบบ หน้าเว็บรองรับทั้งคู่)