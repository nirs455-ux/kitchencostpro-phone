import { renderPantryPage, setPantryTab } from "./pages/pantryPage.js";
import { renderProcessingPage } from "./pages/processingPage.js";
import { renderRecipesPage, collapseRecipes } from "./pages/recipesPage.js";
import { renderDishesPage } from "./pages/dishesPage.js";
import { renderSuppliersPage } from "./pages/suppliersPage.js";
import { renderInventoryPage } from "./pages/inventoryPage.js";
import { renderSettingsPage } from "./pages/settingsPage.js";
import { renderHomePage } from "./pages/homePage.js";
import { renderFilesPage, openFilesFolder } from "./pages/filesPage.js";
import { renderProducerPage } from "./pages/producerPage.js";
import { openSetupWizard } from "./pages/setupWizard.js";
import { initLocale } from "./locale.js";
import { initCloud, getCloudStatus } from "./cloud/cloudGlue.js";
import { getSetting } from "./repo/settingsRepo.js";
import { dbGetAll } from "./db.js";
import { downloadExport } from "./export.js";
import { applyTheme } from "./theme.js";
import { info } from "./ui.js";
import { purgeOldTrash } from "./repo/suppliersRepo.js";
import { consumeSharedFile } from "./share.js";
import { isStaffMode, openUnlockDialog, guardSettings, hasPin, settingsUnlocked } from "./staff.js";
import { initLang, getLang, langDir } from "./i18n.js";
import { initDomTranslate } from "./domTranslate.js";
import { recalcAllCosts, startAutoRecalc, ensureCostsFresh } from "./repo/recalc.js";
import { initStatusIcons, renderStatusIcons } from "./statusIcons.js";
import { installErrorHandlers } from "./errorLog.js";
import { openScanModal } from "./pages/scanModal.js";
import { scanRecipeFile } from "./pages/recipesPage.js";
import { openModal, closeModal, dropLayers, toastAction } from "./ui.js";
import { openDB } from "./db.js";

const PAGES = {
    home: { title: "בית", render: renderHomePage, info: "מסך הבית: סריקה מהירה, ומה שדורש תשומת לב עכשיו." },
    pantry: { title: "מזווה", render: renderPantryPage,
        info: "חומרי גלם ומחירים (מוצרים), ספירת מלאי, וניצולת/פירוק (עיבוד וניצולת) - בלשוניות למעלה." },
    processing: { title: "עיבוד", render: renderProcessingPage,
        info: "כאן קובעים ניצולת וקפוא לכל מוצר, או יוצרים ממנו תוצר מפורק (למשל: דג שלם ← פילה). המחיר האמיתי מוצג רק כאן." },
    recipes: { title: "מתכונים", render: renderRecipesPage,
        info: "מתכוני בסיס (רטבים, מרקים וכו') שמשמשים כמרכיבים במנות." },
    dishes: { title: "מנות ורווחיות", render: renderDishesPage,
        info: "מנות תפריט: מחיר מכירה, עלות, ואחוז רווח ופוד-קוסט בפועל." },
    suppliers: { title: "ספקים וחשבוניות", render: renderSuppliersPage,
        info: "מעקב הזמנות וחשבוניות לפי ספק. בחשבונית שמשויכת למוצר במזווה, המחיר והמלאי מתעדכנים." },
    waste: { title: "פחת", render: renderPantryPage, info: "" },
    inventory: { title: "ספירת מלאי", render: renderInventoryPage,
        info: "מזינים את הכמות שנספרה בפועל, והמערכת מחשבת את היתרה התיאורטית ומציגה את ההפרש." },
    producer: { title: "יצרן", render: renderProducerPage, info: "פרטי העסק, המוצרים שאתה משווק ומדבקות להדפסה עם רכיבים, אלרגנים, תאריך ייצור ותוקף וערכים תזונתיים." },
    files: { title: "קבצים", render: renderFilesPage, info: "כל התמונות והמסמכים שנשמרו באפליקציה: קבלות וחשבוניות, מתכונים, וקבצים שהתקבלו. בהמשך יסונכרנו לתיקייה KitchenCostPro בענן." },
    settings: { title: "הגדרות", render: renderSettingsPage, info: "" },
};

installErrorHandlers();
let appRole = "manager"; // manager | cook | producer (נטען בהפעלה)
const STAFF_PAGES = new Set(["home", "recipes", "inventory", "waste"]); // מצב טבח: בית, מתכונים (בלי כסף), מלאי ופחת

const view = document.getElementById("view");
const pageTitle = document.getElementById("page-title");
const navButtons = document.querySelectorAll("#bottom-nav button");

