// מסך בית: פעולה ראשית אחת (סריקה), ומה שדורש תשומת לב עכשיו. מי שפותח בפעם הראשונה רואה צעדים ברורים.
import { h, toast, escapeHtml, money } from "../ui.js";
import { getSetting } from "../repo/settingsRepo.js";
import { dbGetAll } from "../db.js";
import { listInvoicesWithItems, priceChanges, pettyCashOwed } from "../repo/suppliersRepo.js";
import { openScanModal } from "./scanModal.js";
import { showPriceChangesDialog } from "./priceAlerts.js";
import { downloadExport } from "../export.js";
import { setSuppliersView } from "./suppliersPage.js";
import { listQueue, addToQueue } from "../repo/scanQueue.js";
import { isStaffMode } from "../staff.js";
import { compressImage } from "../imageUtil.js";

const go = (page) => { location.hash = page; };

// מצב עובד: צילום קבלה (נשלחת לבדיקת המנהל) וספירת מלאי - בלי מחירים ובלי מפתח API
function renderStaffHome(container) {
    container.innerHTML = `
        <input type="file" id="staff-file" accept="image/*" capture="environment" style="display:none">
        <button class="btn btn-primary btn-big btn-block" id="staff-shoot" style="margin:14px 0 6px;">📷 צלם קבלה</button>
        <div class="hint" style="text-align:center;margin-bottom:14px;">הקבלה נשלחת לבדיקה של המנהל</div>
        <button class="btn btn-secondary btn-big btn-block" id="staff-count">📋 ספירת מלאי</button>
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
    container.querySelector("#staff-count").onclick = () => go("inventory");
}

export async function renderHomePage(container) {
    if (isStaffMode()) { renderStaffHome(container); return; }
    const rerender = () => renderHomePage(container);
    const pantry = await dbGetAll("pantryItems");
    const invoices = await listInvoicesWithItems();
    const apiKey = await getSetting("gemini_api_key");
    const lastExport = await getSetting("last_export");
    const owed = await pettyCashOwed();
    const alerts = await priceChanges({ thresholdPct: 10, sinceDays: 30 });
    const noWeight = pantry.filter((p) => !p.parent_id && p.unit_type === "unit" && !p.unit_amount);
    const queue = await listQueue();
    const counts = await dbGetAll("inventoryCounts");
    const lastCount = counts.map((c) => c.count_date).sort().pop();
    const daysSince = (d) => (d ? Math.floor((Date.now() - new Date(d).getTime()) / 86400000) : Infinity);

    // ---- צעדי פתיחה (נעלמים כשהכול הושלם) ----
    const steps = [
        { done: !!apiKey, text: "הזן את מפתח Gemini (לסריקת חשבוניות)", action: () => go("settings"), label: "להגדרות" },
        { done: invoices.length > 0, text: "סרוק את החשבונית הראשונה שלך", action: () => scan(), label: "סרוק" },
        { done: !!lastExport, text: "ייצא גיבוי ראשון (כדי לא לאבד נתונים)", action: async () => { await downloadExport(); rerender(); }, label: "ייצא" },
    ];
    const showSteps = steps.some((s) => !s.done);

    container.innerHTML = `
        <button class="btn btn-primary btn-big btn-block" id="home-scan" style="margin:8px 0 4px;">📷 סרוק חשבונית</button>
        <div class="hint" style="text-align:center;margin-bottom:12px;">צלם קבלה או חשבונית - הכול מתעדכן מהתמונה</div>
        ${showSteps ? `<div class="card" id="home-steps"><div class="card-title">להתחלה</div>
            ${steps.map((s, i) => `<div class="card-row" style="align-items:center;margin:8px 0;"><span>${s.done ? "✅" : "⬜"} ${s.text}</span>
                ${s.done ? "" : `<button type="button" class="btn btn-secondary btn-small" data-step="${i}">${s.label}</button>`}</div>`).join("")}</div>` : ""}
        <div id="home-attn"></div>
        <div class="card-title" style="margin:14px 4px 6px;">חשבוניות אחרונות</div>
        <div id="home-recent"></div>
    `;

    const scan = () => openScanModal({ supplierAware: true, onDone: rerender });
    container.querySelector("#home-scan").onclick = scan;
    container.querySelectorAll("[data-step]").forEach((b) => { b.onclick = () => steps[Number(b.dataset.step)].action(); });

    // ---- מה דורש תשומת לב ----
    const attn = container.querySelector("#home-attn");
    const items = [];
    if (queue.length) items.push({ cls: "warn", icon: "⏳", text: `${queue.length} חשבוניות מחכות לעיבוד`, btn: "עבד", fn: () => processQueue(queue, rerender) });
    if (alerts.length) items.push({ cls: "danger", icon: "⚠", text: `${alerts.length} שינויי מחיר ב-30 הימים האחרונים`, btn: "הצג", fn: () => showPriceChangesDialog(alerts, "שינויי מחיר (30 יום אחרונים)") });
    if (owed.count) items.push({ cls: "warn", icon: "💶", text: `קופה קטנה שלא הוחזרה: ${owed.count} קבלות · ${money(owed.total)}`, btn: "פתח", fn: () => { setSuppliersView("invoices", { mode: "owed" }); go("suppliers"); } });
    if (noWeight.length) items.push({ cls: "warn", icon: "⚖", text: `${noWeight.length} מוצרים ביחידות בלי משקל ליחידה (לא ניתן להשתמש בהם במתכון)`, btn: "למזווה", fn: () => go("pantry") });
    if (pantry.length + invoices.length > 0 && daysSince(lastExport) >= 7) items.push({ cls: "warn", icon: "💾", text: lastExport ? `לא יוצא גיבוי ${daysSince(lastExport)} ימים` : "עדיין לא יוצא גיבוי", btn: "ייצא", fn: async () => { await downloadExport(); rerender(); } });
    if (counts.length && daysSince(lastCount) >= 14) items.push({ cls: "warn", icon: "📋", text: `ספירת המלאי האחרונה לפני ${daysSince(lastCount)} ימים`, btn: "לספירה", fn: () => go("inventory") });
    if (items.length) {
        attn.innerHTML = `<div class="card-title" style="margin:14px 4px 6px;">דורש תשומת לב</div>`;
        for (const it of items) {
            const row = h(`<div class="attn-row ${it.cls}"><span>${it.icon} ${escapeHtml(it.text)}</span><button type="button" class="btn btn-secondary btn-small">${it.btn}</button></div>`);
            row.querySelector("button").onclick = it.fn;
            attn.appendChild(row);
        }
    } else if (!showSteps) {
        attn.innerHTML = `<div class="attn-row ok"><span>✓ הכול בסדר - אין משהו שדורש תשומת לב</span></div>`;
    }

    // ---- אחרונות ----
    const recent = container.querySelector("#home-recent");
    if (!invoices.length) recent.innerHTML = '<div class="empty-state" style="padding:16px;">עדיין אין חשבוניות.</div>';
    for (const inv of invoices.slice(0, 3)) {
        const row = h(`<div class="inv-row"><div class="inv-main"><div class="inv-sup">${escapeHtml(inv.supplier_name)}</div>
            <div class="inv-sub">${inv.invoice_date} · ${inv.items.slice(0, 2).map((i) => escapeHtml(i.product_name)).join(", ")}</div></div>
            <div class="inv-amt">${money(inv.total_amount)}</div></div>`);
        row.onclick = () => { setSuppliersView("invoices", {}); go("suppliers"); };
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
        onDone: async () => { await removeFromQueue(first.id); toast("עובד"); rerender(); },
    });
}
