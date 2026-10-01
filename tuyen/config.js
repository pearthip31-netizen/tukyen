// =====================================================
// TUYEN - Supabase Config
// =====================================================

const SUPABASE_URL =
    "https://cllhshpbtsyyujhaouid.supabase.co";

const SUPABASE_ANON_KEY =
    "sb_publishable_Lp-Gu3pQd8aHOiGZ-FpVcg_dF11Ks0f";


// =====================================================
// สร้าง Supabase Client
// =====================================================

const tuyensupabase =
    window.supabase.createClient(
        SUPABASE_URL,
        SUPABASE_ANON_KEY
    );


// =====================================================
// ให้ทุกหน้าเรียกใช้ผ่าน getSupabase()
// =====================================================

function getSupabase() {

    return tuyensupabase;

}