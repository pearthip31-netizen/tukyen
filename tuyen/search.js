// =====================================================
// TUYEN - SHARED GLOBAL FOOD SEARCH (v3)
// ใช้กับ fridge.html / notification.html / setting.html
// ทำงานเหมือนช่องค้นหาใน index.html (app.js):
//  - พิมพ์แล้วค้นหาทันที (debounce) ไม่ต้องกด Enter
//  - ค้นหาข้ามทุกตู้ที่เป็นสมาชิก status = 'active' (food_name, manu)
//  - คลิกผลลัพธ์ -> เปิดรายละเอียด (อ่านอย่างเดียว)
//  - ตู้อื่น -> ปุ่ม "ไปยังตู้เย็นนี้" / ตู้ปัจจุบัน -> ปุ่มไปหน้า "ตู้เย็นของฉัน" เพื่อแก้ไข
// ห่อด้วย IIFE เพื่อไม่ชนกับตัวแปรของแต่ละหน้า
// สิทธิ์จริงยังขึ้นกับ Supabase RLS
// =====================================================

(function () {
    "use strict";

    if (window.__tuyenSearchV3) {
        return;
    }

    window.__tuyenSearchV3 = true;

    console.log("[TUYEN search v3] loaded");

    const FRIDGE_KEY = "tuyen_current_fridge_id";
    const PANEL_ID = "tuyen-gs-panel";
    const DETAIL_ID = "tuyen-gs-detail";
    const DEBOUNCE_MS = 250;
    const LIMIT = 30;
    const CACHE_MS = 15000;
    const COLUMNS =
        "food_id, food_name, manu, location, quantity, import_date, export_date, status, user_id, fridge_id, added_by";

    let sbClient = null;
    let me = null; // { id, email }
    let timer = null;
    let seq = 0;
    let cache = { userId: null, time: 0, roleMap: new Map(), nameMap: new Map() };

    // ---------------------------------------------
    // helpers
    // ---------------------------------------------

    const FALLBACK_URL = "https://cllhshpbtsyyujhaouid.supabase.co";
    const FALLBACK_KEY = "sb_publishable_Lp-Gu3pQd8aHOiGZ-FpVcg_dF11Ks0f";

    function isClient(c) {
        return !!(c && c.auth && typeof c.from === "function");
    }

    function getClient() {
        if (sbClient) return sbClient;

        // 1) ใช้ getSupabase() จาก config.js
        if (typeof getSupabase === "function") {
            try {
                const c = getSupabase();
                if (isClient(c)) sbClient = c;
            } catch (e) {
                console.warn("getSupabase() ใช้ไม่ได้:", e);
            }
        }

        // 2) ตัวแปร global ที่ config.js อาจประกาศไว้
        if (!sbClient) {
            try {
                if (typeof supabase !== "undefined" && isClient(supabase)) sbClient = supabase;
            } catch (e) { /* ignore */ }
        }

        if (!sbClient) {
            for (const c of [window.supabaseClient, window.sb, window.supabase]) {
                if (isClient(c)) {
                    sbClient = c;
                    break;
                }
            }
        }

        // 3) สร้าง client ใหม่จาก publishable key เดิมของโปรเจกต์ (session ใช้ร่วมกัน)
        if (!sbClient && window.supabase && typeof window.supabase.createClient === "function") {
            sbClient = window.supabase.createClient(FALLBACK_URL, FALLBACK_KEY);
        }

        if (!sbClient) {
            throw new Error("ไม่พบ Supabase client กรุณาตรวจสอบ config.js");
        }

        return sbClient;
    }

    function byId(id) {
        return document.getElementById(id);
    }

    function el(tag, className, text) {
        const e = document.createElement(tag);
        if (className) e.className = className;
        if (text !== undefined && text !== null) e.textContent = text;
        return e;
    }

    function escapeLike(value) {
        return String(value ?? "").replace(/[\\%_]/g, "\\$&");
    }

    function daysUntil(dateString) {
        if (!dateString) return null;
        const d = new Date(`${dateString}T00:00:00`);
        if (Number.isNaN(d.getTime())) return null;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return Math.round((d.getTime() - today.getTime()) / 86400000);
    }

    function statusInfo(exportDate) {
        const days = daysUntil(exportDate);

        if (days === null) return { text: "ไม่ระบุวันหมดอายุ", cls: "bg-slate-100 text-slate-500" };
        if (days < 0) return { text: "หมดอายุแล้ว", cls: "bg-rose-100 text-rose-700" };
        if (days === 0) return { text: "หมดอายุวันนี้", cls: "bg-rose-100 text-rose-700" };
        if (days <= 3) return { text: `เหลือ ${days} วัน`, cls: "bg-amber-100 text-amber-700" };
        return { text: `เหลือ ${days} วัน`, cls: "bg-emerald-100 text-emerald-700" };
    }

    function fmtDate(dateString) {
        if (!dateString) return "-";
        const d = new Date(`${dateString}T00:00:00`);
        if (Number.isNaN(d.getTime())) return String(dateString);
        return d.toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" });
    }

    function foodIcon(name) {
        const v = String(name || "").toLowerCase();
        const map = [
            [["นมถั่ว"], "🥛"], [["นม"], "🥛"], [["ไข่"], "🥚"], [["ชีส", "เนยแข็ง"], "🧀"],
            [["โยเกิร์ต"], "🥛"], [["ข้าว", "กล่อง"], "🍱"], [["น้ำผลไม้", "น้ำส้ม"], "🧃"],
            [["ซอสมะเขือเทศ"], "🍅"], [["น้ำปลา"], "🧴"], [["แอปเปิ้ล", "แอปเปิล"], "🍎"],
            [["แครอท"], "🥕"], [["ไก่"], "🍗"], [["ไอศกรีม", "ไอติม"], "🍦"],
            [["เฟรนช์ฟราย", "เฟรนฟราย"], "🍟"]
        ];
        for (const [keys, icon] of map) {
            if (keys.some((k) => v.includes(k))) return icon;
        }
        return "🍽️";
    }

    function currentFridgeId() {
        try {
            return localStorage.getItem(FRIDGE_KEY);
        } catch (e) {
            return null;
        }
    }

    function isCurrent(item) {
        const id = currentFridgeId();
        return id !== null && id !== undefined && String(item?.fridge_id) === String(id);
    }

    function titleOf(item) {
        const name = item?.food_name || "-";
        return isCurrent(item) ? name : `${name} (${item?.fridge_name || "ตู้เย็น"})`;
    }

    // ---------------------------------------------
    // ผู้ใช้ปัจจุบัน
    // ---------------------------------------------

    async function resolveUser() {
        const sb = getClient();
        const { data, error } = await sb.auth.getSession();

        if (error) throw error;

        const user = data?.session?.user;
        if (!user) return null;

        if (me && me.authId === user.id) return me;

        const email = String(user.email || "").trim();
        let id = user.id;

        if (email) {
            try {
                const { data: row } = await sb
                    .from("users")
                    .select("user_id")
                    .eq("user_email", email)
                    .maybeSingle();
                if (row?.user_id) id = row.user_id;
            } catch (e) {
                console.warn("ค้นหา users ไม่สำเร็จ:", e);
            }
        }

        me = { authId: user.id, id, email };
        return me;
    }

    // ---------------------------------------------
    // ตู้เย็นที่ค้นหาได้
    // ---------------------------------------------

    async function loadFridges(force) {
        const user = await resolveUser();
        if (!user) return null;

        if (!force && cache.userId === String(user.id) && Date.now() - cache.time < CACHE_MS) {
            return cache;
        }

        const sb = getClient();

        const { data: memberships, error: mErr } = await sb
            .from("fridge_members")
            .select("fridge_id, role, status")
            .eq("user_id", user.id)
            .eq("status", "active");

        if (mErr) throw mErr;

        const roleMap = new Map();
        (memberships || []).forEach((r) => roleMap.set(String(r.fridge_id), r.role));

        const nameMap = new Map();

        if (roleMap.size > 0) {
            const { data: fridges, error: fErr } = await sb
                .from("fridges")
                .select("fridge_id, fridge_name")
                .in("fridge_id", [...roleMap.keys()]);

            if (fErr) throw fErr;

            (fridges || []).forEach((f) => nameMap.set(String(f.fridge_id), f.fridge_name));
        }

        cache = { userId: String(user.id), time: Date.now(), roleMap, nameMap };
        return cache;
    }

    // ---------------------------------------------
    // ค้นหา
    // ---------------------------------------------

    async function searchAcrossFridges(keyword) {
        const info = await loadFridges(false);

        if (!info || info.roleMap.size === 0) return [];

        const sb = getClient();
        const fridgeIds = [...info.roleMap.keys()];
        const pattern = `%${escapeLike(keyword)}%`;

        const [byName, byManu] = await Promise.all([
            sb.from("food").select(COLUMNS).in("fridge_id", fridgeIds).ilike("food_name", pattern).limit(LIMIT),
            sb.from("food").select(COLUMNS).in("fridge_id", fridgeIds).ilike("manu", pattern).limit(LIMIT)
        ]);

        if (byName.error) throw byName.error;
        if (byManu.error) throw byManu.error;

        const merged = new Map();

        [...(byName.data || []), ...(byManu.data || [])].forEach((row) => {
            if (!info.roleMap.has(String(row.fridge_id))) return;
            merged.set(String(row.food_id), row);
        });

        const results = [...merged.values()].map((row) => ({
            ...row,
            fridge_name: info.nameMap.get(String(row.fridge_id)) || "ตู้เย็น",
            role: info.roleMap.get(String(row.fridge_id)) || null,
            added_by_name: ""
        }));

        results.sort((a, b) => {
            const ac = isCurrent(a) ? 0 : 1;
            const bc = isCurrent(b) ? 0 : 1;
            if (ac !== bc) return ac - bc;
            return String(a.food_name || "").localeCompare(String(b.food_name || ""), "th");
        });

        const limited = results.slice(0, 50);

        try {
            const ids = [...new Set(limited.map((i) => i.added_by || i.user_id).filter(Boolean))];

            if (ids.length) {
                const { data: users, error } = await sb
                    .from("users")
                    .select("user_id, name, user_email")
                    .in("user_id", ids);

                if (!error) {
                    const map = new Map((users || []).map((u) => [String(u.user_id), u]));
                    limited.forEach((item) => {
                        const u = map.get(String(item.added_by || item.user_id));
                        item.added_by_name = u?.name || u?.user_email || "";
                    });
                }
            }
        } catch (e) {
            console.warn("โหลดชื่อผู้เพิ่มอาหารไม่สำเร็จ:", e);
        }

        return limited;
    }

    // ---------------------------------------------
    // PANEL
    // ---------------------------------------------

    function ensurePanel() {
        let panel = byId(PANEL_ID);
        if (panel) return panel;

        panel = el("div");
        panel.id = PANEL_ID;
        panel.setAttribute("role", "listbox");
        panel.style.cssText =
            "position:fixed;z-index:2147483000;max-height:70vh;overflow-y:auto;" +
            "background:#fff;color:#1e293b;border:1px solid #e2e8f0;border-radius:16px;" +
            "box-shadow:0 20px 40px rgba(15,23,42,.30);";
        panel.style.setProperty("display", "none", "important");
        document.body.appendChild(panel);

        return panel;
    }

    function positionPanel() {
        const input = byId("search-food");
        const panel = byId(PANEL_ID);

        if (!input || !panel || panel.style.display === "none") return;

        const rect = input.getBoundingClientRect();
        const width = Math.min(Math.max(rect.width, 360), window.innerWidth - 16);
        let left = rect.left;

        if (rect.left + width > window.innerWidth - 8) {
            left = window.innerWidth - width - 8;
        }

        panel.style.top = `${rect.bottom + 6}px`;
        panel.style.left = `${Math.max(8, left)}px`;
        panel.style.width = `${width}px`;
    }

    function hidePanel() {
        const panel = byId(PANEL_ID);
        if (panel) {
            panel.style.setProperty("display", "none", "important");
            panel.replaceChildren();
        }
    }

    function showMessage(message, isError) {
        const panel = ensurePanel();
        panel.replaceChildren(
            el("div", `px-4 py-4 text-sm ${isError ? "text-rose-600" : "text-slate-500"}`, message)
        );
        panel.style.setProperty("display", "block", "important");
        positionPanel();
    }

    function renderResults(results) {
        if (!Array.isArray(results) || results.length === 0) {
            showMessage("ไม่พบอาหารที่ตรงกับคำค้นหา");
            return;
        }

        const panel = ensurePanel();
        panel.replaceChildren();

        results.forEach((item) => {
            const row = el(
                "button",
                "w-full text-left flex items-start gap-3 px-4 py-3 hover:bg-violet-50 border-b border-slate-100"
            );
            row.type = "button";
            row.setAttribute("role", "option");

            row.appendChild(
                el(
                    "div",
                    "w-10 h-10 rounded-xl bg-violet-50 flex items-center justify-center text-xl shrink-0",
                    foodIcon(item.food_name)
                )
            );

            const body = el("div", "min-w-0 flex-1");
            body.appendChild(el("p", "text-sm font-semibold text-slate-800 truncate", titleOf(item)));

            const parts = [];
            if (item.manu) parts.push(`🏷️ ${item.manu}`);
            parts.push(`📍 ${item.location || "-"}`);
            parts.push(`🔢 ${Math.max(0, Number(item.quantity ?? 0))}`);
            parts.push(`📅 ${fmtDate(item.export_date)}`);

            body.appendChild(el("p", "text-xs text-slate-400 mt-1", parts.join("  ·  ")));
            row.appendChild(body);

            const st = statusInfo(item.export_date);
            row.appendChild(
                el("span", `${st.cls} text-[10px] px-2 py-1 rounded-lg font-semibold whitespace-nowrap`, st.text)
            );

            row.addEventListener("click", () => openDetail(item));
            panel.appendChild(row);
        });

        panel.style.setProperty("display", "block", "important");
        positionPanel();
    }

    // ---------------------------------------------
    // DETAIL MODAL
    // ---------------------------------------------

    function closeDetail() {
        byId(DETAIL_ID)?.remove();
    }

    function openDetail(item) {
        hidePanel();
        closeDetail();

        const current = isCurrent(item);

        const overlay = el("div");
        overlay.id = DETAIL_ID;
        overlay.style.cssText =
            "position:fixed;top:0;right:0;bottom:0;left:0;z-index:2147483100;" +
            "background:rgba(15,23,42,.6);display:flex;align-items:center;" +
            "justify-content:center;padding:16px;";
        overlay.addEventListener("click", (e) => {
            if (e.target === overlay) closeDetail();
        });

        const box = el(
            "div",
            "bg-white rounded-2xl shadow-xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto text-slate-800"
        );

        // header
        const header = el("div", "flex items-start justify-between gap-3 mb-4");
        const left = el("div", "flex items-center gap-3 min-w-0");

        left.appendChild(
            el(
                "div",
                "w-11 h-11 rounded-xl bg-violet-50 flex items-center justify-center text-2xl shrink-0",
                foodIcon(item.food_name)
            )
        );

        const head = el("div", "min-w-0");
        head.appendChild(el("h3", "font-bold text-slate-800 break-words", titleOf(item)));
        head.appendChild(
            el("p", "text-[11px] text-violet-600 font-semibold mt-1", `🧊 ตู้เย็น: ${item.fridge_name || "ตู้เย็น"}`)
        );
        left.appendChild(head);

        const close = el("button", "text-slate-400 hover:text-slate-600 text-2xl leading-none", "×");
        close.type = "button";
        close.setAttribute("aria-label", "ปิด");
        close.addEventListener("click", closeDetail);

        header.appendChild(left);
        header.appendChild(close);
        box.appendChild(header);

        // details
        const st = statusInfo(item.export_date);
        box.appendChild(
            el("span", `${st.cls} inline-block text-[11px] px-2 py-1 rounded-lg font-semibold mb-3`, st.text)
        );

        const details = el("div", "space-y-2 text-xs text-slate-500");

        const addRow = (label, value) => {
            const line = el("p");
            line.appendChild(document.createTextNode(`${label} `));
            line.appendChild(el("span", "font-medium text-slate-700", value));
            details.appendChild(line);
        };

        addRow("🏷️ ยี่ห้อ:", item.manu || "-");
        addRow("📍 ตำแหน่ง:", item.location || "-");
        addRow("📦 จำนวน:", `${Math.max(0, Number(item.quantity ?? 0))} ชิ้น`);
        addRow("📥 วันที่นำเข้า:", fmtDate(item.import_date));
        addRow("📅 วันหมดอายุ:", fmtDate(item.export_date));
        if (item.added_by_name) addRow("👤 เพิ่มโดย:", item.added_by_name);

        box.appendChild(details);

        // actions
        const actions = el("div", "mt-5 pt-4 border-t border-slate-100");

        actions.appendChild(
            el(
                "p",
                "text-xs text-slate-400 mb-3",
                current
                    ? "👁️ ดูรายละเอียดอย่างเดียวในหน้านี้ (แก้ไขได้ที่หน้า “ตู้เย็นของฉัน”)"
                    : "👁️ รายการนี้อยู่ในตู้เย็นอื่น (ดูอย่างเดียว)"
            )
        );

        const go = el(
            "button",
            "w-full bg-violet-600 hover:bg-violet-700 text-white text-sm px-4 py-2.5 rounded-xl font-semibold shadow-md transition",
            current ? "ไปที่หน้าตู้เย็นของฉัน" : "ไปยังตู้เย็นนี้"
        );
        go.type = "button";
        go.addEventListener("click", () => goToFridge(item, go, current));

        actions.appendChild(go);
        box.appendChild(actions);

        overlay.appendChild(box);
        document.body.appendChild(overlay);
    }

    async function goToFridge(item, button, current) {
        const original = button.textContent;
        button.disabled = true;
        button.textContent = "กำลังตรวจสอบสิทธิ์...";

        let navigating = false;

        try {
            const user = await resolveUser();
            if (!user) throw new Error("ไม่พบข้อมูลผู้ใช้ กรุณาเข้าสู่ระบบใหม่");

            const { data, error } = await getClient()
                .from("fridge_members")
                .select("fridge_id, role, status")
                .eq("fridge_id", item.fridge_id)
                .eq("user_id", user.id)
                .eq("status", "active")
                .maybeSingle();

            if (error) throw error;

            if (!data) {
                alert("คุณไม่มีสิทธิ์เข้าถึงตู้เย็นนี้แล้ว");
                cache.time = 0;
                closeDetail();
                refreshResults();
                return;
            }

            localStorage.setItem(FRIDGE_KEY, String(item.fridge_id));

            navigating = true;
            // ตู้ปัจจุบัน -> หน้าตู้เย็นของฉัน (แก้ไขได้) / ตู้อื่น -> หน้าโซนตู้เย็น (เหมือน index)
            window.location.href = current ? "index.html" : "fridge.html";
        } catch (error) {
            console.error("ไปยังตู้เย็นไม่สำเร็จ:", error);
            alert("ไปยังตู้เย็นไม่สำเร็จ: " + (error?.message || "เกิดข้อผิดพลาด"));
        } finally {
            if (!navigating) {
                button.disabled = false;
                button.textContent = original;
            }
        }
    }

    // ---------------------------------------------
    // INPUT CONTROL
    // ---------------------------------------------

    function handleInput(rawValue) {
        const keyword = String(rawValue || "").trim();

        clearTimeout(timer);
        const mySeq = ++seq;

        if (!keyword) {
            hidePanel();
            return;
        }

        showMessage("กำลังค้นหา...");

        timer = setTimeout(() => run(keyword, mySeq), DEBOUNCE_MS);
    }

    async function run(keyword, mySeq) {
        try {
            const user = await resolveUser();

            if (mySeq !== seq) return;

            if (!user) {
                showMessage("กรุณาเข้าสู่ระบบก่อนค้นหา", true);
                return;
            }

            const results = await searchAcrossFridges(keyword);

            if (mySeq !== seq) return;

            renderResults(results);
        } catch (error) {
            if (mySeq !== seq) return;
            console.error("ค้นหาอาหารข้ามตู้ไม่สำเร็จ:", error);
            showMessage("ค้นหาไม่สำเร็จ: " + (error?.message || "เกิดข้อผิดพลาด"), true);
        }
    }

    function refreshResults() {
        const input = byId("search-food");
        if (input) handleInput(input.value);
    }

    function isSearchInput(target) {
        return !!target && target.id === "search-food";
    }

    function setup() {
        // ดักที่ระดับ document (capture) จึงใช้ได้แม้ช่องค้นหาถูกสร้างทีหลัง
        // และไม่ชนกับ handler เดิมของแต่ละหน้า
        document.addEventListener(
            "input",
            (event) => {
                if (!isSearchInput(event.target)) return;
                event.target.setAttribute("autocomplete", "off");
                console.log("[TUYEN search v3] input:", event.target.value);
                handleInput(event.target.value);
            },
            true
        );

        document.addEventListener(
            "focusin",
            (event) => {
                if (isSearchInput(event.target) && event.target.value.trim()) {
                    handleInput(event.target.value);
                }
            },
            true
        );

        // กัน handler Enter เดิมของแต่ละหน้า (alert "ไม่พบรายการ" / scroll) ไม่ให้ทำงานซ้อน
        document.addEventListener(
            "keydown",
            (event) => {
                if (event.key === "Enter" && isSearchInput(event.target)) {
                    event.preventDefault();
                    event.stopPropagation();
                    event.stopImmediatePropagation();
                    handleInput(event.target.value);
                }
            },
            true
        );

        document.addEventListener("click", (event) => {
            const panel = byId(PANEL_ID);
            if (!panel || panel.style.display === "none") return;
            if (isSearchInput(event.target) || panel.contains(event.target)) return;
            hidePanel();
        });

        document.addEventListener("keydown", (event) => {
            if (event.key !== "Escape") return;

            if (byId(DETAIL_ID)) {
                closeDetail();
                return;
            }

            hidePanel();
        });

        window.addEventListener("resize", positionPanel);
        window.addEventListener("scroll", positionPanel, true);

        // เปลี่ยนตู้จากหน้าอื่น -> ล้าง cache และค้นหาใหม่
        window.addEventListener("storage", (event) => {
            if (event.key === FRIDGE_KEY) {
                cache.time = 0;
                refreshResults();
            }
        });
    }

    setup();

    // ตัวบอกสถานะที่เห็นบนหน้าจอ: ถ้าสคริปต์ทำงาน จะมีป้ายเล็ก ๆ ขึ้นมุมขวาล่าง 3 วินาที
    function markReady() {
        const input = byId("search-food");

        if (input) {
            input.placeholder = "ค้นหาอาหารทุกตู้เย็น...";
        }

        if (byId("tuyen-gs-toast")) return;

        const toast = el(
            "div",
            "",
            input ? "🔍 ระบบค้นหาพร้อมใช้งาน (v3)" : "⚠️ ไม่พบช่องค้นหา #search-food ในหน้านี้"
        );
        toast.id = "tuyen-gs-toast";
        toast.style.cssText =
            "position:fixed;right:16px;bottom:16px;z-index:2147483200;padding:8px 14px;" +
            "border-radius:12px;font-size:12px;font-family:sans-serif;color:#fff;" +
            "background:" + (input ? "#7c3aed" : "#e11d48") + ";box-shadow:0 8px 20px rgba(0,0,0,.3);";
        (document.body || document.documentElement).appendChild(toast);

        setTimeout(() => toast.remove(), 3000);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", markReady, { once: true });
    } else {
        markReady();
    }
})();