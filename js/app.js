import { renderPantryPage } from "./pages/pantryPage.js";
import { renderProcessingPage } from "./pages/processingPage.js";
import { renderRecipesPage } from "./pages/recipesPage.js";
import { renderDishesPage } from "./pages/dishesPage.js";
import { renderSuppliersPage } from "./pages/suppliersPage.js";
import { renderInventoryPage } from "./pages/inventoryPage.js";
import { renderSettingsPage } from "./pages/settingsPage.js";
import { renderHomePage } from "./pages/homePage.js";
import { getSetting } from "./repo/settingsRepo.js";
import { dbGetAll } from "./db.js";
import { downloadExport } from "./export.js";
import { applyTheme } from "./theme.js";
import { info } from "./ui.js";
import { purgeOldTrash } from "./repo/suppliersRepo.js";
import { consumeSharedFile } from "./share.js";
import { isStaffMode, openUnlockDialog } from "./staff.js";
import { installErrorHandlers } from "./errorLog.js";
import { openScanModal } from "./pages/scanModal.js";

const PAGES = {
    home: { title: "בית", render: renderHomePage, info: "מסך הבית: סריקה מהירה, ומה שדורש תשומת לב עכשיו." },
    pantry: { title: "מזווה", render: renderPantryPage,
        info: "חומרי גלם, מחיר קנייה, ותוצרי סריקת חשבוניות. הניצולת והפירוק נעשים בעמוד \"עיבוד\"." },
    processing: { title: "עיבוד", render: renderProcessingPage,
        info: "כאן קובעים ניצולת וקפוא לכל מוצר, או יוצרים ממנו תוצר מפורק (למשל: דג שלם ← פילה). המחיר האמיתי מוצג רק כאן." },
    recipes: { title: "מתכונים", render: renderRecipesPage,
        info: "מתכוני בסיס (רטבים, מרקים וכו') שמשמשים כמרכיבים במנות." },
    dishes: { title: "מנות ורווחיות", render: renderDishesPage,
        info: "מנות תפריט: מחיר מכירה, עלות, ואחוז רווח ופוד-קוסט בפועל." },
    suppliers: { title: "ספקים וחשבוניות", render: renderSuppliersPage,
        info: "מעקב הזמנות וחשבוניות לפי ספק. בחשבונית שמשויכת למוצר במזווה, המחיר והמלאי מתעדכנים." },
    inventory: { title: "ספירת מלאי", render: renderInventoryPage,
        info: "מזינים את הכמות שנספרה בפועל, והמערכת מחשבת את היתרה התיאורטית ומציגה את ההפרש." },
    settings: { title: "הגדרות", render: renderSettingsPage, info: "" },
};

installErrorHandlers();
const STAFF_PAGES = new Set(["home", "inventory"]);

const view = document.getElementById("view");
const pageTitle = document.getElementById("page-title");
const navButtons = document.querySelectorAll("#bottom-nav button");

async function navigate(pageKey) {
    if (!PAGES[pageKey]) pageKey = "home";
    if (isStaffMode() && !STAFF_PAGES.has(pageKey)) pageKey = "home"; // מצב עובד: רק בית וספירת מלאי
    location.hash = pageKey;
    navButtons.forEach((b) => b.classList.toggle("active", b.dataset.page === pageKey));
    pageTitle.textContent = "KitchenCostPro - " + PAGES[pageKey].title;
    document.getElementById("page-info").innerHTML = PAGES[pageKey].info ? info(PAGES[pageKey].info) : "";
    view.innerHTML = '<div class="empty-state">טוען...</div>';
    try {
        await PAGES[pageKey].render(view);
    } catch (e) {
        console.error(e);
        view.innerHTML = `<div class="empty-state">שגיאה בטעינת הדף: ${e.message}</div>`;
    }
}

navButtons.forEach((btn) => {
    btn.addEventListener("click", () => navigate(btn.dataset.page));
});

window.addEventListener("hashchange", () => {
    const key = location.hash.replace("#", "");
    if (key === "share") return;
    if (PAGES[key]) navigate(key);
});

document.getElementById("btn-settings").addEventListener("click", () => navigate("settings"));
if (isStaffMode()) {
    // מצב עובד: מסתירים הגדרות ושאר הלשוניות, ומציגים כפתור נעילה לפתיחה בקוד
    document.getElementById("btn-settings").style.display = "none";
    const unlock = document.getElementById("btn-unlock");
    unlock.style.display = "";
    unlock.addEventListener("click", openUnlockDialog);
    document.querySelectorAll("#bottom-nav button").forEach((b) => { if (!STAFF_PAGES.has(b.dataset.page)) b.style.display = "none"; });
}
document.getElementById("page-title").addEventListener("click", () => navigate("home"));

navigate(location.hash.replace("#", "") === "share" ? "home" : (location.hash.replace("#", "") || "home"));

// הגענו דרך "שתף": אם נשלחה תמונה - פותחים ישר את הסריקה
(async () => {
    const shared = await consumeSharedFile();
    if (shared) openScanModal({ supplierAware: true, initialFile: shared, onDone: () => navigate("home") });
})();

applyTheme();
purgeOldTrash().catch(() => {});

// אחסון קבוע: מבקש מהדפדפן לא למחוק את הנתונים אוטומטית כשנגמר מקום
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

// תזכורת גיבוי: אם יש נתונים ולא יוצא גיבוי מעל 7 ימים - מציג פס עליון (פעם אחת בכל פתיחה)
async function maybeShowBackupBanner() {
    if (isStaffMode()) return;
    try {
        const items = await dbGetAll("pantryItems");
        const invoices = await dbGetAll("invoices");
        if (items.length + invoices.length === 0) return;
        const last = await getSetting("last_export");
        const days = last ? (Date.now() - new Date(last).getTime()) / 86400000 : Infinity;
        if (days < 7) return;
        const bar = document.createElement("div");
        bar.style.cssText = "background:#fff4d6;border-bottom:1px solid #e6c86a;padding:8px 12px;font-size:13px;display:flex;gap:8px;align-items:center;justify-content:space-between;";
        bar.innerHTML = `<span>${last ? `לא יוצא גיבוי ${Math.floor(days)} ימים` : "עדיין לא יוצא גיבוי"} - הנתונים והתמונות נשמרים רק בטלפון.</span>
            <span><button class="btn btn-primary btn-small" id="bk-now">ייצא עכשיו</button> <button class="btn btn-secondary btn-small" id="bk-later">אחר כך</button></span>`;
        document.body.insertBefore(bar, document.body.firstChild);
        bar.querySelector("#bk-later").onclick = () => bar.remove();
        bar.querySelector("#bk-now").onclick = async () => { await downloadExport(); bar.remove(); };
    } catch (e) { /* תזכורת בלבד - לא קריטי */ }
}
maybeShowBackupBanner();

if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
        navigator.serviceWorker.register("service-worker.js").catch(() => {});
    });
}
