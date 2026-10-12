// =====================================================
// TUYEN - FOOD CRUD + SHARED FRIDGE
// =====================================================
// Supabase table: food
//   food_id, food_name, manu, location, quantity, import_date,
//   export_date, status, user_id, fridge_id, added_by
//
// Supabase table: notify  (ใช้สำหรับนับจำนวนการแจ้งเตือน)
//   notify_id, notify_text, notify_date, user_id, food_id, is_read
// =====================================================

const FOOD_TABLE = "food";
const USERS_TABLE = "users";

// ตารางแจ้งเตือน + element ที่ใช้แสดงจำนวนบนเมนู "การแจ้งเตือน"
const NOTIFY_TABLE = "notify";
const NOTIFY_COUNT_ELEMENT_ID = "tuyen-notification-count";

const CURRENT_FRIDGE_STORAGE_KEY = "tuyen_current_fridge_id";

// ---- element ของหน้า index.html ที่เกี่ยวกับกล่องแนะนำผู้ใช้ใหม่ ----
const ONBOARDING_ELEMENT_ID = "onboarding-empty-state";
const DASHBOARD_SECTION_IDS = [
    "dashboard-header",
    "dashboard-stats",
    "dashboard-food"
];
// ปุ่มปิดกล่องแนะนำ (ถ้ามีใน index.html ตัวใดตัวหนึ่ง จะถูกผูก event ให้เอง)
const ONBOARDING_CLOSE_SELECTOR = [
    "#onboarding-close",
    "#onboarding-close-btn",
    "#onboarding-dismiss",
    "#close-onboarding",
    "[data-onboarding-close]"
].join(",");


let foods = [];
let currentUser = null;
let authUser = null;
let editingFoodId = null;
let currentFilter = "all";
let searchText = "";
let realtimeChannel = null;

// สถานะกล่องแนะนำ
let hasFridge = null;            // null = ยังไม่รู้, true/false = ผลตรวจล่าสุด
let onboardingDismissed = false; // ผู้ใช้กดปิดกล่องแนะนำ (เฉพาะรอบนี้)


// =====================================================
// SHORTCUT
// =====================================================

const $ = (id) => document.getElementById(id);


// =====================================================
// NOTIFICATION COUNT
// =====================================================
// นับจากฐานข้อมูล Supabase เท่านั้น
//   notify.user_id = ผู้ใช้ปัจจุบัน และ notify.is_read = false
// - จำนวนจะลดลงก็ต่อเมื่อ is_read ในฐานข้อมูลเปลี่ยนเป็น true
// - ทุกหน้าที่เปิดอยู่จะอัปเดตตามผ่าน Realtime (และ polling สำรอง)
// - รวมคำเชิญที่ยัง pending ด้วย (ดู getNotificationCount)

function renderNotificationCount(count) {

    const element = $(NOTIFY_COUNT_ELEMENT_ID);

    if (!element) return;

    const total = Math.max(0, Number(count) || 0);

    element.textContent = total > 99 ? "99+" : String(total);
    element.hidden = total === 0;
    element.style.display = total === 0 ? "none" : "";
    element.classList.toggle("hidden", total === 0);
    element.setAttribute("aria-hidden", String(total === 0));

    if (total > 0) {
        element.setAttribute("title", `${total} การแจ้งเตือนที่ยังไม่ได้อ่าน`);
    } else {
        element.removeAttribute("title");
    }

}

// คืนค่าจำนวนที่ยังไม่อ่านของผู้ใช้ปัจจุบัน หรือ null ถ้านับไม่สำเร็จ
// = notify ที่ is_read = false และมี food_id ของผู้ใช้นี้
// + คำเชิญเข้าตู้เย็นที่ยัง status = 'pending' ส่งถึงอีเมลของบัญชีนี้
//   (นับสูตรเดียวกับ notification.html เพื่อให้กระดิ่งทุกหน้าตรงกัน)
async function getNotificationCount() {

    const userId = currentUser?.user_id;

    if (!userId) return null;

    try {

        const sb = getSB();

        // นับเฉพาะแจ้งเตือนอาหาร (food_id ไม่ว่าง)
        // คำเชิญนับจาก fridge_invitations ด้านล่าง ถ้านับสองทางจะนับซ้ำ
        const notifyQuery = sb
            .from(NOTIFY_TABLE)
            .select("notify_id", { count: "exact", head: true })
            .eq("user_id", userId)
            .eq("is_read", false)
            .not("food_id", "is", null);

        // escape ตัวอักษรพิเศษของ ILIKE (\ % _) ในอีเมล
        const email = String(authUser?.email || currentUser?.user_email || "")
            .trim()
            .replace(/[\\%_]/g, "\\$&");

        const inviteQuery = email
            ? sb
                .from("fridge_invitations")
                .select("invitation_id", { count: "exact", head: true })
                .eq("status", "pending")
                .ilike("invited_email", email)
            : Promise.resolve({ count: 0, error: null });

        const [notifyResult, inviteResult] = await Promise.all([
            notifyQuery,
            inviteQuery
        ]);

        // นับ notify ไม่ได้ -> คืน null (คงตัวเลขเดิม)
        if (notifyResult.error) throw notifyResult.error;

        // นับคำเชิญไม่ได้ (เช่น RLS) -> เตือนแล้วนับเป็น 0 ไม่ให้ระบบหยุด
        if (inviteResult.error) {
            console.warn("นับคำเชิญไม่สำเร็จ:", inviteResult.error);
        }

        const total =
            Number(notifyResult.count ?? 0) +
            (inviteResult.error ? 0 : Number(inviteResult.count ?? 0));

        return Number.isFinite(total) ? total : 0;

    } catch (error) {

        console.warn("นับแจ้งเตือนไม่สำเร็จ:", error);

        return null;

    }

}

let notifyUpdating = false;
let notifyUpdatePending = false;
let notifyRefreshTimer = null;
let notifyRealtimeChannel = null;
let notifyRealtimeUserId = null;
let notifyPollTimer = null;

async function updateNotificationCount() {

    if (!currentUser?.user_id) {
        renderNotificationCount(0);
        return;
    }

    if (notifyUpdating) {
        notifyUpdatePending = true;
        return;
    }

    notifyUpdating = true;

    try {

        do {

            notifyUpdatePending = false;

            const userIdAtStart = String(currentUser.user_id);

            const total = await getNotificationCount();

            // ไม่ใช้ผลเก่าถ้าผู้ใช้เปลี่ยนระหว่างโหลด
            if (userIdAtStart !== String(currentUser?.user_id)) {
                notifyUpdatePending = true;
                continue;
            }

            // นับไม่สำเร็จ -> คงตัวเลขเดิมไว้ ไม่เด้งเป็น 0
            if (total !== null) {
                renderNotificationCount(total);
            }

        } while (notifyUpdatePending && currentUser?.user_id);

    } catch (error) {

        console.warn("อัปเดตจำนวนแจ้งเตือนไม่สำเร็จ:", error);

    } finally {

        notifyUpdating = false;

    }

}

window.updateNotificationCount = updateNotificationCount;

function scheduleNotificationRefresh() {

    clearTimeout(notifyRefreshTimer);

    notifyRefreshTimer = setTimeout(() => {
        updateNotificationCount();
    }, 300);

}

function teardownNotificationRealtime() {

    clearTimeout(notifyRefreshTimer);
    notifyRefreshTimer = null;

    if (notifyPollTimer) {
        clearInterval(notifyPollTimer);
        notifyPollTimer = null;
    }

    const channel = notifyRealtimeChannel;

    notifyRealtimeChannel = null;
    notifyRealtimeUserId = null;

    if (channel) {

        try {

            Promise.resolve(getSB().removeChannel(channel))
                .catch((error) => {
                    console.warn("ปิด Notification Realtime ไม่สำเร็จ:", error);
                });

        } catch (error) {

            console.warn("ปิด Notification Realtime ไม่สำเร็จ:", error);

        }

    }

}

function setupNotificationRealtime() {

    if (!currentUser?.user_id) return;

    const userId = String(currentUser.user_id);

    // ติดตาม user นี้อยู่แล้ว -> ไม่สมัครซ้ำ (และไม่สร้าง polling ซ้ำ)
    if (notifyRealtimeChannel && notifyRealtimeUserId === userId) {
        return;
    }

    // user เปลี่ยน หรือยังไม่เคยสมัคร -> ล้างของเก่าก่อน
    teardownNotificationRealtime();

    try {

        notifyRealtimeUserId = userId;

        // ไม่ใช้ filter เพราะ DELETE กรองด้วย filter ไม่ได้
        // การนับกรอง user_id อยู่แล้วใน getNotificationCount()
        notifyRealtimeChannel = getSB()
            .channel(`tuyen-notify-${userId}`)
            .on(
                "postgres_changes",
                { event: "*", schema: "public", table: NOTIFY_TABLE },
                scheduleNotificationRefresh
            )
            // คำเชิญใหม่ / ตอบรับ / ปฏิเสธ (status เปลี่ยน) -> นับใหม่
            .on(
                "postgres_changes",
                { event: "*", schema: "public", table: "fridge_invitations" },
                scheduleNotificationRefresh
            )
            .subscribe();

        // สำรองกรณี Realtime ไม่ส่ง event มา (ชุดเดียวต่อผู้ใช้)
        notifyPollTimer = setInterval(() => {
            if (document.visibilityState === "visible") {
                updateNotificationCount();
            }
        }, 10000);

    } catch (error) {

        console.warn("ตั้ง Realtime แจ้งเตือนไม่สำเร็จ:", error);

        notifyRealtimeChannel = null;
        notifyRealtimeUserId = null;

    }

}


// =====================================================
// SHARED FRIDGE
// =====================================================

let currentFridgeId = null;
let currentFridgeRole = null;

// เก็บข้อมูล user ของคนที่เพิ่มอาหาร
let foodUserMap = new Map();


// =====================================================
// SUPABASE CLIENT
// =====================================================

function getSB() {

    // ใช้ getSupabase() จาก config.js ก่อน
    if (typeof getSupabase === "function") {
        return getSupabase();
    }

    // fallback ถ้ามีตัวแปร supabase เป็น client อยู่แล้ว
    if (
        typeof supabase !== "undefined" &&
        supabase &&
        typeof supabase.from === "function" &&
        supabase.auth
    ) {
        return supabase;
    }

    throw new Error("ไม่พบ Supabase client กรุณาตรวจสอบ config.js");

}


