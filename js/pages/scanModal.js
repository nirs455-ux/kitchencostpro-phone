import { scanInvoiceImage, applyScannedInvoice } from "../repo/scanRepo.js";
import { getSetting } from "../repo/settingsRepo.js";
import { listSuppliers } from "../repo/suppliersRepo.js";
import { CATEGORY_GROUPS } from "../constants.js";
import { h, openModal, closeModal, toast, escapeHtml } from "../ui.js";

function todayLocal() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export async function openScanModal({ supplierAware, onDone }) {
    const apiKey = await getSetting("gemini_api_key");
    const suppliers = supplierAware ? await listSuppliers() : [];

    const overlay = openModal(`
        <h2>סריקת חשבונית</h2>
        <div id="scan-upload-area">
            <div class="hint" style="margin-bottom:10px;">צלם או העלה תמונה של חשבונית - נזהה ממנה ${supplierAware ? "ספק, תאריך ו" : ""}מוצרים אוטומטית.</div>
            <input type="file" id="scan-file-input" accept="image/*">
            <div class="error-msg"></div>
        </div>
        <div id="scan-loading" style="display:none;text-align:center;padding:24px;color:#666;">קורא את החשבונית...</div>
        <div id="scan-results" style="display:none;">
            ${supplierAware ? `
            <div class="field">
                <label>ספק</label>
                <select id="scan-supplier">
                    <option value="">ללא שיוך לחשבונית (רק עדכון מזווה)</option>
                    ${suppliers.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("")}
                </select>
                <div class="hint">בחירת ספק תשמור זאת גם כחשבונית בדף הספקים, ותעדכן את הקניות בדף המלאי. בלי בחירה - רק המחיר במזווה יתעדכן.</div>
            </div>
            <div class="field"><label>תאריך</label><input type="date" id="scan-date" value="${todayLocal()}"></div>
            ` : ""}
            <div id="scan-items-box"></div>
            <div class="error-msg" id="scan-apply-error"></div>
            <div class="modal-actions">
                <button class="btn btn-secondary" id="btn-cancel">ביטול</button>
                <button class="btn btn-primary" id="btn-apply">שמירה</button>
            </div>
        </div>
        <div class="modal-actions" id="scan-cancel-only">
            <button class="btn btn-secondary" id="btn-cancel2">ביטול</button>
        </div>
    `);

    overlay.querySelector("#btn-cancel2").onclick = closeModal;

    let scannedItems = [];

    overlay.querySelector("#scan-file-input").addEventListener("change", async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        overlay.querySelector("#scan-upload-area").style.display = "none";
        overlay.querySelector("#scan-loading").style.display = "block";
        overlay.querySelector("#scan-cancel-only").style.display = "none";
        try {
            const data = await scanInvoiceImage(apiKey, file);
            scannedItems = data.items || [];
            if (supplierAware) {
                if (data.invoice_date) overlay.querySelector("#scan-date").value = data.invoice_date;
                if (data.supplier_name) {
                    const sel = overlay.querySelector("#scan-supplier");
                    for (const opt of sel.options) {
                        if (opt.textContent.trim() === data.supplier_name.trim()) { sel.value = opt.value; break; }
                    }
                }
            }
            renderResults();
        } catch (err) {
            overlay.querySelector("#scan-loading").style.display = "none";
            overlay.querySelector("#scan-upload-area").style.display = "block";
            overlay.querySelector("#scan-cancel-only").style.display = "flex";
            const el = overlay.querySelector("#scan-upload-area .error-msg");
            el.textContent = err.message;
            el.style.display = "block";
        }
    });

    function renderResults() {
        overlay.querySelector("#scan-loading").style.display = "none";
        overlay.querySelector("#scan-results").style.display = "block";
        const box = overlay.querySelector("#scan-items-box");
        box.innerHTML = "";

        if (scannedItems.length === 0) {
            box.innerHTML = '<div class="muted">לא זוהו מוצרים בתמונה.</div>';
            return;
        }

        scannedItems.forEach((it, idx) => {
            const priceChanged = it.matched_pantry_item_id && it.matched_price != null && Math.abs(it.matched_price - it.unit_price) > 0.001;
            const row = h(`
                <div class="item-row-inputs" style="${priceChanged ? "border-color:#c0392b;background:#fdecea;" : ""}">
                    <div class="field"><label>שם מוצר</label><input type="text" id="scan-name-${idx}" value="${escapeHtml(it.name)}"></div>
                    <div class="field"><label>כמות</label><input type="number" step="any" id="scan-qty-${idx}" value="${it.quantity}"></div>
                    ${it.suggested_pantry_item_id && !it.matched_pantry_item_id ? `
                    <div class="hint-warn">
                        האם התכוונת ל-"${escapeHtml(it.suggested_name)}" הקיים במזווה?
                        <div class="btn-row">
                            <button type="button" class="btn btn-primary btn-small" data-accept="${idx}">כן, זה אותו מוצר</button>
                            <button type="button" class="btn btn-secondary btn-small" data-reject="${idx}">לא, זה מוצר חדש</button>
                        </div>
                    </div>` : ""}
                    <div class="field">
                        <label>מחיר יחידה${priceChanged ? " - שונה מהמחיר הקיים!" : ""}</label>
                        <input type="number" step="any" id="scan-price-${idx}" value="${it.unit_price}" style="${priceChanged ? "border-color:#c0392b;color:#c0392b;font-weight:700;" : ""}">
                        ${priceChanged ? `<div class="hint" style="color:#c0392b;">מחיר קודם: ₪${it.matched_price.toFixed(2)} → מחיר חדש: ₪${it.unit_price.toFixed(2)}</div>` : ""}
                    </div>
                    <div class="field">
                        <label>קטגוריה${it.matched_pantry_item_id ? "" : " (חובה למוצר חדש)"}</label>
                        <select id="scan-cat-${idx}" ${it.matched_pantry_item_id ? "disabled" : ""}>
                            ${it.matched_pantry_item_id ? `<option>${escapeHtml(it.matched_category)}</option>` :
                              '<option value="">בחר קטגוריה...</option>' + Object.keys(CATEGORY_GROUPS).map((c) => `<option value="${c}">${c}</option>`).join("")}
                        </select>
                    </div>
                    <div class="field"><label>יחידות בארגז (אופציונלי)</label><input type="number" step="any" id="scan-case-${idx}" placeholder="לדוגמה: 8"></div>
                    <span class="hint" id="scan-pantry-price-${idx}"></span>
                    <div class="checkbox-field" style="margin-top:6px;">
                        <input type="checkbox" id="scan-frozen-${idx}">
                        <label for="scan-frozen-${idx}">❄ מוצר קפוא</label>
                    </div>
                    <div class="hint">${it.matched_pantry_item_id ? "מוצר קיים - יעודכן מחיר" : "מוצר חדש - יתווסף למזווה"}</div>
                </div>
            `);
            box.appendChild(row);

            const updatePreview = () => {
                const price = parseFloat(row.querySelector(`#scan-price-${idx}`).value) || 0;
                const perCase = parseFloat(row.querySelector(`#scan-case-${idx}`).value) || 0;
                const el = row.querySelector(`#scan-pantry-price-${idx}`);
                el.textContent = perCase > 0 && price > 0 ? `מחיר שיישמר במזווה: ₪${(price / perCase).toFixed(2)} ליחידה` : "";
            };
            row.querySelector(`#scan-price-${idx}`).addEventListener("input", updatePreview);
            row.querySelector(`#scan-case-${idx}`).addEventListener("input", updatePreview);

            const acceptBtn = row.querySelector("[data-accept]");
            if (acceptBtn) {
                acceptBtn.onclick = () => {
                    it.matched_pantry_item_id = it.suggested_pantry_item_id;
                    it.matched_category = it.suggested_category;
                    it.matched_price = it.suggested_price;
                    it.matched_unit_type = it.suggested_unit_type;
                    renderResults();
                };
            }
            const rejectBtn = row.querySelector("[data-reject]");
            if (rejectBtn) {
                rejectBtn.onclick = () => {
                    it.suggested_pantry_item_id = null;
                    renderResults();
                };
            }
        });
    }

    overlay.querySelector("#btn-cancel").onclick = closeModal;
    overlay.querySelector("#btn-apply").onclick = async () => {
        const items = scannedItems.map((it, idx) => ({
            name: overlay.querySelector(`#scan-name-${idx}`).value,
            quantity: overlay.querySelector(`#scan-qty-${idx}`).value,
            unit_price: overlay.querySelector(`#scan-price-${idx}`).value,
            units_per_case: overlay.querySelector(`#scan-case-${idx}`).value,
            category: it.matched_pantry_item_id ? it.matched_category : overlay.querySelector(`#scan-cat-${idx}`).value,
            is_frozen: overlay.querySelector(`#scan-frozen-${idx}`).checked,
            pantry_item_id: it.matched_pantry_item_id,
        }));
        const supplierId = supplierAware ? overlay.querySelector("#scan-supplier").value || null : null;
        const invoiceDate = supplierAware ? overlay.querySelector("#scan-date").value : null;
        try {
            await applyScannedInvoice({ items, supplierId, invoiceDate });
            closeModal();
            toast("נשמר");
            if (onDone) onDone();
        } catch (e) {
            const el = overlay.querySelector("#scan-apply-error");
            el.textContent = e.message;
            el.style.display = "block";
        }
    };
}
