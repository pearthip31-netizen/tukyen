function getSupabase() {
    if (!window.tuyenSupabase) {
        throw new Error("ไม่พบการเชื่อมต่อ Supabase กรุณาตรวจสอบ config.js");
    }

    return window.tuyenSupabase;
}


// ===============================
// LOGIN
// ===============================

async function apiLogin(email, password) {

    const sb = getSupabase();

    const { data, error } =
        await sb.auth.signInWithPassword({
            email,
            password
        });

    if (error) {
        if (/invalid login credentials/i.test(error.message)) {
            throw new Error("อีเมลหรือรหัสผ่านไม่ถูกต้อง");
        }

        if (/email not confirmed/i.test(error.message)) {
            throw new Error(
                "อีเมลยังไม่ได้รับการยืนยัน กรุณาตรวจสอบอีเมลก่อน"
            );
        }

        throw new Error(error.message);
    }

    return data;
}


// ===============================
// REGISTER
// ===============================

async function apiRegister(email, password) {

    const sb = getSupabase();

    const { data, error } =
        await sb.auth.signUp({
            email,
            password
        });

    if (error) {

        if (/already registered/i.test(error.message)) {
            throw new Error("อีเมลนี้ลงทะเบียนแล้ว ลองเข้าสู่ระบบแทน");
        }

        if (/at least 6 characters/i.test(error.message)) {
            throw new Error("รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร");
        }

        throw new Error(error.message);
    }

    return data;
}


// ===============================
// CHECK LOGIN
// ===============================

async function apiMe() {

    const sb = getSupabase();

    const { data, error } =
        await sb.auth.getSession();

    if (error || !data.session) {
        return null;
    }

    return data.session.user;
}


// ===============================
// REQUIRE LOGIN
// ===============================

async function requireAuth(
    redirectPage = "login.html"
) {

    try {

        const user = await apiMe();

        if (!user) {
            window.location.href = redirectPage;
            return null;
        }

        return user;

    } catch (error) {

        console.error(error);

        window.location.href = redirectPage;

        return null;
    }
}


// ===============================
// LOGOUT
// ===============================

async function logout() {

    const sb = getSupabase();

    await sb.auth.signOut();

    window.location.href = "login.html";
}


// ===============================
// Compatibility
// ===============================

async function authHeaders() {
    return {};
}

async function apiLogin(email, password) {
    const sb = getSupabase();

    const { data, error } =
        await sb.auth.signInWithPassword({
            email: email,
            password: password
        });

    if (error) {
        if (/invalid login credentials/i.test(error.message)) {
            throw new Error("อีเมลหรือรหัสผ่านไม่ถูกต้อง");
        }

        throw new Error(error.message);
    }

    return data;
}