// =====================================================
// ONBOARDING / DASHBOARD VISIBILITY
// =====================================================
// ไม่มีตู้เย็น  -> แสดง #onboarding-empty-state ซ่อน dashboard ทั้งหมด
// มีตู้เย็น     -> ซ่อนกล่องแนะนำ แสดง dashboard ตามปกติ

function setElementVisible(element, visible) {

    if (!element) return;

    element.classList.toggle("hidden", !visible);
    element.hidden = !visible;

}

function setFridgeDashboardVisible(fridgePresent) {

    hasFridge = Boolean(fridgePresent);

    // กล่องแนะนำแสดงเมื่อ "ไม่มีตู้เย็น" และผู้ใช้ยังไม่ได้กดปิด
    setElementVisible(
        $(ONBOARDING_ELEMENT_ID),
        !hasFridge && !onboardingDismissed
    );

    DASHBOARD_SECTION_IDS.forEach((id) => {
        setElementVisible($(id), hasFridge);
    });

    // ไม่มีตู้เย็น -> ปิดฟอร์มเพิ่มอาหารที่อาจเปิดค้างอยู่
    if (!hasFridge) {
        $("food-form-overlay")?.classList.add("hidden");
    }

}

// ไม่มีตู้เย็น: เคลียร์ข้อมูลอาหารและเลิกติดตาม Realtime ของอาหาร
function applyNoFridgeState() {

    currentFridgeId = null;
    currentFridgeRole = null;
    foods = [];
    foodUserMap = new Map();

    teardownFoodRealtime();

    setFridgeDashboardVisible(false);

}


function bindOnboardingEvents() {
    document.querySelectorAll(ONBOARDING_CLOSE_SELECTOR).forEach((button) => {
        if (button.dataset.onboardingBound === "1") return;

        button.dataset.onboardingBound = "1";

        button.addEventListener("click", () => {
            try {
                sessionStorage.setItem(ONBOARDING_ACK_KEY, "1");
            } catch (error) {
                console.warn("บันทึกสถานะ onboarding ไม่สำเร็จ:", error);
            }

            onboardingDismissed = true;
            setElementVisible($(ONBOARDING_ELEMENT_ID), false);
        }, true);
    });
}



// =====================================================
// START
// =====================================================

document.addEventListener("DOMContentLoaded", async () => {

    bindEvents();

    setFormDefaults();

    await initialize();

});


// =====================================================
// EVENTS
// =====================================================

function bindEvents() {

    // -------------------------
    // เพิ่มอาหาร
    // -------------------------

    $("add-food-btn")?.addEventListener("click", () => {

        // ยังไม่มีตู้เย็น: ไม่เปิดฟอร์ม และไม่แสดง alert (มีกล่องแนะนำอยู่แล้ว)
        if (!currentFridgeId) {
            return;
        }

        if (!canEditCurrentFridge()) {
            alert("สิทธิ์ของคุณไม่สามารถเพิ่มอาหารในตู้เย็นนี้ได้");
            return;
        }

        openFoodForm();

    });

    // -------------------------
    // ปิดฟอร์ม
    // -------------------------

    $("food-form-close")?.addEventListener("click", closeFoodForm);
    $("food-form-cancel")?.addEventListener("click", closeFoodForm);

    // -------------------------
    // Submit
    // -------------------------

    $("food-form")?.addEventListener("submit", saveFood);

    // -------------------------
    // Search
    // -------------------------

    $("search-food")?.addEventListener("input", (event) => {

        searchText = String(event.target.value || "").trim().toLowerCase();

        renderFoods();

    });

    // -------------------------
    // Global Search (ค้นหาข้ามตู้เย็น)
    // -------------------------

    setupGlobalSearch();

    // -------------------------
    // Filter
    // -------------------------

    document.querySelectorAll("[data-food-filter]").forEach((button) => {

        button.addEventListener("click", () => {

            currentFilter = button.dataset.foodFilter || "all";

            updateFilterButtons();

            renderFoods();

        });

    });

    // -------------------------
    // Location
    // -------------------------

    $("f-location")?.addEventListener("change", handleLocationChange);

    // -------------------------
    // Expiry preview
    // -------------------------

    $("f-export-date")?.addEventListener("change", updateFormStatusPreview);

    // -------------------------
    // Click outside modal
    // -------------------------

    $("food-form-overlay")?.addEventListener("click", (event) => {

        if (event.target === event.currentTarget) {
            closeFoodForm();
        }

    });

    // -------------------------
    // Logout
    // -------------------------

    $("logout-btn")?.addEventListener("click", handleLogout);

    // -------------------------
    // ปุ่มปิดกล่องแนะนำ (ถ้ามี)
    // -------------------------

    bindOnboardingEvents();

    // -------------------------
    // ESC
    // -------------------------

    document.addEventListener("keydown", (event) => {

        if (
            event.key === "Escape" &&
            $("food-form-overlay") &&
            !$("food-form-overlay").classList.contains("hidden")
        ) {
            closeFoodForm();
        }

    });

}


// =====================================================
// INITIALIZE
// =====================================================

async function initialize() {

    try {

        const sb = getSB();

        const { data, error } = await sb.auth.getSession();

        if (error) {

            console.error("ตรวจสอบ Session ไม่สำเร็จ:", error);

            redirectToLogin();

            return;

        }

        const user = data?.session?.user;

        // ไม่มี session จริง ๆ
        if (!user) {
            redirectToLogin();
            return;
        }

        authUser = user;

        // -------------------------
        // แสดง email
        // -------------------------

        setText("user-email", user.email || "ผู้ใช้");
        setText("form-user-email", user.email || "ผู้ใช้");

        // -------------------------
        // หา user ใน public.users
        // -------------------------

        currentUser = await getCurrentDBUser(user);

        if (!currentUser?.user_id) {
            setFridgeDashboardVisible(true); // ให้เห็นข้อความ error ใน food-list
            showError("ไม่พบ user_id ของผู้ใช้งาน");
            return;
        }

        // -------------------------
        // จำนวนแจ้งเตือน
        // (ไม่ await เพื่อไม่ให้หน่วงการโหลดอาหาร
        // และถ้าล้มเหลวจะไม่กระทบระบบหลัก)
        // ทำก่อนตรวจตู้เย็น เพื่อให้ผู้ใช้ใหม่ที่ถูกเชิญเห็น badge ด้วย
        // -------------------------

        updateNotificationCount();
        setupNotificationRealtime();

        // -------------------------
        // หา fridge ปัจจุบัน
        // -------------------------

        await getCurrentFridgeForUser();

        // นำทางตามสถานะตู้เย็น (หลังตรวจ session + ตู้เย็นเสร็จแล้ว)
        if (navigateByFridgeStatus(Boolean(currentFridgeId))) return;

        // ยังไม่มีตู้เย็น -> แสดงกล่องแนะนำ (ไม่แสดง error)
        if (!currentFridgeId) {
            applyNoFridgeState();
            return;
        }

        setFridgeDashboardVisible(true);

        // -------------------------
        // โหลดอาหาร
        // -------------------------

        await loadFoods();

        // -------------------------
        // Realtime
        // -------------------------

        setupRealtime();

    } catch (error) {

        console.error("initialize error:", error);

        if (handleAuthError(error)) {
            return;
        }

        // เกิดข้อผิดพลาดจริง (ไม่ใช่แค่ไม่มีตู้เย็น) -> แสดงข้อความในรายการอาหาร
        setFridgeDashboardVisible(true);

        showError(error?.message || "ไม่สามารถเปิดระบบได้");

    }

}


// =====================================================
// GET CURRENT DB USER
// =====================================================

async function getCurrentDBUser(user) {

    const sb = getSB();

    const email = String(user?.email || "").trim();

    // ถ้าไม่มี email
    if (!email) {
        return { user_id: user.id, name: "", user_email: "" };
    }

    try {

        const { data, error } = await sb
            .from(USERS_TABLE)
            .select("user_id, name, user_email")
            .eq("user_email", email)
            .maybeSingle();

        if (!error && data) {
            return data;
        }

        if (error) {
            console.warn("ค้นหา users ไม่สำเร็จ:", error);
        }

    } catch (error) {

        console.warn("อ่าน users ไม่สำเร็จ:", error);

    }

    // fallback
    return { user_id: user.id, name: "", user_email: email };

}


// =====================================================
// CURRENT FRIDGE
// =====================================================
// ลำดับการเลือก:
// 1. ตู้ที่เลือกไว้ล่าสุด (localStorage: tuyen_current_fridge_id)
// 2. ตู้ที่ user เป็น owner
// 3. ตู้ที่ user เป็น editor
// 4. ตู้แรกที่ user เป็นสมาชิก active
// =====================================================

async function getCurrentFridgeForUser() {

    if (!currentUser?.user_id) {
        currentFridgeId = null;
        currentFridgeRole = null;
        return null;
    }

    const sb = getSB();

    // -------------------------
    // โหลด fridge ที่เข้าถึงได้
    // -------------------------

    const { data: fridges, error: fridgeError } = await sb
        .from("fridges")
        .select("fridge_id, fridge_name, created_by, created_at")
        .order("created_at", { ascending: true });

    if (fridgeError) {
        throw new Error(fridgeError.message);
    }

    const fridgeRows = Array.isArray(fridges) ? fridges : [];

    if (fridgeRows.length === 0) {
        currentFridgeId = null;
        currentFridgeRole = null;
        return null;
    }

    // -------------------------
    // โหลด membership ของ user (เฉพาะ active)
    // -------------------------

    const { data: memberships, error: memberError } = await sb
        .from("fridge_members")
        .select("fridge_id, role, status")
        .eq("user_id", currentUser.user_id)
        .eq("status", "active");

    if (memberError) {
        throw new Error(memberError.message);
    }

    const membershipRows = Array.isArray(memberships) ? memberships : [];

    // Map fridge_id -> role
    const roleMap = new Map(
        membershipRows.map((row) => [String(row.fridge_id), row.role])
    );

    // ไม่มี membership เลย
    if (roleMap.size === 0) {
        currentFridgeId = null;
        currentFridgeRole = null;
        return null;
    }

    let selected = null;

    // -------------------------
    // ใช้ fridge ที่เคยเลือกไว้ (ต้องยังเป็นสมาชิกอยู่)
    // -------------------------

    const savedFridgeId = localStorage.getItem(CURRENT_FRIDGE_STORAGE_KEY);

    if (savedFridgeId) {

        selected = fridgeRows.find((fridge) => {

            const id = String(fridge.fridge_id);

            return id === String(savedFridgeId) && roleMap.has(id);

        }) || null;

    }

    // owner ก่อน
    if (!selected) {
        selected = fridgeRows.find(
            (fridge) => roleMap.get(String(fridge.fridge_id)) === "owner"
        ) || null;
    }

    // แล้ว editor
    if (!selected) {
        selected = fridgeRows.find(
            (fridge) => roleMap.get(String(fridge.fridge_id)) === "editor"
        ) || null;
    }

    // แล้วสมาชิกตัวแรก
    if (!selected) {
        selected = fridgeRows.find(
            (fridge) => roleMap.has(String(fridge.fridge_id))
        ) || null;
    }

    if (!selected) {
        currentFridgeId = null;
        currentFridgeRole = null;
        return null;
    }

    currentFridgeId = selected.fridge_id;

    currentFridgeRole = roleMap.get(String(selected.fridge_id)) || null;

    // จำ fridge ปัจจุบัน
    localStorage.setItem(CURRENT_FRIDGE_STORAGE_KEY, String(currentFridgeId));

    // อัปเดตชื่อถ้ามี element
    updateCurrentFridgeUI(selected);

    return selected;

}


