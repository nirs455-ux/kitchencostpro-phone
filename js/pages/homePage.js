// מסך בית: פעולה ראשית אחת (סריקה), והתראות. מי שפותח בפעם הראשונה רואה צעדים ברורים.
import { h, toast, escapeHtml, money, setFlag } from "../ui.js";
import { getSetting } from "../repo/settingsRepo.js";
import { getAgentKey } from "../agent.js";
import { dbGetAll } from "../db.js";
import { listInvoicesWithItems, priceChanges, pettyCashOwed } from "../repo/suppliersRepo.js";
import { openScanModal } from "./scanModal.js";
import { addonOn } from "../addons.js";
import { showPriceChangesDialog } from "./priceAlerts.js";
import { downloadExport } from "../export.js";
import { setSuppliersView } from "./suppliersPage.js";
import { listQueue, addToQueue } from "../repo/scanQueue.js";
import { isStaffMode } from "../staff.js";
import { compressImage } from "../imageUtil.js";
import { getCloudStatus } from "../cloud/cloudGlue.js";
import { computeStatus, openWizardAt } from "../statusIcons.js";
import { resolveCloudIssue } from "../cloud/cloudUi.js";
import { loadDemoData } from "../demoData.js";
import { orderAttnItems } from "../orderReminders.js";
import { listDishesWithItems } from "../repo/dishesRepo.js";
import { underpricedDishes } from "../dishPricing.js";
import { showUnderpricedDialog } from "./dishesPage.js";

const go = (page) => { location.hash = page; };

// מצב עובד: צילום קבלה (נשלחת לבדיקת המנהל) וספירת מלאי - בלי מחירים ובלי מפתח API
function renderStaffHome(container) {
    container.innerHTML = `
        <input type="file" id="staff-file" accept="image/*" capture="environment" style="display:none">
        <button class="btn btn-primary btn-big btn-block" id="staff-shoot" style="margin:14px 0 6px;">📷 צלם קבלה</button>
        <div class="hint" style="text-align:center;margin-bottom:14px;">הקבלה נשלחת לבדיקה של המנהל</div>
        <button class="btn btn-secondary btn-big btn-block" id="staff-recipes" style="margin-bottom:10px;">📖 מתכונים</button>
        ${addonOn("count") ? '<button class="btn btn-secondary btn-big btn-block" id="staff-count">📋 ספירת מלאי</button>' : ""}
        <button class="btn btn-secondary btn-big btn-block" id="staff-waste" style="margin-top:10px;">🗑 רישום פחת</button>
        <div id="staff-sent" class="hint" style="text-align:center;margin-top:14px;"></div>`;
    const input = container.querySelector("#staff-file");
    container.querySelector("#staff-shoot").onclick = () => input.click();
    input.addEventListener("change", async () => {
        const f = input.files[0];
        if (!f) return;
        await addToQueue(await compressImage(f));
        input.value = "";
        toast("הקבלה נשלחה לבדיקה ✓");
        container.querySelector("#staff-sent").textContent = `נשלחו ${(await listQueue()).length} קבלות שמחכות למנהל`;
    });
    container.querySelector("#staff-recipes").onclick = () => go("recipes");
    const sc = container.querySelector("#staff-count");
    if (sc) sc.onclick = () => go("inventory");
    container.querySelector("#staff-waste").onclick = () => go("waste");
}

