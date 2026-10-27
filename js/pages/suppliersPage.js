import { listSuppliers, addSupplier, deleteSupplier, getSupplierDeleteInfo, listInvoicesWithItems, saveInvoice, validateInvoicePayload, deleteInvoice, monthlySummaryBySupplier,
    priceChanges, monthlyReport, invoicesToCsv, pettyCashOwed, markAllPettyCashReimbursed, setPettyReimbursed, findDuplicateInvoice } from "../repo/suppliersRepo.js";
import { listTopLevelPantryItems } from "../repo/pantryRepo.js";
import { createPantryItemFromInvoice } from "../repo/scanRepo.js";
import { CATEGORY_GROUPS, UNIT_TYPES, UNIT_TYPE_LABELS } from "../constants.js";
import { computeStockFactor } from "../invoiceParse.js";
import { showPriceChangesDialog, renderPriceChangeRows } from "./priceAlerts.js";
import { openTrashModal } from "./trashModal.js";
import { restoreInvoice } from "../repo/suppliersRepo.js";
import { dbGet, dbPut, dbDelete } from "../db.js";
import { h, openModal, closeModal, confirmDialog, toast, escapeHtml, money, info, busy, attemptClose, toastAction, cur } from "../ui.js";
import { openScanModal } from "./scanModal.js";
import { openOrderModal } from "./orderModal.js";
import { listRow, groupsEl } from "./listKit.js";
import { compressImage, showImageFullscreen } from "../imageUtil.js";

function todayLocal() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const MONTHS_HE = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];
const monthLabel = (ym) => { const [y, m] = ym.split("-"); return `${MONTHS_HE[parseInt(m, 10) - 1] || m} ${y}`; };
const shortDate = (d) => { const [y, m, day] = (d || "").split("-"); return day ? `${parseInt(day, 10)}.${parseInt(m, 10)}.${y.slice(2)}` : d; };

// מצב התצוגה נשמר בזמן שהדף נבנה מחדש (אחרי שמירה/מחיקה)
let uiTab = "invoices";
let uiFilter = { q: "", mode: "all", month: "", supplier: "" };
const invOpen = new Set(); // חודשים פתוחים (כברירת מחדל הכול סגור)

// מאפשר למסכים אחרים (למשל מסך הבית) לפתוח את הדף בלשונית/סינון מסוימים
export function setSuppliersView(tab, filter = {}) {
    uiTab = tab;
    uiFilter = { q: "", mode: "all", month: "", supplier: "", ...filter };
}