// =====================================================
// UPDATE CURRENT FRIDGE UI
// =====================================================

function updateCurrentFridgeUI(fridge) {

    if (!fridge) return;

    [
        "current-fridge-name",
        "fridge-name",
        "current-fridge",
        "selected-fridge-name"
    ].forEach((id) => {

        const element = $(id);

        if (element) {
            element.textContent = fridge.fridge_name || "";
        }

    });

}


// =====================================================
// PERMISSION
// =====================================================

function canEditCurrentFridge() {

    return currentFridgeRole === "owner" || currentFridgeRole === "editor";

}


// =====================================================
// AUTH ERROR
// =====================================================

function handleAuthError(error) {

    const message = String(error?.message || error || "");

    if (
        /invalid jwt|jwt expired|refresh token|invalid refresh token|session missing|not authenticated|permission denied|PGRST301/i
            .test(message)
    ) {
        redirectToLogin();
        return true;
    }

    return false;

}


// =====================================================
// REDIRECT LOGIN
// =====================================================

function redirectToLogin() {

    if (!location.pathname.endsWith("login.html")) {
        window.location.replace("login.html");
    }

}


// =====================================================
// NAVIGATION: index.html <-> indexnew.html ตามสถานะตู้เย็น
// =====================================================

const ONBOARDING_ACK_KEY = "tuyen_onboarding_ack";
let fridgeNavigating = false;

function getCurrentPageName() {

    const name = (location.pathname.split("/").pop() || "")
        .toLowerCase()
        .replace(/\.html$/, "");

    return name === "" ? "index" : name;

}

// คืน true ถ้ากำลังเปลี่ยนหน้า (ผู้เรียกควรหยุดทำงานต่อ)
// เรียกได้หลังตรวจ session + ตู้เย็นเสร็จแล้วเท่านั้น
function navigateByFridgeStatus(fridgePresent) {

    if (fridgeNavigating) return true;

    const page = getCurrentPageName();

    if (page !== "index" && page !== "indexnew") return false;

    let acknowledged = false;

    try {
        acknowledged = sessionStorage.getItem(ONBOARDING_ACK_KEY) === "1";
    } catch (error) {}

    let target = null;

    if (fridgePresent) {

        // มีตู้เย็นแล้ว -> ล้าง flag และให้อยู่ index.html
        try {
            sessionStorage.removeItem(ONBOARDING_ACK_KEY);
        } catch (error) {}

        if (page === "indexnew") target = "index.html";

    } else if (page === "index" && !acknowledged) {

        // ไม่มีตู้เย็น และยังไม่เคยกด "เข้าใจแล้ว" -> ไป indexnew.html
        target = "indexnew.html";

    }

    if (!target) return false;

    fridgeNavigating = true;

    window.location.replace(target);

    return true;

}


// =====================================================
// LOGOUT
// =====================================================

async function handleLogout() {

    try {

        await getSB().auth.signOut();

    } catch (error) {

        console.error("Logout error:", error);

    } finally {

        // เลิกติดตามแจ้งเตือนและซ่อนตัวเลข
        teardownNotificationRealtime();

        renderNotificationCount(0);

        try {
            sessionStorage.removeItem(ONBOARDING_ACK_KEY);
        } catch (error) {}

        // ปิดผลค้นหา/รายละเอียดที่เปิดค้างอยู่
        teardownGlobalSearchUI();

        ["currentUser", "user", "loggedInUser", "tuyenUser"].forEach((key) => {

            try {
                localStorage.removeItem(key);
            } catch (error) {
                console.warn("ล้าง localStorage ไม่สำเร็จ:", error);
            }

        });

        window.location.replace("login.html");

    }

}


// =====================================================
// REALTIME (FOOD)
// =====================================================

function teardownFoodRealtime() {

    if (!realtimeChannel) return;

    try {
        getSB().removeChannel(realtimeChannel);
    } catch (error) {
        console.warn("ปิด Realtime อาหารไม่สำเร็จ:", error);
    }

    realtimeChannel = null;

}

function setupRealtime() {

    try {

        if (!currentUser?.user_id || !currentFridgeId) {
            return;
        }

        const sb = getSB();

        // ลบ channel เดิม
        teardownFoodRealtime();

        realtimeChannel = sb
            .channel(`tuyen-food-${String(currentFridgeId)}`)
            .on(
                "postgres_changes",
                { event: "*", schema: "public", table: FOOD_TABLE },
                async () => {
                    await loadFoods();
                }
            )
            .subscribe();

    } catch (error) {

        console.warn("ตั้ง Realtime ไม่สำเร็จ:", error);

    }

}


// =====================================================
// LOAD FOODS
// =====================================================

async function loadFoods() {

    if (!currentUser?.user_id) {
        showMessage("ไม่พบ user_id ของผู้ใช้งาน");
        return;
    }

    // ถ้ายังไม่มี fridge
    if (!currentFridgeId) {
        await getCurrentFridgeForUser();
    }

    // ยังไม่มีตู้เย็น -> แสดงกล่องแนะนำ ไม่แสดง error
    if (!currentFridgeId) {
        applyNoFridgeState();
        return;
    }

    // มีตู้เย็นแล้ว -> แสดง dashboard
    setFridgeDashboardVisible(true);

    try {

        const sb = getSB();

        // โหลดอาหารตาม fridge_id (ไม่ใช่ user_id)
        const { data, error } = await sb
            .from(FOOD_TABLE)
            .select("*")
            .eq("fridge_id", currentFridgeId)
            .order("export_date", { ascending: true });

        if (error) {

            if (handleAuthError(error)) {
                return;
            }

            console.error("โหลดอาหารไม่สำเร็จ:", error);

            showError(error.message);

            return;

        }

        foods = Array.isArray(data) ? data : [];

        // -------------------------
        // โหลดชื่อคนที่เพิ่มอาหาร
        // -------------------------

        const addedByIds = [
            ...new Set(
                foods
                    .map((food) => food.added_by || food.user_id)
                    .filter(Boolean)
            )
        ];

        foodUserMap = new Map();

        if (addedByIds.length) {

            const { data: users, error: usersError } = await sb
                .from(USERS_TABLE)
                .select("user_id, name, user_email")
                .in("user_id", addedByIds);

            if (usersError) {
                console.warn("โหลดข้อมูลผู้เพิ่มอาหารไม่สำเร็จ:", usersError);
            }

            (users || []).forEach((user) => {
                foodUserMap.set(String(user.user_id), user);
            });

        }

        renderFoods();

        // อัปเดตจำนวนแจ้งเตือนหลังโหลดข้อมูลอาหารสำเร็จ
        // (ไม่ await และไม่ throw จึงไม่กระทบการโหลดอาหาร)
        updateNotificationCount();

    } catch (error) {

        if (handleAuthError(error)) {
            return;
        }

        console.error("loadFoods error:", error);

        showError(error?.message || "โหลดรายการอาหารไม่สำเร็จ");

    }

}


// =====================================================
// SAVE FOOD
// CREATE + UPDATE
// =====================================================

async function saveFood(event) {

    event.preventDefault();

    if (!currentUser?.user_id) {
        alert("ไม่พบข้อมูลผู้ใช้ กรุณาเข้าสู่ระบบใหม่");
        redirectToLogin();
        return;
    }

    // -------------------------
    // ตรวจ fridge
    // -------------------------

    if (!currentFridgeId) {
        await getCurrentFridgeForUser();
    }

    if (!currentFridgeId) {
        // ยังไม่มีตู้เย็น: ไม่ให้เพิ่มอาหาร กลับไปที่กล่องแนะนำ
        closeFoodForm();
        applyNoFridgeState();
        return;
    }

    // -------------------------
    // ตรวจสิทธิ์
    // -------------------------

    if (!canEditCurrentFridge()) {
        alert("สิทธิ์ของคุณไม่สามารถเพิ่มหรือแก้ไขอาหารในตู้เย็นนี้ได้");
        return;
    }

    // -------------------------
    // รับค่า
    // -------------------------

    const foodName = $("f-name")?.value.trim() || "";
    const manu = $("f-manu")?.value.trim() || "";
    const selectedLocation = $("f-location")?.value.trim() || "";
    const otherLocation = $("f-location-other")?.value.trim() || "";

    const location =
        selectedLocation === "อื่นๆ" ? otherLocation : selectedLocation;

    const quantity = Number($("f-quantity")?.value);
    const importDate = $("f-import-date")?.value || "";
    const exportDate = $("f-export-date")?.value || "";

    // -------------------------
    // Validation
    // -------------------------

    if (
        !foodName ||
        !manu ||
        !selectedLocation ||
        !location ||
        !importDate ||
        !exportDate
    ) {
        alert("กรุณากรอกข้อมูลที่มีเครื่องหมาย * ให้ครบ");
        return;
    }

    if (!Number.isFinite(quantity) || quantity < 1) {
        alert("จำนวนต้องเป็นตัวเลขตั้งแต่ 1 ขึ้นไป");
        return;
    }

    if (exportDate < importDate) {
        alert("วันหมดอายุต้องไม่ก่อนวันที่นำเข้า");
        return;
    }

    const status = calculateStatus(exportDate);

    // =================================================
    // INSERT PAYLOAD
    // =================================================

    const payload = {
        food_name: foodName,
        manu: manu,
        location: location,
        quantity: quantity,
        import_date: importDate,
        export_date: exportDate,
        status: status,
        user_id: currentUser.user_id,      // user เดิม
        fridge_id: currentFridgeId,        // ตู้ปัจจุบัน
        added_by: currentUser.user_id      // คนที่เอาอาหารใส่
    };

    const submitButton = $("food-form-submit");

    const isEditing = Boolean(editingFoodId);

    if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = "กำลังบันทึก...";
    }

    try {

        const sb = getSB();

        let result;

        if (isEditing) {

            // UPDATE: ไม่แก้ added_by คนเดิมยังเป็นคนที่นำอาหารเข้าตู้
            const updatePayload = {
                food_name: foodName,
                manu: manu,
                location: location,
                quantity: quantity,
                import_date: importDate,
                export_date: exportDate,
                status: status
            };

            result = await sb
                .from(FOOD_TABLE)
                .update(updatePayload)
                .eq("food_id", editingFoodId)
                .eq("fridge_id", currentFridgeId);

        } else {

            // INSERT
            result = await sb.from(FOOD_TABLE).insert(payload);

        }

        if (result.error) {

            if (handleAuthError(result.error)) {
                return;
            }

            throw new Error(result.error.message);

        }

        closeFoodForm();

        await loadFoods();

    } catch (error) {

        if (handleAuthError(error)) {
            return;
        }

        console.error("บันทึกไม่สำเร็จ:", error);

        alert("บันทึกไม่สำเร็จ: " + (error?.message || "เกิดข้อผิดพลาด"));

    } finally {

        if (submitButton) {
            submitButton.disabled = false;
            submitButton.textContent = isEditing ? "บันทึกการแก้ไข" : "บันทึก";
        }

    }

}