async function navigate(pageKey) {
    await ensureCostsFresh(); // שינוי מחיר במזווה שעדיין מחושב מחדש במתכונים/מנות: ממתינים כדי שלא יוצג מספר ישן
    if (!PAGES[pageKey]) pageKey = "home";
    // הגדרות מוגנות בקוד מנהל (אם הוגדר). יצרן לא רואה מנות.
    if (pageKey === "settings" && (await hasPin()) && !settingsUnlocked()) {
        guardSettings(() => navigate("settings"), () => { if (location.hash === "#settings") navigate("home"); });
        if (location.hash === "#settings") location.hash = "home";
        return;
    }
    if (isStaffMode() && !STAFF_PAGES.has(pageKey)) pageKey = "home"; // מצב עובד: רק בית וספירת מלאי
    if (pageKey === "files" && location.hash !== "#files") openFilesFolder(null);
    location.hash = pageKey;
    try { localStorage.setItem("kcp_last_page", pageKey); } catch (e) { /* לא קריטי */ } // כדי לחזור לאותו דף אם הטלפון סגר את האפליקציה ברקע
    // ספירת מלאי ועיבוד הם לשוניות של המזווה (הכתובות #inventory ו-#processing ממשיכות לעבוד)
    const inPantry = pageKey === "inventory" || pageKey === "processing" || pageKey === "waste";
    if (pageKey === "recipes") collapseRecipes();
    if (inPantry) setPantryTab(pageKey);
    else if (pageKey === "pantry") setPantryTab("products");
    const shown = inPantry ? PAGES.pantry : PAGES[pageKey];
    const navKey = inPantry && !isStaffMode() ? "pantry" : pageKey === "waste" ? "inventory" : pageKey;
    navButtons.forEach((b) => b.classList.toggle("active", b.dataset.page === navKey));
    pageTitle.textContent = "KitchenCostPro - " + shown.title;
    document.getElementById("page-info").innerHTML = shown.info ? info(shown.info) : "";
    view.innerHTML = '<div class="empty-state">טוען...</div>';
    renderStatusIcons();
    try {
        await shown.render(view);
    } catch (e) {
        console.error(e);
        view.innerHTML = `<div class="empty-state">שגיאה בטעינת הדף: ${e.message}</div>`;
    }
}

navButtons.forEach((btn) => {
    btn.addEventListener("click", () => navigate(btn.dataset.page));
});

window.addEventListener("hashchange", () => {
    dropLayers(); // מעבר מסך (תפריט/קישור) סוגר חלון או בורר שנשארו פתוחים
    const key = location.hash.replace("#", "");
    if (key === "share") return;
    if (PAGES[key]) navigate(key);
});

document.getElementById("btn-settings").addEventListener("click", () => navigate("settings"));
initStatusIcons();
if (isStaffMode()) document.body.dataset.cook = "1"; // מצב טבח: מסתירים עלויות ופעולות עריכה
if (isStaffMode()) {
    // מצב עובד: מסתירים הגדרות ושאר הלשוניות, ומציגים כפתור נעילה לפתיחה בקוד
    document.getElementById("btn-settings").style.display = "none";
    const unlock = document.getElementById("btn-unlock");
    unlock.style.display = "";
    unlock.addEventListener("click", openUnlockDialog);
    document.querySelectorAll("#bottom-nav button").forEach((b) => { b.style.display = STAFF_PAGES.has(b.dataset.page) ? "" : "none"; });
}
document.getElementById("page-title").addEventListener("click", () => navigate("home"));

