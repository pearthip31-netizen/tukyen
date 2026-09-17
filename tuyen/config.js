const SUPABASE_URL = "https://cllhshpbtsyyujhaouid.supabase.co";

const SUPABASE_ANON_KEY =
    "sb_publishable_Lp-Gu3pQd8aHOiGZ-FpVcg_dF11Ks0f";


// สร้าง Supabase client
window.tuyenSupabase = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY
);