// =====================================================
// TUYEN - FOOD MANAGEMENT
// =====================================================
// ตาราง Supabase: food
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

// =====================================================
// ตัวแปรสถานะ
// =====================================================

let foods = [];
let editingFoodId = null;
let currentFilter = "all";
let searchText = "";
let currentUser = null;
let authUser = null;

// =====================================================
// SHORTCUT
// =====================================================

const $ = (id) => document.getElementById(id);

// =====================================================
// START
// =====================================================

document.addEventListener("DOMContentLoaded", async () => {
    await initialize();
});

// =====================================================
// INITIALIZE
// =====================================================

async function initialize() {
    try {

        // -------------------------------------------------
        // 1. ตรวจสอบ Supabase Auth
        // -------------------------------------------------

        if (typeof requireAuth !== "function") {
            console.error("ไม่พบ requireAuth()");
            showMessage("ไม่พบระบบเข้าสู่ระบบ กรุณาตรวจสอบ auth.js");
            return;
        }

        authUser = await requireAuth("login.html");

        if (!authUser) {
            return;
        }

        console.log("Auth User:", authUser);

        // -------------------------------------------------
        // 2. แสดงอีเมลบัญชีที่ Login อยู่
        // -------------------------------------------------

        const email =
            authUser.email ||
            authUser.user_email ||
            "ผู้ใช้";

        setText("user-email", email);

        // -------------------------------------------------
        // 3. ปุ่ม Logout
        // -------------------------------------------------

        const logoutButton = $("logout-btn");

        if (logoutButton) {
            logoutButton.addEventListener("click", async () => {

                if (typeof logout === "function") {
                    await logout();
                } else {
                    console.error("ไม่พบฟังก์ชัน logout()");
                }

            });
        }

        // -------------------------------------------------
        // 4. หา user_id สำหรับฐานข้อมูล
        // -------------------------------------------------

        currentUser = await getCurrentDBUser();

        if (!currentUser) {
            showMessage(
                "ไม่พบข้อมูลผู้ใช้ในระบบ กรุณาตรวจสอบตาราง users"
            );
            return;
        }

        console.log("Current DB User:", currentUser);

        // -------------------------------------------------
        // 5. โหลดข้อมูลอาหาร
        // -------------------------------------------------

        await loadFoods();

        // -------------------------------------------------
        // 6. ผูก Event ต่าง ๆ
        // -------------------------------------------------

        bindEvents();

    } catch (error) {

        console.error("initialize error:", error);

        if (handleAuthError(error)) {
            return;
        }

        showError(error.message || "เกิดข้อผิดพลาด");
    }
}

// =====================================================
// GET CURRENT DATABASE USER
// =====================================================

async function getCurrentDBUser() {

    const sb = getSupabase();

    // -------------------------------------------------
    // ถ้ามี user_id จาก Auth
    // -------------------------------------------------

    const authId =
        authUser?.id ||
        authUser?.user?.id ||
        null;

    const email =
        authUser?.email ||
        authUser?.user_email ||
        authUser?.user?.email ||
        null;

    console.log("Auth ID:", authId);
    console.log("Auth Email:", email);

    // -------------------------------------------------
    // วิธีที่ 1
    // หาใน users ด้วย email
    // -------------------------------------------------

    if (email) {

        const {
            data: dbUser,
            error
        } = await sb
            .from(USERS_TABLE)
            .select("user_id, name, user_email")
            .eq("user_email", email)
            .maybeSingle();

        if (!error && dbUser) {

            return {
                user_id: dbUser.user_id,
                name: dbUser.name || "",
                user_email: dbUser.user_email || email,
                auth_id: authId
            };

        }

        console.log(
            "ไม่พบผู้ใช้ใน users จาก email:",
            error?.message || "ไม่มีข้อมูล"
        );
    }

    // -------------------------------------------------
    // วิธีที่ 2
    // ถ้า users ไม่มีข้อมูล ให้ใช้ Auth UUID
    // -------------------------------------------------

    if (authId) {

        return {
            user_id: authId,
            name: "",
            user_email: email || "",
            auth_id: authId
        };

    }

    return null;
}

