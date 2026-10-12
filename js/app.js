import { renderPantryPage } from "./pages/pantryPage.js";
import { renderProcessingPage } from "./pages/processingPage.js";
import { renderRecipesPage } from "./pages/recipesPage.js";
import { renderDishesPage } from "./pages/dishesPage.js";
import { renderSuppliersPage } from "./pages/suppliersPage.js";
import { renderInventoryPage } from "./pages/inventoryPage.js";
import { renderSettingsPage } from "./pages/settingsPage.js";
import { getSetting } from "./repo/settingsRepo.js";
import { dbGetAll } from "./db.js";
import { downloadExport } from "./export.js";

const PAGES = {
    pantry: { title: "מזווה", render: renderPantryPage },
    processing: { title: "עיבוד", render: renderProcessingPage },
    recipes: { title: "מתכונים", render: renderRecipesPage },
    dishes: { title: "מנות ורווחיות", render: renderDishesPage },
    suppliers: { title: "ספקים וחשבוניות", render: renderSuppliersPage },
    inventory: { title: "ספירת מלאי", render: renderInventoryPage },
    settings: { title: "הגדרות", render: renderSettingsPage },
};

const view = document.getElementById("view");
const pageTitle = document.getElementById("page-title");
const navButtons = document.querySelectorAll("#bottom-nav button");

async function navigate(pageKey) {
    if (!PAGES[pageKey]) pageKey = "pantry";
    location.hash = pageKey;
    navButtons.forEach((b) => b.classList.toggle("active", b.dataset.page === pageKey));
    pageTitle.textContent = "KitchenCostPro - " + PAGES[pageKey].title;
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
    if (PAGES[key]) navigate(key);
});

navigate(location.hash.replace("#", "") || "pantry");

// אחסון קבוע: מבקש מהדפדפן לא למחוק את הנתונים אוטומטית כשנגמר מקום
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

// תזכורת גיבוי: אם יש נתונים ולא יוצא גיבוי מעל 7 ימים - מציג פס עליון (פעם אחת בכל פתיחה)
async function maybeShowBackupBanner() {
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