// =====================================================
// DELETE FOOD
// =====================================================

async function deleteFood(foodId) {

    if (!currentUser?.user_id) {
        alert("ไม่พบข้อมูลผู้ใช้");
        redirectToLogin();
        return;
    }

    if (!canEditCurrentFridge()) {
        alert("สิทธิ์ของคุณไม่สามารถลบอาหารในตู้เย็นนี้ได้");
        return;
    }

    const food = foods.find((item) => String(item.food_id) === String(foodId));

    const foodName = food?.food_name || "รายการนี้";

    if (!confirm(`ต้องการลบ "${foodName}" ใช่หรือไม่?`)) {
        return;
    }

    try {

        const { error } = await getSB()
            .from(FOOD_TABLE)
            .delete()
            .eq("food_id", foodId)
            .eq("fridge_id", currentFridgeId);

        if (error) {

            if (handleAuthError(error)) {
                return;
            }

            throw new Error(error.message);

        }

        await loadFoods();

    } catch (error) {

        if (handleAuthError(error)) {
            return;
        }

        console.error("ลบไม่สำเร็จ:", error);

        alert("ลบไม่สำเร็จ: " + (error?.message || "เกิดข้อผิดพลาด"));

    }

}

window.deleteFood = deleteFood;


// =====================================================
// STOCK
// =====================================================

async function updateStock(foodId, change) {

    if (!currentUser?.user_id) {
        alert("ไม่พบข้อมูลผู้ใช้ กรุณาเข้าสู่ระบบใหม่");
        redirectToLogin();
        return;
    }

    if (!canEditCurrentFridge()) {
        alert("สิทธิ์ของคุณไม่สามารถแก้ไขจำนวนอาหารในตู้เย็นนี้ได้");
        return;
    }

    const food = foods.find((item) => String(item.food_id) === String(foodId));

    if (!food) {
        alert("ไม่พบรายการอาหารนี้");
        return;
    }

    const currentQuantity = Math.max(0, Number(food.quantity ?? 0));

    const newQuantity = currentQuantity + Number(change);

    if (newQuantity < 0) {
        return;
    }

    try {

        const { error } = await getSB()
            .from(FOOD_TABLE)
            .update({ quantity: newQuantity })
            .eq("food_id", foodId)
            .eq("fridge_id", currentFridgeId);

        if (error) {

            if (handleAuthError(error)) {
                return;
            }

            throw new Error(error.message);

        }

        await loadFoods();

    } catch (error) {

        if (handleAuthError(error)) {
            return;
        }

        console.error("อัปเดตจำนวนไม่สำเร็จ:", error);

        alert("อัปเดตจำนวนไม่สำเร็จ: " + (error?.message || "เกิดข้อผิดพลาด"));

    }

}

async function decreaseStock(foodId) {
    await updateStock(foodId, -1);
}

async function increaseStock(foodId) {
    await updateStock(foodId, 1);
}

window.decreaseStock = decreaseStock;
window.increaseStock = increaseStock;


// =====================================================
// OPEN FORM
// =====================================================

function openFoodForm(food = null) {

    // ยังไม่มีตู้เย็น: ไม่เปิดฟอร์ม
    if (!currentFridgeId) {
        return;
    }

    if (!canEditCurrentFridge()) {
        alert("สิทธิ์ของคุณไม่สามารถเพิ่มหรือแก้ไขอาหารในตู้เย็นนี้ได้");
        return;
    }

    editingFoodId = food ? food.food_id : null;

    setText("food-form-title", food ? "แก้ไขรายการอาหาร" : "เพิ่มรายการอาหาร");
    setText("food-form-submit", food ? "บันทึกการแก้ไข" : "บันทึก");

    if ($("f-name")) {
        $("f-name").value = food?.food_name || "";
    }

    if ($("f-manu")) {
        $("f-manu").value = food?.manu || "";
    }

    if ($("f-quantity")) {
        $("f-quantity").value = food?.quantity ?? 1;
    }

    if ($("f-import-date")) {
        $("f-import-date").value = food?.import_date || getTodayString();
    }

    if ($("f-export-date")) {
        $("f-export-date").value = food?.export_date || "";
    }

    setLocationForForm(food?.location || "");

    updateFormStatusPreview();

    $("food-form-overlay")?.classList.remove("hidden");

    $("f-name")?.focus();

}


// =====================================================
// EDIT
// =====================================================

window.editFood = function (foodId) {

    if (!canEditCurrentFridge()) {
        alert("สิทธิ์ของคุณไม่สามารถแก้ไขอาหารในตู้เย็นนี้ได้");
        return;
    }

    const food = foods.find((item) => String(item.food_id) === String(foodId));

    if (!food) {
        alert("ไม่พบรายการอาหารนี้");
        return;
    }

    openFoodForm(food);

};


// =====================================================
// CLOSE FORM
// =====================================================

function closeFoodForm() {

    editingFoodId = null;

    $("food-form")?.reset();

    setFormDefaults();

    setText("food-form-title", "เพิ่มรายการอาหาร");
    setText("food-form-submit", "บันทึก");

    $("food-form-overlay")?.classList.add("hidden");

}


// =====================================================
// FORM DEFAULTS
// =====================================================

function setFormDefaults() {

    if ($("f-quantity")) {
        $("f-quantity").value = 1;
    }

    if ($("f-import-date")) {
        $("f-import-date").value = getTodayString();
    }

    if ($("f-location")) {
        $("f-location").value = "";
    }

    if ($("f-location-other")) {
        $("f-location-other").value = "";
        $("f-location-other").classList.add("hidden");
        $("f-location-other").required = false;
    }

    if ($("f-location-other-help")) {
        $("f-location-other-help").classList.add("hidden");
    }

    setText("form-user-email", authUser?.email || "...");

    setText("form-status-preview", "ระบบคำนวณอัตโนมัติ");

}


// =====================================================
// LOCATION
// =====================================================

const STANDARD_LOCATIONS = [
    "ชั้นบน",
    "ชั้นกลาง",
    "ชั้นล่าง",
    "ช่องประตู",
    "ช่องผักและผลไม้",
    "ช่องแช่แข็ง"
];

function handleLocationChange() {

    const value = $("f-location")?.value || "";

    toggleOtherLocationInput(value === "อื่นๆ");

}

function toggleOtherLocationInput(show) {

    if ($("f-location-other")) {
        $("f-location-other").classList.toggle("hidden", !show);
        $("f-location-other").required = show;
    }

    if ($("f-location-other-help")) {
        $("f-location-other-help").classList.toggle("hidden", !show);
    }

    if (!show && $("f-location-other")) {
        $("f-location-other").value = "";
    }

}

function setLocationForForm(location) {

    const select = $("f-location");
    const other = $("f-location-other");

    if (!select) {
        return;
    }

    if (!location) {

        select.value = "";

        if (other) {
            other.value = "";
        }

        toggleOtherLocationInput(false);

        return;

    }

    if (STANDARD_LOCATIONS.includes(location)) {

        select.value = location;

        toggleOtherLocationInput(false);

        return;

    }

    select.value = "อื่นๆ";

    if (other) {
        other.value = location;
    }

    toggleOtherLocationInput(true);

}


// =====================================================
// FORM STATUS PREVIEW
// =====================================================

function updateFormStatusPreview() {

    const value = $("f-export-date")?.value || "";

    const preview = $("form-status-preview");

    if (!preview) {
        return;
    }

    if (!value) {
        preview.textContent = "ระบบคำนวณอัตโนมัติ";
        return;
    }

    const days = getDaysUntilExpiry(value);

    if (days === null) {
        preview.textContent = "ระบบคำนวณอัตโนมัติ";
    } else if (days < 0) {
        preview.textContent = "หมดอายุ";
    } else if (days <= 3) {
        preview.textContent = "ใกล้หมดอายุ";
    } else {
        preview.textContent = "ปกติ";
    }

}


// =====================================================
// RENDER FOODS
// =====================================================

function renderFoods() {

    const list = $("food-list");

    if (!list) {
        return;
    }

    const filtered = foods.filter((food) => {

        const searchArea = [
            food.food_name,
            food.manu,
            food.location,
            food.status,
            getFoodAddedByName(food)
        ]
            .map((value) => String(value || "").toLowerCase())
            .join(" ");

        const matchesSearch = !searchText || searchArea.includes(searchText);

        const matchesFilter = matchesLocationFilter(food.location, currentFilter);

        return matchesSearch && matchesFilter;

    });

    // -------------------------
    // Sort
    // -------------------------

    filtered.sort((a, b) => {

        const aDays = getDaysUntilExpiry(a.export_date);
        const bDays = getDaysUntilExpiry(b.export_date);

        const aValue = aDays === null ? 999999 : aDays;
        const bValue = bDays === null ? 999999 : bDays;

        return aValue - bValue;

    });

    // -------------------------
    // Empty
    // -------------------------

    if (filtered.length === 0) {

        list.innerHTML = `
            <div class="col-span-full bg-white rounded-2xl border border-slate-200 p-10 text-center">
                <div class="text-4xl mb-3">🧊</div>
                <p class="font-semibold text-slate-600">ยังไม่มีรายการอาหาร</p>
                <p class="text-xs text-slate-400 mt-1">
                    กด “+ เพิ่มรายการอาหาร” เพื่อเพิ่มอาหารในตู้เย็น
                </p>
            </div>
        `;

    } else {

        list.innerHTML = filtered.map(createFoodCard).join("");

    }

    updateStats(foods);

}