export async function renderSuppliersPage(container) {
    const suppliers = await listSuppliers();
    const invoices = await listInvoicesWithItems();
    const pantryItems = await listTopLevelPantryItems();
    const owed = await pettyCashOwed();
    const alerts = await priceChanges({ thresholdPct: 10, sinceDays: 30 });
    const rerender = () => renderSuppliersPage(container);
    const trashCount = (await listInvoicesWithItems({ trashed: true })).length;
    const months = [...new Set(invoices.map((i) => (i.invoice_date || "").slice(0, 7)).filter(Boolean))].sort().reverse();

    container.innerHTML = `
        <div class="sup-actions">
            <button class="btn btn-primary btn-big" id="btn-scan">📷 סרוק חשבונית</button>
            <button class="btn btn-secondary btn-big" id="btn-add-invoice">+ ידנית</button>
        </div>
        <div class="attn" id="attn"></div>
        <div class="seg" id="seg">
            <button data-tab="invoices">חשבוניות <span class="seg-n">${invoices.length}</span></button>
            <button data-tab="summary">סיכום</button>
            <button data-tab="suppliers">ספקים <span class="seg-n">${suppliers.length}</span></button>
        </div>
        <div id="tab-body"></div>
    `;

    // ---- פס התראות קטן (רק אם יש) ----
    const attn = container.querySelector("#attn");
    if (owed.count) attn.insertAdjacentHTML("beforeend", `<button type="button" class="attn-chip warn" id="attn-owed">🔴 ${owed.count === 1 ? "קבלה אחת ממתינה" : owed.count + " קבלות ממתינות"} להחזר · ${money(owed.total)}</button>`);
    if (alerts.length) attn.insertAdjacentHTML("beforeend", `<button type="button" class="attn-chip danger" id="attn-alerts">⚠ ${alerts.length} שינויי מחיר</button>`);
    const owedBtn = attn.querySelector("#attn-owed");
    if (owedBtn) owedBtn.onclick = () => { uiTab = "invoices"; uiFilter = { q: "", mode: "owed", month: "", supplier: "" }; rerender(); };
    const alertsBtn = attn.querySelector("#attn-alerts");
    if (alertsBtn) alertsBtn.onclick = () => showPriceChangesDialog(alerts, "שינויי מחיר (30 יום אחרונים)");

    container.querySelector("#btn-add-invoice").onclick = () => openInvoiceModal(null, suppliers, pantryItems, container);
    container.querySelector("#btn-scan").onclick = () => openScanModal({ supplierAware: true, onDone: rerender });

    // ---- לשוניות ----
    const body = container.querySelector("#tab-body");
    const segBtns = container.querySelectorAll("#seg button");
    const showTab = (t) => {
        uiTab = t;
        segBtns.forEach((b) => b.classList.toggle("active", b.dataset.tab === t));
        if (t === "invoices") renderInvoicesTab();
        else if (t === "summary") renderSummaryTab();
        else renderSuppliersTab();
    };
    segBtns.forEach((b) => { b.onclick = () => showTab(b.dataset.tab); });

    // ================= לשונית חשבוניות =================
    function renderInvoicesTab() {
        const supplierName = uiFilter.supplier ? (suppliers.find((s) => String(s.id) === String(uiFilter.supplier)) || {}).name : "";
        body.innerHTML = `
            <div class="field" style="margin-bottom:8px;"><input type="search" id="flt-q" placeholder="חיפוש חשבוניות" value="${escapeHtml(uiFilter.q)}"></div>
            <div class="fchips" id="fchips">
                ${uiFilter.mode === "owed" ? '<button type="button" class="chip active" id="flt-owed">🔴 ממתינות להחזר ✕</button>' : ""}
                <select id="flt-month" class="chip-select"><option value="">כל החודשים</option>${months.map((m) => `<option value="${m}" ${uiFilter.month === m ? "selected" : ""}>${monthLabel(m)}</option>`).join("")}</select>
                ${supplierName ? `<button type="button" class="chip active" id="flt-sup">${escapeHtml(supplierName)} ✕</button>` : ""}
                ${trashCount ? `<button type="button" class="chip" id="btn-trash">🗑 ארכיון (${trashCount})</button>` : ""}
            </div>
            ${uiFilter.mode === "owed" && owed.count ? `<div class="card-row" style="margin:4px 2px 8px;"><span>${owed.count} קבלות · ${money(owed.total)}</span><button type="button" class="btn btn-secondary btn-small" id="btn-reimb-all">סמן הכול כהוחזר</button></div>` : ""}
            <div id="inv-groups"></div>
        `;
        const q = body.querySelector("#flt-q");
        q.addEventListener("input", () => { uiFilter.q = q.value; drawGroups(); });
        const fOwed = body.querySelector("#flt-owed");
        if (fOwed) fOwed.onclick = () => { uiFilter.mode = "all"; renderInvoicesTab(); };
        body.querySelector("#flt-month").onchange = (e) => { uiFilter.month = e.target.value; drawGroups(); };
        const trashBtn = body.querySelector("#btn-trash");
        if (trashBtn) trashBtn.onclick = () => openTrashModal(rerender);
        const sup = body.querySelector("#flt-sup");
        if (sup) sup.onclick = () => { uiFilter.supplier = ""; renderInvoicesTab(); };
        const reimb = body.querySelector("#btn-reimb-all");
        if (reimb) reimb.onclick = async () => {
            if (!(await confirmDialog(`לסמן ${owed.count} קבלות (${money(owed.total)}) כהוחזרו לעובדים?`))) return;
            await markAllPettyCashReimbursed();
            toast("סומן");
            uiFilter.mode = "all";
            rerender();
        };
        drawGroups();
    }

    function filteredInvoices() {
        const q = uiFilter.q.trim().toLowerCase();
        return invoices.filter((inv) => {
            if (uiFilter.supplier && String(inv.supplier_id) !== String(uiFilter.supplier)) return false;
            if (uiFilter.month && !(inv.invoice_date || "").startsWith(uiFilter.month)) return false;
            if (uiFilter.mode === "owed" && !(inv.petty_cash && !inv.reimbursed)) return false;
            if (q) {
                const hay = [inv.supplier_name, inv.invoice_date, inv.purchaser, ...inv.items.map((it) => it.product_name)].join(" ").toLowerCase();
                if (!hay.includes(q)) return false;
            }
            return true;
        });
    }

    function drawGroups() {
        const box = body.querySelector("#inv-groups");
        const list = filteredInvoices();
        if (!list.length) {
            box.innerHTML = `<div class="empty-state">${invoices.length ? "לא נמצאו חשבוניות תואמות." : "אין עדיין חשבוניות.<br>לחץ על \"סרוק חשבונית\" כדי להתחיל."}</div>`;
            return;
        }
        const groups = new Map();
        for (const inv of list) {
            const ym = (inv.invoice_date || "").slice(0, 7);
            if (!groups.has(ym)) groups.set(ym, []);
            groups.get(ym).push(inv);
        }
        box.innerHTML = "";
        const searching = !!(uiFilter.q.trim() || uiFilter.month || uiFilter.supplier || uiFilter.mode === "owed");
        const gs = [];
        for (const [ym, arr] of groups) {
            const total = arr.reduce((n, i) => n + (i.document_type === "credit" ? -i.total_amount : i.total_amount), 0);
            const rows = [];
            for (const inv of arr) {
                const preview = inv.items.slice(0, 2).map((it) => escapeHtml(it.product_name)).join(", ") + (inv.items.length > 2 ? ` +${inv.items.length - 2}` : "");
                const tags = (inv.document_type === "credit" ? ' <span class="tag tag-danger">זיכוי</span>' : "") + (inv.petty_cash ? ` <button type="button" class="petty-tag ${inv.reimbursed ? "paid" : "owed"}" data-petty="${inv.id}">${inv.reimbursed ? "הוחזר" : "ממתין להחזר"}</button>` : "");
                const row = listRow({ ic: inv.document_type === "credit" ? "↩" : "🧾", tint: inv.petty_cash && !inv.reimbursed ? "var(--danger-soft)" : "var(--accent-soft)", name: inv.supplier_name,
                    meta: `${shortDate(inv.invoice_date)} · ${preview}${tags}`, end: `${money(inv.total_amount)}${inv.has_image ? " 🖼" : ""}`, onClick: () => openInvoiceDetails(inv) });
                const pt = row.querySelector("[data-petty]");
                if (pt) pt.onclick = async (e) => {
                    e.stopPropagation(); // לא פותח את החשבונית
                    const was = !!inv.reimbursed;
                    await setPettyReimbursed(inv.id, !was);
                    toastAction(was ? "סומן: ממתין להחזר" : "סומן: הוחזר", "בטל", async () => { await setPettyReimbursed(inv.id, was); rerender(); });
                    rerender();
                };
                rows.push(row);
            }
            gs.push({ key: "inv:" + ym, title: `${ym ? monthLabel(ym) : "ללא תאריך"} · ${money(total)}`, ic: "📅", tint: "var(--brand-soft)", rows });
        }
        box.appendChild(groupsEl(gs, invOpen, searching, (k) => { if (invOpen.has(k)) invOpen.delete(k); else invOpen.add(k); drawGroups(); }));
    }

    // ---- פרטי חשבונית (לחיצה על שורה): תוכן + פעולות במקום אחד ----
    function openInvoiceDetails(inv) {
        const overlay = openModal(`
            <h2>${escapeHtml(inv.supplier_name)}</h2>
            <div class="card-row" style="margin:-8px 0 10px;"><span>${shortDate(inv.invoice_date)}${inv.purchaser ? " · " + escapeHtml(inv.purchaser) : ""}</span>
                <span>${inv.document_type === "credit" ? '<span class="tag tag-danger">זיכוי</span>' : ""}${inv.petty_cash ? `<span class="petty-tag ${inv.reimbursed ? "paid" : "owed"}">קופה קטנה · ${inv.reimbursed ? "הוחזר" : "ממתין להחזר"}</span>` : ""}</span></div>
            <table class="simple">
                <thead><tr><th>מוצר</th><th>כמות</th><th>סה"כ</th></tr></thead>
                <tbody>${inv.items.map((it) => `<tr><td>${escapeHtml(it.product_name)}</td><td>${+Number(it.quantity).toFixed(3)}</td><td>${money(it.line_total ?? it.quantity * it.unit_price)}</td></tr>`).join("")}</tbody>
            </table>
            <div class="card-row" style="font-weight:700;margin:10px 0;"><span>סה"כ</span><span>${money(inv.total_amount)}</span></div>
            <div class="modal-actions" style="flex-wrap:wrap;">
                ${inv.has_image ? '<button type="button" class="btn btn-accent" id="d-image">🖼 תמונה</button>' : ""}
                <button type="button" class="btn btn-secondary" id="d-edit">עריכה</button>
                <button type="button" class="btn btn-danger" id="d-delete">מחיקה</button>
            </div>
            <div class="modal-actions"><button type="button" class="btn btn-secondary" id="d-close">סגור</button></div>
        `);
        overlay.querySelector("#d-close").onclick = closeModal;
        const img = overlay.querySelector("#d-image");
        if (img) img.onclick = () => showImageFullscreen(inv.image, `${inv.supplier_name} - ${inv.invoice_date}`);
        overlay.querySelector("#d-edit").onclick = () => { closeModal(); openInvoiceModal(inv, suppliers, pantryItems, container); };
        overlay.querySelector("#d-delete").onclick = async () => {
            if (!(await confirmDialog("להעביר את החשבונית לארכיון?<br><br>הקניות שלה ייגרעו מהסיכום החודשי ומחישוב המלאי. אפשר לשחזר 30 יום."))) return;
            await deleteInvoice(inv.id);
            closeModal();
            rerender();
            toastAction("החשבונית הועברה לארכיון", "בטל", async () => { await restoreInvoice(inv.id); toast("שוחזר"); rerender(); });
        };
    }

    // ================= לשונית סיכום =================
    function renderSummaryTab() {
        if (!months.length) { body.innerHTML = '<div class="empty-state">אין עדיין נתונים לסיכום.</div>'; return; }
        const current = uiFilter.month && months.includes(uiFilter.month) ? uiFilter.month : months[0];
        body.innerHTML = `
            <div class="form-row" style="align-items:center;">
                <div class="field" style="margin:0;"><select id="sum-month">${months.map((m) => `<option value="${m}" ${m === current ? "selected" : ""}>${monthLabel(m)}</option>`).join("")}</select></div>
                <button type="button" class="btn btn-secondary btn-small" id="btn-csv">⬇ אקסל</button>
            </div>
            <div id="sum-body" style="margin-top:10px;"></div>
        `;
        const draw = async () => {
            const ym = body.querySelector("#sum-month").value;
            const r = await monthlyReport(ym);
            const rows = (obj) => Object.entries(obj).sort((x, y) => y[1] - x[1]).map(([k, v]) => `<div class="card-row"><span>${escapeHtml(k)}</span><span>${money(v)}</span></div>`).join("");
            body.querySelector("#sum-body").innerHTML = `
                <div class="card"><div class="stat-big">${money(r.total)}</div><div class="muted">${r.invoice_count} מסמכים</div>
                    ${r.petty_cash_count ? `<div class="card-row"><span>מתוכם קופה קטנה (${r.petty_cash_count})</span><span>${money(r.petty_cash_total)}</span></div>` : ""}</div>
                <div class="card-title" style="margin:12px 4px 6px;">לפי ספק</div><div class="card">${rows(r.by_supplier)}</div>
                <div class="card-title" style="margin:12px 4px 6px;">לפי קטגוריה</div><div class="card">${rows(r.by_category)}</div>`;
        };
        body.querySelector("#sum-month").onchange = draw;
        body.querySelector("#btn-csv").onclick = () => {
            const ym = body.querySelector("#sum-month").value;
            const list = invoices.filter((i) => (i.invoice_date || "").startsWith(ym));
            if (!list.length) { toast("אין חשבוניות לייצוא"); return; }
            const blob = new Blob([invoicesToCsv(list)], { type: "text/csv;charset=utf-8" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `חשבוניות-${ym}.csv`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        };
        draw();
    }

    // ================= לשונית ספקים =================
    function renderSuppliersTab() {
        body.innerHTML = `<button type="button" class="btn btn-secondary btn-block" id="btn-add-supplier" style="margin-bottom:10px;">+ ספק חדש</button><div id="sup-list"></div>`;
        body.querySelector("#btn-add-supplier").onclick = () => openSupplierModal(container);
        const list = body.querySelector("#sup-list");
        if (!suppliers.length) { list.innerHTML = '<div class="empty-state">עדיין אין ספקים.<br>הם נוספים אוטומטית בסריקה, או ידנית כאן.</div>'; return; }
        const thisMonth = new Date().toISOString().slice(0, 7);
        for (const s of suppliers) {
            const mine = invoices.filter((i) => i.supplier_id === s.id);
            const monthTotal = mine.filter((i) => (i.invoice_date || "").startsWith(thisMonth)).reduce((n, i) => n + (i.document_type === "credit" ? -i.total_amount : i.total_amount), 0);
            const last = mine.map((i) => i.invoice_date).sort().pop();
            const row = listRow({ ic: "🚚", tint: "var(--accent-soft)", name: s.name, meta: `${mine.length === 1 ? "חשבונית אחת" : mine.length + " חשבוניות"}${last ? " · אחרונה " + shortDate(last) : ""}`, end: `${money(monthTotal)}<small>החודש</small>` });
            row.onclick = () => {
                const overlay = openModal(`
                    <h2>${escapeHtml(s.name)}</h2>
                    <div class="modal-actions" style="flex-wrap:wrap;">
                        <button type="button" class="btn btn-primary" id="s-order">📝 הזמנה</button>
                        <button type="button" class="btn btn-secondary" id="s-show">הצג חשבוניות</button>
                        <button type="button" class="btn btn-danger" id="s-del">מחק ספק</button>
                    </div>
                    <div class="modal-actions"><button type="button" class="btn btn-secondary" id="s-close">סגור</button></div>`);
                overlay.querySelector("#s-close").onclick = closeModal;
                overlay.querySelector("#s-order").onclick = () => { closeModal(); openOrderModal(s, rerender); };
                overlay.querySelector("#s-show").onclick = () => { closeModal(); uiFilter = { q: "", mode: "all", month: "", supplier: String(s.id) }; uiTab = "invoices"; rerender(); };
                overlay.querySelector("#s-del").onclick = async () => {
                    try {
                        const infoD = await getSupplierDeleteInfo(s.id);
                        let msg = `למחוק את הספק "${escapeHtml(infoD.name)}"?`;
                        if (infoD.invoice_count) msg += `<br><br>יימחקו גם ${infoD.invoice_count} חשבוניות שלו (סה"כ ${money(infoD.invoices_total)}).<br>הקניות שלהן ייגרעו מהסיכום החודשי ומחישוב המלאי.`;
                        if (!(await confirmDialog(msg))) return;
                        await deleteSupplier(s.id);
                        closeModal();
                        toast("נמחק");
                        rerender();
                    } catch (err) { toast(err.message); }
                };
            };
            list.appendChild(row);
        }
    }

    showTab(uiTab);
}

function openSupplierModal(container) {
    const overlay = openModal(`
        <h2>ספק חדש</h2>
        <div class="field"><label>שם ספק</label><input type="text" id="f-name"></div>
        <div class="error-msg"></div>
        <div class="modal-actions">
            <button class="btn btn-secondary" id="btn-cancel">ביטול</button>
            <button class="btn btn-primary" id="btn-save">שמירה</button>
        </div>
    `);
    overlay.querySelector("#btn-cancel").onclick = () => attemptClose(overlay);
    overlay.querySelector("#btn-save").onclick = busy(async () => {
        try {
            await addSupplier(overlay.querySelector("#f-name").value);
            closeModal();
            toast("נשמר");
            renderSuppliersPage(container);
        } catch (e) {
            const el = overlay.querySelector(".error-msg");
            el.textContent = e.message;
            el.style.display = "block";
        }
    });
}

function openInvoiceModal(existing, suppliers, pantryItems, container) {
    let rowCounter = 0;
    const overlay = openModal(`
        <h2>${existing ? "עריכת חשבונית" : "חשבונית חדשה"}</h2>
        <div class="field">
            <label>ספק</label>
            <select id="f-supplier">
                <option value="">בחר ספק...</option>
                ${suppliers.map((s) => `<option value="${s.id}" ${existing && existing.supplier_id === s.id ? "selected" : ""}>${escapeHtml(s.name)}</option>`).join("")}
            </select>
        </div>
        <div class="form-row">
            <div class="field"><label>תאריך</label><input type="date" id="f-date" value="${existing ? existing.invoice_date : todayLocal()}"></div>
            <div class="field">
                <label>סוג מסמך</label>
                <select id="f-doctype">
                    <option value="invoice" ${!existing || existing.document_type === "invoice" ? "selected" : ""}>חשבונית רגילה</option>
                    <option value="credit" ${existing && existing.document_type === "credit" ? "selected" : ""}>זיכוי</option>
                </select>
            </div>
        </div>
        <div class="card" style="background:var(--brand-soft);">
            ${existing && existing.petty_cash ? "" : '<button type="button" class="btn-link" id="f-petty-show">＋ זו קופה קטנה (עובד קנה והוחזר לו במזומן)</button>'}
            <div class="checkbox-field" id="f-petty-wrap" style="${existing && existing.petty_cash ? "" : "display:none;"}"><input type="checkbox" id="f-petty" ${existing && existing.petty_cash ? "checked" : ""}>
                <label for="f-petty">קופה קטנה ${info("עובד קנה בדרך וקיבל החזר במזומן, והביא קבלה. אפשר לסמן מי רכש ואם הוחזר לו.")}</label></div>
            <div id="petty-fields" style="display:none;">
                <div class="field"><label>מי רכש (אופציונלי)</label><input type="text" id="f-purchaser" value="${existing ? escapeHtml(existing.purchaser || "") : ""}" placeholder="שם העובד"></div>
                <div class="checkbox-field"><input type="checkbox" id="f-reimb" ${existing && existing.reimbursed ? "checked" : ""}>
                    <label for="f-reimb">הוחזר לעובד</label></div>
            </div>
        </div>
        <datalist id="inv-pantry-names">${[...pantryItems].map((p) => `<option value="${escapeHtml(p.name)}"></option>`).join("")}</datalist>
        <div id="repeat-box" class="card" style="display:none;">
            <div class="card-title" style="font-size:13px;">הזמנה קבועה ${info("מעתיק את השורות מחשבונית קודמת של הספק, ואתה משנה רק מה שהשתנה.")}</div>
            <div class="form-row"><div class="field"><select id="repeat-sel"></select></div>
                <button type="button" class="btn btn-accent btn-small" id="btn-repeat">העתק</button></div>
        </div>
        <div id="items-box"></div>
        <button type="button" class="btn btn-secondary btn-small" id="btn-add-row">+ הוסף שורה</button>
        <div class="card-row" style="font-weight:700;margin-top:10px;"><span>סה"כ:</span><span id="total-display">${cur()}0.00</span></div>
        <div class="field" style="margin-top:10px;">
            <label>תמונת החשבונית (אופציונלי)</label>
            <div class="btn-row">
                <button type="button" class="btn btn-accent btn-small" id="btn-img-pick">🖼 הוסף תמונה</button>
                <button type="button" class="btn btn-secondary btn-small" id="btn-img-view" style="display:none;">🖼 הצג</button>
                <button type="button" class="btn btn-danger btn-small" id="btn-img-remove" style="display:none;">הסר</button>
            </div>
            <input type="file" id="f-img-file" accept="image/*" style="display:none">
            <div class="hint" id="img-status"></div>
        </div>
        <div class="error-msg"></div>
        <div class="modal-actions">
            <button class="btn btn-secondary" id="btn-cancel">ביטול</button>
            <button class="btn btn-primary" id="btn-save">שמירה</button>
        </div>
    `);

    const box = overlay.querySelector("#items-box");
    function addRow(prefill) {
        const id = rowCounter++;
        const row = h(`
            <div class="item-row-inputs" id="inv-row-${id}" data-stock-factor="${prefill && prefill.stock_factor ? prefill.stock_factor : ""}" data-factor-pantry="${prefill && prefill.pantry_item_id ? prefill.pantry_item_id : ""}">
                <div class="top-line" style="margin-bottom:6px;">
                    <input type="text" id="inv-name-${id}" list="inv-pantry-names" autocomplete="off" placeholder="שם מוצר" style="flex:1;min-width:0;" value="${prefill ? escapeHtml(prefill.product_name) : ""}">
                    <button type="button" class="remove-row-btn" data-remove="${id}" aria-label="הסר שורה">✕</button>
                </div>
                <div class="hint" id="inv-link-${id}" style="margin:0 0 6px;"></div>
                <div class="field" id="inv-pantry-wrap-${id}" style="display:none;">
                    <select id="inv-pantry-${id}">
                        <option value="">ללא שיוך לחומרי הגלם</option>
                        <option value="__new__">➕ מוצר חדש - הוסף לחומרי הגלם</option>
                        ${[...pantryItems].sort((a, b) => a.name.localeCompare(b.name, "he")).map((p) => `<option value="${p.id}" ${prefill && prefill.pantry_item_id === p.id ? "selected" : ""}>${escapeHtml(p.name)}</option>`).join("")}
                    </select>
                </div>
                <div id="inv-new-${id}" style="display:none;background:var(--accent-soft);color:var(--text);border-radius:8px;padding:8px;margin-bottom:6px;">
                    <div class="form-row">
                        <div class="field"><label>קטגוריה ${info("המוצר ייווצר בחומרי הגלם עם המחיר ליחידה מהשורה הזו.")}</label>
                            <select id="inv-cat-${id}"><option value="">בחר...</option>${Object.keys(CATEGORY_GROUPS).map((c) => `<option value="${c}">${c}</option>`).join("")}</select></div>
                        <div class="field"><label>נמדד ב-</label>
                            <select id="inv-ut-${id}">${UNIT_TYPES.map((u) => `<option value="${u}" ${u === "unit" ? "selected" : ""}>${UNIT_TYPE_LABELS[u]}</option>`).join("")}</select></div>
                    </div>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                    <div class="field" style="margin:0;"><label id="inv-qty-label-${id}">כמות</label>
                        <input type="number" step="any" inputmode="decimal" id="inv-qty-${id}" value="${prefill ? prefill.quantity : ""}"></div>
                    <div class="field" style="margin:0;"><label>כמה שילמת (סה"כ)</label>
                        <input type="number" step="any" inputmode="decimal" id="inv-line-${id}" value="${prefill ? (prefill.line_total ?? Math.round(prefill.quantity * prefill.unit_price * 100) / 100) : ""}"></div>
                </div>
                <div class="hint" id="inv-pk-prev-${id}" style="margin:6px 0;font-weight:600;"></div>
                ${prefill && prefill.stock_factor ? `<div class="hint">כל יחידה בחשבונית = ${Math.round(prefill.stock_factor * 1000) / 1000} יחידות מלאי (נשמר מהסריקה)</div>` : ""}
                <details style="margin-top:4px;">
                    <summary style="cursor:pointer;color:#777;font-size:13px;">אפשרויות נוספות</summary>
                    <div style="padding-top:8px;">
                        <div class="field"><label>מחיר ליחידה / ק"ג (מחושב לבד מהסכום)</label>
                            <input type="number" step="any" inputmode="decimal" id="inv-price-${id}" value="${prefill ? prefill.unit_price : ""}"></div>
                        <div class="field" id="inv-ua-wrap-${id}" style="display:none;"><label>משקל ליחידה בגרם (אפשר להשלים אחר כך)</label>
                            <input type="number" step="any" inputmode="decimal" id="inv-ua-${id}"></div>
                        <div id="inv-pk-${id}" style="display:none;">
                            <div class="form-row" id="inv-pack-wrap-${id}">
                                <div class="field"><label id="inv-pack-label-${id}">גודל אריזה (אופציונלי)</label>
                                    <input type="number" step="any" inputmode="decimal" id="inv-pack-${id}" placeholder="לדוגמה: 0.1"></div>
                                <div class="field"><label>יחידה</label><select id="inv-pack-unit-${id}"></select></div>
                            </div>
                            <div class="hint" id="inv-pack-echo-${id}"></div>
                            <div class="field"><label id="inv-case-label-${id}">יחידות באריזה / בארגז (אופציונלי)</label>
                                <input type="number" step="any" inputmode="decimal" id="inv-case-${id}" placeholder="לדוגמה: 9"></div>
                            <div class="checkbox-field">
                                <input type="checkbox" id="inv-upd-${id}" ${existing ? "" : "checked"}>
                                <label for="inv-upd-${id}">עדכן את המחיר בחומרי הגלם לפי השורה הזו</label>
                            </div>
                        </div>
                    </div>
                </details>
            </div>
        `);
        box.appendChild(row);
        const qtyEl = row.querySelector(`#inv-qty-${id}`);
        const priceEl = row.querySelector(`#inv-price-${id}`);
        const totalEl = row.querySelector(`#inv-line-${id}`);
        const num = (el) => parseFloat(el.value);
        const fmt = (x, d) => String(+x.toFixed(d));
        // השדה שהוזן אחרון (מחיר / סכום) נשאר כמו שהוזן; שינוי כמות מחשב מחדש את השדה השני
        let locked = "price";
        priceEl.addEventListener("input", () => {
            locked = "price";
            if (num(qtyEl) > 0 && !isNaN(num(priceEl))) totalEl.value = (num(qtyEl) * num(priceEl)).toFixed(2);
            recalc();
        });
        totalEl.addEventListener("input", () => {
            locked = "total";
            if (num(qtyEl) > 0 && !isNaN(num(totalEl))) priceEl.value = fmt(num(totalEl) / num(qtyEl), 4);
            recalc();
        });
        qtyEl.addEventListener("input", () => {
            if (num(qtyEl) > 0) {
                if (locked === "total" && !isNaN(num(totalEl))) priceEl.value = fmt(num(totalEl) / num(qtyEl), 4);
                else if (!isNaN(num(priceEl))) totalEl.value = (num(qtyEl) * num(priceEl)).toFixed(2);
                else if (!isNaN(num(totalEl))) priceEl.value = fmt(num(totalEl) / num(qtyEl), 4);
            }
            recalc();
        });
        const pantrySel = row.querySelector(`#inv-pantry-${id}`);
        const newBox = row.querySelector(`#inv-new-${id}`);
        const utSel = row.querySelector(`#inv-ut-${id}`);
        const syncNew = () => {
            newBox.style.display = pantrySel.value === "__new__" ? "block" : "none";
            row.querySelector(`#inv-ua-wrap-${id}`).style.display = (pantrySel.value === "__new__" && utSel.value === "unit") ? "block" : "none";
        };
        const rowUnitType = () => {
            if (pantrySel.value === "__new__") return utSel.value;
            const p = pantryItems.find((x) => String(x.id) === pantrySel.value);
            return p ? p.unit_type : null;
        };
        const packSel = row.querySelector(`#inv-pack-unit-${id}`);
        const syncPack = () => {
            const ut = rowUnitType();
            const pk = row.querySelector(`#inv-pk-${id}`);
            pk.style.display = ut ? "block" : "none";
            row.querySelector(`#inv-qty-label-${id}`).textContent = ut === "unit" ? "כמה יחידות קיבלת?" : ut === "weight" ? 'כמה ק"ג?' : ut === "liter" ? "כמה ליטר?" : "כמות";
            if (!ut) { updatePreview(); return; }
            const isPackable = ut === "weight" || ut === "liter";
            row.querySelector(`#inv-pack-wrap-${id}`).style.display = isPackable ? "" : "none";
            // ברירת מחדל: ק"ג / ליטר (0.1 = מאה גרם, 1.2 = קילו ומאתיים). גרם/מ"ל זמינים לבחירה מפורשת.
            const opts = ut === "liter" ? [["l", "ליטר"], ["ml", 'מ"ל']] : [["kg", 'ק"ג'], ["g", "גרם"]];
            const cur = packSel.value;
            packSel.innerHTML = opts.map(([v, l]) => `<option value="${v}">${l}</option>`).join("");
            if (opts.some(([v]) => v === cur)) packSel.value = cur;
            row.querySelector(`#inv-pack-label-${id}`).textContent = ut === "liter" ? "גודל אריזה בליטרים (0.37 = 370 מ\"ל)" : 'גודל אריזה בק"ג (0.1 = 100 גרם)';
            row.querySelector(`#inv-case-label-${id}`).textContent = ut === "unit"
                ? "כמה יחידות בכל אריזה? (למשל גומייה עם 9 גבעולים)" : "יחידות באריזה / בארגז (אופציונלי)";
            updatePreview();
        };
        const updatePreview = () => {
            const ut = rowUnitType();
            const q = num(qtyEl);
            let price = num(priceEl);
            if (isNaN(price) && q > 0 && !isNaN(num(totalEl))) price = num(totalEl) / q;
            if (!ut) {
                row.querySelector(`#inv-pk-prev-${id}`).textContent = !isNaN(price) && price > 0 ? `מחיר ליחידה: ${cur()}${price.toFixed(2)}` : "";
                return;
            }
            const { factor, error } = computeStockFactor(ut, parseFloat(row.querySelector(`#inv-case-${id}`).value) || null,
                parseFloat(row.querySelector(`#inv-pack-${id}`).value) || null, packSel.value);
            const label = ut === "liter" ? "ליטר" : ut === "weight" ? 'ק"ג' : "יחידה";
            const prev = row.querySelector(`#inv-pk-prev-${id}`);
            const echo = row.querySelector(`#inv-pack-echo-${id}`);
            const packVal = parseFloat(row.querySelector(`#inv-pack-${id}`).value);
            echo.textContent = "";
            if (packVal > 0 && (ut === "weight" || ut === "liter")) {
                const base = packSel.value === "g" || packSel.value === "ml" ? packVal / 1000 : packVal;
                echo.textContent = ut === "liter" ? `= ${base >= 1 ? +base.toFixed(3) + " ליטר" : Math.round(base * 1000) + ' מ"ל'}`
                    : `= ${base >= 1 ? +base.toFixed(3) + ' ק"ג' : Math.round(base * 1000) + " גרם"}`;
            }
            if (error) { prev.textContent = error; return; }
            const p = pantryItems.find((x) => String(x.id) === pantrySel.value);
            const old = p && p.price != null ? ` (בחומרי הגלם כרגע: ${cur()}${Number(p.price).toFixed(2)})` : "";
            const packs = q > 0 ? q : 1;
            const unitsText = ut === "unit" && (factor || 1) > 1 && q > 0 ? `${packs === 1 ? "אריזה אחת" : packs + " אריזות"} × ${+(factor).toFixed(3)} = ${+(packs * factor).toFixed(3)} יחידות. ` : "";
            prev.textContent = !isNaN(price) && price > 0 ? `${unitsText}מחיר בחומרי הגלם: ${cur()}${(price / (factor || 1)).toFixed(2)} ל${label}${old}` : "";
        };
        for (const el of [qtyEl, priceEl, totalEl, row.querySelector(`#inv-case-${id}`), row.querySelector(`#inv-pack-${id}`)]) el.addEventListener("input", updatePreview);
        packSel.addEventListener("change", updatePreview);
        pantrySel.addEventListener("change", () => {
            // factor שנשמר בשורה שייך למוצר הקודם - מחליפים מוצר = מתחילים מחדש
            if (row.dataset.factorPantry !== pantrySel.value) row.dataset.stockFactor = "";
            syncNew(); syncPack();
        });
        utSel.addEventListener("change", () => { syncNew(); syncPack(); });
        syncNew();
        syncPack();

        // ---- קישור אוטומטי לחומרי הגלם לפי השם (בלי לגלול ברשימה) ----
        const nameEl = row.querySelector(`#inv-name-${id}`);
        const linkEl = row.querySelector(`#inv-link-${id}`);
        const wrapEl = row.querySelector(`#inv-pantry-wrap-${id}`);
        const findByName = (v) => {
            const key = (v || "").trim().toLowerCase();
            return key ? pantryItems.find((p) => p.name.trim().toLowerCase() === key) : null;
        };
        const refreshLink = () => {
            const name = nameEl.value.trim();
            const linked = pantrySel.value && pantrySel.value !== "__new__" ? pantryItems.find((p) => String(p.id) === pantrySel.value) : null;
            if (linked) {
                linkEl.innerHTML = `✓ מקושר לחומרי הגלם: <b>${escapeHtml(linked.name)}</b> · <a href="#" data-change>שנה</a>`;
            } else if (pantrySel.value === "__new__") {
                linkEl.innerHTML = `➕ מוצר חדש יתווסף לחומרי הגלם · <a href="#" data-change>שנה</a>`;
            } else if (name) {
                linkEl.innerHTML = `לא נמצא בחומרי הגלם · <a href="#" data-new>➕ הוסף כמוצר חדש</a> · <a href="#" data-change>קשר למוצר קיים</a>`;
            } else {
                linkEl.innerHTML = "";
            }
            const ch = linkEl.querySelector("[data-change]");
            if (ch) ch.onclick = (e) => { e.preventDefault(); wrapEl.style.display = wrapEl.style.display === "none" ? "block" : "none"; };
            const nw = linkEl.querySelector("[data-new]");
            if (nw) nw.onclick = (e) => { e.preventDefault(); pantrySel.value = "__new__"; pantrySel.dispatchEvent(new Event("change")); };
        };
        const autoLink = () => {
            const m = findByName(nameEl.value);
            if (m && (!pantrySel.value || row.dataset.autoLinked === "1")) {
                if (pantrySel.value !== String(m.id)) { pantrySel.value = String(m.id); pantrySel.dispatchEvent(new Event("change")); }
                row.dataset.autoLinked = "1";
            } else if (!m && row.dataset.autoLinked === "1") {
                pantrySel.value = ""; pantrySel.dispatchEvent(new Event("change")); row.dataset.autoLinked = "";
            }
            refreshLink();
        };
        nameEl.addEventListener("input", autoLink);
        nameEl.addEventListener("change", autoLink);
        pantrySel.addEventListener("change", refreshLink);
        refreshLink();
        row.querySelector("[data-remove]").onclick = () => { row.remove(); recalc(); };
    }

    function recalc() {
        let total = 0;
        box.querySelectorAll(".item-row-inputs").forEach((row) => {
            const id = row.id.replace("inv-row-", "");
            total += parseFloat(overlay.querySelector(`#inv-line-${id}`).value) || 0;
        });
        overlay.querySelector("#total-display").textContent = money(total);
    }

    if (existing) {
        for (const it of existing.items) addRow(it);
    } else {
        addRow();
    }
    recalc();
    overlay.querySelector("#btn-add-row").onclick = () => addRow();

    // ---- העתקה מהזמנה קודמת של הספק (הזמנה יומית קבועה) ----
    const repeatBox = overlay.querySelector("#repeat-box");
    const repeatSel = overlay.querySelector("#repeat-sel");
    let supplierInvoices = [];
    const loadRepeatOptions = async () => {
        const sid = overlay.querySelector("#f-supplier").value;
        repeatBox.style.display = "none";
        if (existing || !sid) return;
        supplierInvoices = (await listInvoicesWithItems()).filter((i) => String(i.supplier_id) === sid && i.items.length).slice(0, 8);
        if (!supplierInvoices.length) return;
        repeatSel.innerHTML = supplierInvoices.map((i, k) => `<option value="${k}">${i.invoice_date} · ${i.items.length} שורות · ${money(i.total_amount)}</option>`).join("");
        repeatBox.style.display = "block";
    };
    overlay.querySelector("#f-supplier").addEventListener("change", loadRepeatOptions);
    overlay.querySelector("#btn-repeat").onclick = () => {
        const inv = supplierInvoices[parseInt(repeatSel.value, 10)];
        if (!inv) return;
        // מסירים שורות ריקות לפני ההעתקה
        box.querySelectorAll(".item-row-inputs").forEach((r) => {
            const rid = r.id.replace("inv-row-", "");
            if (!overlay.querySelector(`#inv-name-${rid}`).value.trim() && !overlay.querySelector(`#inv-qty-${rid}`).value) r.remove();
        });
        for (const it of inv.items) addRow({ ...it, pantry_item_id: it.pantry_item_id });
        recalc();
        toast(`הועתקו ${inv.items.length} שורות - עדכן כמויות ומחירים ושמור`);
    };
    loadRepeatOptions();

    const pettyShowBtn = overlay.querySelector("#f-petty-show");
    if (pettyShowBtn) pettyShowBtn.onclick = () => { pettyShowBtn.style.display = "none"; overlay.querySelector("#f-petty-wrap").style.display = "flex"; overlay.querySelector("#f-petty").checked = true; overlay.querySelector("#petty-fields").style.display = "block"; };
    const pettyBox = overlay.querySelector("#f-petty");
    const syncPetty = () => { overlay.querySelector("#petty-fields").style.display = pettyBox.checked ? "block" : "none"; };
    pettyBox.addEventListener("change", syncPetty);
    syncPetty();

    // תמונה: undefined = בלי שינוי, Blob = תמונה חדשה/מחליפה, null = הסרה
    let imageChange;
    let currentImage = existing && existing.image instanceof Blob ? existing.image : null;
    const syncImageUi = () => {
        const shown = imageChange instanceof Blob ? imageChange : imageChange === null ? null : currentImage;
        overlay.querySelector("#btn-img-view").style.display = shown ? "" : "none";
        overlay.querySelector("#btn-img-remove").style.display = shown ? "" : "none";
        overlay.querySelector("#img-status").textContent = shown ? "יש תמונה שמורה לחשבונית." : "";
    };
    syncImageUi();
    const fileInput = overlay.querySelector("#f-img-file");
    overlay.querySelector("#btn-img-pick").onclick = () => fileInput.click();
    fileInput.addEventListener("change", async () => {
        if (!fileInput.files[0]) return;
        imageChange = await compressImage(fileInput.files[0]);
        syncImageUi();
    });
    overlay.querySelector("#btn-img-view").onclick = () => {
        const shown = imageChange instanceof Blob ? imageChange : currentImage;
        if (shown) showImageFullscreen(shown);
    };
    overlay.querySelector("#btn-img-remove").onclick = () => { imageChange = null; fileInput.value = ""; syncImageUi(); };

    overlay.querySelector("#btn-cancel").onclick = () => attemptClose(overlay);
    overlay.querySelector("#btn-save").onclick = busy(async () => {
        const items = [];
        const newProducts = []; // שורות עם "מוצר חדש בחומרי הגלם" - נוצרות רק אחרי שכל האימותים עברו
        const priceUpdates = []; // עדכוני מחיר למוצרים קיימים - מתבצעים רק אחרי שהחשבונית נשמרה
        const sanity = []; // מחירים חריגים - שואלים את המשתמש לפני שמירה
        const showErr = (msg) => {
            const el = overlay.querySelector(".error-msg");
            el.textContent = msg;
            el.style.display = "block";
        };
        for (const row of box.querySelectorAll(".item-row-inputs")) {
            const id = row.id.replace("inv-row-", "");
            const product_name = overlay.querySelector(`#inv-name-${id}`).value;
            const quantity = overlay.querySelector(`#inv-qty-${id}`).value;
            const unit_price = overlay.querySelector(`#inv-price-${id}`).value;
            const line_total = overlay.querySelector(`#inv-line-${id}`).value;
            const sel = overlay.querySelector(`#inv-pantry-${id}`).value;
            if (!(product_name && quantity && (unit_price || line_total))) {
                if (product_name || quantity || unit_price || line_total) return showErr(`שורה לא מלאה: ${product_name || "(ללא שם)"} - מלא שם, כמות ומחיר (או סכום), או הסר את השורה`);
                continue;
            }
            const item = { product_name, quantity, unit_price, line_total, pantry_item_id: sel === "__new__" ? null : sel || null, stock_factor: row.dataset.stockFactor || null };

            // סוג יחידה, גודל אריזה וארגז -> stock_factor (יחידות חומרי גלם ביחידה אחת של השורה)
            let unitType = null;
            const existingPantry = sel && sel !== "__new__" ? pantryItems.find((p) => String(p.id) === sel) : null;
            if (sel === "__new__") unitType = overlay.querySelector(`#inv-ut-${id}`).value;
            else if (existingPantry) unitType = existingPantry.unit_type;
            const q = parseFloat(quantity);
            const unitPriceNum = unit_price !== "" ? parseFloat(unit_price) : parseFloat(line_total) / q;
            let factor = 1;
            if (unitType) {
                const upc = parseFloat(overlay.querySelector(`#inv-case-${id}`).value) || null;
                const ps = parseFloat(overlay.querySelector(`#inv-pack-${id}`).value) || null;
                const packUnitVal = overlay.querySelector(`#inv-pack-unit-${id}`).value;
                if (ps && (packUnitVal === "g" || packUnitVal === "ml") && ps < 1) {
                    return showErr(`'${product_name}': גודל אריזה ${ps} ב${packUnitVal === "g" ? "גרם" : 'מ"ל'} נראה קטן מדי. התכוונת ל-${ps} ${packUnitVal === "g" ? 'ק"ג' : "ליטר"}? בחר ${packUnitVal === "g" ? 'ק"ג' : "ליטר"} ביחידה.`);
                }
                const res = computeStockFactor(unitType, upc, ps, packUnitVal);
                if (res.error) return showErr(`'${product_name}': ${res.error}`);
                if (upc || ps) { factor = res.factor; item.stock_factor = factor !== 1 ? factor : null; }
                else if (item.stock_factor) factor = parseFloat(item.stock_factor) || 1;
            }
            const pantryPrice = unitPriceNum / factor;

            if (sel === "__new__") {
                const category = overlay.querySelector(`#inv-cat-${id}`).value;
                if (!category) return showErr(`'${product_name}': בחר קטגוריה למוצר החדש בחומרי הגלם`);
                const unitAmount = overlay.querySelector(`#inv-ua-${id}`).value;
                if (unitAmount !== "" && !(parseFloat(unitAmount) > 0)) return showErr(`'${product_name}': משקל ליחידה לא תקין`);
                if (Number.isFinite(pantryPrice) && pantryPrice > 2000) sanity.push(`'${product_name}': המחיר בחומרי הגלם יהיה ${cur()}${pantryPrice.toFixed(2)} ל${unitType === "unit" ? "יחידה" : unitType === "liter" ? "ליטר" : 'ק"ג'}`);
                const key = product_name.trim().toLowerCase();
                if (pantryItems.some((p) => p.name.trim().toLowerCase() === key)) return showErr(`'${product_name}' כבר קיים בחומרי הגלם - בחר אותו מהרשימה במקום ליצור חדש`);
                if (newProducts.some((np) => np.item.product_name.trim().toLowerCase() === key)) return showErr(`'${product_name}' מופיע פעמיים כמוצר חדש`);
                if (!(q > 0) || Number.isNaN(pantryPrice)) return showErr("כמות/מחיר לא תקינים");
                newProducts.push({ item, category, unitType, unitAmount, price: pantryPrice });
            } else if (existingPantry && overlay.querySelector(`#inv-upd-${id}`).checked && q > 0 && Number.isFinite(pantryPrice) && pantryPrice > 0 && overlay.querySelector("#f-doctype").value === "invoice") {
                priceUpdates.push({ id: existingPantry.id, price: pantryPrice });
                const oldPrice = Number(existingPantry.price);
                if (oldPrice > 0 && (pantryPrice / oldPrice > 5 || pantryPrice / oldPrice < 0.2)) {
                    sanity.push(`'${product_name}': המחיר בחומרי הגלם ישתנה מ-${cur()}${oldPrice.toFixed(2)} ל-${cur()}${pantryPrice.toFixed(2)}`);
                }
            }
            items.push(item);
        }
        const data = {
            petty_cash: overlay.querySelector("#f-petty").checked,
            purchaser: overlay.querySelector("#f-purchaser").value,
            reimbursed: overlay.querySelector("#f-reimb").checked,
            supplier_id: overlay.querySelector("#f-supplier").value,
            invoice_date: overlay.querySelector("#f-date").value,
            document_type: overlay.querySelector("#f-doctype").value,
            items,
        };
        if (imageChange !== undefined) data.image = imageChange;
        if (sanity.length && !(await confirmDialog(`שים לב, מחיר חריג:<br><br>${sanity.map(escapeHtml).join("<br>")}<br><br>בדוק שגודל האריזה והיחידה נכונים (0.1 = מאה גרם). לשמור בכל זאת?`))) return;
        try {
            if (!existing && data.supplier_id && data.invoice_date) {
                const sum = Math.round(items.reduce((n, it) => n + (parseFloat(it.line_total) || (parseFloat(it.quantity) * parseFloat(it.unit_price)) || 0), 0) * 100) / 100;
                const dup = await findDuplicateInvoice({ supplierId: data.supplier_id, date: data.invoice_date, total: sum });
                if (dup && !(await confirmDialog(`כבר קיימת חשבונית מאותו ספק, באותו תאריך ובאותו סכום (${money(sum)}). לשמור בכל זאת?`))) return;
            }
            // מוצרים חדשים נוצרים רק אחרי שהחשבונית עצמה עברה אימות
            const createdIds = [];
            if (newProducts.length) {
                await validateInvoicePayload(data); // אימות מלא לפני שנוצר מוצר כלשהו
                for (const np of newProducts) {
                    np.item.pantry_item_id = await createPantryItemFromInvoice({
                        name: np.item.product_name, category: np.category, unitType: np.unitType, unitAmount: np.unitAmount, price: np.price,
                    });
                    createdIds.push(np.item.pantry_item_id);
                }
            }
            let savedId;
            try {
                savedId = await saveInvoice(existing ? existing.id : null, data);
            } catch (saveErr) {
                for (const pid of createdIds) await dbDelete("pantryItems", pid); // לא משאירים מוצרים יתומים
                throw saveErr;
            }
            for (const u of priceUpdates) {
                const p = await dbGet("pantryItems", u.id);
                if (p) { p.price = u.price; await dbPut("pantryItems", p); }
            }
            closeModal();
            toast("נשמר");
            renderSuppliersPage(container);
            const changes = await priceChanges({ thresholdPct: 10, invoiceId: savedId });
            if (changes.length) await showPriceChangesDialog(changes);
        } catch (e) {
            const el = overlay.querySelector(".error-msg");
            el.textContent = e.message;
            el.style.display = "block";
        }
    });
}
