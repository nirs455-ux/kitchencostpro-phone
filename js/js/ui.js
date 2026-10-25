// עזרי UI משותפים - מודאלים, טוסט, יצירת אלמנטים מ-HTML.

export function h(html) {
    const t = document.createElement("template");
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
}

export function toast(msg) {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove("show"), 2200);
}

let currentModalCleanup = null;

// ---- כפתור "חזור" (בטלפון/דפדפן): כשחלון/בורר פתוח, חזור סוגר אותו (עם שאלה אם יש שינויים) ולא עובר מסך מאחורי ----
// בזמן שיש שכבה פתוחה קיימת רשומה אחת נוספת בהיסטוריה (אותה כתובת). סגירה רגילה מחזירה אותה לאחור, ולחיצה על "חזור" סוגרת את השכבה.
let layerActive = false;
let ignorePops = 0;
const anyLayerOpen = () => !!document.querySelector("#modal-root .modal-overlay, .picker");
export function layerOpened() {
    if (layerActive) return;
    try { history.pushState({ kcpLayer: 1 }, "", location.href); layerActive = true; } catch (e) { /* לא קריטי */ }
}
export function layerClosed() {
    setTimeout(() => { // בדיקה מאוחרת: סגירה ופתיחה רצופות (חלון מוחלף) לא צריכות להזיז את ההיסטוריה
        if (layerActive && !anyLayerOpen()) { layerActive = false; ignorePops++; try { history.back(); } catch (e) { ignorePops--; } }
    }, 0);
}
// ניווט רגיל (מעבר מסך) כשיש שכבה פתוחה: סוגרים אותה בלי לגעת בהיסטוריה (כבר התקדמה)
export function dropLayers() {
    document.querySelectorAll(".picker").forEach((p) => p.remove());
    const root = document.getElementById("modal-root");
    if (root) root.innerHTML = "";
    if (currentModalCleanup) { try { currentModalCleanup(); } catch (e) { /* ignore */ } currentModalCleanup = null; }
    layerActive = false;
}
if (typeof window !== "undefined") window.addEventListener("popstate", () => {
    if (ignorePops > 0) { ignorePops--; return; }
    if (!layerActive) return; // חזור רגיל: ניווט בין מסכים
    layerActive = false; // הרשומה הנוספת כבר נצרכה
    const picker = document.querySelector(".picker");
    if (picker) { picker.remove(); if (anyLayerOpen()) layerOpened(); return; }
    const ov = document.querySelector("#modal-root .modal-overlay");
    if (ov && !attemptClose(ov)) layerOpened(); // המשתמש ביטל את הסגירה: נשארים בחלון
});

// page: true = דף מלא (בניית מתכון/מנה): כותרת עליונה, גוף נגלל, וסיכום קבוע בתחתית
export function openModal(innerHtml, { onClose, page = false } = {}) {
    closeModal();
    const root = document.getElementById("modal-root");
    const overlay = h(`<div class="modal-overlay open ${page ? "page" : ""}"><div class="modal ${page ? "page-modal" : ""}">${innerHtml}</div></div>`);
    // כל הקלדה/שינוי בחלון מסמנים אותו כ"מלוכלך" - סגירה בלחיצה בחוץ או ב"ביטול" תשאל קודם
    overlay.__dirty = false;
    overlay.addEventListener("input", () => { overlay.__dirty = true; });
    overlay.addEventListener("change", () => { overlay.__dirty = true; });
    overlay.addEventListener("click", (e) => {
        if (e.target === overlay) attemptClose(overlay);
    });
    root.appendChild(overlay);
    currentModalCleanup = onClose || null;
    layerOpened();
    return overlay;
}

// סגירה זהירה: אם יש שינויים שלא נשמרו - שואלים. מחזיר true אם נסגר.
export function attemptClose(overlay) {
    if (overlay && overlay.__dirty && !window.confirm("יש שינויים שלא נשמרו. לסגור בכל זאת?")) return false;
    closeModal();
    return true;
}

export function markDirty(overlay) {
    if (overlay) overlay.__dirty = true;
}

// עוטף פעולה אסינכרונית כך שלחיצה כפולה לא תריץ אותה פעמיים (והכפתור ננעל בזמן הריצה)
export function busy(fn) {
    let running = false;
    return async function (...args) {
        if (running) return;
        running = true;
        const btn = this && this.tagName === "BUTTON" ? this : null;
        if (btn) btn.disabled = true;
        try {
            return await fn.apply(this, args);
        } finally {
            running = false;
            if (btn) btn.disabled = false;
        }
    };
}

