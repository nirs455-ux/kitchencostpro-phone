import { scanInvoiceImage, applyScannedInvoice } from "../repo/scanRepo.js";
import { getSetting } from "../repo/settingsRepo.js";
import { listSuppliers, addSupplier } from "../repo/suppliersRepo.js";
import { CATEGORY_GROUPS, UNIT_TYPES, UNIT_TYPE_LABELS } from "../constants.js";
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
            <div class="btn-row">
                <button type="button" class="btn btn-accent" id="btn-pick-camera">📷 צלם חשבונית</button>
                <button type="button" class="btn btn-secondary" id="btn-pick-gallery">🖼️ בחר מהגלריה / קבצים</button>
            </div>
            <input type="file" id="scan-file-camera" accept="image/*" capture="environment" style="display:none">
            <input type="file" id="scan-file-gallery" accept="image/*" style="display:none">
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
                <div class="hint-warn" id="scan-no-supplier" style="display:none;">לא נבחר ספק - החשבונית לא תישמר בדף הספקים, רק המזווה יתעדכן.</div>
            </div>
            <div class="field"><label>תאריך</label><input type="date" id="scan-date" value="${todayLocal()}"></div>
            ` : ""}
            <div id="scan-items-box"></div>
            <div class="card-row" style="font-weight:700;margin:8px 0;"><span>סה"כ החשבונית (לפי השורות שמעל)</span><span id="scan-total">₪0.00</span></div>
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
    if (supplierAware) {
        const supSel = overlay.querySelector("#scan-supplier");
        const warn = overlay.querySelector("#scan-no-supplier");
        const syncWarn = () => { warn.style.display = supSel.value ? "none" : "block"; };
        supSel.addEventListener("change", syncWarn);
        overlay.__syncSupplierWarn = syncWarn;
        syncWarn();
    }

    overlay.querySelector("#btn-pick-camera").onclick = () => openInAppCamera();
    overlay.querySelector("#btn-pick-gallery").onclick = () => overlay.querySelector("#scan-file-gallery").click();

    // מצלמה בתוך האפליקציה (מבקשת הרשאה בעצמה). אם היא לא זמינה/נדחתה - חוזרים לשיטת הקלט הרגילה.
    async function openInAppCamera() {
        const fallback = () => overlay.querySelector("#scan-file-camera").click();
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return fallback();
        let stream;
        try {
            stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
        } catch (e) {
            return fallback();
        }
        const cam = document.createElement("div");
        cam.style.cssText = "position:fixed;inset:0;z-index:100;background:#000;display:flex;flex-direction:column;";
        cam.innerHTML = `
            <video autoplay playsinline muted style="flex:1;min-height:0;width:100%;object-fit:contain;"></video>
            <div style="display:flex;gap:10px;padding:14px;background:#111;">
                <button type="button" class="btn btn-secondary" style="flex:1;" id="cam-cancel">ביטול</button>
                <button type="button" class="btn btn-primary" style="flex:2;" id="cam-shoot">📸 צלם</button>
            </div>`;
        document.body.appendChild(cam);
        const video = cam.querySelector("video");
        video.srcObject = stream;
        const stop = () => { stream.getTracks().forEach((t) => t.stop()); cam.remove(); };
        cam.querySelector("#cam-cancel").onclick = stop;
        cam.querySelector("#cam-shoot").onclick = () => {
            if (!video.videoWidth) return;
            const canvas = document.createElement("canvas");
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            canvas.getContext("2d").drawImage(video, 0, 0);
            canvas.toBlob((blob) => {
                stop();
                if (blob) processFile(new File([blob], "invoice.jpg", { type: "image/jpeg" }));
            }, "image/jpeg", 0.92);
        };
    }

    const onFileChosen = (e) => processFile(e.target.files[0]);

    const processFile = async (file) => {
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
                    let found = false;
                    for (const opt of sel.options) {
                        if (opt.textContent.trim() === data.supplier_name.trim()) { sel.value = opt.value; found = true; break; }
                    }
                    if (!found) {
                        // ספק שזוהה בחשבונית ועדיין לא קיים - מציעים ליצור אותו (נבחר כברירת מחדל)
                        const opt = document.createElement("option");
                        opt.value = "__new__";
                        opt.textContent = `➕ צור ספק חדש: ${data.supplier_name.trim()}`;
                        sel.appendChild(opt);
                        sel.value = "__new__";
                    }
                }
            }
            if (overlay.__syncSupplierWarn) overlay.__syncSupplierWarn();
            renderResults();
        } catch (err) {
            overlay.querySelector("#scan-loading").style.display = "none";
            overlay.querySelector("#scan-upload-area").style.display = "block";
            overlay.querySelector("#scan-cancel-only").style.display = "flex";
            const el = overlay.querySelector("#scan-upload-area .error-msg");
            el.textContent = err.message;
            el.style.display = "block";
        }
    };
    overlay.querySelector("#scan-file-camera").addEventListener("change", onFileChosen);
    overlay.querySelector("#scan-file-gallery").addEventListener("change", onFileChosen);

    // שומר את מה שהוקלד בשדות לפני ציור מחדש (כדי שלחיצה על "כן/לא" לא תמחק עריכות)
    function captureInputs() {
        scannedItems.forEach((it, idx) => {
            const g = (id) => overlay.querySelector(`#${id}-${idx}`);
            if (!g("scan-name")) return;
            it.name = g("scan-name").value;
            it.quantity = g("scan-qty").value;
            it.unit_price = g("scan-price").value;
            it._case = g("scan-case").value;
            if (g("scan-pack")) { it._pack = g("scan-pack").value; it._packUnit = g("scan-pack-unit").value; }
            it._frozen = g("scan-frozen").checked;
            if (g("scan-cat") && !g("scan-cat").disabled) it._cat = g("scan-cat").value;
            if (g("scan-unit")) it._unit = g("scan-unit").value;
            if (g("scan-unit-amount")) it._unitAmount = g("scan-unit-amount").value;
        });
    }

    // סוג היחידה האפקטיבי של השורה (מוצר קיים - לפי המזווה; חדש - לפי הבחירה)
    const rowUnit = (it) => (it.matched_pantry_item_id ? it.matched_unit_type : it._unit || "weight");

    function renderResults() {
        overlay.querySelector("#scan-loading").style.display = "none";
        overlay.querySelector("#scan-results").style.display = "block";
        const box = overlay.querySelector("#scan-items-box");
        box.innerHTML = "";

        if (scannedItems.length === 0) {
            box.innerHTML = '<div class="muted">לא זוהו מוצרים בתמונה.</div>';
            overlay.querySelector("#scan-total").textContent = "₪0.00";
            return;
        }

        const updateTotal = () => {
            let t = 0;
            scannedItems.forEach((_, i) => {
                const q = parseFloat(overlay.querySelector(`#scan-qty-${i}`)?.value) || 0;
                const pr = parseFloat(overlay.querySelector(`#scan-price-${i}`)?.value) || 0;
                t += q * pr;
            });
            overlay.querySelector("#scan-total").textContent = `₪${t.toFixed(2)}`;
        };
        box.oninput = updateTotal;

        scannedItems.forEach((it, idx) => {
            const unitPriceNum = parseFloat(it.unit_price) || 0;
            const priceChanged = it.matched_pantry_item_id && it.matched_price != null && Math.abs(it.matched_price - unitPriceNum) > 0.001;
            const ut = rowUnit(it);
            const packUnits = ut === "liter" ? [["ml", 'מ"ל'], ["l", "ליטר"]] : [["g", "גרם"], ["kg", 'ק"ג']];
            const nameEmpty = !String(it.name || "").trim();
            const row = h(`
                <div class="item-row-inputs" style="${priceChanged ? "border-color:#c0392b;background:#fdecea;" : ""}">
                    <div class="top-line">
                        <strong>שורה ${idx + 1}</strong>
                        <div class="btn-row">
                            ${idx > 0 ? `<button type="button" class="btn btn-accent btn-small" data-promo="${idx}">🏷 זו שורת מבצע - הפחת מהמוצר שמעל</button>` : ""}
                            <button type="button" class="btn btn-secondary btn-small" data-remove="${idx}">✕ הסר שורה</button>
                        </div>
                    </div>
                    ${it.discount_applied ? `<div class="hint">כולל מבצע: הנחה ₪${it.discount_applied.toFixed(2)} שולבה במחיר (מחיר מחירון ₪${Number(it.list_unit_price).toFixed(2)} ליחידה)</div>` : ""}
                    ${nameEmpty ? '<div class="hint-warn">חסר שם מוצר - הזן שם, או לחץ "הסר שורה" אם זו לא שורת מוצר (למשל מבצע).</div>' : ""}
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
                        ${priceChanged ? `<div class="hint" style="color:#c0392b;">מחיר קודם: ₪${it.matched_price.toFixed(2)} → מחיר חדש: ₪${unitPriceNum.toFixed(2)}</div>` : ""}
                    </div>
                    <div class="field">
                        <label>קטגוריה${it.matched_pantry_item_id ? "" : " (חובה למוצר חדש)"}</label>
                        <select id="scan-cat-${idx}" ${it.matched_pantry_item_id ? "disabled" : ""}>
                            ${it.matched_pantry_item_id ? `<option>${escapeHtml(it.matched_category)}</option>` :
                              '<option value="">בחר קטגוריה...</option>' + Object.keys(CATEGORY_GROUPS).map((c) => `<option value="${c}" ${it._cat === c ? "selected" : ""}>${c}</option>`).join("")}
                        </select>
                    </div>
                    ${it.matched_pantry_item_id ? "" : `
                    <div class="form-row">
                        <div class="field">
                            <label>יחידת מידה</label>
                            <select id="scan-unit-${idx}">
                                ${UNIT_TYPES.map((u) => `<option value="${u}" ${(it._unit || "weight") === u ? "selected" : ""}>${UNIT_TYPE_LABELS[u]}</option>`).join("")}
                            </select>
                        </div>
                        <div class="field" id="scan-unit-amount-wrap-${idx}" style="display:none;">
                            <label>משקל/נפח ליחידה (גרם/מ"ל)</label>
                            <input type="number" step="any" id="scan-unit-amount-${idx}" value="${it._unitAmount ?? ""}">
                        </div>
                    </div>`}
                    ${ut === "weight" || ut === "liter" ? `
                    <div class="form-row">
                        <div class="field"><label>${ut === "liter" ? "נפח האריזה (אופציונלי)" : "משקל האריזה (אופציונלי)"}</label>
                            <input type="number" step="any" id="scan-pack-${idx}" placeholder="${ut === "liter" ? "לדוגמה: 370" : "לדוגמה: 180"}" value="${it._pack ?? ""}"></div>
                        <div class="field"><label>יחידה</label>
                            <select id="scan-pack-unit-${idx}">${packUnits.map(([v, l]) => `<option value="${v}" ${(it._packUnit || packUnits[0][0]) === v ? "selected" : ""}>${l}</option>`).join("")}</select></div>
                    </div>` : ""}
                    <div class="field"><label>יחידות בארגז (אופציונלי)</label><input type="number" step="any" id="scan-case-${idx}" placeholder="לדוגמה: 8" value="${it._case ?? ""}"></div>
                    <span class="hint" id="scan-pantry-price-${idx}"></span>
                    <div class="checkbox-field" style="margin-top:6px;">
                        <input type="checkbox" id="scan-frozen-${idx}" ${it._frozen ? "checked" : ""}>
                        <label for="scan-frozen-${idx}">❄ מוצר קפוא</label>
                    </div>
                    <div class="hint">${it.matched_pantry_item_id ? "מוצר קיים - יעודכן מחיר" : "מוצר חדש - יתווסף למזווה"}</div>
                </div>
            `);
            box.appendChild(row);

            const updatePreview = () => {
                const price = parseFloat(row.querySelector(`#scan-price-${idx}`).value) || 0;
                const perCase = parseFloat(row.querySelector(`#scan-case-${idx}`).value) || 1;
                const packEl = row.querySelector(`#scan-pack-${idx}`);
                const pack = packEl ? parseFloat(packEl.value) || 0 : 0;
                let packBase = 1;
                if (pack > 0) {
                    const pu = row.querySelector(`#scan-pack-unit-${idx}`).value;
                    packBase = pack * (pu === "g" || pu === "ml" ? 0.001 : 1);
                }
                const factor = perCase * packBase;
                const el = row.querySelector(`#scan-pantry-price-${idx}`);
                const label = ut === "liter" ? "ליטר" : ut === "weight" ? 'ק"ג' : "יחידה";
                el.textContent = factor !== 1 && price > 0 ? `מחיר שיישמר במזווה: ₪${(price / factor).toFixed(2)} ל${label}` : "";
            };
            row.querySelector(`#scan-price-${idx}`).addEventListener("input", updatePreview);
            row.querySelector(`#scan-case-${idx}`).addEventListener("input", updatePreview);
            if (row.querySelector(`#scan-pack-${idx}`)) {
                row.querySelector(`#scan-pack-${idx}`).addEventListener("input", updatePreview);
                row.querySelector(`#scan-pack-unit-${idx}`).addEventListener("change", updatePreview);
            }
            const promoBtn = row.querySelector("[data-promo]");
            if (promoBtn) promoBtn.onclick = () => {
                captureInputs();
                const prev = scannedItems[idx - 1];
                const cur = it;
                const qty = parseFloat(prev.quantity) || 0;
                const list = prev.list_unit_price ?? parseFloat(prev.unit_price) ?? 0;
                if (!(qty > 0)) { toast("אי אפשר לחשב מבצע - הכמות במוצר שמעל לא תקינה"); return; }
                let discount = Math.abs((parseFloat(cur.quantity) || 0) * (parseFloat(cur.unit_price) || 0));
                // מבצע חבילה כמו "3 ב-50": המחיר המודפס הוא מחיר החבילה, ההנחה = מחיר מחירון פחות מחיר החבילה
                const m = String(cur.name || "").match(/(\d+(?:\.\d+)?)\s*ב[-־\s]*(\d+(?:\.\d+)?)/);
                if (m) {
                    const bundleDiscount = qty * list - parseFloat(m[2]);
                    if (bundleDiscount > 0) discount = bundleDiscount;
                }
                prev.list_unit_price = list;
                prev.discount_applied = Math.round(((prev.discount_applied || 0) + discount) * 100) / 100;
                prev.unit_price = String(Math.round((Math.max(qty * list - prev.discount_applied, 0) / qty) * 10000) / 10000);
                scannedItems.splice(idx, 1);
                renderResults();
            };
            row.querySelector("[data-remove]").onclick = () => {
                captureInputs();
                const looksPromo = idx > 0 && /מבצע|הנחה|\d\s*ב[-־\s]*\d/.test(String(it.name || ""));
                scannedItems.splice(idx, 1);
                renderResults();
                if (looksPromo) toast('הסרת שורה שנראית כמו מבצע - ההנחה לא נחשבה. להפחתה מהמוצר השתמש ב"זו שורת מבצע"');
            };
            updatePreview();

            const unitSel = row.querySelector(`#scan-unit-${idx}`);
            if (unitSel) {
                const wrap = row.querySelector(`#scan-unit-amount-wrap-${idx}`);
                const syncUnit = () => { wrap.style.display = unitSel.value === "unit" ? "block" : "none"; };
                unitSel.addEventListener("change", () => { captureInputs(); renderResults(); });
                syncUnit();
            }

            const acceptBtn = row.querySelector("[data-accept]");
            if (acceptBtn) {
                acceptBtn.onclick = () => {
                    captureInputs();
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
                    captureInputs();
                    it.suggested_pantry_item_id = null;
                    renderResults();
                };
            }
        });
        updateTotal();
    }

    overlay.querySelector("#btn-cancel").onclick = closeModal;
    overlay.querySelector("#btn-apply").onclick = async () => {
        const items = scannedItems.map((it, idx) => ({
            name: overlay.querySelector(`#scan-name-${idx}`).value,
            quantity: overlay.querySelector(`#scan-qty-${idx}`).value,
            unit_price: overlay.querySelector(`#scan-price-${idx}`).value,
            units_per_case: overlay.querySelector(`#scan-case-${idx}`).value,
            package_size: overlay.querySelector(`#scan-pack-${idx}`)?.value || "",
            package_unit: overlay.querySelector(`#scan-pack-unit-${idx}`)?.value || null,
            category: it.matched_pantry_item_id ? it.matched_category : overlay.querySelector(`#scan-cat-${idx}`).value,
            is_frozen: overlay.querySelector(`#scan-frozen-${idx}`).checked,
            pantry_item_id: it.matched_pantry_item_id,
            unit_type: it.matched_pantry_item_id ? undefined : overlay.querySelector(`#scan-unit-${idx}`).value,
            unit_amount: it.matched_pantry_item_id ? undefined : overlay.querySelector(`#scan-unit-amount-${idx}`).value,
        }));
        let supplierId = supplierAware ? overlay.querySelector("#scan-supplier").value || null : null;
        const invoiceDate = supplierAware ? overlay.querySelector("#scan-date").value : null;
        try {
            if (supplierId === "__new__") {
                const name = overlay.querySelector("#scan-supplier").selectedOptions[0].textContent.replace(/^➕ צור ספק חדש:\s*/, "");
                const existing = (await listSuppliers()).find((x) => x.name === name);
                supplierId = existing ? existing.id : await addSupplier(name);
            }
            await applyScannedInvoice({ items, supplierId, invoiceDate });
            closeModal();
            toast(supplierId ? "נשמר גם כחשבונית בדף הספקים" : "נשמר במזווה בלבד (לא נבחר ספק)");
            if (onDone) onDone();
        } catch (e) {
            const el = overlay.querySelector("#scan-apply-error");
            el.textContent = e.message;
            el.style.display = "block";
        }
    };
}
