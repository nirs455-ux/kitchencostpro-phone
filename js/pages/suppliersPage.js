import { listSuppliers, addSupplier, deleteSupplier, getSupplierDeleteInfo, listInvoicesWithItems, saveInvoice, deleteInvoice, monthlySummaryBySupplier } from "../repo/suppliersRepo.js";
import { listTopLevelPantryItems } from "../repo/pantryRepo.js";
import { createPantryItemFromInvoice } from "../repo/scanRepo.js";
import { CATEGORY_GROUPS, UNIT_TYPES, UNIT_TYPE_LABELS } from "../constants.js";
import { computeStockFactor } from "../invoiceParse.js";
import { dbGet, dbPut } from "../db.js";
import { h, openModal, closeModal, confirmDialog, toast, escapeHtml, money } from "../ui.js";
import { openScanModal } from "./scanModal.js";
import { compressImage, showImageFullscreen } from "../imageUtil.js";

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
        const chip = h(`<div class="chip" style="display:flex;align-items:center;gap:8px;">${escapeHtml(s.name)}<button type="button" data-del style="border:none;background:none;color:#c0392b;font-size:15px;font-weight:700;padding:2px 4px;cursor:pointer;" aria-label="מחק ספק">✕</button></div>`);
        chip.querySelector("[data-del]").onclick = async () => {
            try {
                const info = await getSupplierDeleteInfo(s.id);
                let msg = `למחוק את הספק "${escapeHtml(info.name)}"?`;
                if (info.invoice_count) {
                    msg += `<br><br>יימחקו גם ${info.invoice_count} חשבוניות שלו (סה"כ ${money(info.invoices_total)}).<br>הקניות שלהן ייגרעו מהסיכום החודשי ומחישוב המלאי.`;
                }
                if (!(await confirmDialog(msg))) return;
                await deleteSupplier(s.id);
                toast("נמחק");
                renderSuppliersPage(container);
            } catch (err) {
                toast(err.message);
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
                        ${inv.has_image ? '<button class="btn btn-accent btn-small" data-image>🖼 תמונה</button>' : ""}
                        <button class="btn btn-secondary btn-small" data-edit>עריכה</button>
                        <button class="btn btn-danger btn-small" data-delete>מחיקה</button>
                    </div>
                </div>
            `);
            const imgBtn = card.querySelector("[data-image]");
            if (imgBtn) imgBtn.onclick = () => showImageFullscreen(inv.image, `${inv.supplier_name} - ${inv.invoice_date}`);
            card.querySelector("[data-edit]").onclick = () => openInvoiceModal(inv, suppliers, pantryItems, container);
            card.querySelector("[data-delete]").onclick = async () => {
                if (!(await confirmDialog("למחוק את החשבונית?<br><br>הקניות שלה ייגרעו מהסיכום החודשי ומחישוב המלאי."))) return;
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
        <div class="field" style="margin-top:10px;">
            <label>תמונת החשבונית (אופציונלי)</label>
            <div class="btn-row">
                <button type="button" class="btn btn-accent btn-small" id="btn-img-pick">📷 צלם / בחר תמונה</button>
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
            <div class="item-row-inputs" id="inv-row-${id}" data-stock-factor="${prefill && prefill.stock_factor ? prefill.stock_factor : ""}">
                <div class="field"><input type="text" id="inv-name-${id}" placeholder="שם מוצר" value="${prefill ? escapeHtml(prefill.product_name) : ""}"></div>
                <div class="field">
                    <select id="inv-pantry-${id}">
                        <option value="">ללא שיוך למזווה</option>
                        <option value="__new__">➕ מוצר חדש - הוסף למזווה</option>
                        ${[...pantryItems].sort((a, b) => a.name.localeCompare(b.name, "he")).map((p) => `<option value="${p.id}" ${prefill && prefill.pantry_item_id === p.id ? "selected" : ""}>${escapeHtml(p.name)}</option>`).join("")}
                    </select>
                </div>
                <div id="inv-new-${id}" style="display:none;background:#eef6fb;border-radius:8px;padding:8px;margin-bottom:6px;">
                    <div class="hint">המוצר ייווצר במזווה עם המחיר ליחידה מהשורה הזו.</div>
                    <div class="field"><label>קטגוריה (חובה)</label>
                        <select id="inv-cat-${id}"><option value="">בחר קטגוריה...</option>${Object.keys(CATEGORY_GROUPS).map((c) => `<option value="${c}">${c}</option>`).join("")}</select></div>
                    <div class="form-row">
                        <div class="field"><label>נמדד ב-</label>
                            <select id="inv-ut-${id}">${UNIT_TYPES.map((u) => `<option value="${u}" ${u === "unit" ? "selected" : ""}>${UNIT_TYPE_LABELS[u]}</option>`).join("")}</select></div>
                        <div class="field" id="inv-ua-wrap-${id}"><label>משקל/נפח ליחידה (גרם/מ"ל)</label>
                            <input type="number" step="any" id="inv-ua-${id}" placeholder="לדוגמה: 20"></div>
                    </div>
                </div>
                <div id="inv-pk-${id}" style="display:none;background:#f6f6f0;border-radius:8px;padding:8px;margin-bottom:6px;">
                    <div class="form-row" id="inv-pack-wrap-${id}">
                        <div class="field"><label>גודל אריזה (אופציונלי)</label>
                            <input type="number" step="any" id="inv-pack-${id}" placeholder="לדוגמה: 370"></div>
                        <div class="field"><label>יחידה</label><select id="inv-pack-unit-${id}"></select></div>
                    </div>
                    <div class="field"><label>יחידות בארגז (אופציונלי)</label>
                        <input type="number" step="any" id="inv-case-${id}" placeholder="לדוגמה: 8"></div>
                    <div class="checkbox-field">
                        <input type="checkbox" id="inv-upd-${id}" ${existing ? "" : "checked"}>
                        <label for="inv-upd-${id}">עדכן את המחיר במזווה לפי השורה הזו</label>
                    </div>
                    <div class="hint" id="inv-pk-prev-${id}"></div>
                </div>
                <div class="top-line">
                    <input type="number" step="any" id="inv-qty-${id}" placeholder="כמות / משקל" value="${prefill ? prefill.quantity : ""}">
                    <input type="number" step="any" id="inv-price-${id}" placeholder="מחיר ליחידה/ק&quot;ג" value="${prefill ? prefill.unit_price : ""}">
                    <input type="number" step="any" id="inv-line-${id}" placeholder="סה&quot;כ שורה" value="${prefill ? (prefill.line_total ?? Math.round(prefill.quantity * prefill.unit_price * 100) / 100) : ""}">
                    <button type="button" class="remove-row-btn" data-remove="${id}">✕</button>
                </div>
                ${prefill && prefill.stock_factor ? `<div class="hint">כל יחידה בחשבונית = ${Math.round(prefill.stock_factor * 1000) / 1000} יחידות מלאי (נשמר מהסריקה)</div>` : ""}
                <div class="hint">למשל 9 יחידות ב-15 ₪: כמות 9 וסה"כ 15 (המחיר ליחידה יחושב לבד). הנתונים נשמרים כפי שהוזנו.</div>
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
            row.querySelector(`#inv-ua-wrap-${id}`).style.display = utSel.value === "unit" ? "block" : "none";
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
            if (!ut) return;
            const isPackable = ut === "weight" || ut === "liter";
            row.querySelector(`#inv-pack-wrap-${id}`).style.display = isPackable ? "" : "none";
            const opts = ut === "liter" ? [["ml", 'מ"ל'], ["l", "ליטר"]] : [["g", "גרם"], ["kg", 'ק"ג']];
            const cur = packSel.value;
            packSel.innerHTML = opts.map(([v, l]) => `<option value="${v}">${l}</option>`).join("");
            if (opts.some(([v]) => v === cur)) packSel.value = cur;
            updatePreview();
        };
        const updatePreview = () => {
            const ut = rowUnitType();
            if (!ut) return;
            const q = num(qtyEl);
            let price = num(priceEl);
            if (isNaN(price) && q > 0 && !isNaN(num(totalEl))) price = num(totalEl) / q;
            const { factor, error } = computeStockFactor(ut, parseFloat(row.querySelector(`#inv-case-${id}`).value) || null,
                parseFloat(row.querySelector(`#inv-pack-${id}`).value) || null, packSel.value);
            const label = ut === "liter" ? "ליטר" : ut === "weight" ? 'ק"ג' : "יחידה";
            const prev = row.querySelector(`#inv-pk-prev-${id}`);
            if (error) { prev.textContent = error; return; }
            const p = pantryItems.find((x) => String(x.id) === pantrySel.value);
            const old = p && p.price != null ? ` (במזווה כרגע: ₪${Number(p.price).toFixed(2)})` : "";
            prev.textContent = !isNaN(price) && price > 0 ? `מחיר שיישמר במזווה: ₪${(price / (factor || 1)).toFixed(2)} ל${label}${old}` : "";
        };
        for (const el of [qtyEl, priceEl, totalEl, row.querySelector(`#inv-case-${id}`), row.querySelector(`#inv-pack-${id}`)]) el.addEventListener("input", updatePreview);
        packSel.addEventListener("change", updatePreview);
        pantrySel.addEventListener("change", () => { syncNew(); syncPack(); });
        utSel.addEventListener("change", () => { syncNew(); syncPack(); });
        syncNew();
        syncPack();
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

    overlay.querySelector("#btn-cancel").onclick = closeModal;
    overlay.querySelector("#btn-save").onclick = async () => {
        const items = [];
        const newProducts = []; // שורות עם "מוצר חדש במזווה" - נוצרות רק אחרי שכל האימותים עברו
        const priceUpdates = []; // עדכוני מחיר למוצרים קיימים - מתבצעים רק אחרי שהחשבונית נשמרה
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
            if (!(product_name && quantity && (unit_price || line_total))) continue;
            const item = { product_name, quantity, unit_price, line_total, pantry_item_id: sel === "__new__" ? null : sel || null, stock_factor: row.dataset.stockFactor || null };

            // סוג יחידה, גודל אריזה וארגז -> stock_factor (יחידות מזווה ביחידה אחת של השורה)
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
                const res = computeStockFactor(unitType, upc, ps, overlay.querySelector(`#inv-pack-unit-${id}`).value);
                if (res.error) return showErr(`'${product_name}': ${res.error}`);
                if (upc || ps) { factor = res.factor; item.stock_factor = factor !== 1 ? factor : null; }
                else if (item.stock_factor) factor = parseFloat(item.stock_factor) || 1;
            }
            const pantryPrice = unitPriceNum / factor;

            if (sel === "__new__") {
                const category = overlay.querySelector(`#inv-cat-${id}`).value;
                if (!category) return showErr(`'${product_name}': בחר קטגוריה למוצר החדש במזווה`);
                const unitAmount = overlay.querySelector(`#inv-ua-${id}`).value;
                if (unitType === "unit" && !(parseFloat(unitAmount) > 0)) return showErr(`'${product_name}': הזן משקל/נפח ליחידה (גרם/מ"ל)`);
                const key = product_name.trim().toLowerCase();
                if (pantryItems.some((p) => p.name.trim().toLowerCase() === key)) return showErr(`'${product_name}' כבר קיים במזווה - בחר אותו מהרשימה במקום ליצור חדש`);
                if (newProducts.some((np) => np.item.product_name.trim().toLowerCase() === key)) return showErr(`'${product_name}' מופיע פעמיים כמוצר חדש`);
                if (!(q > 0) || Number.isNaN(pantryPrice)) return showErr("כמות/מחיר לא תקינים");
                newProducts.push({ item, category, unitType, unitAmount, price: pantryPrice });
            } else if (existingPantry && overlay.querySelector(`#inv-upd-${id}`).checked && q > 0 && !Number.isNaN(pantryPrice)) {
                priceUpdates.push({ id: existingPantry.id, price: pantryPrice });
            }
            items.push(item);
        }
        const data = {
            supplier_id: overlay.querySelector("#f-supplier").value,
            invoice_date: overlay.querySelector("#f-date").value,
            document_type: overlay.querySelector("#f-doctype").value,
            items,
        };
        if (imageChange !== undefined) data.image = imageChange;
        try {
            // מוצרים חדשים נוצרים רק אחרי שהחשבונית עצמה עברה אימות
            if (newProducts.length) {
                if (!data.supplier_id) throw new Error("יש לבחור ספק");
                if (!data.invoice_date) throw new Error("יש להזין תאריך");
                for (const np of newProducts) {
                    np.item.pantry_item_id = await createPantryItemFromInvoice({
                        name: np.item.product_name, category: np.category, unitType: np.unitType, unitAmount: np.unitAmount, price: np.price,
                    });
                }
            }
            await saveInvoice(existing ? existing.id : null, data);
            for (const u of priceUpdates) {
                const p = await dbGet("pantryItems", u.id);
                if (p) { p.price = u.price; await dbPut("pantryItems", p); }
            }
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