// =====================================================
// LOCATION FILTER
// =====================================================

function matchesLocationFilter(location, filter) {

    if (filter === "all") {
        return true;
    }

    const value = String(location || "").trim();

    const map = {
        top: "ชั้นบน",
        middle: "ชั้นกลาง",
        bottom: "ชั้นล่าง",
        door: "ช่องประตู",
        crisper: "ช่องผักและผลไม้",
        freezer: "ช่องแช่แข็ง"
    };

    if (map[filter]) {
        return value === map[filter];
    }

    if (filter === "other") {
        return value !== "" && !STANDARD_LOCATIONS.includes(value);
    }

    if (filter === "chiller") {
        return value === "ช่องแช่เย็น";
    }

    return true;

}


// =====================================================
// FILTER BUTTON
// =====================================================

function updateFilterButtons() {

    document.querySelectorAll("[data-food-filter]").forEach((button) => {

        button.classList.remove("bg-violet-600", "text-white");
        button.classList.add("bg-white", "text-slate-600");

    });

    const active = document.querySelector(
        `[data-food-filter="${CSS.escape(currentFilter)}"]`
    );

    if (active) {

        active.classList.remove("bg-white", "text-slate-600");
        active.classList.add("bg-violet-600", "text-white");

    }

}


// =====================================================
// GET ADDED BY NAME
// =====================================================

function getFoodAddedByName(food) {

    const userId = food?.added_by || food?.user_id;

    const user = userId ? foodUserMap.get(String(userId)) : null;

    if (user?.name) {
        return user.name;
    }

    if (user?.user_email) {
        return user.user_email;
    }

    if (String(userId) === String(currentUser?.user_id)) {
        return authUser?.email || "ฉัน";
    }

    return "ไม่ทราบชื่อ";

}


// =====================================================
// FOOD CARD
// =====================================================

function createFoodCard(food) {

    const status = getStatusInfo(food.export_date);

    const quantity = Math.max(0, Number(food.quantity ?? 0));

    const foodId = escapeHtml(String(food.food_id ?? ""));

    const addedBy = getFoodAddedByName(food);

    const canEdit = canEditCurrentFridge();

    return `
        <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">

            <!-- Header -->
            <div class="flex items-start justify-between gap-3">

                <div class="flex items-center gap-3 min-w-0">

                    <div class="w-11 h-11 rounded-xl bg-violet-50 flex items-center justify-center text-2xl shrink-0">
                        ${getFoodIcon(food.food_name)}
                    </div>

                    <div class="min-w-0">

                        <h3 class="font-bold text-slate-800 truncate">
                            ${escapeHtml(food.food_name)}
                        </h3>

                        <p class="text-xs text-slate-400 mt-1">
                            🏷️ ${escapeHtml(food.manu)}
                        </p>

                        <p class="text-[11px] text-violet-600 font-semibold mt-1">
                            👤 เพิ่มโดย: ${escapeHtml(addedBy)}
                        </p>

                    </div>

                </div>

                <span class="${status.className} text-[11px] px-2 py-1 rounded-lg font-semibold whitespace-nowrap">
                    ${status.text}
                </span>

            </div>

            <!-- Details -->
            <div class="mt-4 space-y-2 text-xs text-slate-500">

                <p>
                    📍 ตำแหน่ง:
                    <span class="font-medium text-slate-700">${escapeHtml(food.location)}</span>
                </p>

                <p>
                    📦 จำนวน:
                    <span class="font-medium text-slate-700">${quantity} ชิ้น</span>
                </p>

                <p>
                    📥 วันที่นำเข้า:
                    <span class="font-medium text-slate-700">${formatDate(food.import_date)}</span>
                </p>

                <p>
                    📅 วันหมดอายุ:
                    <span class="font-medium text-slate-700">${formatDate(food.export_date)}</span>
                </p>

            </div>

            <!-- Stock -->
            ${
                canEdit
                    ? `
                <div class="mt-5 pt-4 border-t border-slate-100 flex items-center justify-between gap-3">

                    <div>
                        <p class="text-xs font-medium text-slate-500">จำนวนคงเหลือ</p>
                        <p class="text-[11px] text-slate-400 mt-0.5">
                            กด − เมื่อนำไปใช้ และ + เมื่อนำมาเพิ่ม
                        </p>
                    </div>

                    <div class="flex items-center bg-slate-50 border border-slate-200 rounded-xl overflow-hidden shrink-0">

                        <button
                            type="button"
                            onclick="decreaseStock('${foodId}')"
                            ${quantity <= 0 ? "disabled" : ""}
                            class="w-10 h-10 flex items-center justify-center text-lg font-semibold ${
                                quantity <= 0
                                    ? "text-slate-300 cursor-not-allowed"
                                    : "text-rose-500 hover:bg-rose-50"
                            } transition"
                        >
                            −
                        </button>

                        <span class="min-w-[52px] text-center text-sm font-bold text-slate-700">
                            ${quantity}
                        </span>

                        <button
                            type="button"
                            onclick="increaseStock('${foodId}')"
                            class="w-10 h-10 flex items-center justify-center text-lg font-semibold text-emerald-500 hover:bg-emerald-50 transition"
                        >
                            +
                        </button>

                    </div>

                </div>
            `
                    : `
                <div class="mt-5 pt-4 border-t border-slate-100">
                    <p class="text-xs text-slate-400">
                        👁️ สิทธิ์ดูอย่างเดียว • จำนวนคงเหลือ:
                        <span class="font-semibold text-slate-600">${quantity}</span>
                    </p>
                </div>
            `
            }

            <!-- Edit / Delete -->
            ${
                canEdit
                    ? `
                <div class="flex justify-end gap-2 mt-3">

                    <button
                        type="button"
                        onclick="editFood('${foodId}')"
                        class="px-3 py-1.5 text-xs font-medium text-violet-600 bg-violet-50 hover:bg-violet-100 rounded-lg"
                    >
                        ✏️ แก้ไขข้อมูล
                    </button>

                    <button
                        type="button"
                        onclick="deleteFood('${foodId}')"
                        class="px-3 py-1.5 text-xs font-medium text-rose-600 bg-rose-50 hover:bg-rose-100 rounded-lg"
                    >
                        🗑️ ลบ
                    </button>

                </div>
            `
                    : ""
            }

        </div>
    `;

}


// =====================================================
// STATISTICS
// =====================================================

function updateStats(list) {

    const total = list.reduce(
        (sum, food) => sum + Number(food.quantity || 0),
        0
    );

    const soon = list.filter((food) => {
        const days = getDaysUntilExpiry(food.export_date);
        return days !== null && days >= 0 && days <= 3;
    }).length;

    const expired = list.filter((food) => {
        const days = getDaysUntilExpiry(food.export_date);
        return days !== null && days < 0;
    }).length;

    const urgent = list.filter((food) => {
        const days = getDaysUntilExpiry(food.export_date);
        return days !== null && days <= 3;
    }).length;

    setText("stat-total", total);
    setText("stat-soon", soon);
    setText("stat-expired", expired);
    setText("filter-total", list.length);
    setText("urgent-count", `${urgent} รายการ`);

}


// =====================================================
// TODAY
// =====================================================

function getTodayString() {

    const date = new Date();

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;

}


// =====================================================
// DAYS UNTIL EXPIRY
// =====================================================

function getDaysUntilExpiry(dateString) {

    if (!dateString) {
        return null;
    }

    const expiry = new Date(`${dateString}T00:00:00`);

    if (Number.isNaN(expiry.getTime())) {
        return null;
    }

    const today = new Date();

    today.setHours(0, 0, 0, 0);
    expiry.setHours(0, 0, 0, 0);

    return Math.round((expiry.getTime() - today.getTime()) / 86400000);

}


// =====================================================
// CALCULATE STATUS
// =====================================================

function calculateStatus(exportDate) {

    const days = getDaysUntilExpiry(exportDate);

    if (days === null) {
        return "ไม่มีวันหมดอายุ";
    }

    if (days < 0) {
        return "หมดอายุ";
    }

    if (days <= 3) {
        return "ใกล้หมดอายุ";
    }

    return "ปกติ";

}


// =====================================================
// STATUS UI
// =====================================================

function getStatusInfo(exportDate) {

    const days = getDaysUntilExpiry(exportDate);

    if (days === null) {
        return {
            text: "ไม่ระบุวันหมดอายุ",
            className: "bg-slate-100 text-slate-500"
        };
    }

    if (days < 0) {
        return {
            text: "หมดอายุแล้ว",
            className: "bg-rose-100 text-rose-700"
        };
    }

    if (days === 0) {
        return {
            text: "หมดอายุวันนี้",
            className: "bg-rose-100 text-rose-700"
        };
    }

    if (days <= 3) {
        return {
            text: `เหลือ ${days} วัน`,
            className: "bg-amber-100 text-amber-700"
        };
    }

    return {
        text: `เหลือ ${days} วัน`,
        className: "bg-emerald-100 text-emerald-700"
    };

}


// =====================================================
// FOOD ICON
// =====================================================

function getFoodIcon(name) {

    const value = String(name || "").toLowerCase();

    if (value.includes("นม")) return "🥛";
    if (value.includes("ไข่")) return "🥚";
    if (value.includes("ชีส") || value.includes("เนยแข็ง")) return "🧀";
    if (value.includes("โยเกิร์ต")) return "🥛";
    if (value.includes("ข้าว") || value.includes("กล่อง")) return "🍱";
    if (value.includes("น้ำผลไม้") || value.includes("น้ำส้ม")) return "🧃";
    if (value.includes("นมถั่วเหลือง") || value.includes("นมถั่ว")) return "🥛";
    if (value.includes("ซอสมะเขือเทศ")) return "🍅";
    if (value.includes("น้ำปลา")) return "🧴";
    if (value.includes("แอปเปิ้ล") || value.includes("แอปเปิล")) return "🍎";
    if (value.includes("แครอท")) return "🥕";
    if (value.includes("ไก่")) return "🍗";
    if (value.includes("ไอศกรีม") || value.includes("ไอติม")) return "🍦";
    if (value.includes("เฟรนช์ฟราย") || value.includes("เฟรนฟราย")) return "🍟";

    return "🍽️";

}


// =====================================================
// FORMAT DATE
// =====================================================