export async function renderHomePage(container) {
    if (isStaffMode()) { renderStaffHome(container); return; }
    const rerender = () => renderHomePage(container);
    // שתי הצגות במקביל (פתיחת האפליקציה + רענון אחרי סנכרון/סטטוס) היו כותבות לאותו מסך ומכפילות שורות. רק האחרונה מציירת.
    const token = (container.__homeRender = (container.__homeRender || 0) + 1);
    const stale = () => container.__homeRender !== token;
    const pantry = await dbGetAll("pantryItems");
    const invoices = await listInvoicesWithItems();
    const apiKey = await getAgentKey();
    const lastExport = await getSetting("last_export");
    const owed = await pettyCashOwed();
    const alerts = await priceChanges({ thresholdPct: 10, sinceDays: 30 });
    const queue = await listQueue();
    const counts = await dbGetAll("inventoryCounts");
    const lastCount = counts.map((c) => c.count_date).sort().pop();
    const daysSince = (d) => (d ? Math.floor((Date.now() - new Date(d).getTime()) / 86400000) : Infinity);

    const scan = () => openScanModal({ supplierAware: true, onDone: rerender });
    const wasteLogs = await dbGetAll("wasteLogs");
    const underpriced = underpricedDishes(await listDishesWithItems());
    if (stale()) return;

    container.innerHTML = `
        <div class="sec-title">התראות</div>
        <div id="home-attn"></div>
        <div class="sec-title">פעולה מהירה</div>
        <div class="qa-grid">
            <button type="button" class="qa-tile" id="qa-waste"><span class="qa-ic">🗑</span>רישום פחת</button>
            <button type="button" class="qa-tile" id="qa-recipe"><span class="qa-ic">📖</span>מתכון חדש</button>
            ${addonOn("count") ? '<button type="button" class="qa-tile" id="qa-count"><span class="qa-ic">📋</span>ספירת מלאי</button>' : ""}
            <button type="button" class="qa-tile" id="qa-files"><span class="qa-ic">📁</span>קבצים</button>
        </div>
        <div class="sec-title">פעילות אחרונה</div>
        <div id="home-recent"></div>
    `;
    container.querySelector("#qa-waste").onclick = () => { setFlag("waste-new"); go("waste"); };
    container.querySelector("#qa-recipe").onclick = () => { setFlag("recipe-new"); go("recipes"); };
    const qc = container.querySelector("#qa-count");
    if (qc) qc.onclick = () => go("inventory");
    container.querySelector("#qa-files").onclick = () => go("files");

    // ---- התראות ----
    const attn = container.querySelector("#home-attn");
    const items = [];
    if (queue.length) items.push({ cls: "warn", icon: "⏳", text: `${queue.length} חשבוניות מחכות לעיבוד`, btn: "עבד", fn: () => processQueue(queue, rerender) });
    if (alerts.length) items.push({ cls: "danger", icon: "⚠", text: `${alerts.length} שינויי מחיר ב-30 הימים האחרונים`, btn: "הצג", fn: () => showPriceChangesDialog(alerts, "שינויי מחיר (30 יום אחרונים)") });
    if (underpriced.length) items.push({ cls: "warn", icon: "🍽️", text: underpriced.length === 1 ? `המחיר של "${underpriced[0].dish.name}" נמוך מהמומלץ` : `${underpriced.length} מנות שהמחיר שלהן נמוך מהמומלץ`, btn: "הצג", fn: () => showUnderpricedDialog(underpriced, rerender) });
    const cloudNow = getCloudStatus();
    const cloudFresh = cloudNow.enabled && cloudNow.lastBackup && daysSince(cloudNow.lastBackup) < 3; // גיבוי טרי בענן מחליף תזכורת לגיבוי ידני
    if (pantry.length + invoices.length > 0 && !cloudFresh && daysSince(lastExport) >= 7) items.push({ cls: "warn", icon: "💾", text: lastExport ? `לא יוצא גיבוי ${daysSince(lastExport)} ימים` : "עדיין לא יוצא גיבוי", btn: "ייצא", fn: async () => { await downloadExport(); rerender(); } });
    if (addonOn("count") && counts.length && daysSince(lastCount) >= 14) items.push({ cls: "warn", icon: "📋", text: `ספירת המלאי האחרונה לפני ${daysSince(lastCount)} ימים`, btn: "לספירה", fn: () => go("inventory") });
    const sts = await computeStatus();
    if (stale()) return;
    if (sts.agent === "bad") items.unshift({ cls: "danger", icon: "🤖", text: "אין עוזר AI מחובר - אי אפשר לסרוק חשבוניות ומתכונים מתמונה", btn: "חבר", fn: () => openWizardAt(1) });
    if (addonOn("cloud") && sts.cloud === "bad") items.push({ cls: "warn", icon: "☁️", text: sts.cloudAvailable ? "אין גיבוי בענן - הנתונים שמורים רק בטלפון הזה" : "אין גיבוי בענן (החיבור עדיין לא הוגדר) - ייצא גיבוי ידני", btn: sts.cloudAvailable ? "חבר" : "ייצא", fn: sts.cloudAvailable ? () => openWizardAt(2) : async () => { await downloadExport(); rerender(); } });
    const cst = getCloudStatus();
    if (addonOn("cloud") && cst.enabled && (cst.state === "conflict" || cst.state === "needs-auth" || cst.state === "error")) {
        const text = cst.state === "conflict" ? "הענן שונה ממכשיר אחר" : cst.state === "needs-auth" ? "הגיבוי לענן מחכה לאישור שלך" : "הגיבוי לענן נכשל";
        items.unshift({ cls: "warn", icon: "☁️", text, btn: "טפל", fn: async () => { await resolveCloudIssue(); rerender(); } });
    }
    if (!pantry.length && !invoices.length) items.push({ cls: "ok", icon: "🧪", text: "רוצה לנסות עם נתוני דוגמה? (חומרי גלם, מתכונים, מנות ומוצר יצרן)", btn: "טען", fn: async () => { await loadDemoData(); toast("נתוני הדוגמה נטענו"); rerender(); } });
    try { items.unshift(...(await orderAttnItems(rerender))); } catch (e) { /* תזכורות הזמנה הן עזר */ }
    if (stale()) return;
    const order = { danger: 0, warn: 1, ok: 2 };
    items.sort((x, y) => (order[x.cls] ?? 1) - (order[y.cls] ?? 1));
    if (items.length) {
        for (const it of items) {
            const row = h(`<div class="tint-row ${it.cls}"><span class="tr-ic">${it.icon}</span><span class="tr-text">${escapeHtml(it.text)}</span><button type="button" class="tr-btn">${it.btn}</button></div>`);
            row.querySelector("button").onclick = it.fn;
            attn.appendChild(row);
        }
    } else {
        attn.innerHTML = `<div class="tint-row ok"><span class="tr-ic">✓</span><span class="tr-text">הכול בסדר, אין התראות</span></div>`;
    }

    // ---- פעילות אחרונה: חשבוניות ופחת, מהחדש לישן ----
    const recent = container.querySelector("#home-recent");
    const acts = [
        ...invoices.map((i) => ({ date: i.invoice_date || "", ic: "🧾", title: i.supplier_name, sub: i.items.slice(0, 2).map((x) => x.product_name).join(", "), amt: money(i.total_amount), go: () => { setSuppliersView("invoices", {}); go("suppliers"); } })),
        ...wasteLogs.map((l) => ({ date: l.date || "", ic: "🗑", title: `פחת: ${l.name}`, sub: l.note || "", amt: money(l.cost), go: () => go("waste") })),
    ].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 4);
    if (!acts.length) recent.innerHTML = '<div class="empty-state" style="padding:14px;">עדיין אין פעילות.</div>';
    for (const a of acts) {
        const row = h(`<div class="act-row"><span class="act-ic">${a.ic}</span><div class="act-main"><div class="act-title">${escapeHtml(a.title)}</div><div class="act-sub">${a.date.split("-").reverse().join("/")}${a.sub ? " · " + escapeHtml(a.sub) : ""}</div></div><div class="act-amt">${a.amt}</div></div>`);
        row.onclick = a.go;
        recent.appendChild(row);
    }
}

// עיבוד חשבוניות שנשמרו בתור (נשמרו כי לא היה חיבור או שהשרת היה עמוס)
async function processQueue(queue, rerender) {
    const { removeFromQueue } = await import("../repo/scanQueue.js");
    const first = queue[0];
    openScanModal({
        supplierAware: true,
        initialFile: first.blob,
        onDone: async () => { await removeFromQueue(first.id); toast("טופל"); rerender(); },
    });
}