// =====================================================
// LOAD FOODS
// =====================================================

async function loadFoods() {

    if (!currentUser?.user_id) {

        showMessage(
            "ไม่พบ user_id ของผู้ใช้งาน"
        );

        return;
    }

    const sb = getSupabase();

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

        console.error(
            "โหลดอาหารไม่สำเร็จ:",
            error
        );

        if (handleAuthError(error)) {
            return;
        }

        showError(error.message);

        return;
    }

    foods = data || [];

    console.log(
        "อาหารของผู้ใช้:",
        foods
    );

    renderFoods();
}

// =====================================================
// BIND EVENTS
// =====================================================

function bindEvents() {

    // -------------------------------------------------
    // เพิ่มอาหาร
    // -------------------------------------------------

    $("add-food-btn")?.addEventListener(
        "click",
        () => {
            openFoodForm();
        }
    );

    // -------------------------------------------------
    // ปิดฟอร์ม
    // -------------------------------------------------

    $("food-form-close")?.addEventListener(
        "click",
        closeFoodForm
    );

    $("food-form-cancel")?.addEventListener(
        "click",
        closeFoodForm
    );

    // -------------------------------------------------
    // Submit
    // -------------------------------------------------

    $("food-form")?.addEventListener(
        "submit",
        saveFood
    );

    // -------------------------------------------------
    // Search
    // -------------------------------------------------

    $("search-food")?.addEventListener(
        "input",
        (event) => {

            searchText =
                event.target.value
                    .trim()
                    .toLowerCase();

            renderFoods();
        }
    );

    // -------------------------------------------------
    // Filter
    // -------------------------------------------------

    document
        .querySelectorAll("[data-food-filter]")
        .forEach((button) => {

            button.addEventListener(
                "click",
                () => {

                    setFilter(
                        button.dataset.foodFilter
                    );

                }
            );

        });

    // -------------------------------------------------
    // ปุ่มใน Food Card
    // -------------------------------------------------

    $("food-list")?.addEventListener(
        "click",
        handleFoodCardClick
    );

    // -------------------------------------------------
    // กดนอก Modal เพื่อปิด
    // -------------------------------------------------

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

    // -------------------------------------------------
    // วันที่นำเข้า
    // -------------------------------------------------

    $("f-import-date")?.addEventListener(
        "change",
        updateExpiryMinDate
    );
}

// =====================================================
// HANDLE FOOD CARD BUTTON
// =====================================================

function handleFoodCardClick(event) {

    const button =
        event.target.closest(
            "[data-action]"
        );

    if (!button) {
        return;
    }

    const action =
        button.dataset.action;

    const foodId =
        button.dataset.id;

    // -------------------------------------------------
    // EDIT
    // -------------------------------------------------

    if (action === "edit") {

        const food =
            foods.find(
                (item) =>
                    String(item.food_id) ===
                    String(foodId)
            );

        if (food) {
            openFoodForm(food);
        }

        return;
    }

    // -------------------------------------------------
    // DELETE
    // -------------------------------------------------

    if (action === "delete") {

        deleteFood(foodId);

        return;
    }

    // -------------------------------------------------
    // DECREASE
    // -------------------------------------------------

    if (action === "decrease") {

        changeStock(
            foodId,
            -1
        );

        return;
    }

    // -------------------------------------------------
    // INCREASE
    // -------------------------------------------------

    if (action === "increase") {

        changeStock(
            foodId,
            1
        );

        return;
    }
}

// =====================================================
// CHANGE STOCK
// =====================================================

