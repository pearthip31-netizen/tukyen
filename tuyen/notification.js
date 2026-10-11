/* =========================================================
   TUYEN - Notification Page
   File: notification.js
   ========================================================= */

(() => {
    "use strict";

    const $ = (id) => document.getElementById(id);

    let notificationRows = [];
    let initStarted = false;

    /* =====================================================
       SUPABASE CLIENT
    ===================================================== */

    function getSB() {
        // ใช้ฟังก์ชันจาก config.js ก่อน
        if (typeof getSupabase === "function") {
            try {
                const client = getSupabase();

                if (
                    client?.auth &&
                    typeof client.from === "function"
                ) {
                    return client;
                }
            } catch (error) {
                console.warn(
                    "getSupabase() ใช้งานไม่ได้:",
                    error
                );
            }
        }

        // รองรับ const supabase ที่ประกาศใน config.js
        if (
            typeof supabase !== "undefined" &&
            supabase &&
            supabase.auth &&
            typeof supabase.from === "function"
        ) {
            return supabase;
        }

        // รองรับกรณีเก็บ client ไว้ใน window
        const candidates = [
            window.supabaseClient,
            window.sb,
            window.supabase
        ];

        for (const client of candidates) {
            if (
                client?.auth &&
                typeof client.from === "function"
            ) {
                return client;
            }
        }

        throw new Error(
            "ไม่พบ Supabase client กรุณาตรวจสอบ config.js และลำดับการโหลดไฟล์"
        );
    }

    /* =====================================================
       HELPER FUNCTIONS
    ===================================================== */

    function escapeHTML(value) {
        return String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function formatDate(value) {
        if (!value) {
            return "ไม่ระบุวันที่";
        }

        const date = new Date(value);

        if (Number.isNaN(date.getTime())) {
            return "ไม่ระบุวันที่";
        }

        return date.toLocaleString("th-TH", {
            dateStyle: "medium",
            timeStyle: "short"
        });
    }

    /* =====================================================
       SHOW ERROR
    ===================================================== */

    function showLoadError(error) {
        console.error(
            "TUYEN notification page:",
            error
        );

        const list = $("notification-list");
        const count = $("notification-count");
        const header = $("user-email");

        // หากยังเป็น ... ให้แสดงสถานะผิดพลาดแทน
        if (
            header &&
            (
                !header.textContent ||
                header.textContent.trim() === "..."
            )
        ) {
            header.textContent =
                "เชื่อมต่อบัญชีไม่สำเร็จ";

            header.title =
                error?.message ||
                "กรุณาตรวจสอบ config.js และ Session";
        }

        if (count) {
            count.textContent =
                "โหลดข้อมูลไม่สำเร็จ";
        }

        if (list) {
            list.innerHTML = `
                <div class="notification-empty">
                    <div class="empty-icon">⚠️</div>

                    <h3>โหลดการแจ้งเตือนไม่สำเร็จ</h3>

                    <p>
                        ${escapeHTML(
                            error?.message ||
                            "กรุณาตรวจสอบการเชื่อมต่อ"
                        )}
                    </p>
                </div>
            `;
        }
    }

    /* =====================================================
       GET CURRENT USER
    ===================================================== */

    async function getCurrentUser(sb) {
        const {
            data: sessionData,
            error: sessionError
        } = await sb.auth.getSession();

        if (sessionError) {
            throw sessionError;
        }

        const authUser =
            sessionData?.session?.user;

        if (!authUser) {
            return null;
        }

        const email = String(
            authUser.email || ""
        ).trim();

        const header = $("user-email");

        // แสดงอีเมลทันทีที่พบ Session
        if (header) {
            header.textContent =
                email || "ไม่พบอีเมล";

            header.title = email;
        } else {
            console.warn(
                'ไม่พบ element id="user-email" ใน HTML'
            );
        }

        let dbUser = null;

        // ค้นหาข้อมูลจาก users ด้วย user_id
        const {
            data: userById,
            error: byIdError
        } = await sb
            .from("users")
            .select("user_id, name, user_email")
            .eq("user_id", authUser.id)
            .maybeSingle();

        if (byIdError) {
            console.warn(
                "ค้นหาผู้ใช้ด้วย user_id ไม่สำเร็จ:",
                byIdError.message
            );
        } else {
            dbUser = userById;
        }

        // หากไม่พบ ให้ลองค้นหาด้วยอีเมล
        if (!dbUser && email) {
            const {
                data: userByEmail,
                error: byEmailError
            } = await sb
                .from("users")
                .select("user_id, name, user_email")
                .eq("user_email", email)
                .maybeSingle();

            if (byEmailError) {
                console.warn(
                    "ค้นหาผู้ใช้ด้วยอีเมลไม่สำเร็จ:",
                    byEmailError.message
                );
            } else {
                dbUser = userByEmail;
            }
        }

        // สำรองชื่อจาก Auth metadata
        const metadataName =
            authUser.user_metadata?.name ||
            authUser.user_metadata?.full_name ||
            authUser.user_metadata?.display_name ||
            "";

        const name = String(
            dbUser?.name ||
            metadataName ||
            ""
        ).trim();

        // แสดงชื่อก่อน หากไม่มีชื่อให้แสดงอีเมล
        const displayText =
            name ||
            String(
                dbUser?.user_email ||
                email ||
                "ไม่พบข้อมูลผู้ใช้"
            );

        if (header) {
            header.textContent = displayText;
            header.title = email || displayText;
        }

        return {
            user_id: dbUser?.user_id || authUser.id,
            name,
            user_email: dbUser?.user_email || email,
            email,
            authUser
        };
    }

    /* =====================================================
       LOAD NOTIFICATIONS
    ===================================================== */

    async function loadNotifications() {
        const sb = getSB();

        const currentUser =
            await getCurrentUser(sb);

        if (!currentUser) {
            window.location.replace("login.html");
            return;
        }

        /*
         * ตาราง public.notify ปัจจุบันไม่มี is_read
         * จึงไม่เรียก select หรือ update คอลัมน์นี้
         */

        const {
            data,
            error
        } = await sb
            .from("notify")
            .select(
                "notify_id, notify_text, notify_date, user_id, food_id"
            )
            .eq("user_id", currentUser.user_id)
            .order("notify_date", {
                ascending: true
            });

        if (error) {
            throw error;
        }

        notificationRows = data || [];

        renderNotifications();
    }

    /* =====================================================
       RENDER NOTIFICATIONS
    ===================================================== */

    function renderNotifications() {
        const list = $("notification-list");
        const count = $("notification-count");

        if (!list || !count) {
            return;
        }

        count.textContent =
            `${notificationRows.length} รายการ`;

        // ตารางปัจจุบันไม่เก็บสถานะอ่านแล้ว/ยังไม่อ่าน
        const badge =
            $("tuyen-notification-count");

        if (badge) {
            badge.textContent = "0";
            badge.classList.add("hidden");
        }

        // ไม่มีรายการแจ้งเตือน
        if (notificationRows.length === 0) {
            list.innerHTML = `
                <div class="notification-empty">
                    <div class="empty-icon">🔔</div>

                    <h3>ยังไม่มีการแจ้งเตือน</h3>

                    <p>
                        เมื่อมีการแจ้งเตือนอาหาร
                        รายการจะแสดงที่นี่
                    </p>
                </div>
            `;

            return;
        }

        // สร้างรายการแจ้งเตือน
        list.innerHTML = notificationRows
            .map((item, index) => `
                <button
                    type="button"
                    class="notification-card text-left w-full"
                    data-notification-index="${index}"
                >
                    <div class="notification-icon">
                        🔔
                    </div>

                    <div class="notification-content">
                        <h3 class="notification-title">
                            ${escapeHTML(
                                item.notify_text ||
                                "การแจ้งเตือน"
                            )}
                        </h3>

                        <p class="notification-detail">
                            กดเพื่อดูรายละเอียด
                        </p>

                        <span class="notification-date">
                            ${escapeHTML(
                                formatDate(item.notify_date)
                            )}
                        </span>
                    </div>
                </button>
            `)
            .join("");

        // กดเพื่อเปิดรายละเอียด
        list.querySelectorAll(
            "[data-notification-index]"
        ).forEach((button) => {
            button.addEventListener("click", () => {
                const index = Number(
                    button.dataset.notificationIndex
                );

                openNotificationDetail(
                    notificationRows[index]
                );
            });
        });
    }

    /* =====================================================
       NOTIFICATION DETAIL MODAL
    ===================================================== */

    function openNotificationDetail(item) {
        if (!item) {
            return;
        }

        const title = $("modal-title");
        const message = $("modal-message");
        const date = $("modal-date");
        const modal = $("notification-modal");

        if (title) {
            title.textContent =
                "รายละเอียดการแจ้งเตือน";
        }

        if (message) {
            message.textContent =
                item.notify_text ||
                "ไม่มีรายละเอียด";
        }

        if (date) {
            date.textContent =
                formatDate(item.notify_date);
        }

        if (modal) {
            modal.hidden = false;
        }

        $("modal-close")?.focus();
    }

    function closeNotificationDetail() {
        const modal =
            $("notification-modal");

        if (modal) {
            modal.hidden = true;
        }
    }

    /* =====================================================
       BIND EVENTS
    ===================================================== */

    function bindNotificationEvents() {
        // ปุ่มปิดหน้าต่างรายละเอียด
        $("modal-close")?.addEventListener(
            "click",
            closeNotificationDetail
        );

        // คลิกพื้นหลังเพื่อปิดหน้าต่าง
        $("notification-modal")?.addEventListener(
            "click",
            (event) => {
                if (
                    event.target ===
                    $("notification-modal")
                ) {
                    closeNotificationDetail();
                }
            }
        );

        // กด Escape เพื่อปิดหน้าต่าง
        document.addEventListener(
            "keydown",
            (event) => {
                if (event.key === "Escape") {
                    closeNotificationDetail();
                }
            }
        );

        // ปุ่มออกจากระบบ
        $("logout-btn")?.addEventListener(
            "click",
            async () => {
                const button = $("logout-btn");

                if (button) {
                    button.disabled = true;
                }

                try {
                    const sb = getSB();

                    const {
                        error
                    } = await sb.auth.signOut();

                    if (error) {
                        throw error;
                    }

                    window.location.replace(
                        "login.html"
                    );

                } catch (error) {
                    console.error(
                        "ออกจากระบบไม่สำเร็จ:",
                        error
                    );

                    alert(
                        "ออกจากระบบไม่สำเร็จ กรุณาลองอีกครั้ง"
                    );

                    if (button) {
                        button.disabled = false;
                    }
                }
            }
        );
    }

    /* =====================================================
       INITIALIZE
    ===================================================== */

    async function initialize() {
        if (initStarted) {
            return;
        }

        initStarted = true;

        bindNotificationEvents();

        try {
            await loadNotifications();
        } catch (error) {
            showLoadError(error);
        }
    }

    // ใช้ตรวจว่า notification.js โหลดแล้วหรือยัง
    window.__tuyenNotificationScriptLoaded = true;

    if (document.readyState === "loading") {
        document.addEventListener(
            "DOMContentLoaded",
            initialize,
            { once: true }
        );
    } else {
        initialize();
    }
})();