function formatDate(dateString) {

    if (!dateString) {
        return "-";
    }

    const date = new Date(`${dateString}T00:00:00`);

    if (Number.isNaN(date.getTime())) {
        return String(dateString);
    }

    return date.toLocaleDateString("th-TH", {
        day: "numeric",
        month: "short",
        year: "numeric"
    });

}


// =====================================================
// SET TEXT
// =====================================================

function setText(id, value) {

    const element = $(id);

    if (element) {
        element.textContent = String(value ?? "");
    }

}


// =====================================================
// SHOW MESSAGE
// =====================================================

function showMessage(message) {

    const list = $("food-list");

    if (!list) {
        return;
    }

    list.innerHTML = `
        <div class="col-span-full bg-white rounded-2xl border border-slate-200 p-8 text-center">
            <p class="text-slate-500 text-sm">${escapeHtml(message)}</p>
        </div>
    `;

}


// =====================================================
// SHOW ERROR
// =====================================================

function showError(message) {

    const list = $("food-list");

    if (!list) {
        return;
    }

    list.innerHTML = `
        <div class="col-span-full bg-rose-50 border border-rose-200 rounded-2xl p-5">
            <p class="font-semibold text-rose-700">โหลดรายการอาหารไม่สำเร็จ</p>
            <p class="text-xs text-rose-600 mt-1">${escapeHtml(message)}</p>
        </div>
    `;

}


// =====================================================
// ESCAPE HTML
// =====================================================

function escapeHtml(value) {

    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");

}


// =====================================================
// GLOBAL FOOD SEARCH (ค้นหาอาหารข้ามตู้เย็น)
// =====================================================
// ใช้ช่องค้นหาเดิม #search-food
// - ค้นหาตั้งแต่พิมพ์ตัวอักษรแรก (debounce) ไม่ต้องกด Enter
// - ค้นหาจากทุกตู้ที่ผู้ใช้เป็นสมาชิก status = 'active'
//   (ค้นจาก food_name และ manu)
// - ผลค้นหาแสดงใน panel ที่สร้างด้วย JavaScript (ไม่แตะ #food-list
//   และไม่แตะสถิติของตู้ปัจจุบัน)
// - คลิกผลค้นหา:
//     ตู้ปัจจุบัน -> เปิดรายละเอียด (owner/editor แก้ไข ลบ ปรับจำนวนได้
//                    ผ่านฟังก์ชันเดิม, viewer ดูอย่างเดียว)
//     ตู้อื่น     -> เปิดรายละเอียดแบบอ่านอย่างเดียว + ปุ่ม "ไปยังตู้เย็นนี้"
// - การค้นหา/เปิดรายละเอียดตู้อื่น ไม่เปลี่ยนตู้ปัจจุบัน
//   จะเปลี่ยนก็ต่อเมื่อกด "ไปยังตู้เย็นนี้" (ตรวจ membership ซ้ำก่อน)
// - ข้อมูลที่แสดงสร้างด้วย textContent ทั้งหมด (ไม่ต่อ HTML)
// - สิทธิ์จริงยังขึ้นกับ Supabase RLS ฝั่งฐานข้อมูล

const GLOBAL_SEARCH_PANEL_ID = "global-search-results";
const GLOBAL_SEARCH_DETAIL_ID = "global-search-detail";
const GLOBAL_SEARCH_DEBOUNCE_MS = 250;
const GLOBAL_SEARCH_LIMIT = 30;
const GLOBAL_SEARCH_CACHE_MS = 15000;

let globalSearchInitialized = false;
let globalSearchTimer = null;
let globalSearchSeq = 0;
let globalSearchResults = [];
let globalSearchCache = {
    userId: null,
    time: 0,
    roleMap: new Map(),
    nameMap: new Map()
};


function createEl(tag, className, text) {

    const element = document.createElement(tag);

    if (className) {
        element.className = className;
    }

    if (text !== undefined && text !== null) {
        element.textContent = text;
    }

    return element;

}


// escape ตัวอักษรพิเศษของ LIKE/ILIKE (\ % _) ในคำค้นหา
function escapeLikePattern(value) {

    return String(value ?? "").replace(/[\\%_]/g, "\\$&");

}


function isCurrentFridgeResult(item) {

    return (
        currentFridgeId !== null &&
        currentFridgeId !== undefined &&
        String(item?.fridge_id) === String(currentFridgeId)
    );

}


// ชื่อที่แสดงในผลค้นหา: ตู้ปัจจุบันแสดงชื่ออาหารเฉย ๆ
// ตู้อื่นแสดง "ชื่ออาหาร (ชื่อตู้เย็น)"
function getGlobalSearchTitle(item) {

    const name = item?.food_name || "-";

    if (isCurrentFridgeResult(item)) {
        return name;
    }

    return `${name} (${item?.fridge_name || "ตู้เย็น"})`;

}


// -----------------------------------------------------
// โหลดตู้เย็นที่ผู้ใช้เป็นสมาชิก active (cache สั้น ๆ)
// -----------------------------------------------------

async function loadSearchableFridges(forceRefresh = false) {

    const userId = currentUser?.user_id;

    if (!userId) {
        return null;
    }

    const cache = globalSearchCache;

    if (
        !forceRefresh &&
        cache.userId === String(userId) &&
        Date.now() - cache.time < GLOBAL_SEARCH_CACHE_MS
    ) {
        return cache;
    }

    const sb = getSB();

    const { data: memberships, error: memberError } = await sb
        .from("fridge_members")
        .select("fridge_id, role, status")
        .eq("user_id", userId)
        .eq("status", "active");

    if (memberError) {
        throw memberError;
    }

    const roleMap = new Map();

    (memberships || []).forEach((row) => {
        roleMap.set(String(row.fridge_id), row.role);
    });

    const nameMap = new Map();

    if (roleMap.size > 0) {

        const { data: fridges, error: fridgeError } = await sb
            .from("fridges")
            .select("fridge_id, fridge_name")
            .in("fridge_id", [...roleMap.keys()]);

        if (fridgeError) {
            throw fridgeError;
        }

        (fridges || []).forEach((fridge) => {
            nameMap.set(String(fridge.fridge_id), fridge.fridge_name);
        });

    }

    globalSearchCache = {
        userId: String(userId),
        time: Date.now(),
        roleMap,
        nameMap
    };

    return globalSearchCache;

}


// -----------------------------------------------------
// ค้นหาอาหารจากทุกตู้ที่มีสิทธิ์
// -----------------------------------------------------

async function searchFoodsAcrossFridges(keyword) {

    const info = await loadSearchableFridges();

    if (!info || info.roleMap.size === 0) {
        return [];
    }

    const sb = getSB();

    const fridgeIds = [...info.roleMap.keys()];

    const pattern = `%${escapeLikePattern(keyword)}%`;

    const columns =
        "food_id, food_name, manu, location, quantity, import_date, export_date, status, user_id, fridge_id, added_by";

    // แยกค้นหาชื่อ/ยี่ห้อเป็นสองคำขอ แล้วรวมผล
    // (หลีกเลี่ยงการต่อคำค้นหาลงใน filter string ของ .or())
    const [byName, byManu] = await Promise.all([
        sb.from(FOOD_TABLE)
            .select(columns)
            .in("fridge_id", fridgeIds)
            .ilike("food_name", pattern)
            .limit(GLOBAL_SEARCH_LIMIT),
        sb.from(FOOD_TABLE)
            .select(columns)
            .in("fridge_id", fridgeIds)
            .ilike("manu", pattern)
            .limit(GLOBAL_SEARCH_LIMIT)
    ]);

    if (byName.error) {
        throw byName.error;
    }

    if (byManu.error) {
        throw byManu.error;
    }

    const merged = new Map();

    [...(byName.data || []), ...(byManu.data || [])].forEach((row) => {

        // กันข้อมูลจากตู้ที่ไม่ได้อยู่ในรายการสมาชิก active
        if (!info.roleMap.has(String(row.fridge_id))) {
            return;
        }

        merged.set(String(row.food_id), row);

    });

    const results = [...merged.values()].map((row) => ({
        ...row,
        fridge_name: info.nameMap.get(String(row.fridge_id)) || "ตู้เย็น",
        role: info.roleMap.get(String(row.fridge_id)) || null,
        added_by_name: ""
    }));

    // ตู้ปัจจุบันขึ้นก่อน แล้วเรียงตามชื่ออาหาร
    results.sort((a, b) => {

        const aCurrent = isCurrentFridgeResult(a) ? 0 : 1;
        const bCurrent = isCurrentFridgeResult(b) ? 0 : 1;

        if (aCurrent !== bCurrent) {
            return aCurrent - bCurrent;
        }

        return String(a.food_name || "").localeCompare(
            String(b.food_name || ""),
            "th"
        );

    });

    const limited = results.slice(0, 50);

    // ชื่อผู้เพิ่มอาหาร (ถ้าดึงไม่ได้ ไม่กระทบผลค้นหา)
    try {

        const addedByIds = [
            ...new Set(
                limited
                    .map((item) => item.added_by || item.user_id)
                    .filter(Boolean)
            )
        ];

        if (addedByIds.length > 0) {

            const { data: users, error: usersError } = await sb
                .from(USERS_TABLE)
                .select("user_id, name, user_email")
                .in("user_id", addedByIds);

            if (!usersError) {

                const userMap = new Map(
                    (users || []).map((user) => [String(user.user_id), user])
                );

                limited.forEach((item) => {

                    const user = userMap.get(
                        String(item.added_by || item.user_id)
                    );

                    item.added_by_name = user?.name || user?.user_email || "";

                });

            }

        }

    } catch (error) {

        console.warn("โหลดชื่อผู้เพิ่มอาหารของผลค้นหาไม่สำเร็จ:", error);

    }

    return limited;

}


// -----------------------------------------------------
// PANEL ผลการค้นหา
// -----------------------------------------------------

function ensureGlobalSearchPanel() {

    let panel = $(GLOBAL_SEARCH_PANEL_ID);

    if (panel) {
        return panel;
    }

    panel = createEl(
        "div",
        "bg-white border border-slate-200 rounded-2xl shadow-xl overflow-y-auto"
    );

    panel.id = GLOBAL_SEARCH_PANEL_ID;
    panel.setAttribute("role", "listbox");
    panel.style.position = "absolute";
    panel.style.zIndex = "70";
    panel.style.maxHeight = "70vh";
    panel.style.display = "none";

    document.body.appendChild(panel);

    return panel;

}


