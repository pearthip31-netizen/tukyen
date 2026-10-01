// =====================================================
// TUYEN - FOOD CRUD + SHARED FRIDGE
// =====================================================
// Supabase table: food
//
// food_id
// food_name
// manu
// location
// quantity
// import_date
// export_date
// status
// user_id
// fridge_id
// added_by
// =====================================================

const FOOD_TABLE = "food";
const USERS_TABLE = "users";

const CURRENT_FRIDGE_STORAGE_KEY =
    "tuyen_current_fridge_id";


let foods = [];

let currentUser = null;

let authUser = null;

let editingFoodId = null;

let currentFilter = "all";

let searchText = "";

let realtimeChannel = null;


// =====================================================
// SHARED FRIDGE
// =====================================================

let currentFridgeId = null;

let currentFridgeRole = null;


// เก็บข้อมูล user ของคนที่เพิ่มอาหาร
let foodUserMap = new Map();


// =====================================================
// SHORTCUT
// =====================================================

const $ = (id) =>
    document.getElementById(id);


// =====================================================
// SUPABASE CLIENT
// =====================================================

function getSB() {

    // ใช้ getSupabase() จาก config.js ก่อน
    if (
        typeof getSupabase === "function"
    ) {

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


    throw new Error(
        "ไม่พบ Supabase client กรุณาตรวจสอบ config.js"
    );

}


// =====================================================
// START
// =====================================================

document.addEventListener(
    "DOMContentLoaded",
    async () => {

        bindEvents();

        setFormDefaults();

        await initialize();

    }
);


// =====================================================
// EVENTS
// =====================================================

function bindEvents() {

    // -------------------------
    // เพิ่มอาหาร
    // -------------------------

    $("add-food-btn")?.addEventListener(
        "click",
        () => {

            if (
                !canEditCurrentFridge()
            ) {

                alert(
                    "สิทธิ์ของคุณไม่สามารถเพิ่มอาหารในตู้เย็นนี้ได้"
                );

                return;

            }

            openFoodForm();

        }
    );


    // -------------------------
    // ปิดฟอร์ม
    // -------------------------

    $("food-form-close")?.addEventListener(
        "click",
        closeFoodForm
    );


    $("food-form-cancel")?.addEventListener(
        "click",
        closeFoodForm
    );


    // -------------------------
    // Submit
    // -------------------------

    $("food-form")?.addEventListener(
        "submit",
        saveFood
    );


    // -------------------------
    // Search
    // -------------------------

    $("search-food")?.addEventListener(
        "input",
        (event) => {

            searchText =
                String(
                    event.target.value || ""
                )
                    .trim()
                    .toLowerCase();


            renderFoods();

        }
    );


    // -------------------------
    // Filter
    // -------------------------

    document
        .querySelectorAll(
            "[data-food-filter]"
        )
        .forEach(
            (button) => {

                button.addEventListener(
                    "click",
                    () => {

                        currentFilter =
                            button.dataset.foodFilter ||
                            "all";


                        updateFilterButtons();

                        renderFoods();

                    }
                );

            }
        );


    // -------------------------
    // Location
    // -------------------------

    $("f-location")?.addEventListener(
        "change",
        handleLocationChange
    );


    // -------------------------
    // Expiry preview
    // -------------------------

    $("f-export-date")?.addEventListener(
        "change",
        updateFormStatusPreview
    );


    // -------------------------
    // Click outside modal
    // -------------------------

    $("food-form-overlay")?.addEventListener(
        "click",
        (event) => {

            if (
                event.target ===
                event.currentTarget
            ) {

                closeFoodForm();

            }

        }
    );


    // -------------------------
    // Logout
    // -------------------------

    $("logout-btn")?.addEventListener(
        "click",
        handleLogout
    );


    // -------------------------
    // ESC
    // -------------------------

    document.addEventListener(
        "keydown",
        (event) => {

            if (
                event.key === "Escape" &&
                $("food-form-overlay") &&
                !$("food-form-overlay")
                    .classList
                    .contains("hidden")
            ) {

                closeFoodForm();

            }

        }
    );

}


// =====================================================
// INITIALIZE
// =====================================================

async function initialize() {

    try {

        const sb =
            getSB();


        const {
            data,
            error
        } =
            await sb.auth.getSession();


        if (error) {

            console.error(
                "ตรวจสอบ Session ไม่สำเร็จ:",
                error
            );


            redirectToLogin();

            return;

        }


        const session =
            data?.session;


        const user =
            session?.user;


        // ไม่มี session จริง ๆ
        if (!user) {

            redirectToLogin();

            return;

        }


        authUser =
            user;


        // -------------------------
        // แสดง email
        // -------------------------

        setText(
            "user-email",
            user.email ||
            "ผู้ใช้"
        );


        setText(
            "form-user-email",
            user.email ||
            "ผู้ใช้"
        );


        // -------------------------
        // หา user ใน public.users
        // -------------------------

        currentUser =
            await getCurrentDBUser(
                user
            );


        if (
            !currentUser?.user_id
        ) {

            showError(
                "ไม่พบ user_id ของผู้ใช้งาน"
            );

            return;

        }


        // -------------------------
        // หา fridge ปัจจุบัน
        // -------------------------

        await getCurrentFridgeForUser();


        if (!currentFridgeId) {

            showError(
                "ยังไม่มีตู้เย็นที่สามารถเข้าถึงได้"
            );

            return;

        }


        // -------------------------
        // โหลดอาหาร
        // -------------------------

        await loadFoods();


        // -------------------------
        // Realtime
        // -------------------------

        setupRealtime();

    }

    catch (error) {

        console.error(
            "initialize error:",
            error
        );


        if (
            handleAuthError(error)
        ) {

            return;

        }


        showError(
            error?.message ||
            "ไม่สามารถเปิดระบบได้"
        );

    }

}


// =====================================================
// GET CURRENT DB USER
// =====================================================

async function getCurrentDBUser(
    user
) {

    const sb =
        getSB();


    const email =
        String(
            user?.email || ""
        ).trim();


    // ถ้าไม่มี email
    if (!email) {

        return {

            user_id:
                user.id,

            name:
                "",

            user_email:
                ""

        };

    }


    try {

        const {
            data,
            error
        } =
            await sb
                .from(
                    USERS_TABLE
                )
                .select(
                    "user_id, name, user_email"
                )
                .eq(
                    "user_email",
                    email
                )
                .maybeSingle();


        if (
            !error &&
            data
        ) {

            return data;

        }


        if (error) {

            console.warn(
                "ค้นหา users ไม่สำเร็จ:",
                error
            );

        }

    }

    catch (error) {

        console.warn(
            "อ่าน users ไม่สำเร็จ:",
            error
        );

    }


    // fallback
    return {

        user_id:
            user.id,

        name:
            "",

        user_email:
            email

    };

}


// =====================================================
// CURRENT FRIDGE
// =====================================================
// ตู้เย็นปัจจุบันจะถูกใช้เป็นศูนย์กลางของข้อมูลอาหาร
//
// localStorage:
// tuyen_current_fridge_id
//
// ลำดับการเลือก:
//
// 1. ตู้ที่เลือกไว้ล่าสุด
// 2. ตู้ที่ user เป็น owner
// 3. ตู้แรกที่ user เป็นสมาชิก
// =====================================================

async function getCurrentFridgeForUser() {

    if (
        !currentUser?.user_id
    ) {

        currentFridgeId =
            null;

        currentFridgeRole =
            null;

        return null;

    }


    const sb =
        getSB();


    // -------------------------
    // โหลด fridge ที่เข้าถึงได้
    // -------------------------

    const {
        data: fridges,
        error: fridgeError
    } =
        await sb
            .from(
                "fridges"
            )
            .select(
                "fridge_id, fridge_name, created_by, created_at"
            )
            .order(
                "created_at",
                {
                    ascending:
                        true
                }
            );


    if (fridgeError) {

        throw new Error(
            fridgeError.message
        );

    }


    const fridgeRows =
        Array.isArray(fridges)
            ? fridges
            : [];


    if (
        fridgeRows.length ===
        0
    ) {

        currentFridgeId =
            null;

        currentFridgeRole =
            null;

        return null;

    }


    // -------------------------
    // โหลด membership ของ user
    // -------------------------

    const {
        data: memberships,
        error: memberError
    } =
        await sb
            .from(
                "fridge_members"
            )
            .select(
                "fridge_id, role, status"
            )
            .eq(
                "user_id",
                currentUser.user_id
            )
            .eq(
                "status",
                "active"
            );


    if (memberError) {

        throw new Error(
            memberError.message
        );

    }


    const membershipRows =
        Array.isArray(memberships)
            ? memberships
            : [];


    // -------------------------
    // Map fridge_id -> role
    // -------------------------

    const roleMap =
        new Map(
            membershipRows.map(
                (row) => [

                    String(
                        row.fridge_id
                    ),

                    row.role

                ]
            )
        );


    // -------------------------
    // ถ้าไม่มี membership เลย
    // -------------------------

    if (
        roleMap.size === 0
    ) {

        currentFridgeId =
            null;

        currentFridgeRole =
            null;

        return null;

    }


    let selected =
        null;


    // -------------------------
    // ใช้ fridge ที่เคยเลือกไว้
    // -------------------------
    // สำคัญ:
    // ต้องตรวจด้วยว่า user ยังเป็นสมาชิกอยู่
    // -------------------------

    const savedFridgeId =
        localStorage.getItem(
            CURRENT_FRIDGE_STORAGE_KEY
        );


    if (savedFridgeId) {

        selected =
            fridgeRows.find(
                (fridge) => {

                    const id =
                        String(
                            fridge.fridge_id
                        );


                    return (
                        id ===
                        String(
                            savedFridgeId
                        ) &&
                        roleMap.has(id)
                    );

                }
            ) || null;

    }


    // -------------------------
    // ถ้ายังไม่มี ให้เลือก owner ก่อน
    // -------------------------

    if (!selected) {

        selected =
            fridgeRows.find(
                (fridge) => {

                    return (
                        roleMap.get(
                            String(
                                fridge.fridge_id
                            )
                        ) ===
                        "owner"
                    );

                }
            ) || null;

    }


    // -------------------------
    // ถ้ายังไม่มี ให้เลือก editor
    // -------------------------

    if (!selected) {

        selected =
            fridgeRows.find(
                (fridge) => {

                    return (
                        roleMap.get(
                            String(
                                fridge.fridge_id
                            )
                        ) ===
                        "editor"
                    );

                }
            ) || null;

    }


    // -------------------------
    // ถ้ายังไม่มี ให้เลือกสมาชิกตัวแรก
    // -------------------------

    if (!selected) {

        selected =
            fridgeRows.find(
                (fridge) => {

                    return roleMap.has(
                        String(
                            fridge.fridge_id
                        )
                    );

                }
            ) || null;

    }


    if (!selected) {

        currentFridgeId =
            null;

        currentFridgeRole =
            null;

        return null;

    }


    currentFridgeId =
        selected.fridge_id;


    currentFridgeRole =
        roleMap.get(
            String(
                selected.fridge_id
            )
        ) || null;


    // -------------------------
    // จำ fridge ปัจจุบัน
    // -------------------------

    localStorage.setItem(
        CURRENT_FRIDGE_STORAGE_KEY,
        String(
            currentFridgeId
        )
    );


    // -------------------------
    // อัปเดตชื่อถ้ามี element
    // -------------------------

    updateCurrentFridgeUI(
        selected
    );


    return selected;

}


// =====================================================
// UPDATE CURRENT FRIDGE UI
// =====================================================
// ทำงานเฉพาะถ้า index.html มี element เหล่านี้อยู่
// ไม่กระทบระบบเดิมถ้าไม่มี
// =====================================================

function updateCurrentFridgeUI(
    fridge
) {

    if (!fridge) {

        return;

    }


    const possibleIds = [

        "current-fridge-name",

        "fridge-name",

        "current-fridge",

        "selected-fridge-name"

    ];


    possibleIds.forEach(
        (id) => {

            const element =
                $(id);


            if (element) {

                element.textContent =
                    fridge.fridge_name ||
                    "";

            }

        }
    );

}


// =====================================================
// PERMISSION
// =====================================================

function canEditCurrentFridge() {

    return (
        currentFridgeRole ===
            "owner" ||
        currentFridgeRole ===
            "editor"
    );

}


// =====================================================
// AUTH ERROR
// =====================================================

function handleAuthError(
    error
) {

    const message =
        String(
            error?.message ||
            error ||
            ""
        );


    if (
        /invalid jwt|jwt expired|refresh token|invalid refresh token|session missing|not authenticated|permission denied|PGRST301/i
            .test(
                message
            )
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

    if (
        !location.pathname.endsWith(
            "login.html"
        )
    ) {

        window.location.replace(
            "login.html"
        );

    }

}


// =====================================================
// LOGOUT
// =====================================================

async function handleLogout() {

    try {

        const sb =
            getSB();


        await sb.auth.signOut();

    }

    catch (error) {

        console.error(
            "Logout error:",
            error
        );

    }

    finally {

        const keys = [

            "currentUser",

            "user",

            "loggedInUser",

            "tuyenUser"

        ];


        keys.forEach(
            (key) => {

                try {

                    localStorage.removeItem(
                        key
                    );

                }

                catch (error) {

                    console.warn(
                        "ล้าง localStorage ไม่สำเร็จ:",
                        error
                    );

                }

            }
        );


        window.location.replace(
            "login.html"
        );

    }

}


// =====================================================
// REALTIME
// =====================================================

function setupRealtime() {

    try {

        if (
            !currentUser?.user_id ||
            !currentFridgeId
        ) {

            return;

        }


        const sb =
            getSB();


        // ลบ channel เดิม
        if (realtimeChannel) {

            sb.removeChannel(
                realtimeChannel
            );

            realtimeChannel =
                null;

        }


        realtimeChannel =
            sb
                .channel(
                    `tuyen-food-${String(
                        currentFridgeId
                    )}`
                )
                .on(
                    "postgres_changes",
                    {
                        event:
                            "*",

                        schema:
                            "public",

                        table:
                            FOOD_TABLE
                    },
                    async () => {

                        await loadFoods();

                    }
                )
                .subscribe();

    }

    catch (error) {

        console.warn(
            "ตั้ง Realtime ไม่สำเร็จ:",
            error
        );

    }

}


// =====================================================
// LOAD FOODS
// =====================================================

async function loadFoods() {

    if (
        !currentUser?.user_id
    ) {

        showMessage(
            "ไม่พบ user_id ของผู้ใช้งาน"
        );

        return;

    }


    // ถ้ายังไม่มี fridge
    if (
        !currentFridgeId
    ) {

        await getCurrentFridgeForUser();

    }


    if (
        !currentFridgeId
    ) {

        showError(
            "ยังไม่มีตู้เย็นที่สามารถเข้าถึงได้"
        );

        return;

    }


    try {

        const sb =
            getSB();


        // =================================================
        // โหลดอาหารตาม fridge_id
        // ไม่ได้โหลดตาม user_id
        // =================================================

        const {
            data,
            error
        } =
            await sb
                .from(
                    FOOD_TABLE
                )
                .select("*")
                .eq(
                    "fridge_id",
                    currentFridgeId
                )
                .order(
                    "export_date",
                    {
                        ascending:
                            true
                    }
                );


        if (error) {

            if (
                handleAuthError(error)
            ) {

                return;

            }


            console.error(
                "โหลดอาหารไม่สำเร็จ:",
                error
            );


            showError(
                error.message
            );


            return;

        }


        foods =
            Array.isArray(data)
                ? data
                : [];


        // =================================================
        // โหลดชื่อคนที่เพิ่มอาหาร
        // =================================================

        const addedByIds =
            [
                ...new Set(
                    foods
                        .map(
                            (food) =>
                                food.added_by ||
                                food.user_id
                        )
                        .filter(Boolean)
                )
            ];


        foodUserMap =
            new Map();


        if (
            addedByIds.length
        ) {

            const {
                data: users,
                error: usersError
            } =
                await sb
                    .from(
                        USERS_TABLE
                    )
                    .select(
                        "user_id, name, user_email"
                    )
                    .in(
                        "user_id",
                        addedByIds
                    );


            if (usersError) {

                console.warn(
                    "โหลดข้อมูลผู้เพิ่มอาหารไม่สำเร็จ:",
                    usersError
                );

            }


            (
                users ||
                []
            ).forEach(
                (user) => {

                    foodUserMap.set(
                        String(
                            user.user_id
                        ),
                        user
                    );

                }
            );

        }


        renderFoods();

    }

    catch (error) {

        if (
            handleAuthError(error)
        ) {

            return;

        }


        console.error(
            "loadFoods error:",
            error
        );


        showError(
            error?.message ||
            "โหลดรายการอาหารไม่สำเร็จ"
        );

    }

}


// =====================================================
// SAVE FOOD
// CREATE + UPDATE
// =====================================================

async function saveFood(
    event
) {

    event.preventDefault();


    if (
        !currentUser?.user_id
    ) {

        alert(
            "ไม่พบข้อมูลผู้ใช้ กรุณาเข้าสู่ระบบใหม่"
        );


        redirectToLogin();


        return;

    }


    // -------------------------
    // ตรวจ fridge
    // -------------------------

    if (
        !currentFridgeId
    ) {

        await getCurrentFridgeForUser();

    }


    if (
        !currentFridgeId
    ) {

        alert(
            "ยังไม่มีตู้เย็นสำหรับบันทึกรายการอาหาร"
        );


        return;

    }


    // -------------------------
    // ตรวจสิทธิ์
    // -------------------------

    if (
        !canEditCurrentFridge()
    ) {

        alert(
            "สิทธิ์ของคุณไม่สามารถเพิ่มหรือแก้ไขอาหารในตู้เย็นนี้ได้"
        );


        return;

    }


    // -------------------------
    // รับค่า
    // -------------------------

    const foodName =
        $("f-name")?.value
            .trim() ||
        "";


    const manu =
        $("f-manu")?.value
            .trim() ||
        "";


    const selectedLocation =
        $("f-location")?.value
            .trim() ||
        "";


    const otherLocation =
        $("f-location-other")?.value
            .trim() ||
        "";


    const location =
        selectedLocation === "อื่นๆ"
            ? otherLocation
            : selectedLocation;


    const quantity =
        Number(
            $("f-quantity")?.value
        );


    const importDate =
        $("f-import-date")?.value ||
        "";


    const exportDate =
        $("f-export-date")?.value ||
        "";


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

        alert(
            "กรุณากรอกข้อมูลที่มีเครื่องหมาย * ให้ครบ"
        );


        return;

    }


    if (
        !Number.isFinite(
            quantity
        ) ||
        quantity < 1
    ) {

        alert(
            "จำนวนต้องเป็นตัวเลขตั้งแต่ 1 ขึ้นไป"
        );


        return;

    }


    if (
        exportDate <
        importDate
    ) {

        alert(
            "วันหมดอายุต้องไม่ก่อนวันที่นำเข้า"
        );


        return;

    }


    const status =
        calculateStatus(
            exportDate
        );


    // =================================================
    // INSERT PAYLOAD
    // =================================================

    const payload = {

        food_name:
            foodName,

        manu:
            manu,

        location:
            location,

        quantity:
            quantity,

        import_date:
            importDate,

        export_date:
            exportDate,

        status:
            status,

        // user เดิม
        user_id:
            currentUser.user_id,

        // ตู้ปัจจุบัน
        fridge_id:
            currentFridgeId,

        // คนที่เอาอาหารใส่
        added_by:
            currentUser.user_id

    };


    const submitButton =
        $("food-form-submit");


    const isEditing =
        Boolean(
            editingFoodId
        );


    if (submitButton) {

        submitButton.disabled =
            true;


        submitButton.textContent =
            "กำลังบันทึก...";

    }


    try {

        const sb =
            getSB();


        let result;


        // =================================================
        // UPDATE
        // =================================================

        if (isEditing) {

            // ไม่แก้ added_by
            // คนเดิมยังเป็นคนที่นำอาหารเข้าตู้

            const updatePayload = {

                food_name:
                    foodName,

                manu:
                    manu,

                location:
                    location,

                quantity:
                    quantity,

                import_date:
                    importDate,

                export_date:
                    exportDate,

                status:
                    status

            };


            result =
                await sb
                    .from(
                        FOOD_TABLE
                    )
                    .update(
                        updatePayload
                    )
                    .eq(
                        "food_id",
                        editingFoodId
                    )
                    .eq(
                        "fridge_id",
                        currentFridgeId
                    );

        }


        // =================================================
        // INSERT
        // =================================================

        else {

            result =
                await sb
                    .from(
                        FOOD_TABLE
                    )
                    .insert(
                        payload
                    );

        }


        // =================================================
        // ERROR
        // =================================================

        if (
            result.error
        ) {

            if (
                handleAuthError(
                    result.error
                )
            ) {

                return;

            }


            throw new Error(
                result.error.message
            );

        }


        // =================================================
        // SUCCESS
        // =================================================

        closeFoodForm();

        await loadFoods();

    }

    catch (error) {

        if (
            handleAuthError(error)
        ) {

            return;

        }


        console.error(
            "บันทึกไม่สำเร็จ:",
            error
        );


        alert(
            "บันทึกไม่สำเร็จ: " +
            (
                error?.message ||
                "เกิดข้อผิดพลาด"
            )
        );

    }

    finally {

        if (
            submitButton
        ) {

            submitButton.disabled =
                false;


            submitButton.textContent =
                isEditing
                    ? "บันทึกการแก้ไข"
                    : "บันทึก";

        }

    }

}


// =====================================================
// DELETE FOOD
// =====================================================

async function deleteFood(
    foodId
) {

    if (
        !currentUser?.user_id
    ) {

        alert(
            "ไม่พบข้อมูลผู้ใช้"
        );


        redirectToLogin();


        return;

    }


    if (
        !canEditCurrentFridge()
    ) {

        alert(
            "สิทธิ์ของคุณไม่สามารถลบอาหารในตู้เย็นนี้ได้"
        );


        return;

    }


    const food =
        foods.find(
            (item) =>
                String(
                    item.food_id
                ) ===
                String(
                    foodId
                )
        );


    const foodName =
        food?.food_name ||
        "รายการนี้";


    const confirmDelete =
        confirm(
            `ต้องการลบ "${foodName}" ใช่หรือไม่?`
        );


    if (
        !confirmDelete
    ) {

        return;

    }


    try {

        const sb =
            getSB();


        const {
            error
        } =
            await sb
                .from(
                    FOOD_TABLE
                )
                .delete()
                .eq(
                    "food_id",
                    foodId
                )
                .eq(
                    "fridge_id",
                    currentFridgeId
                );


        if (error) {

            if (
                handleAuthError(
                    error
                )
            ) {

                return;

            }


            throw new Error(
                error.message
            );

        }


        await loadFoods();

    }

    catch (error) {

        if (
            handleAuthError(error)
        ) {

            return;

        }


        console.error(
            "ลบไม่สำเร็จ:",
            error
        );


        alert(
            "ลบไม่สำเร็จ: " +
            (
                error?.message ||
                "เกิดข้อผิดพลาด"
            )
        );

    }

}


window.deleteFood =
    deleteFood;


// =====================================================
// STOCK
// =====================================================

async function updateStock(
    foodId,
    change
) {

    if (
        !currentUser?.user_id
    ) {

        alert(
            "ไม่พบข้อมูลผู้ใช้ กรุณาเข้าสู่ระบบใหม่"
        );


        redirectToLogin();


        return;

    }


    if (
        !canEditCurrentFridge()
    ) {

        alert(
            "สิทธิ์ของคุณไม่สามารถแก้ไขจำนวนอาหารในตู้เย็นนี้ได้"
        );


        return;

    }


    const food =
        foods.find(
            (item) =>
                String(
                    item.food_id
                ) ===
                String(
                    foodId
                )
        );


    if (!food) {

        alert(
            "ไม่พบรายการอาหารนี้"
        );


        return;

    }


    const currentQuantity =
        Math.max(
            0,
            Number(
                food.quantity ??
                0
            )
        );


    const newQuantity =
        currentQuantity +
        Number(
            change
        );


    if (
        newQuantity < 0
    ) {

        return;

    }


    try {

        const sb =
            getSB();


        const {
            error
        } =
            await sb
                .from(
                    FOOD_TABLE
                )
                .update(
                    {
                        quantity:
                            newQuantity
                    }
                )
                .eq(
                    "food_id",
                    foodId
                )
                .eq(
                    "fridge_id",
                    currentFridgeId
                );


        if (error) {

            if (
                handleAuthError(
                    error
                )
            ) {

                return;

            }


            throw new Error(
                error.message
            );

        }


        await loadFoods();

    }

    catch (error) {

        if (
            handleAuthError(error)
        ) {

            return;

        }


        console.error(
            "อัปเดตจำนวนไม่สำเร็จ:",
            error
        );


        alert(
            "อัปเดตจำนวนไม่สำเร็จ: " +
            (
                error?.message ||
                "เกิดข้อผิดพลาด"
            )
        );

    }

}


async function decreaseStock(
    foodId
) {

    await updateStock(
        foodId,
        -1
    );

}


async function increaseStock(
    foodId
) {

    await updateStock(
        foodId,
        1
    );

}


window.decreaseStock =
    decreaseStock;


window.increaseStock =
    increaseStock;


// =====================================================
// OPEN FORM
// =====================================================

function openFoodForm(
    food = null
) {

    if (
        !canEditCurrentFridge()
    ) {

        alert(
            "สิทธิ์ของคุณไม่สามารถเพิ่มหรือแก้ไขอาหารในตู้เย็นนี้ได้"
        );


        return;

    }


    editingFoodId =
        food
            ? food.food_id
            : null;


    setText(
        "food-form-title",
        food
            ? "แก้ไขรายการอาหาร"
            : "เพิ่มรายการอาหาร"
    );


    setText(
        "food-form-submit",
        food
            ? "บันทึกการแก้ไข"
            : "บันทึก"
    );


    if (
        $("f-name")
    ) {

        $("f-name").value =
            food?.food_name ||
            "";

    }


    if (
        $("f-manu")
    ) {

        $("f-manu").value =
            food?.manu ||
            "";

    }


    if (
        $("f-quantity")
    ) {

        $("f-quantity").value =
            food?.quantity ??
            1;

    }


    if (
        $("f-import-date")
    ) {

        $("f-import-date").value =
            food?.import_date ||
            getTodayString();

    }


    if (
        $("f-export-date")
    ) {

        $("f-export-date").value =
            food?.export_date ||
            "";

    }


    setLocationForForm(
        food?.location ||
        ""
    );


    updateFormStatusPreview();


    $("food-form-overlay")
        ?.classList
        .remove(
            "hidden"
        );


    $("f-name")
        ?.focus();

}


// =====================================================
// EDIT
// =====================================================

window.editFood =
    function(
        foodId
    ) {

        if (
            !canEditCurrentFridge()
        ) {

            alert(
                "สิทธิ์ของคุณไม่สามารถแก้ไขอาหารในตู้เย็นนี้ได้"
            );


            return;

        }


        const food =
            foods.find(
                (item) =>
                    String(
                        item.food_id
                    ) ===
                    String(
                        foodId
                    )
            );


        if (!food) {

            alert(
                "ไม่พบรายการอาหารนี้"
            );


            return;

        }


        openFoodForm(
            food
        );

    };


// =====================================================
// CLOSE FORM
// =====================================================

function closeFoodForm() {

    editingFoodId =
        null;


    $("food-form")
        ?.reset();


    setFormDefaults();


    setText(
        "food-form-title",
        "เพิ่มรายการอาหาร"
    );


    setText(
        "food-form-submit",
        "บันทึก"
    );


    $("food-form-overlay")
        ?.classList
        .add(
            "hidden"
        );

}


// =====================================================
// FORM DEFAULTS
// =====================================================

function setFormDefaults() {

    if (
        $("f-quantity")
    ) {

        $("f-quantity").value =
            1;

    }


    if (
        $("f-import-date")
    ) {

        $("f-import-date").value =
            getTodayString();

    }


    if (
        $("f-location")
    ) {

        $("f-location").value =
            "";

    }


    if (
        $("f-location-other")
    ) {

        $("f-location-other").value =
            "";

        $("f-location-other")
            .classList
            .add(
                "hidden"
            );

        $("f-location-other")
            .required =
            false;

    }


    if (
        $("f-location-other-help")
    ) {

        $("f-location-other-help")
            .classList
            .add(
                "hidden"
            );

    }


    setText(
        "form-user-email",
        authUser?.email ||
        "..."
    );


    setText(
        "form-status-preview",
        "ระบบคำนวณอัตโนมัติ"
    );

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

    const value =
        $("f-location")
            ?.value ||
        "";


    const isOther =
        value === "อื่นๆ";


    toggleOtherLocationInput(
        isOther
    );

}


function toggleOtherLocationInput(
    show
) {

    if (
        $("f-location-other")
    ) {

        $("f-location-other")
            .classList
            .toggle(
                "hidden",
                !show
            );


        $("f-location-other")
            .required =
            show;

    }


    if (
        $("f-location-other-help")
    ) {

        $("f-location-other-help")
            .classList
            .toggle(
                "hidden",
                !show
            );

    }


    if (
        !show &&
        $("f-location-other")
    ) {

        $("f-location-other")
            .value =
            "";

    }

}


function setLocationForForm(
    location
) {

    const select =
        $("f-location");


    const other =
        $("f-location-other");


    if (!select) {

        return;

    }


    if (!location) {

        select.value =
            "";


        if (other) {

            other.value =
                "";

        }


        toggleOtherLocationInput(
            false
        );


        return;

    }


    if (
        STANDARD_LOCATIONS.includes(
            location
        )
    ) {

        select.value =
            location;


        toggleOtherLocationInput(
            false
        );


        return;

    }


    select.value =
        "อื่นๆ";


    if (other) {

        other.value =
            location;

    }


    toggleOtherLocationInput(
        true
    );

}


// =====================================================
// FORM STATUS PREVIEW
// =====================================================

function updateFormStatusPreview() {

    const value =
        $("f-export-date")
            ?.value ||
        "";


    const preview =
        $("form-status-preview");


    if (!preview) {

        return;

    }


    if (!value) {

        preview.textContent =
            "ระบบคำนวณอัตโนมัติ";


        return;

    }


    const days =
        getDaysUntilExpiry(
            value
        );


    if (
        days === null
    ) {

        preview.textContent =
            "ระบบคำนวณอัตโนมัติ";

    }

    else if (
        days < 0
    ) {

        preview.textContent =
            "หมดอายุ";

    }

    else if (
        days <= 3
    ) {

        preview.textContent =
            "ใกล้หมดอายุ";

    }

    else {

        preview.textContent =
            "ปกติ";

    }

}


// =====================================================
// RENDER FOODS
// =====================================================

function renderFoods() {

    const list =
        $("food-list");


    if (!list) {

        return;

    }


    let filtered =
        foods.filter(
            (food) => {

                const searchArea = [

                    food.food_name,

                    food.manu,

                    food.location,

                    food.status,

                    getFoodAddedByName(
                        food
                    )

                ]
                    .map(
                        (value) =>
                            String(
                                value ||
                                ""
                            ).toLowerCase()
                    )
                    .join(
                        " "
                    );


                const matchesSearch =
                    !searchText ||
                    searchArea.includes(
                        searchText
                    );


                const matchesFilter =
                    matchesLocationFilter(
                        food.location,
                        currentFilter
                    );


                return (
                    matchesSearch &&
                    matchesFilter
                );

            }
        );


    // -------------------------
    // Sort
    // -------------------------

    filtered.sort(
        (a, b) => {

            const aDays =
                getDaysUntilExpiry(
                    a.export_date
                );


            const bDays =
                getDaysUntilExpiry(
                    b.export_date
                );


            const aValue =
                aDays === null
                    ? 999999
                    : aDays;


            const bValue =
                bDays === null
                    ? 999999
                    : bDays;


            return (
                aValue -
                bValue
            );

        }
    );


    // -------------------------
    // Empty
    // -------------------------

    if (
        filtered.length ===
        0
    ) {

        list.innerHTML = `

            <div
                class="col-span-full bg-white rounded-2xl border border-slate-200 p-10 text-center"
            >

                <div
                    class="text-4xl mb-3"
                >
                    🧊
                </div>


                <p
                    class="font-semibold text-slate-600"
                >
                    ยังไม่มีรายการอาหาร
                </p>


                <p
                    class="text-xs text-slate-400 mt-1"
                >
                    กด “+ เพิ่มรายการอาหาร”
                    เพื่อเพิ่มอาหารในตู้เย็น
                </p>

            </div>

        `;

    }

    else {

        list.innerHTML =
            filtered
                .map(
                    createFoodCard
                )
                .join(
                    ""
                );

    }


    updateStats(
        foods
    );

}


// =====================================================
// LOCATION FILTER
// =====================================================

function matchesLocationFilter(
    location,
    filter
) {

    if (
        filter === "all"
    ) {

        return true;

    }


    const value =
        String(
            location ||
            ""
        ).trim();


    const map = {

        top:
            "ชั้นบน",

        middle:
            "ชั้นกลาง",

        bottom:
            "ชั้นล่าง",

        door:
            "ช่องประตู",

        crisper:
            "ช่องผักและผลไม้",

        freezer:
            "ช่องแช่แข็ง"

    };


    if (
        map[filter]
    ) {

        return (
            value ===
            map[filter]
        );

    }


    if (
        filter === "other"
    ) {

        return (
            value !== "" &&
            !STANDARD_LOCATIONS.includes(
                value
            )
        );

    }


    if (
        filter === "chiller"
    ) {

        return (
            value ===
            "ช่องแช่เย็น"
        );

    }


    return true;

}


// =====================================================
// FILTER BUTTON
// =====================================================

function updateFilterButtons() {

    document
        .querySelectorAll(
            "[data-food-filter]"
        )
        .forEach(
            (button) => {

                button.classList.remove(
                    "bg-violet-600",
                    "text-white"
                );


                button.classList.add(
                    "bg-white",
                    "text-slate-600"
                );

            }
        );


    const active =
        document.querySelector(
            `[data-food-filter="${CSS.escape(
                currentFilter
            )}"]`
        );


    if (active) {

        active.classList.remove(
            "bg-white",
            "text-slate-600"
        );


        active.classList.add(
            "bg-violet-600",
            "text-white"
        );

    }

}


// =====================================================
// GET ADDED BY NAME
// =====================================================

function getFoodAddedByName(
    food
) {

    const userId =
        food?.added_by ||
        food?.user_id;


    const user =
        userId
            ? foodUserMap.get(
                String(
                    userId
                )
            )
            : null;


    if (
        user?.name
    ) {

        return user.name;

    }


    if (
        user?.user_email
    ) {

        return user.user_email;

    }


    if (
        String(
            userId
        ) ===
        String(
            currentUser?.user_id
        )
    ) {

        return (
            authUser?.email ||
            "ฉัน"
        );

    }


    return "ไม่ทราบชื่อ";

}


// =====================================================
// FOOD CARD
// =====================================================

function createFoodCard(
    food
) {

    const status =
        getStatusInfo(
            food.export_date
        );


    const quantity =
        Math.max(
            0,
            Number(
                food.quantity ??
                0
            )
        );


    const foodId =
        escapeHtml(
            String(
                food.food_id ??
                ""
            )
        );


    const addedBy =
        getFoodAddedByName(
            food
        );


    const canEdit =
        canEditCurrentFridge();


    return `

        <div
            class="bg-white rounded-2xl border border-slate-200 shadow-sm p-5"
        >

            <!-- Header -->

            <div
                class="flex items-start justify-between gap-3"
            >

                <div
                    class="flex items-center gap-3 min-w-0"
                >

                    <div
                        class="w-11 h-11 rounded-xl bg-violet-50 flex items-center justify-center text-2xl shrink-0"
                    >
                        ${getFoodIcon(
                            food.food_name
                        )}
                    </div>


                    <div
                        class="min-w-0"
                    >

                        <h3
                            class="font-bold text-slate-800 truncate"
                        >
                            ${escapeHtml(
                                food.food_name
                            )}
                        </h3>


                        <p
                            class="text-xs text-slate-400 mt-1"
                        >
                            🏷️
                            ${escapeHtml(
                                food.manu
                            )}
                        </p>


                        <p
                            class="text-[11px] text-violet-600 font-semibold mt-1"
                        >
                            👤 เพิ่มโดย:
                            ${escapeHtml(
                                addedBy
                            )}
                        </p>

                    </div>

                </div>


                <span
                    class="${status.className} text-[11px] px-2 py-1 rounded-lg font-semibold whitespace-nowrap"
                >
                    ${status.text}
                </span>

            </div>


            <!-- Details -->

            <div
                class="mt-4 space-y-2 text-xs text-slate-500"
            >

                <p>

                    📍 ตำแหน่ง:

                    <span
                        class="font-medium text-slate-700"
                    >
                        ${escapeHtml(
                            food.location
                        )}
                    </span>

                </p>


                <p>

                    📦 จำนวน:

                    <span
                        class="font-medium text-slate-700"
                    >
                        ${quantity} ชิ้น
                    </span>

                </p>


                <p>

                    📥 วันที่นำเข้า:

                    <span
                        class="font-medium text-slate-700"
                    >
                        ${formatDate(
                            food.import_date
                        )}
                    </span>

                </p>


                <p>

                    📅 วันหมดอายุ:

                    <span
                        class="font-medium text-slate-700"
                    >
                        ${formatDate(
                            food.export_date
                        )}
                    </span>

                </p>

            </div>


            <!-- Stock -->

            ${
                canEdit

                    ? `

                <div
                    class="mt-5 pt-4 border-t border-slate-100 flex items-center justify-between gap-3"
                >

                    <div>

                        <p
                            class="text-xs font-medium text-slate-500"
                        >
                            จำนวนคงเหลือ
                        </p>


                        <p
                            class="text-[11px] text-slate-400 mt-0.5"
                        >
                            กด − เมื่อนำไปใช้
                            และ + เมื่อนำมาเพิ่ม
                        </p>

                    </div>


                    <div
                        class="flex items-center bg-slate-50 border border-slate-200 rounded-xl overflow-hidden shrink-0"
                    >

                        <button
                            type="button"
                            onclick="decreaseStock('${foodId}')"
                            ${
                                quantity <= 0
                                    ? "disabled"
                                    : ""
                            }
                            class="w-10 h-10 flex items-center justify-center text-lg font-semibold ${
                                quantity <= 0
                                    ? "text-slate-300 cursor-not-allowed"
                                    : "text-rose-500 hover:bg-rose-50"
                            } transition"
                        >
                            −
                        </button>


                        <span
                            class="min-w-[52px] text-center text-sm font-bold text-slate-700"
                        >
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

                <div
                    class="mt-5 pt-4 border-t border-slate-100"
                >

                    <p
                        class="text-xs text-slate-400"
                    >
                        👁️ สิทธิ์ดูอย่างเดียว
                        • จำนวนคงเหลือ:

                        <span
                            class="font-semibold text-slate-600"
                        >
                            ${quantity}
                        </span>

                    </p>

                </div>

            `
            }


            <!-- Edit / Delete -->

            ${
                canEdit

                    ? `

                <div
                    class="flex justify-end gap-2 mt-3"
                >

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

function updateStats(
    list
) {

    const total =
        list.reduce(
            (sum, food) => {

                return (
                    sum +
                    Number(
                        food.quantity ||
                        0
                    )
                );

            },
            0
        );


    const soon =
        list.filter(
            (food) => {

                const days =
                    getDaysUntilExpiry(
                        food.export_date
                    );


                return (
                    days !== null &&
                    days >= 0 &&
                    days <= 3
                );

            }
        ).length;


    const expired =
        list.filter(
            (food) => {

                const days =
                    getDaysUntilExpiry(
                        food.export_date
                    );


                return (
                    days !== null &&
                    days < 0
                );

            }
        ).length;


    const urgent =
        list.filter(
            (food) => {

                const days =
                    getDaysUntilExpiry(
                        food.export_date
                    );


                return (
                    days !== null &&
                    days <= 3
                );

            }
        ).length;


    setText(
        "stat-total",
        total
    );


    setText(
        "stat-soon",
        soon
    );


    setText(
        "stat-expired",
        expired
    );


    setText(
        "filter-total",
        list.length
    );


    setText(
        "urgent-count",
        `${urgent} รายการ`
    );

}


// =====================================================
// TODAY
// =====================================================

function getTodayString() {

    const date =
        new Date();


    const year =
        date.getFullYear();


    const month =
        String(
            date.getMonth() + 1
        ).padStart(
            2,
            "0"
        );


    const day =
        String(
            date.getDate()
        ).padStart(
            2,
            "0"
        );


    return `${year}-${month}-${day}`;

}


// =====================================================
// DAYS UNTIL EXPIRY
// =====================================================

function getDaysUntilExpiry(
    dateString
) {

    if (
        !dateString
    ) {

        return null;

    }


    const expiry =
        new Date(
            `${dateString}T00:00:00`
        );


    if (
        Number.isNaN(
            expiry.getTime()
        )
    ) {

        return null;

    }


    const today =
        new Date();


    today.setHours(
        0,
        0,
        0,
        0
    );


    expiry.setHours(
        0,
        0,
        0,
        0
    );


    return Math.round(
        (
            expiry.getTime() -
            today.getTime()
        ) /
        86400000
    );

}


// =====================================================
// CALCULATE STATUS
// =====================================================

function calculateStatus(
    exportDate
) {

    const days =
        getDaysUntilExpiry(
            exportDate
        );


    if (
        days === null
    ) {

        return "ไม่มีวันหมดอายุ";

    }


    if (
        days < 0
    ) {

        return "หมดอายุ";

    }


    if (
        days <= 3
    ) {

        return "ใกล้หมดอายุ";

    }


    return "ปกติ";

}


// =====================================================
// STATUS UI
// =====================================================

function getStatusInfo(
    exportDate
) {

    const days =
        getDaysUntilExpiry(
            exportDate
        );


    if (
        days === null
    ) {

        return {

            text:
                "ไม่ระบุวันหมดอายุ",

            className:
                "bg-slate-100 text-slate-500"

        };

    }


    if (
        days < 0
    ) {

        return {

            text:
                "หมดอายุแล้ว",

            className:
                "bg-rose-100 text-rose-700"

        };

    }


    if (
        days === 0
    ) {

        return {

            text:
                "หมดอายุวันนี้",

            className:
                "bg-rose-100 text-rose-700"

        };

    }


    if (
        days <= 3
    ) {

        return {

            text:
                `เหลือ ${days} วัน`,

            className:
                "bg-amber-100 text-amber-700"

        };

    }


    return {

        text:
            `เหลือ ${days} วัน`,

        className:
            "bg-emerald-100 text-emerald-700"

    };

}


// =====================================================
// FOOD ICON
// =====================================================

function getFoodIcon(
    name
) {

    const value =
        String(
            name ||
            ""
        ).toLowerCase();


    if (
        value.includes("นม")
    ) {

        return "🥛";

    }


    if (
        value.includes("ไข่")
    ) {

        return "🥚";

    }


    if (
        value.includes("ชีส") ||
        value.includes("เนยแข็ง")
    ) {

        return "🧀";

    }


    if (
        value.includes("โยเกิร์ต")
    ) {

        return "🥛";

    }


    if (
        value.includes("ข้าว") ||
        value.includes("กล่อง")
    ) {

        return "🍱";

    }


    if (
        value.includes("น้ำผลไม้") ||
        value.includes("น้ำส้ม")
    ) {

        return "🧃";

    }


    if (
        value.includes("นมถั่วเหลือง") ||
        value.includes("นมถั่ว")
    ) {

        return "🥛";

    }


    if (
        value.includes("ซอสมะเขือเทศ")
    ) {

        return "🍅";

    }


    if (
        value.includes("น้ำปลา")
    ) {

        return "🧴";

    }


    if (
        value.includes("แอปเปิ้ล") ||
        value.includes("แอปเปิล")
    ) {

        return "🍎";

    }


    if (
        value.includes("แครอท")
    ) {

        return "🥕";

    }


    if (
        value.includes("ไก่")
    ) {

        return "🍗";

    }


    if (
        value.includes("ไอศกรีม") ||
        value.includes("ไอติม")
    ) {

        return "🍦";

    }


    if (
        value.includes("เฟรนช์ฟราย") ||
        value.includes("เฟรนฟราย")
    ) {

        return "🍟";

    }


    return "🍽️";

}


// =====================================================
// FORMAT DATE
// =====================================================

function formatDate(
    dateString
) {

    if (
        !dateString
    ) {

        return "-";

    }


    const date =
        new Date(
            `${dateString}T00:00:00`
        );


    if (
        Number.isNaN(
            date.getTime()
        )
    ) {

        return String(
            dateString
        );

    }


    return date.toLocaleDateString(
        "th-TH",
        {
            day:
                "numeric",

            month:
                "short",

            year:
                "numeric"
        }
    );

}


// =====================================================
// SET TEXT
// =====================================================

function setText(
    id,
    value
) {

    const element =
        $(id);


    if (element) {

        element.textContent =
            String(
                value ??
                ""
            );

    }

}


// =====================================================
// SHOW MESSAGE
// =====================================================

function showMessage(
    message
) {

    const list =
        $("food-list");


    if (!list) {

        return;

    }


    list.innerHTML = `

        <div
            class="col-span-full bg-white rounded-2xl border border-slate-200 p-8 text-center"
        >

            <p
                class="text-slate-500 text-sm"
            >
                ${escapeHtml(
                    message
                )}
            </p>

        </div>

    `;

}


// =====================================================
// SHOW ERROR
// =====================================================

function showError(
    message
) {

    const list =
        $("food-list");


    if (!list) {

        return;

    }


    list.innerHTML = `

        <div
            class="col-span-full bg-rose-50 border border-rose-200 rounded-2xl p-5"
        >

            <p
                class="font-semibold text-rose-700"
            >
                โหลดรายการอาหารไม่สำเร็จ
            </p>


            <p
                class="text-xs text-rose-600 mt-1"
            >
                ${escapeHtml(
                    message
                )}
            </p>

        </div>

    `;

}


// =====================================================
// ESCAPE HTML
// =====================================================

function escapeHtml(
    value
) {

    return String(
        value ??
        ""
    )
        .replaceAll(
            "&",
            "&amp;"
        )
        .replaceAll(
            "<",
            "&lt;"
        )
        .replaceAll(
            ">",
            "&gt;"
        )
        .replaceAll(
            '"',
            "&quot;"
        )
        .replaceAll(
            "'",
            "&#039;"
        );

}


// =====================================================
// SYNC FRIDGE FROM OTHER PAGE / TAB
// =====================================================
// เวลา Settings เปลี่ยน fridge
// หน้า index ที่เปิดอยู่ในอีก tab/page จะเปลี่ยนตาม
// =====================================================

window.addEventListener(
    "storage",
    async (event) => {

        if (
            event.key !==
            CURRENT_FRIDGE_STORAGE_KEY
        ) {

            return;

        }


        if (
            !event.newValue
        ) {

            return;

        }


        try {

            // -------------------------
            // ตรวจ session
            // -------------------------

            const sb =
                getSB();


            const {
                data,
                error
            } =
                await sb.auth.getSession();


            if (error) {

                console.error(
                    "ตรวจ Session จาก storage event ไม่สำเร็จ:",
                    error
                );


                return;

            }


            const user =
                data?.session?.user;


            if (!user) {

                redirectToLogin();

                return;

            }


            authUser =
                user;


            currentUser =
                await getCurrentDBUser(
                    user
                );


            if (
                !currentUser?.user_id
            ) {

                return;

            }


            const previousFridgeId =
                currentFridgeId;


            currentFridgeId =
                null;

            currentFridgeRole =
                null;


            await getCurrentFridgeForUser();


            // -------------------------
            // ถ้า fridge เปลี่ยน
            // -------------------------

            if (
                String(
                    previousFridgeId
                ) !==
                String(
                    currentFridgeId
                )
            ) {

                await loadFoods();

                setupRealtime();

            }

            else {

                // เผื่อข้อมูลในตู้นั้นมีการเปลี่ยน
                await loadFoods();

            }

        }

        catch (error) {

            console.error(
                "เปลี่ยนตู้เย็นตามหน้าอื่นไม่สำเร็จ:",
                error
            );

        }

    }
);


// =====================================================
// KEEP SESSION WHEN RETURNING TO PAGE
// =====================================================

document.addEventListener(
    "visibilitychange",
    async () => {

        if (
            document.visibilityState !==
            "visible"
        ) {

            return;

        }


        try {

            const sb =
                getSB();


            const {
                data,
                error
            } =
                await sb.auth.getSession();


            if (error) {

                console.error(
                    "ตรวจ Session หลังกลับหน้า:",
                    error
                );


                return;

            }


            const user =
                data?.session?.user;


            // ไม่มี session
            if (!user) {

                redirectToLogin();

                return;

            }


            authUser =
                user;


            setText(
                "user-email",
                user.email ||
                "ผู้ใช้"
            );


            setText(
                "form-user-email",
                user.email ||
                "ผู้ใช้"
            );


            currentUser =
                await getCurrentDBUser(
                    user
                );


            if (
                currentUser?.user_id
            ) {

                // รีเฟรช fridge ปัจจุบันด้วย
                // เพราะ Settings อาจเปลี่ยนตู้ไว้แล้ว

                const previousFridgeId =
                    currentFridgeId;


                currentFridgeId =
                    null;


                currentFridgeRole =
                    null;


                const selectedFridge =
                    await getCurrentFridgeForUser();


                if (
                    !selectedFridge
                ) {

                    showError(
                        "ยังไม่มีตู้เย็นที่สามารถเข้าถึงได้"
                    );


                    return;

                }


                await loadFoods();


                // ถ้าตู้เปลี่ยน
                if (
                    String(
                        previousFridgeId
                    ) !==
                    String(
                        currentFridgeId
                    )
                ) {

                    setupRealtime();

                }

            }

        }

        catch (error) {

            console.error(
                "Session check error:",
                error
            );

        }

    }
);


// =====================================================
// OPTIONAL: REFRESH WHEN PAGE IS SHOWN
// =====================================================

window.addEventListener(
    "pageshow",
    async () => {

        try {

            if (
                document.visibilityState !==
                "visible"
            ) {

                return;

            }


            if (
                !currentUser?.user_id
            ) {

                return;

            }


            const previousFridgeId =
                currentFridgeId;


            currentFridgeId =
                null;


            currentFridgeRole =
                null;


            await getCurrentFridgeForUser();

            await loadFoods();


            if (
                String(
                    previousFridgeId
                ) !==
                String(
                    currentFridgeId
                )
            ) {

                setupRealtime();

            }

        }

        catch (error) {

            console.warn(
                "pageshow refresh error:",
                error
            );

        }

    }
);