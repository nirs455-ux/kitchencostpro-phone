import { listSuppliers, addSupplier, deleteSupplier, listInvoicesWithItems, saveInvoice, deleteInvoice, monthlySummaryBySupplier } from "../repo/suppliersRepo.js";
import { listTopLevelPantryItems } from "../repo/pantryRepo.js";
import { h, openModal, closeModal, confirmDialog, toast, escapeHtml, money } from "../ui.js";
import { openScanModal } from "./scanModal.js";

function todayLocal() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export async function renderSuppliersPage(container) {
    const suppliers = await listSuppliers();
    const invoices = await listInvoicesWithItems();
    const monthly = await monthlySummaryBySupplier();
    const pantryItems = await listTopLevelPantryItems();

    container.innerHTML = `
        <div class="subtitle">מעקב הזמנות לפי ספק - נפרד מהמזווה, לא משפיע על שום חישוב עלות.</div>
        <div class="btn-row">
            <button class="btn btn-primary btn-small" id="btn-add-supplier">+ ספק חדש</button>
            <button class="btn btn-primary btn-small" id="btn-add-invoice">+ חשבונית חדשה</button>
            <button class="btn btn-accent btn-small" id="btn-scan">📷 סרוק חשבונית</button>
        </div>
        <div class="chips" id="supplier-chips"></div>
        <h2>סיכום קנייה חודשי</h2>
        <div id="monthly-summary"></div>
        <h2>כל החשבוניות</h2>
        <div id="invoices-list"></div>
    `;

    const chipsBox = container.querySelector("#supplier-chips");
    if (suppliers.length === 0) {
        chipsBox.innerHTML = '<div class="muted">עדיין אין ספקים - לחץ על "+ ספק חדש".</div>';
    }
    for (const s of suppliers) {
        const chip = h(`<div class="chip">${escapeHtml(s.name)} ✕</div>`);
        chip.onclick = async (e) => {
            if (e.offsetX > chip.clientWidth - 22) {
                if (!(await confirmDialog("למחוק את הספק?"))) return;
                try {
                    await deleteSupplier(s.id);
                    toast("נמחק");
                    renderSuppliersPage(container);
                } catch (err) {
                    toast(err.message);
                }
            }
        };
        chipsBox.appendChild(chip);
    }

    const monthlyBox = container.querySelector("#monthly-summary");
    if (Object.keys(monthly).length === 0) {
        monthlyBox.innerHTML = '<div class="empty-state">אין עדיין נתונים - הוסף חשבונית ראשונה.</div>';
    } else {
        for (const [supplierName, months] of Object.entries(monthly)) {
            const card = h(`<div class="card"><div class="card-title">${escapeHtml(supplierName)}</div></div>`);
            for (const m of months) {
                card.appendChild(h(`<div class="card-row"><span>${m.month}</span><span style="${m.total < 0 ? "color:#c0392b;" : ""}">${money(m.total)}</span></div>`));
            }
            monthlyBox.appendChild(card);
        }
    }

    const invoicesList = container.querySelector("#invoices-list");
    if (invoices.length === 0) {
        invoicesList.innerHTML = '<div class="empty-state">אין עדיין חשבוניות.</div>';
    } else {
        for (const inv of invoices) {
            const card = h(`
                <div class="card">
                    <div class="card-title">${escapeHtml(inv.supplier_name)} ${inv.document_type === "credit" ? '<span class="tag tag-danger">זיכוי</span>' : ""}</div>
                    <div class="card-row"><span class="muted">${inv.invoice_date}</span><span>${money(inv.total_amount)}</span></div>
                    <div class="muted">${inv.items.map((it) => escapeHtml(it.product_name)).join(", ")}</div>
                    <div class="card-actions">
                        <button class="btn btn-secondary btn-small" data-edit>עריכה</button>
                        <button class="btn btn-danger btn-small" data-delete>מחיקה</button>
                    </div>
                </div>
            `);
            card.querySelector("[data-edit]").onclick = () => openInvoiceModal(inv, suppliers, pantryItems, container);
            card.querySelector("[data-delete]").onclick = async () => {
                if (!(await confirmDialog("למחוק את החשבונית?"))) return;
                await deleteInvoice(inv.id);
                toast("נמחק");
                renderSuppliersPage(container);
            };
            invoicesList.appendChild(card);
        }
    }

    container.querySelector("#btn-add-supplier").onclick = () => openSupplierModal(container);
    container.querySelector("#btn-add-invoice").onclick = () => openInvoiceModal(null, suppliers, pantryItems, container);
    container.querySelector("#btn-scan").onclick = () => openScanModal({ supplierAware: true, onDone: () => renderSuppliersPage(container) });
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
    overlay.querySelector("#btn-cancel").onclick = closeModal;
    overlay.querySelector("#btn-save").onclick = async () => {
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
    };
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
        <div id="items-box"></div>
        <button type="button" class="btn btn-secondary btn-small" id="btn-add-row">+ הוסף שורה</button>
        <div class="card-row" style="font-weight:700;margin-top:10px;"><span>סה"כ:</span><span id="total-display">₪0.00</span></div>
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
            <div class="item-row-inputs" id="inv-row-${id}">
                <div class="field"><input type="text" id="inv-name-${id}" placeholder="שם מוצר" value="${prefill ? escapeHtml(prefill.product_name) : ""}"></div>
                <div class="field">
                    <select id="inv-pantry-${id}">
                        <option value="">ללא שיוך למזווה</option>
                        ${pantryItems.map((p) => `<option value="${p.id}" ${prefill && prefill.pantry_item_id === p.id ? "selected" : ""}>${escapeHtml(p.name)}</option>`).join("")}
                    </select>
                </div>
                <div class="top-line">
                    <input type="number" step="any" id="inv-qty-${id}" placeholder="כמות" value="${prefill ? prefill.quantity : ""}">
                    <input type="number" step="any" id="inv-price-${id}" placeholder="מחיר יח'" value="${prefill ? prefill.unit_price : ""}">
                    <button type="button" class="remove-row-btn" data-remove="${id}">✕</button>
                </div>
                <div class="line-total" id="inv-line-${id}"></div>
            </div>
        `);
        box.appendChild(row);
        const recalcAndBind = () => { recalc(); };
        row.querySelector(`#inv-qty-${id}`).addEventListener("input", recalcAndBind);
        row.querySelector(`#inv-price-${id}`).addEventListener("input", recalcAndBind);
        row.querySelector("[data-remove]").onclick = () => { row.remove(); recalc(); };
    }

    function recalc() {
        let total = 0;
        box.querySelectorAll(".item-row-inputs").forEach((row) => {
            const id = row.id.replace("inv-row-", "");
            const qty = parseFloat(overlay.querySelector(`#inv-qty-${id}`).value) || 0;
            const price = parseFloat(overlay.querySelector(`#inv-price-${id}`).value) || 0;
            const lineTotal = qty * price;
            overlay.querySelector(`#inv-line-${id}`).textContent = lineTotal ? money(lineTotal) : "";
            total += lineTotal;
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

    overlay.querySelector("#btn-cancel").onclick = closeModal;
    overlay.querySelector("#btn-save").onclick = async () => {
        const items = [];
        box.querySelectorAll(".item-row-inputs").forEach((row) => {
            const id = row.id.replace("inv-row-", "");
            const product_name = overlay.querySelector(`#inv-name-${id}`).value;
            const quantity = overlay.querySelector(`#inv-qty-${id}`).value;
            const unit_price = overlay.querySelector(`#inv-price-${id}`).value;
            const pantry_item_id = overlay.querySelector(`#inv-pantry-${id}`).value || null;
            if (product_name && quantity && unit_price) items.push({ product_name, quantity, unit_price, pantry_item_id });
        });
        const data = {
            supplier_id: overlay.querySelector("#f-supplier").value,
            invoice_date: overlay.querySelector("#f-date").value,
            document_type: overlay.querySelector("#f-doctype").value,
            items,
        };
        try {
            await saveInvoice(existing ? existing.id : null, data);
            closeModal();
            toast("נשמר");
            renderSuppliersPage(container);
        } catch (e) {
            const el = overlay.querySelector(".error-msg");
            el.textContent = e.message;
            el.style.display = "block";
        }
    };
}