function positionGlobalSearchPanel() {

    const input = $("search-food");
    const panel = $(GLOBAL_SEARCH_PANEL_ID);

    if (!input || !panel || panel.style.display === "none") {
        return;
    }

    const rect = input.getBoundingClientRect();

    const width = Math.min(
        Math.max(rect.width, 360),
        window.innerWidth - 16
    );

    let left = rect.left + window.scrollX;

    if (rect.left + width > window.innerWidth - 8) {
        left = window.scrollX + window.innerWidth - width - 8;
    }

    panel.style.top = `${rect.bottom + window.scrollY + 6}px`;
    panel.style.left = `${Math.max(8, left)}px`;
    panel.style.width = `${width}px`;

}


function hideGlobalSearchPanel() {

    const panel = $(GLOBAL_SEARCH_PANEL_ID);

    if (panel) {
        panel.style.display = "none";
        panel.replaceChildren();
    }

}


function showGlobalSearchMessage(message, isError = false) {

    const panel = ensureGlobalSearchPanel();

    panel.replaceChildren(
        createEl(
            "div",
            `px-4 py-4 text-sm ${isError ? "text-rose-600" : "text-slate-500"}`,
            message
        )
    );

    panel.style.display = "block";

    positionGlobalSearchPanel();

}


function renderGlobalSearchResults(results) {

    if (!Array.isArray(results) || results.length === 0) {
        showGlobalSearchMessage("ไม่พบอาหารที่ตรงกับคำค้นหา");
        return;
    }

    const panel = ensureGlobalSearchPanel();

    panel.replaceChildren();

    results.forEach((item) => {

        const row = createEl(
            "button",
            "w-full text-left flex items-start gap-3 px-4 py-3 hover:bg-violet-50 border-b border-slate-100"
        );

        row.type = "button";
        row.setAttribute("role", "option");

        row.appendChild(
            createEl(
                "div",
                "w-10 h-10 rounded-xl bg-violet-50 flex items-center justify-center text-xl shrink-0",
                getFoodIcon(item.food_name)
            )
        );

        const body = createEl("div", "min-w-0 flex-1");

        body.appendChild(
            createEl(
                "p",
                "text-sm font-semibold text-slate-800 truncate",
                getGlobalSearchTitle(item)
            )
        );

        const parts = [];

        if (item.manu) {
            parts.push(`🏷️ ${item.manu}`);
        }

        parts.push(`📍 ${item.location || "-"}`);
        parts.push(`🔢 ${Math.max(0, Number(item.quantity ?? 0))}`);
        parts.push(`📅 ${formatDate(item.export_date)}`);

        body.appendChild(
            createEl("p", "text-xs text-slate-400 mt-1", parts.join("  ·  "))
        );

        row.appendChild(body);

        const status = getStatusInfo(item.export_date);

        row.appendChild(
            createEl(
                "span",
                `${status.className} text-[10px] px-2 py-1 rounded-lg font-semibold whitespace-nowrap`,
                status.text
            )
        );

        row.addEventListener("click", () => {
            openGlobalSearchDetail(item);
        });

        panel.appendChild(row);

    });

    panel.style.display = "block";

    positionGlobalSearchPanel();

}


// -----------------------------------------------------
// รายละเอียดอาหาร (modal)
// -----------------------------------------------------

function closeGlobalSearchDetail() {

    $(GLOBAL_SEARCH_DETAIL_ID)?.remove();

}


function openGlobalSearchDetail(sourceItem) {

    hideGlobalSearchPanel();

    closeGlobalSearchDetail();

    // ตู้ปัจจุบัน: ใช้ข้อมูลล่าสุดจาก foods (ถ้ามี)
    let item = sourceItem;

    const isCurrent = isCurrentFridgeResult(item);

    if (isCurrent) {

        const fresh = foods.find(
            (food) => String(food.food_id) === String(item.food_id)
        );

        if (fresh) {
            item = { ...item, ...fresh };
        }

    }

    const canEdit = isCurrent && canEditCurrentFridge();

    const overlay = createEl(
        "div",
        "fixed inset-0 bg-slate-900/60 flex items-center justify-center p-4"
    );

    overlay.id = GLOBAL_SEARCH_DETAIL_ID;
    overlay.style.zIndex = "80";

    overlay.addEventListener("click", (event) => {
        if (event.target === overlay) {
            closeGlobalSearchDetail();
        }
    });

    const box = createEl(
        "div",
        "bg-white rounded-2xl shadow-xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto"
    );

    // ---------- header ----------
    const header = createEl("div", "flex items-start justify-between gap-3 mb-4");

    const headLeft = createEl("div", "flex items-center gap-3 min-w-0");

    headLeft.appendChild(
        createEl(
            "div",
            "w-11 h-11 rounded-xl bg-violet-50 flex items-center justify-center text-2xl shrink-0",
            getFoodIcon(item.food_name)
        )
    );

    const headText = createEl("div", "min-w-0");

    headText.appendChild(
        createEl("h3", "font-bold text-slate-800 break-words", getGlobalSearchTitle(item))
    );

    headText.appendChild(
        createEl(
            "p",
            "text-[11px] text-violet-600 font-semibold mt-1",
            `🧊 ตู้เย็น: ${item.fridge_name || "ตู้เย็น"}`
        )
    );

    headLeft.appendChild(headText);

    const closeButton = createEl(
        "button",
        "text-slate-400 hover:text-slate-600 text-2xl leading-none",
        "×"
    );

    closeButton.type = "button";
    closeButton.setAttribute("aria-label", "ปิด");
    closeButton.addEventListener("click", closeGlobalSearchDetail);

    header.appendChild(headLeft);
    header.appendChild(closeButton);
    box.appendChild(header);

    // ---------- details ----------
    const status = getStatusInfo(item.export_date);

    box.appendChild(
        createEl(
            "span",
            `${status.className} inline-block text-[11px] px-2 py-1 rounded-lg font-semibold mb-3`,
            status.text
        )
    );

    const details = createEl("div", "space-y-2 text-xs text-slate-500");

    const addRow = (label, value) => {

        const line = createEl("p");

        line.appendChild(document.createTextNode(`${label} `));

        line.appendChild(
            createEl("span", "font-medium text-slate-700", value)
        );

        details.appendChild(line);

    };

    addRow("🏷️ ยี่ห้อ:", item.manu || "-");
    addRow("📍 ตำแหน่ง:", item.location || "-");
    addRow("📦 จำนวน:", `${Math.max(0, Number(item.quantity ?? 0))} ชิ้น`);
    addRow("📥 วันที่นำเข้า:", formatDate(item.import_date));
    addRow("📅 วันหมดอายุ:", formatDate(item.export_date));

    if (item.added_by_name) {
        addRow("👤 เพิ่มโดย:", item.added_by_name);
    }

    box.appendChild(details);

    // ---------- actions ----------
    const actions = createEl("div", "mt-5 pt-4 border-t border-slate-100");

    if (canEdit) {

        // ปรับจำนวน (ใช้ updateStock เดิม)
        const stockRow = createEl("div", "flex items-center justify-between gap-3");

        stockRow.appendChild(
            createEl("p", "text-xs font-medium text-slate-500", "จำนวนคงเหลือ")
        );

        const stockBox = createEl(
            "div",
            "flex items-center bg-slate-50 border border-slate-200 rounded-xl overflow-hidden shrink-0"
        );

        const quantity = Math.max(0, Number(item.quantity ?? 0));

        const minus = createEl(
            "button",
            `w-10 h-10 flex items-center justify-center text-lg font-semibold ${
                quantity <= 0
                    ? "text-slate-300 cursor-not-allowed"
                    : "text-rose-500 hover:bg-rose-50"
            }`,
            "−"
        );

        minus.type = "button";
        minus.disabled = quantity <= 0;

        const plus = createEl(
            "button",
            "w-10 h-10 flex items-center justify-center text-lg font-semibold text-emerald-500 hover:bg-emerald-50",
            "+"
        );

        plus.type = "button";

        const adjust = async (change) => {

            minus.disabled = true;
            plus.disabled = true;

            await updateStock(item.food_id, change);

            // updateStock -> loadFoods อัปเดต foods แล้ว: เปิดรายละเอียดใหม่ด้วยค่าล่าสุด
            if ($(GLOBAL_SEARCH_DETAIL_ID)) {
                openGlobalSearchDetail(item);
            }

        };

        minus.addEventListener("click", () => adjust(-1));
        plus.addEventListener("click", () => adjust(1));

        stockBox.appendChild(minus);

        stockBox.appendChild(
            createEl(
                "span",
                "min-w-[52px] text-center text-sm font-bold text-slate-700",
                String(quantity)
            )
        );

        stockBox.appendChild(plus);
        stockRow.appendChild(stockBox);
        actions.appendChild(stockRow);

        // แก้ไข / ลบ (ใช้ editFood / deleteFood เดิม)
        const editRow = createEl("div", "flex justify-end gap-2 mt-3");

        const editButton = createEl(
            "button",
            "px-3 py-1.5 text-xs font-medium text-violet-600 bg-violet-50 hover:bg-violet-100 rounded-lg",
            "✏️ แก้ไขข้อมูล"
        );

        editButton.type = "button";

        editButton.addEventListener("click", () => {
            closeGlobalSearchDetail();
            window.editFood(item.food_id);
        });

        const deleteButton = createEl(
            "button",
            "px-3 py-1.5 text-xs font-medium text-rose-600 bg-rose-50 hover:bg-rose-100 rounded-lg",
            "🗑️ ลบ"
        );

        deleteButton.type = "button";

        deleteButton.addEventListener("click", async () => {

            await deleteFood(item.food_id);

            const stillExists = foods.some(
                (food) => String(food.food_id) === String(item.food_id)
            );

            // ลบสำเร็จ (หรือไม่มีรายการแล้ว) -> ปิดรายละเอียดและค้นหาใหม่
            if (!stillExists) {
                closeGlobalSearchDetail();
                refreshGlobalSearchResults();
            }

        });

        editRow.appendChild(editButton);
        editRow.appendChild(deleteButton);
        actions.appendChild(editRow);

    } else if (isCurrent) {

        // ตู้ปัจจุบัน แต่เป็น viewer: ดูอย่างเดียว ไม่มีปุ่มแก้ไข/ลบ/ปรับจำนวน
        actions.appendChild(
            createEl(
                "p",
                "text-xs text-slate-400",
                "👁️ สิทธิ์ดูอย่างเดียวในตู้เย็นนี้"
            )
        );

    } else {

        // ตู้เย็นอื่น: อ่านอย่างเดียว + ปุ่มไปยังตู้เย็นนี้
        actions.appendChild(
            createEl(
                "p",
                "text-xs text-slate-400 mb-3",
                "👁️ รายการนี้อยู่ในตู้เย็นอื่น (ดูอย่างเดียว)"
            )
        );

        const goButton = createEl(
            "button",
            "w-full bg-violet-600 hover:bg-violet-700 text-white text-sm px-4 py-2.5 rounded-xl font-semibold shadow-md transition",
            "ไปยังตู้เย็นนี้"
        );

        goButton.type = "button";

        goButton.addEventListener("click", () => {
            goToSearchedFridge(item, goButton);
        });

        actions.appendChild(goButton);

    }

    box.appendChild(actions);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

}