async function changeStock(
    foodId,
    change
) {

    if (!currentUser?.user_id) {

        alert(
            "ไม่พบข้อมูลผู้ใช้ กรุณาเข้าสู่ระบบใหม่"
        );

        return;
    }

    const food =
        foods.find(
            (item) =>
                String(item.food_id) ===
                String(foodId)
        );

    if (!food) {
        return;
    }

    const currentQuantity =
        Number(food.quantity || 0);

    const newQuantity =
        currentQuantity + change;

    // -------------------------------------------------
    // ห้ามติดลบ
    // -------------------------------------------------

    if (newQuantity < 0) {

        alert(
            "จำนวนอาหารไม่สามารถน้อยกว่า 0 ได้"
        );

        return;
    }

    try {

        const sb = getSupabase();

        const {
            error
        } = await sb
            .from(FOOD_TABLE)
            .update({
                quantity: newQuantity
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
            throw new Error(
                error.message
            );
        }

        // อัปเดตข้อมูลบนหน้าเว็บทันที
        food.quantity = newQuantity;

        renderFoods();

    } catch (error) {

        console.error(
            "เปลี่ยนจำนวนไม่สำเร็จ:",
            error
        );

        if (handleAuthError(error)) {
            return;
        }

        alert(
            "เปลี่ยนจำนวนไม่สำเร็จ: " +
            error.message
        );
    }
}

// =====================================================
// SAVE FOOD
// =====================================================

async function saveFood(event) {

    event.preventDefault();

    if (!currentUser?.user_id) {

        alert(
            "ไม่พบข้อมูลผู้ใช้ กรุณาเข้าสู่ระบบใหม่"
        );

        return;
    }

    // -------------------------------------------------
    // รับค่าจากฟอร์ม
    // -------------------------------------------------

    const foodName =
        $("f-name")?.value.trim();

    const manu =
        $("f-manu")?.value.trim();

    const location =
        $("f-location")?.value.trim();

    const quantity =
        Number(
            $("f-quantity")?.value
        );

    const importDate =
        $("f-import-date")?.value;

    const exportDate =
        $("f-export-date")?.value;

    const today =
        getTodayString();

    // -------------------------------------------------
    // ตรวจสอบข้อมูล
    // -------------------------------------------------

    if (
        !foodName ||
        !manu ||
        !location ||
        !importDate ||
        !exportDate
    ) {

        alert(
            "กรุณากรอกข้อมูลที่มีเครื่องหมาย * ให้ครบ"
        );

        return;
    }

    // -------------------------------------------------
    // ตรวจสอบจำนวน
    // -------------------------------------------------

    if (
        Number.isNaN(quantity) ||
        quantity < 0
    ) {

        alert(
            "จำนวนต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป"
        );

        return;
    }

    // -------------------------------------------------
    // ตรวจสอบวันที่นำเข้า
    // วันที่นำเข้าห้ามเป็นอนาคต
    // -------------------------------------------------

    if (importDate > today) {

        alert(
            "วันที่นำเข้าไม่สามารถเป็นวันในอนาคตได้"
        );

        return;
    }

    // -------------------------------------------------
    // ตรวจสอบวันหมดอายุ
    // วันหมดอายุต้องไม่ก่อนวันที่นำเข้า
    // -------------------------------------------------

    if (exportDate < importDate) {

        alert(
            "วันหมดอายุต้องไม่ก่อนวันที่นำเข้า"
        );

        return;
    }

    // -------------------------------------------------
    // คำนวณสถานะ
    // -------------------------------------------------

    const status =
        calculateStatus(
            exportDate
        );

    // -------------------------------------------------
    // Payload
    // -------------------------------------------------

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

    const sb = getSupabase();

    const submitButton =
        $("food-form-submit");

    if (submitButton) {

        submitButton.disabled = true;

        submitButton.textContent =
            editingFoodId
                ? "กำลังบันทึก..."
                : "กำลังเพิ่ม...";
    }

    try {

        let result;

        // -------------------------------------------------
        // UPDATE
        // -------------------------------------------------

        if (editingFoodId) {

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

        // -------------------------------------------------
        // CREATE
        // -------------------------------------------------

        else {

            result =
                await sb
                    .from(FOOD_TABLE)
                    .insert(payload);
        }

        if (result.error) {

            throw new Error(
                result.error.message
            );
        }

        closeFoodForm();

        await loadFoods();

    } catch (error) {

        console.error(
            "บันทึกไม่สำเร็จ:",
            error
        );

        if (handleAuthError(error)) {
            return;
        }

        alert(
            "บันทึกไม่สำเร็จ: " +
            error.message
        );

    } finally {

        if (submitButton) {

            submitButton.disabled = false;

            submitButton.textContent =
                editingFoodId
                    ? "บันทึกการแก้ไข"
                    : "บันทึก";
        }
    }
}

// =====================================================
// DELETE FOOD
// =====================================================

async function deleteFood(foodId) {

    if (!currentUser?.user_id) {

        alert(
            "ไม่พบข้อมูลผู้ใช้"
        );

        return;
    }

    const food =
        foods.find(
            (item) =>
                String(item.food_id) ===
                String(foodId)
        );

    const foodName =
        food?.food_name ||
        "รายการนี้";

    const confirmDelete =
        confirm(
            `ต้องการลบ "${foodName}" ออกจากตู้เย็นใช่หรือไม่?`
        );

    if (!confirmDelete) {
        return;
    }

    try {

        const sb = getSupabase();

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

            throw new Error(
                error.message
            );
        }

        await loadFoods();

    } catch (error) {

        console.error(
            "ลบไม่สำเร็จ:",
            error
        );

        if (handleAuthError(error)) {
            return;
        }

        alert(
            "ลบไม่สำเร็จ: " +
            error.message
        );
    }
}

// =====================================================
// OPEN FOOD FORM
// =====================================================

function openFoodForm(
    food = null
) {

    editingFoodId =
        food
            ? food.food_id
            : null;

    // -------------------------------------------------
    // Title
    // -------------------------------------------------

    setText(
        "food-form-title",
        food
            ? "แก้ไขรายการอาหาร"
            : "เพิ่มรายการอาหาร"
    );

    // -------------------------------------------------
    // Submit button
    // -------------------------------------------------

    setText(
        "food-form-submit",
        food
            ? "บันทึกการแก้ไข"
            : "บันทึก"
    );

    // -------------------------------------------------
    // Fill data
    // -------------------------------------------------

    if ($("f-name")) {

        $("f-name").value =
            food?.food_name || "";
    }

    if ($("f-manu")) {

        $("f-manu").value =
            food?.manu || "";
    }

    if ($("f-location")) {

        $("f-location").value =
            food?.location || "";
    }

    if ($("f-quantity")) {

        $("f-quantity").value =
            food?.quantity ?? 1;
    }

    // -------------------------------------------------
    // วันที่นำเข้า
    // -------------------------------------------------

    const today =
        getTodayString();

    if ($("f-import-date")) {

        $("f-import-date").value =
            food?.import_date ||
            today;

        // ห้ามเลือกวันที่นำเข้าในอนาคต
        $("f-import-date").max =
            today;
    }

    // -------------------------------------------------
    // วันหมดอายุ
    // -------------------------------------------------

    if ($("f-export-date")) {

        $("f-export-date").value =
            food?.export_date || "";

        // วันหมดอายุต้องไม่ก่อนวันที่นำเข้า
        if ($("f-import-date").value) {

            $("f-export-date").min =
                $("f-import-date").value;
        }
    }

    // -------------------------------------------------
    // เปิด Modal
    // -------------------------------------------------

    $("food-form-overlay")
        ?.classList
        .remove("hidden");

    $("f-name")?.focus();
}

// =====================================================
// UPDATE EXPIRY MIN DATE
// =====================================================

function updateExpiryMinDate() {

    const importDate =
        $("f-import-date")?.value;

    const exportInput =
        $("f-export-date");

    if (!exportInput) {
        return;
    }

    if (importDate) {

        // วันหมดอายุต้องไม่ก่อนวันที่นำเข้า
        exportInput.min =
            importDate;

        // ถ้าวันหมดอายุเดิมน้อยกว่าวันนำเข้า
        // ให้ล้างค่าออก
        if (
            exportInput.value &&
            exportInput.value < importDate
        ) {

            exportInput.value = "";
        }
    }
}

// =====================================================
// CLOSE FOOD FORM
// =====================================================

function closeFoodForm() {

    editingFoodId = null;

    $("food-form")?.reset();

    if ($("f-quantity")) {

        $("f-quantity").value = 1;
    }

    const today =
        getTodayString();

    if ($("f-import-date")) {

        $("f-import-date").value =
            today;

        $("f-import-date").max =
            today;
    }

    if ($("f-export-date")) {

        $("f-export-date").value = "";

        $("f-export-date").min =
            today;
    }

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
// RENDER FOODS
// =====================================================

function renderFoods() {

    const foodList =
        $("food-list");

    if (!foodList) {
        return;
    }

    // -------------------------------------------------
    // Filter + Search
    // -------------------------------------------------

    const filtered =
        foods.filter(
            (food) => {

                const text =
                    `
                    ${food.food_name || ""}
                    ${food.manu || ""}
                    ${food.location || ""}
                    ${food.status || ""}
                    `
                    .toLowerCase();

                const matchesSearch =
                    !searchText ||
                    text.includes(
                        searchText
                    );

                // =================================================
                // FILTER ตำแหน่งในตู้เย็น
                // =================================================

                let matchesFilter = true;

                // แปลงตำแหน่งของอาหาร
                // ให้เป็นข้อความและตัดช่องว่างหัว-ท้าย
                const foodLocation =
                    String(food.location || "").trim();

                // ชั้นบน
                if (currentFilter === "top") {

                    matchesFilter =
                        foodLocation === "ชั้นบน".trim();
                }

                // ชั้นกลาง
                if (currentFilter === "middle") {

                    matchesFilter =
                        foodLocation === "ชั้นกลาง".trim();
                }

                // ชั้นล่าง
                if (currentFilter === "bottom") {

                    matchesFilter =
                        foodLocation === "ชั้นล่าง".trim();
                }

                // ช่องประตู
                // รองรับข้อมูลเก่าที่ใช้ "ช่องประตูตู้เย็น"
                if (currentFilter === "door") {

                    matchesFilter =
                        foodLocation === "ช่องประตู".trim() ||
                        foodLocation === "ช่องประตูตู้เย็น".trim();
                }

                // ช่องผักและผลไม้
                if (currentFilter === "crisper") {

                    matchesFilter =
                        foodLocation === "ช่องผักและผลไม้".trim();
                }

                // ช่องแช่แข็ง
                if (currentFilter === "freezer") {

                    matchesFilter =
                        foodLocation === "ช่องแช่แข็ง".trim();
                }

                // =================================================
                // อื่น ๆ
                // =================================================
                // รองรับทั้ง
                // 1. "อื่นๆ"
                // 2. "อื่น ๆ"
                // 3. ตำแหน่งที่ผู้ใช้พิมพ์เอง
                //
                // เช่น
                // "ข้างตู้เย็น"
                // "ชั้นพิเศษ"
                // "กล่องด้านบน"
                // =================================================

                if (currentFilter === "other") {

                    const standardLocations = [
                        "ชั้นบน",
                        "ชั้นกลาง",
                        "ชั้นล่าง",
                        "ช่องประตู",
                        "ช่องประตูตู้เย็น",
                        "ช่องผักและผลไม้",
                        "ช่องแช่แข็ง"
                    ];

                    matchesFilter =
                        foodLocation !== "" &&
                        !standardLocations.some(
                            (location) =>
                                foodLocation === location.trim()
                        );
                }

                return (
                    matchesSearch &&
                    matchesFilter
                );
            }
        );

    // -------------------------------------------------
    // เรียงตามวันหมดอายุ
    // -------------------------------------------------

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

            if (aDays === null) {
                return 1;
            }

            if (bDays === null) {
                return -1;
            }

            return aDays - bDays;
        }
    );

    // -------------------------------------------------
    // ไม่มีอาหาร
    // -------------------------------------------------

    if (!filtered.length) {

        foodList.innerHTML = `
            <div
                class="col-span-full bg-white rounded-2xl border border-slate-200 p-10 text-center min-h-[250px] flex flex-col items-center justify-center"
            >

                <div class="text-5xl mb-4">
                    🧊
                </div>

                <p class="font-semibold text-slate-700">
                    ยังไม่มีรายการอาหาร
                </p>

                <p class="text-xs text-slate-400 mt-2">
                    กด “+ เพิ่มรายการอาหาร”
                    เพื่อเพิ่มอาหารในตู้เย็น
                </p>

            </div>
        `;

    }

    // -------------------------------------------------
    // แสดงอาหาร
    // -------------------------------------------------

    else {

        foodList.innerHTML =
            filtered
                .map(createFoodCard)
                .join("");
    }

    // -------------------------------------------------
    // Update Dashboard
    // -------------------------------------------------

    updateStats(
        foods
    );
}