// הודעה עם כפתור פעולה (למשל "בטל") שנעלמת אחרי כמה שניות
export function toastAction(msg, label, onClick, ms = 10000) {
    let el = document.getElementById("toast-action");
    if (!el) {
        el = document.createElement("div");
        el.id = "toast-action";
        el.className = "toast-action";
        document.body.appendChild(el);
    }
    el.innerHTML = "<span></span><button type=\"button\"></button>";
    el.querySelector("span").textContent = msg;
    const btn = el.querySelector("button");
    btn.textContent = label;
    el.classList.add("show");
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove("show"), ms);
    btn.onclick = async () => {
        el.classList.remove("show");
        clearTimeout(el._t);
        await onClick();
    };
}

export function closeModal() {
    const root = document.getElementById("modal-root");
    root.innerHTML = "";
    if (currentModalCleanup) {
        try { currentModalCleanup(); } catch (e) { /* ignore */ }
        currentModalCleanup = null;
    }
    layerClosed();
}

export function confirmDialog(message) {
    return new Promise((resolve) => {
        const overlay = openModal(`
            <h2>אישור</h2>
            <p>${message}</p>
            <div class="modal-actions">
                <button class="btn btn-secondary" id="confirm-no">ביטול</button>
                <button class="btn btn-danger" id="confirm-yes">אישור</button>
            </div>
        `);
        overlay.querySelector("#confirm-no").onclick = () => { closeModal(); resolve(false); };
        overlay.querySelector("#confirm-yes").onclick = () => { closeModal(); resolve(true); };
    });
}

export function showError(container, message) {
    const el = container.querySelector(".error-msg");
    if (!el) return;
    el.textContent = message;
    el.style.display = "block";
}

export function clearError(container) {
    const el = container.querySelector(".error-msg");
    if (el) el.style.display = "none";
}

// מטבע תצוגה (נקבע באשף ההפעלה / בהגדרות). כל המחירים נשמרים כמספרים, רק התצוגה משתנה.
let currencySymbol = "₪";
export function setCurrencySymbol(sym) { currencySymbol = sym || "₪"; }
// cur() לשילוב לפני מספר (עם רווח אחרי סמל של כמה אותיות), curLabel() לתוך תוויות כמו "מחיר (₪)"
export function cur() { return currencySymbol.length > 1 ? currencySymbol + " " : currencySymbol; }
export function curLabel() { return currencySymbol; }

export function money(v) {
    return `${cur()}${(Number(v) || 0).toFixed(2)}`;
}

export function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
}


// ---- סימן הסבר קטן (i): ההסבר מופיע רק בלחיצה ----
const INFO_GLYPH = "i"; // אפשר להחליף ל-"*" אם מעדיפים כוכבית

export function info(text) {
    return `<button type="button" class="info-btn" data-info="${escapeHtml(text)}" aria-label="הסבר">${INFO_GLYPH}</button>`;
}

let infoPop = null;
function closeInfoPop() {
    if (infoPop) { infoPop.remove(); infoPop = null; }
}
if (typeof document !== "undefined") {
    document.addEventListener("click", (e) => {
        const btn = e.target.closest && e.target.closest(".info-btn");
        if (!btn) { closeInfoPop(); return; }
        e.preventDefault();
        e.stopPropagation();
        const same = infoPop && infoPop.__btn === btn;
        closeInfoPop();
        if (same) return;
        const pop = document.createElement("div");
        pop.className = "info-pop";
        pop.textContent = btn.dataset.info;
        pop.__btn = btn;
        document.body.appendChild(pop);
        // ממקם מתחת לסימן, בתוך גבולות המסך
        const r = btn.getBoundingClientRect();
        const w = Math.min(280, window.innerWidth - 24);
        pop.style.width = w + "px";
        let left = r.left + r.width / 2 - w / 2;
        left = Math.max(12, Math.min(left, window.innerWidth - w - 12));
        pop.style.left = left + "px";
        const below = r.bottom + 8;
        pop.style.top = (below + pop.offsetHeight > window.innerHeight - 12 ? Math.max(12, r.top - 8 - pop.offsetHeight) : below) + "px";
        infoPop = pop;
    }, true);
    window.addEventListener("scroll", closeInfoPop, true);
}

// דגל חד-פעמי בין מסכים: הבית מדליק, והמסך הבא קורא ומנקה (למשל לפתוח ישר חלון "מתכון חדש")
export function setFlag(key) { try { sessionStorage.setItem("kcp_flag_" + key, "1"); } catch (e) { /* לא קריטי */ } }
export function takeFlag(key) {
    try { const k = "kcp_flag_" + key; const v = sessionStorage.getItem(k); sessionStorage.removeItem(k); return v === "1"; } catch (e) { return false; }
}