// מסד הנתונים לא נפתח (גלישה פרטית, אחסון חסום/מלא, תקלה בדפדפן): מסך הסבר במקום מסך ריק
const showFatal = (title, text) => {
    const d = document.createElement("div");
    d.style.cssText = "position:fixed;inset:0;z-index:200;background:var(--bg,#fff);color:var(--text,#111);display:flex;flex-direction:column;justify-content:center;padding:28px;text-align:start;line-height:1.7";
    d.innerHTML = '<h2 style="margin:0 0 10px"></h2><p style="margin:0 0 16px"></p><button type="button" class="btn btn-primary">נסה שוב</button>';
    d.querySelector("h2").textContent = title;
    d.querySelector("p").textContent = text;
    d.querySelector("button").onclick = () => location.reload();
    document.body.appendChild(d);
};
try { await openDB(); } catch (e) {
    showFatal("לא ניתן לפתוח את האחסון של האפליקציה", "האפליקציה שומרת את הנתונים בדפדפן, והדפדפן לא מאפשר את זה עכשיו. הסיבות הנפוצות: גלישה פרטית (Incognito), אחסון מלא בטלפון, או הגדרה שחוסמת נתוני אתרים. פתח בחלון רגיל, פנה מקום בטלפון, ונסה שוב.");
    throw e;
}
window.addEventListener("kcp-db-blocked", () => toastAction("האפליקציה פתוחה גם בלשונית אחרת", "רענן", () => location.reload(), 60000));
await initLocale(); // סמל מטבע וכו' לפני שהמסכים מצוירים
await recalcAllCosts().catch(() => {}); // ריפוי: עלויות שנשארו ישנות מגרסאות קודמות מתעדכנות לפי המזווה הנוכחי
startAutoRecalc(); // מכאן כל שינוי במזווה מעדכן מתכונים ומנות לבד
await initLang(); // שפת האשף והסיור
await initDomTranslate(getLang(), langDir()); // תרגום כל הממשק (עברית = בלי שינוי)
appRole = (await getSetting("role")) || "manager"; // manager | cook | producer
// כפתור "יצרן" בתפריט: מופיע כשמודול היצרן פעיל (גם אחרי שינוי באשף/בהגדרות, בלי טעינה מחדש)
const refreshProducerNav = async () => {
    const on = appRole === "producer" || !!(await getSetting("producer_mode"));
    const pb = document.querySelector('#bottom-nav [data-page="producer"]');
    if (pb) pb.style.display = on && !isStaffMode() ? "" : "none";
};
await refreshProducerNav();
window.addEventListener("kcp-nav-refresh", refreshProducerNav);
await initCloud().catch(() => {}); // גיבוי אוטומטי לענן (אם מחובר)
// פתיחה בלי כתובת (למשל אחרי שהטלפון סגר את האפליקציה ברקע, או חזרה ממצלמה/בורר קבצים): חוזרים לדף האחרון ולא לבית
let lastPage = "";
try { lastPage = localStorage.getItem("kcp_last_page") || ""; } catch (e) { /* לא קריטי */ }
const startKey = location.hash.replace("#", "");
navigate(startKey === "share" ? "home" : startKey || (PAGES[lastPage] && lastPage !== "settings" ? lastPage : "home"));

// אשף הפעלה: רק בהתקנה ריקה לגמרי שעוד לא עברה אותו (מי שכבר יש לו נתונים לא יראה אותו אוטומטית)
(async () => {
    try {
        if (isStaffMode() || (await getSetting("setup_done"))) return;
        if ((await dbGetAll("pantryItems")).length + (await dbGetAll("invoices")).length + (await dbGetAll("recipes")).length > 0) return;
        openSetupWizard({ onDone: () => navigate("home") });
    } catch (e) { /* האשף אופציונלי */ }
})();

// הגענו דרך "שתף": אם נשלחה תמונה - פותחים ישר את הסריקה
(async () => {
    const shared = await consumeSharedFile();
    if (shared) {
        // קובץ שנשלח דרך "שתף": שואלים מה זה - חשבונית או מתכון
        const ov = openModal(`<h2>מה לעשות עם הקובץ?</h2>
            <div class="btn-row" style="flex-direction:column;">
                <button type="button" class="btn btn-primary btn-big" id="sh-invoice">🧾 חשבונית / קבלה</button>
                <button type="button" class="btn btn-accent btn-big" id="sh-recipe">📖 מתכון</button>
                <button type="button" class="btn btn-secondary" id="sh-cancel">ביטול</button></div>`);
        ov.querySelector("#sh-cancel").onclick = closeModal;
        ov.querySelector("#sh-invoice").onclick = () => { closeModal(); openScanModal({ supplierAware: true, initialFile: shared, onDone: () => navigate("home") }); };
        ov.querySelector("#sh-recipe").onclick = async () => { closeModal(); await navigate("recipes"); scanRecipeFile(shared, view); };
    }
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
        // גיבוי טרי בענן מחליף את התזכורת לגיבוי ידני
        const cs = getCloudStatus();
        if (cs.enabled && cs.lastBackup && (Date.now() - new Date(cs.lastBackup).getTime()) / 86400000 < 3) return;
        const last = await getSetting("last_export");
        const days = last ? (Date.now() - new Date(last).getTime()) / 86400000 : Infinity;
        if (days < 7) return;
        const bar = document.createElement("div");
        bar.style.cssText = "background:var(--warn-soft);color:var(--text);border-bottom:1px solid var(--warn-border);padding:8px 12px;font-size:13px;display:flex;gap:8px;align-items:center;justify-content:space-between;";
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
    // גרסה חדשה הותקנה והשתלטה בזמן שהאפליקציה פתוחה: הקוד שבזיכרון עדיין ישן עד רענון, ולכן מציעים לרענן (בלי זה נשארים על גרסה ישנה)
    let hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (hadController) toastAction("יצאה גרסה חדשה", "רענן", () => location.reload(), 60000);
        hadController = true;
    });
}