// =====================================================
// FOOD CARD
// =====================================================

function createFoodCard(food) {

    const status =
        getStatusInfo(
            food.export_date
        );

    const quantity =
        Number(
            food.quantity || 0
        );

    return `
        <div
            class="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 hover:border-violet-200 hover:shadow-md transition"
        >

            <!-- ========================================= -->
            <!-- HEADER -->
            <!-- ========================================= -->

            <div class="flex items-start justify-between gap-3">

                <div class="min-w-0">

                    <h3
                        class="font-bold text-slate-800 text-base truncate"
                    >
                        ${escapeHtml(
                            food.food_name
                        )}
                    </h3>

                    <p
                        class="text-[11px] text-slate-400 mt-0.5 truncate"
                    >
                        🏷️
                        ${escapeHtml(
                            food.manu
                        )}
                    </p>

                </div>

                <span
                    class="${status.className}
                    text-[10px]
                    px-2
                    py-1
                    rounded-lg
                    font-semibold
                    whitespace-nowrap
                    shrink-0"
                >
                    ${status.text}
                </span>

            </div>


            <!-- ========================================= -->
            <!-- MAIN CONTENT -->
            <!-- ========================================= -->

            <div
                class="flex items-center justify-between gap-3 mt-4"
            >

                <!-- ------------------------------------- -->
                <!-- FOOD INFORMATION -->
                <!-- ------------------------------------- -->

                <div
                    class="min-w-0 flex-1 space-y-1.5 text-[11px] text-slate-500"
                >

                    <p class="truncate">

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


                <!-- ------------------------------------- -->
                <!-- STOCK CONTROL -->
                <!-- ------------------------------------- -->

                <div
                    class="shrink-0 bg-slate-50 border border-slate-100 rounded-xl px-2.5 py-2"
                >

                    <p
                        class="text-[9px] text-slate-400 text-center mb-1"
                    >
                        จำนวน
                    </p>


                    <div
                        class="flex items-center gap-1.5"
                    >

                        <button
                            type="button"
                            data-action="decrease"
                            data-id="${food.food_id}"
                            title="ลดจำนวน"
                            class="w-7 h-7 rounded-lg bg-white border border-slate-200 text-slate-600 hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200 font-bold text-base flex items-center justify-center transition"
                        >
                            −
                        </button>


                        <div
                            class="min-w-[34px] text-center"
                        >

                            <span
                                class="text-base font-bold text-slate-800"
                            >
                                ${quantity}
                            </span>

                            <span
                                class="block text-[9px] text-slate-400"
                            >
                                ชิ้น
                            </span>

                        </div>


                        <button
                            type="button"
                            data-action="increase"
                            data-id="${food.food_id}"
                            title="เพิ่มจำนวน"
                            class="w-7 h-7 rounded-lg bg-white border border-slate-200 text-slate-600 hover:bg-emerald-50 hover:text-emerald-600 hover:border-emerald-200 font-bold text-base flex items-center justify-center transition"
                        >
                            +
                        </button>

                    </div>

                </div>

            </div>


            <!-- ========================================= -->
            <!-- ACTIONS -->
            <!-- ========================================= -->

            <div
                class="flex justify-end gap-2 mt-3 pt-3 border-t border-slate-100"
            >

                <button
                    type="button"
                    data-action="edit"
                    data-id="${food.food_id}"
                    class="px-3 py-1.5 text-[11px] font-medium text-violet-600 bg-violet-50 hover:bg-violet-100 rounded-lg transition"
                >
                    ✏️ แก้ไข
                </button>


                <button
                    type="button"
                    data-action="delete"
                    data-id="${food.food_id}"
                    class="px-3 py-1.5 text-[11px] font-medium text-rose-600 bg-rose-50 hover:bg-rose-100 rounded-lg transition"
                >
                    🗑️ ลบ
                </button>

            </div>

        </div>
    `;
}

