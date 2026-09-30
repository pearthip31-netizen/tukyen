// =====================================================
// TUYEN - FOOD CRUD
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
// =====================================================

const FOOD_TABLE = "food";
const USERS_TABLE = "users";

let foods = [];
let currentUser = null;
let authUser = null;
let editingFoodId = null;
let currentFilter = "all";
let searchText = "";
let realtimeChannel = null;


// =====================================================
// SHORTCUT
// =====================================================

const $ = (id) => document.getElementById(id);


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
                String(event.target.value || "")
                    .trim()
                    .toLowerCase();

            renderFoods();

        }
    );


    // -------------------------
    // Filter
    // -------------------------

    document
        .querySelectorAll("[data-food-filter]")
        .forEach((button) => {

            button.addEventListener(
                "click",
                () => {

                    currentFilter =
                        button.dataset.foodFilter || "all";

                    updateFilterButtons();

                    renderFoods();

                }
            );

        });


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
// สำคัญ:
// ใช้ getSession() โดยตรง
// ไม่ใช้ requireAuth()
// เพื่อป้องกันกลับจาก fridge.html แล้วถูกส่ง login
// =====================================================

async function initialize() {

    try {

        const sb = getSB();

        const {
            data,
            error
        } = await sb.auth.getSession();


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


        authUser = user;


        // -------------------------
        // แสดง email
        // -------------------------

        setText(
            "user-email",
            user.email || "ผู้ใช้"
        );

        setText(
            "form-user-email",
            user.email || "ผู้ใช้"
        );


        // -------------------------
        // หา user ใน public.users
        // -------------------------

        currentUser =
            await getCurrentDBUser(user);


        if (!currentUser?.user_id) {

            showError(
                "ไม่พบ user_id ของผู้ใช้งาน"
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

async function getCurrentDBUser(user) {

    const sb = getSB();

    const email =
        String(
            user?.email || ""
        ).trim();


    // ถ้าไม่มี email
    if (!email) {

        return {

            user_id: user.id,

            name: "",

            user_email: ""

        };

    }


    try {

        const {
            data,
            error
        } = await sb
            .from(USERS_TABLE)
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
    // เผื่อฐานข้อมูล food ใช้ Auth UUID
    return {

        user_id: user.id,

        name: "",

        user_email: email

    };

}


// =====================================================
// AUTH ERROR
// =====================================================

function handleAuthError(error) {

    const message =
        String(
            error?.message ||
            error ||
            ""
        );


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

        const sb = getSB();

        await sb.auth.signOut();

    }

    catch (error) {

        console.error(
            "Logout error:",
            error
        );

    }

    finally {

        // ล้างข้อมูลเก่าที่อาจค้าง
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
            !currentUser?.user_id
        ) {
            return;
        }


        const sb = getSB();


        // ลบ channel เดิม
        if (realtimeChannel) {

            sb.removeChannel(
                realtimeChannel
            );

            realtimeChannel = null;

        }


        realtimeChannel =
            sb
                .channel(
                    "tuyen-food-realtime"
                )
                .on(
                    "postgres_changes",
                    {
                        event: "*",
                        schema: "public",
                        table: FOOD_TABLE
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


    try {

        const sb = getSB();


        const {
            data,
            error
        } = await sb
            .from(FOOD_TABLE)
            .select("*")
            .eq(
                "user_id",
                currentUser.user_id
            )
            .order(
                "export_date",
                {
                    ascending: true
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

async function saveFood(event) {

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
    // รับค่า
    // -------------------------

    const foodName =
        $("f-name")?.value
            .trim() || "";


    const manu =
        $("f-manu")?.value
            .trim() || "";


    const selectedLocation =
        $("f-location")?.value
            .trim() || "";


    const otherLocation =
        $("f-location-other")?.value
            .trim() || "";


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
        !Number.isFinite(quantity) ||
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


    // -------------------------
    // Status
    // -------------------------

    const status =
        calculateStatus(
            exportDate
        );


    // -------------------------
    // Payload
    // -------------------------

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

        user_id:
            currentUser.user_id

    };


    const submitButton =
        $("food-form-submit");


    const isEditing =
        Boolean(
            editingFoodId
        );


    if (submitButton) {

        submitButton.disabled = true;

        submitButton.textContent =
            "กำลังบันทึก...";

    }


    try {

        const sb = getSB();

        let result;


        // -------------------------
        // UPDATE
        // -------------------------

        if (isEditing) {

            result =
                await sb
                    .from(FOOD_TABLE)
                    .update(payload)
                    .eq(
                        "food_id",
                        editingFoodId
                    )
                    .eq(
                        "user_id",
                        currentUser.user_id
                    );

        }


        // -------------------------
        // INSERT
        // -------------------------

        else {

            result =
                await sb
                    .from(FOOD_TABLE)
                    .insert(
                        payload
                    );

        }


        // -------------------------
        // Error
        // -------------------------

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


        // -------------------------
        // สำเร็จ
        // -------------------------

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

        if (submitButton) {

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


    const food =
        foods.find(
            (item) =>
                String(
                    item.food_id
                ) ===
                String(foodId)
        );


    const foodName =
        food?.food_name ||
        "รายการนี้";


    const confirmDelete =
        confirm(
            `ต้องการลบ "${foodName}" ใช่หรือไม่?`
        );


    if (!confirmDelete) {
        return;
    }


    try {

        const sb = getSB();


        const {
            error
        } = await sb
            .from(FOOD_TABLE)
            .delete()
            .eq(
                "food_id",
                foodId
            )
            .eq(
                "user_id",
                currentUser.user_id
            );


        if (error) {

            if (
                handleAuthError(error)
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


    const food =
        foods.find(
            (item) =>
                String(
                    item.food_id
                ) ===
                String(foodId)
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
                food.quantity ?? 0
            )
        );


    const newQuantity =
        currentQuantity +
        Number(change);


    if (
        newQuantity < 0
    ) {
        return;
    }


    try {

        const sb = getSB();


        const {
            error
        } = await sb
            .from(FOOD_TABLE)
            .update({
                quantity:
                    newQuantity
            })
            .eq(
                "food_id",
                foodId
            )
            .eq(
                "user_id",
                currentUser.user_id
            );


        if (error) {

            if (
                handleAuthError(error)
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

    editingFoodId =
        food
            ? food.food_id
            : null;


    // Title
    setText(
        "food-form-title",
        food
            ? "แก้ไขรายการอาหาร"
            : "เพิ่มรายการอาหาร"
    );


    // Button
    setText(
        "food-form-submit",
        food
            ? "บันทึกการแก้ไข"
            : "บันทึก"
    );


    // -------------------------
    // Name
    // -------------------------

    if ($("f-name")) {

        $("f-name").value =
            food?.food_name ||
            "";

    }


    // -------------------------
    // Manufacturer
    // -------------------------

    if ($("f-manu")) {

        $("f-manu").value =
            food?.manu ||
            "";

    }


    // -------------------------
    // Quantity
    // -------------------------

    if ($("f-quantity")) {

        $("f-quantity").value =
            food?.quantity ??
            1;

    }


    // -------------------------
    // Import date
    // -------------------------

    if ($("f-import-date")) {

        $("f-import-date").value =
            food?.import_date ||
            getTodayString();

    }


    // -------------------------
    // Export date
    // -------------------------

    if ($("f-export-date")) {

        $("f-export-date").value =
            food?.export_date ||
            "";

    }


    // -------------------------
    // Location
    // -------------------------

    setLocationForForm(
        food?.location ||
        ""
    );


    // -------------------------
    // Preview
    // -------------------------

    updateFormStatusPreview();


    // -------------------------
    // Open
    // -------------------------

    $("food-form-overlay")
        ?.classList
        .remove("hidden");


    $("f-name")
        ?.focus();

}


// =====================================================
// EDIT
// =====================================================

window.editFood =
    function(foodId) {

        const food =
            foods.find(
                (item) =>
                    String(
                        item.food_id
                    ) ===
                    String(foodId)
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
        .add("hidden");

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
            .add("hidden");

        $("f-location-other")
            .required =
            false;

    }


    if (
        $("f-location-other-help")
    ) {

        $("f-location-other-help")
            .classList
            .add("hidden");

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

        $("f-location-other").value =
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


    // ถ้าเป็นค่าอื่น
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


    if (days === null) {

        preview.textContent =
            "ระบบคำนวณอัตโนมัติ";

    }

    else if (days < 0) {

        preview.textContent =
            "หมดอายุ";

    }

    else if (days <= 3) {

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

                // -------------------------
                // Search
                // -------------------------

                const searchArea = [

                    food.food_name,

                    food.manu,

                    food.location,

                    food.status

                ]
                    .map(
                        (value) =>
                            String(
                                value || ""
                            ).toLowerCase()
                    )
                    .join(" ");


                const matchesSearch =
                    !searchText ||
                    searchArea.includes(
                        searchText
                    );


                // -------------------------
                // Filter
                // -------------------------

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
        filtered.length === 0
    ) {

        list.innerHTML = `

            <div
                class="col-span-full bg-white rounded-2xl border border-slate-200 p-10 text-center"
            >

                <div class="text-4xl mb-3">
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
                .map(createFoodCard)
                .join("");

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
            location || ""
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
            !STANDARD_LOCATIONS
                .includes(value)
        );

    }


    // รองรับ filter รุ่นเก่า
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
// FILTER BUTTON UI
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
            `[data-food-filter="${currentFilter}"]`
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
                food.quantity ?? 0
            )
        );


    const foodId =
        escapeHtml(
            String(
                food.food_id ?? ""
            )
        );


    const icon =
        getFoodIcon(
            food.food_name
        );


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
                        ${icon}
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


            <!-- Edit / Delete -->

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
                        food.quantity || 0
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

    if (!dateString) {
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
        ) / 86400000
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

function getStatusInfo(
    exportDate
) {

    const days =
        getDaysUntilExpiry(
            exportDate
        );


    if (days === null) {

        return {

            text:
                "ไม่ระบุวันหมดอายุ",

            className:
                "bg-slate-100 text-slate-500"

        };

    }


    if (days < 0) {

        return {

            text:
                "หมดอายุแล้ว",

            className:
                "bg-rose-100 text-rose-700"

        };

    }


    if (days === 0) {

        return {

            text:
                "หมดอายุวันนี้",

            className:
                "bg-rose-100 text-rose-700"

        };

    }


    if (days <= 3) {

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
            name || ""
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

    if (!dateString) {
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
            day: "numeric",
            month: "short",
            year: "numeric"
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
                value ?? ""
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
        value ?? ""
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
            } = await sb.auth.getSession();


            if (error) {

                console.error(
                    "ตรวจ Session หลังกลับหน้า:",
                    error
                );

                return;

            }


            const user =
                data?.session?.user;


            // ถ้าไม่มี session จริง ๆ
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

                await loadFoods();

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