// -----------------------------------------------------
// ไปยังตู้เย็นของผลค้นหา (เปลี่ยนตู้เฉพาะเมื่อกดปุ่มนี้)
// -----------------------------------------------------

async function goToSearchedFridge(item, button) {

    const originalText = button?.textContent || "ไปยังตู้เย็นนี้";

    if (button) {
        button.disabled = true;
        button.textContent = "กำลังตรวจสอบสิทธิ์...";
    }

    let navigating = false;

    try {

        if (!currentUser?.user_id) {
            throw new Error("ไม่พบข้อมูลผู้ใช้ กรุณาเข้าสู่ระบบใหม่");
        }

        // ตรวจ membership ซ้ำ ณ ตอนกด
        const { data, error } = await getSB()
            .from("fridge_members")
            .select("fridge_id, role, status")
            .eq("fridge_id", item.fridge_id)
            .eq("user_id", currentUser.user_id)
            .eq("status", "active")
            .maybeSingle();

        if (error) {
            throw error;
        }

        if (!data) {

            alert("คุณไม่มีสิทธิ์เข้าถึงตู้เย็นนี้แล้ว");

            // ล้าง cache แล้วค้นหาใหม่ เพื่อไม่ให้ผลของตู้ที่หมดสิทธิ์ค้างอยู่
            globalSearchCache.time = 0;

            closeGlobalSearchDetail();

            refreshGlobalSearchResults();

            return;

        }

        localStorage.setItem(CURRENT_FRIDGE_STORAGE_KEY, String(item.fridge_id));

        navigating = true;

        window.location.href = "fridge.html";

    } catch (error) {

        console.error("ไปยังตู้เย็นไม่สำเร็จ:", error);

        alert("ไปยังตู้เย็นไม่สำเร็จ: " + (error?.message || "เกิดข้อผิดพลาด"));

    } finally {

        if (button && !navigating) {
            button.disabled = false;
            button.textContent = originalText;
        }

    }

}


// -----------------------------------------------------
// ควบคุมการพิมพ์ / debounce / กันผลเก่าทับผลใหม่
// -----------------------------------------------------

function handleGlobalSearchInput(rawValue) {

    const keyword = String(rawValue || "").trim();

    clearTimeout(globalSearchTimer);

    // ทุกครั้งที่พิมพ์ ให้ลำดับคำขอเพิ่ม เพื่อทิ้งผลของคำค้นเก่า
    const seq = ++globalSearchSeq;

    if (!keyword) {

        globalSearchResults = [];

        hideGlobalSearchPanel();

        return;

    }

    showGlobalSearchMessage("กำลังค้นหา...");

    globalSearchTimer = setTimeout(() => {
        runGlobalSearch(keyword, seq);
    }, GLOBAL_SEARCH_DEBOUNCE_MS);

}


async function runGlobalSearch(keyword, seq) {

    if (!currentUser?.user_id) {

        if (seq === globalSearchSeq) {
            showGlobalSearchMessage("กำลังโหลดข้อมูลผู้ใช้ กรุณาลองใหม่อีกครั้ง");
        }

        return;

    }

    try {

        const results = await searchFoodsAcrossFridges(keyword);

        // มีคำค้นใหม่กว่าแล้ว -> ทิ้งผลนี้
        if (seq !== globalSearchSeq) {
            return;
        }

        globalSearchResults = results;

        renderGlobalSearchResults(results);

    } catch (error) {

        if (seq !== globalSearchSeq) {
            return;
        }

        console.error("ค้นหาอาหารข้ามตู้ไม่สำเร็จ:", error);

        showGlobalSearchMessage(
            "ค้นหาไม่สำเร็จ: " + (error?.message || "เกิดข้อผิดพลาด"),
            true
        );

    }

}


// ค้นหาซ้ำด้วยคำเดิมในช่อง (ใช้หลังลบ/หมดสิทธิ์)
function refreshGlobalSearchResults() {

    const input = $("search-food");

    if (!input) {
        return;
    }

    handleGlobalSearchInput(input.value);

}


function teardownGlobalSearchUI() {

    clearTimeout(globalSearchTimer);

    globalSearchTimer = null;

    globalSearchSeq++;

    globalSearchResults = [];

    hideGlobalSearchPanel();

    closeGlobalSearchDetail();

}


// ผูก event ครั้งเดียว และทำงานเฉพาะหน้าที่มี #search-food
function setupGlobalSearch() {

    const input = $("search-food");

    if (!input || globalSearchInitialized) {
        return;
    }

    globalSearchInitialized = true;

    input.setAttribute("autocomplete", "off");

    input.addEventListener("input", () => {
        handleGlobalSearchInput(input.value);
    });

    // กลับมาโฟกัสช่องที่ยังมีคำค้นอยู่ -> ค้นหา/แสดงผลอีกครั้ง
    input.addEventListener("focus", () => {

        if (input.value.trim()) {
            handleGlobalSearchInput(input.value);
        }

    });

    // คลิกนอก panel / นอกช่องค้นหา -> ซ่อนผลค้นหา
    document.addEventListener("click", (event) => {

        const panel = $(GLOBAL_SEARCH_PANEL_ID);

        if (!panel || panel.style.display === "none") {
            return;
        }

        if (event.target === input || panel.contains(event.target)) {
            return;
        }

        hideGlobalSearchPanel();

    });

    document.addEventListener("keydown", (event) => {

        if (event.key !== "Escape") {
            return;
        }

        if ($(GLOBAL_SEARCH_DETAIL_ID)) {
            closeGlobalSearchDetail();
            return;
        }

        hideGlobalSearchPanel();

    });

    window.addEventListener("resize", positionGlobalSearchPanel);

    window.addEventListener("scroll", positionGlobalSearchPanel, true);

}


// =====================================================
// REFRESH FRIDGE STATE (ใช้ร่วมกันใน storage / visibility / pageshow)
// =====================================================
// หา fridge ปัจจุบันใหม่ แล้วอัปเดตกล่องแนะนำ / dashboard / Realtime
// - ไม่มีตู้เย็น  -> แสดงกล่องแนะนำ
// - มีตู้เย็น     -> แสดง dashboard โหลดอาหาร (และตั้ง Realtime ถ้าตู้เปลี่ยน)

async function refreshFridgeState(forceRealtime = false) {

    const previousFridgeId = currentFridgeId;

    currentFridgeId = null;
    currentFridgeRole = null;

    await getCurrentFridgeForUser();

    if (navigateByFridgeStatus(Boolean(currentFridgeId))) return;

    if (!currentFridgeId) {
        applyNoFridgeState();
        return;
    }

    setFridgeDashboardVisible(true);

    await loadFoods();

    const changed = String(previousFridgeId) !== String(currentFridgeId);

    if (changed || forceRealtime || !realtimeChannel) {
        setupRealtime();
    }

}


// =====================================================
// SYNC FRIDGE FROM OTHER PAGE / TAB
// =====================================================
// เวลา Settings เปลี่ยน fridge
// หน้า index ที่เปิดอยู่ในอีก tab/page จะเปลี่ยนตาม
// =====================================================

window.addEventListener("storage", async (event) => {

    if (event.key !== CURRENT_FRIDGE_STORAGE_KEY) {
        return;
    }

    if (!event.newValue) {
        return;
    }

    try {

        // -------------------------
        // ตรวจ session
        // -------------------------

        const { data, error } = await getSB().auth.getSession();

        if (error) {
            console.error("ตรวจ Session จาก storage event ไม่สำเร็จ:", error);
            return;
        }

        const user = data?.session?.user;

        if (!user) {
            redirectToLogin();
            return;
        }

        authUser = user;

        currentUser = await getCurrentDBUser(user);

        if (!currentUser?.user_id) {
            return;
        }

        // รีเฟรชจำนวนแจ้งเตือน
        // (setup ไม่สร้างซ้ำถ้ายังเป็น user เดิม)
        setupNotificationRealtime();
        updateNotificationCount();

        await refreshFridgeState();

    } catch (error) {

        console.error("เปลี่ยนตู้เย็นตามหน้าอื่นไม่สำเร็จ:", error);

    }

});


// =====================================================
// KEEP SESSION WHEN RETURNING TO PAGE
// =====================================================

document.addEventListener("visibilitychange", async () => {

    if (document.visibilityState !== "visible") {
        return;
    }

    try {

        const { data, error } = await getSB().auth.getSession();

        if (error) {
            console.error("ตรวจ Session หลังกลับหน้า:", error);
            return;
        }

        const user = data?.session?.user;

        // ไม่มี session
        if (!user) {
            redirectToLogin();
            return;
        }

        authUser = user;

        setText("user-email", user.email || "ผู้ใช้");
        setText("form-user-email", user.email || "ผู้ใช้");

        currentUser = await getCurrentDBUser(user);

        if (currentUser?.user_id) {

            // รีเฟรชจำนวนแจ้งเตือนเมื่อกลับมาที่หน้านี้
            setupNotificationRealtime();
            updateNotificationCount();

            // รีเฟรช fridge ปัจจุบันด้วย เพราะ Settings อาจเปลี่ยนตู้ไว้แล้ว
            // (หรือผู้ใช้ใหม่เพิ่งสร้าง/เข้าร่วมตู้เย็นมา)
            await refreshFridgeState();

        }

    } catch (error) {

        console.error("Session check error:", error);

    }

});


// =====================================================
// OPTIONAL: REFRESH WHEN PAGE IS SHOWN
// =====================================================

window.addEventListener("pageshow", async () => {

    try {

        if (document.visibilityState !== "visible") {
            return;
        }

        if (!currentUser?.user_id) {
            return;
        }

        // รีเฟรชจำนวนแจ้งเตือน (เช่น กลับมาจากหน้าอื่นด้วยปุ่ม Back)
        setupNotificationRealtime();
        updateNotificationCount();

        await refreshFridgeState();

    } catch (error) {

        console.warn("pageshow refresh error:", error);

    }

});