// =====================================================
// UPDATE STATISTICS
// =====================================================

function updateStats(list) {

    // จำนวนอาหารทั้งหมด
    const total =
        list.reduce(
            (sum, food) =>
                sum +
                Number(
                    food.quantity || 0
                ),
            0
        );

    // ใกล้หมดอายุ
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

    // หมดอายุ
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

    // รายการทั้งหมด
    const totalItems =
        list.length;

    // ของที่ต้องแจ้งเตือน
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
        totalItems
    );

    setText(
        "urgent-count",
        `${urgent} รายการ`
    );

    setText(
        "food-count",
        `${totalItems} รายการ`
    );
}

// =====================================================
// FILTER
// =====================================================

function setFilter(filter) {

    currentFilter =
        filter;

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
            `[data-food-filter="${filter}"]`
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

    renderFoods();
}

// =====================================================
// GET TODAY
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

    const today =
        new Date();

    today.setHours(
        0,
        0,
        0,
        0
    );

    const expiry =
        new Date(
            `${dateString}T00:00:00`
        );

    expiry.setHours(
        0,
        0,
        0,
        0
    );

    return Math.round(
        (
            expiry -
            today
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
            text: "ไม่ระบุวันหมดอายุ",
            className:
                "bg-slate-100 text-slate-500"
        };
    }

    if (days < 0) {

        return {
            text: "หมดอายุแล้ว",
            className:
                "bg-rose-100 text-rose-700"
        };
    }

    if (days === 0) {

        return {
            text: "หมดอายุวันนี้",
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
        return "-";
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
// SHOW MESSAGE
// =====================================================

function showMessage(
    message
) {

    if (!$("food-list")) {
        return;
    }

    $("food-list").innerHTML = `
        <div
            class="col-span-full bg-white rounded-2xl border border-slate-200 p-8 text-center"
        >

            <p class="text-slate-500 text-sm">
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

    if (!$("food-list")) {
        return;
    }

    $("food-list").innerHTML = `
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
            value;
    }
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
// AUTH ERROR
// =====================================================

function handleAuthError(
    error
) {

    const msg =
        String(
            error?.message ||
            error ||
            ""
        );

    if (
        /invalid jwt|jwt expired|permission denied|PGRST301/i
            .test(msg)
    ) {

        window.location.href =
            "login.html";

        return true;
    }

    return false;
}