import { scanInvoiceImage, applyScannedInvoice } from "../repo/scanRepo.js";
import { getSetting } from "../repo/settingsRepo.js";
import { getAgentKey } from "../agent.js";
import { listSuppliers, addSupplier } from "../repo/suppliersRepo.js";
import { CATEGORY_GROUPS, UNIT_TYPES, UNIT_TYPE_LABELS } from "../constants.js";
import { h, openModal, closeModal, toast, escapeHtml, info, busy, attemptClose, cur } from "../ui.js";
import { compressImage } from "../imageUtil.js";
import { addToQueue } from "../repo/scanQueue.js";
import { FILE_ACCEPT, DOC_ACCEPT } from "../filePrep.js";
import { driveButtonHtml, pickFromDrive, warmDrivePicker, ONEDRIVE_LOGO } from "../cloud/drivePicker.js";
import { logError } from "../errorLog.js";
import { priceChanges } from "../repo/suppliersRepo.js";
import { totalsReference, vatLines } from "../invoiceParse.js";
import { showPriceChangesDialog } from "./priceAlerts.js";

// שורה שנראית כמו מבצע/הנחה: שם עם "מבצע"/"הנחה"/"3 ב-50", או כמות/מחיר שליליים. רק לשורות כאלה מוצג כפתור "זו שורת מבצע".
const promoLike = (it) => /מבצע|הנחה|\d\s*ב[-־\s]*\d/.test(String(it.name || "")) || parseFloat(it.unit_price) < 0 || parseFloat(it.quantity) < 0;

function todayLocal() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export async function openScanModal({ supplierAware, onDone, initialFile = null }) {
    const apiKey = await getAgentKey();
    const autoSaveEnabled = !!(await getSetting("scan_autosave"));
    const suppliers = supplierAware ? await listSuppliers() : [];

    const overlay = openModal(`
        <h2>סריקת חשבונית ${info(`צלם או העלה תמונה של חשבונית - נזהה ממנה ${supplierAware ? "ספק, תאריך ו" : ""}מוצרים אוטומטית.`)}</h2>
        <div id="scan-upload-area">
            <div class="btn-row">
                <button type="button" class="btn btn-accent" id="btn-pick-camera">צלם</button>
                <button type="button" class="btn btn-secondary" id="btn-pick-gallery">🖼️ גלריה</button>
            </div>
            <button type="button" class="btn btn-secondary btn-block" id="btn-pick-any" style="margin-top:8px;">${ONEDRIVE_LOGO}📁 קבצים (PDF, Word, Excel, OneDrive)</button>
            ${driveButtonHtml("btn-pick-drive")}
            <input type="file" id="scan-file-camera" accept="image/*" capture="environment" style="display:none">
            <input type="file" id="scan-file-gallery" accept="image/*" style="display:none">
            <input type="file" id="scan-file-any" accept="${DOC_ACCEPT}" style="display:none">
            <div class="error-msg"></div>
        </div>
        <div id="scan-loading" style="display:none;text-align:center;padding:24px;color:#666;">קורא את החשבונית...</div>
        <div id="scan-results" style="display:none;">
            <div class="hint-warn" id="scan-skipped" style="display:none;"></div>
            <div class="hint-warn" id="scan-returns" style="display:none;"></div>
            ${supplierAware ? `
            <div class="field">
                <label>ספק ${info("בחירת ספק תשמור זאת גם כחשבונית בדף הספקים, ותעדכן את הקניות בדף המלאי. בלי בחירה - רק המחיר בחומרי הגלם יתעדכן.")}</label>
                <select id="scan-supplier">
                    <option value="">ללא שיוך לחשבונית (רק עדכון חומרי גלם)</option>
                    ${suppliers.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("")}
                </select>
                <div class="hint-warn" id="scan-no-supplier" style="display:none;">לא נבחר ספק - החשבונית לא תישמר בדף הספקים, רק חומרי הגלם יתעדכן.</div>
            </div>
            <div class="field"><label>תאריך</label><input type="date" id="scan-date" value="${todayLocal()}"></div>
            <button type="button" class="btn-link" id="scan-petty-show">＋ קופה קטנה</button>
            <div class="checkbox-field" id="scan-petty-wrap" style="display:none;"><input type="checkbox" id="scan-petty"><label for="scan-petty">קופה קטנה</label></div>
            <div class="field" id="scan-purchaser-wrap" style="display:none;"><input type="text" id="scan-purchaser" placeholder="מי רכש (אופציונלי)"></div>
            ` : ""}
            <div id="scan-summary" style="margin-bottom:8px;"></div>
            <div id="scan-autosave" class="hint-warn" style="display:none;"></div>
            <div id="scan-items-box"></div>
            <div class="card-row" style="font-weight:700;margin:8px 0 2px;"><span>סה"כ השורות</span><span id="scan-sum">${cur()}0.00</span></div>
            <div id="scan-vat"></div>
            <div class="hint-warn" id="scan-total-warn" style="display:none;"></div>
            <div class="card-row" style="font-weight:700;margin:8px 0;"><span>סה"כ החשבונית (לפי השורות שמעל)</span><span id="scan-total">${cur()}0.00</span></div>
            <div class="error-msg" id="scan-apply-error"></div>
            <div class="modal-actions">
                <button class="btn btn-secondary" id="btn-cancel">ביטול</button>
                <button class="btn btn-primary" id="btn-apply">אשר ושמור</button>
            </div>
        </div>
        <div class="modal-actions" id="scan-cancel-only">
            <button class="btn btn-secondary" id="btn-cancel2">ביטול</button>
        </div>
    `);

    let autoTimer = null;
    const stopAuto = () => { if (autoTimer) { clearInterval(autoTimer); autoTimer = null; } const b = overlay.querySelector("#scan-autosave"); if (b) b.style.display = "none"; };
    overlay.querySelector("#btn-cancel2").onclick = () => { stopAuto(); attemptClose(overlay); };
    // כל עריכה/לחיצה במסך הבדיקה עוצרת את השמירה האוטומטית
    overlay.querySelector("#scan-results").addEventListener("input", stopAuto);
    overlay.querySelector("#scan-items-box").addEventListener("pointerdown", stopAuto);

    let scannedItems = [];
    let scannedSkipped = 0; // שורות שלא נקראו במלואן
    let scannedReturns = []; // החזרות/זיכויים: מוצגים ונספרים בסכום, לא משנים מחיר
    let scannedFile = null;
    let scannedAttachment = null; // הקובץ שיישמר עם החשבונית (תמונה מכווצת / PDF / המסמך המקורי)
    let printedTotal = null;
    let scannedVat = null; // סיכומי המע"מ כפי שמודפסים בחשבונית
    const pettyShow = overlay.querySelector("#scan-petty-show");
    if (pettyShow) pettyShow.onclick = () => { pettyShow.style.display = "none"; overlay.querySelector("#scan-petty-wrap").style.display = "flex"; overlay.querySelector("#scan-petty").checked = true; overlay.querySelector("#scan-purchaser-wrap").style.display = "block"; };
    const pettyBox = overlay.querySelector("#scan-petty");
    if (pettyBox) pettyBox.addEventListener("change", () => { overlay.querySelector("#scan-purchaser-wrap").style.display = pettyBox.checked ? "block" : "none"; });
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
    overlay.querySelector("#btn-pick-any").onclick = () => overlay.querySelector("#scan-file-any").click();

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
        scannedFile = file;
        overlay.querySelector("#scan-upload-area").style.display = "none";
        overlay.querySelector("#scan-loading").style.display = "block";
        overlay.querySelector("#scan-cancel-only").style.display = "none";
        try {
            const loading = overlay.querySelector("#scan-loading");
            loading.textContent = "קורא את החשבונית...";
            const data = await scanInvoiceImage(apiKey, file, (n, total) => {
                loading.textContent = `השרת עמוס, מנסה שוב (${n}/${total})...`;
            });
            scannedItems = data.items || [];
            if (!scannedItems.length) throw new Error(data.skipped_lines ? "לא נקראו שורות תקינות מהחשבונית. נסה לצלם שוב (ישר, באור טוב, כל העמוד בתמונה) או הוסף ידנית." : "לא זוהו מוצרים בחשבונית. נסה לצלם שוב (ישר, באור טוב) או הוסף ידנית.");
            scannedSkipped = data.skipped_lines || 0;
            scannedReturns = data.returns || [];
            // מוצר חדש: קטגוריה ויחידה מוצעות אוטומטית (אפשר לשנות)
            for (const it of scannedItems) {
                if (!it.matched_pantry_item_id) {
                    if (it.guess_category && !it._cat) { it._cat = it.guess_category; it._catGuessed = true; }
                    if (it.guess_unit && !it._unit) it._unit = it.guess_unit;
                }
            }
            printedTotal = data.invoice_total;
            scannedVat = data.vat || null;
            scannedAttachment = data.attachment || null;
            if (data.partial) toast("הקובץ ישן - הקריאה עשויה להיות חלקית, בדוק את השורות");
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
            logError("scan", err);
            overlay.querySelector("#scan-loading").style.display = "none";
            overlay.querySelector("#scan-upload-area").style.display = "block";
            overlay.querySelector("#scan-cancel-only").style.display = "flex";
            const el = overlay.querySelector("#scan-upload-area .error-msg");
            el.textContent = err.message;
            el.style.display = "block";
            // התמונה כבר נבחרה - מאפשרים ניסיון חוזר בלחיצה אחת, בלי לצלם מחדש
            if (err.queueable && !overlay.querySelector("#btn-scan-queue")) {
                const qb = h(`<button type="button" class="btn btn-secondary btn-block" id="btn-scan-queue" style="margin-top:8px;">⏳ שמור לעיבוד מאוחר</button>`);
                el.after(qb);
                qb.onclick = async () => {
                    await addToQueue(await compressImage(scannedFile));
                    closeModal();
                    toast("התמונה נשמרה בתור - תופיע במסך הבית כשתרצה לעבד");
                    if (onDone) onDone();
                };
            }
            if (!overlay.querySelector("#btn-scan-retry")) {
                const rb = h(`<button type="button" class="btn btn-primary btn-block" id="btn-scan-retry" style="margin-top:8px;">🔄 נסה שוב עם אותה תמונה</button>`);
                el.after(rb);
                rb.onclick = () => { rb.remove(); processFile(scannedFile); };
            }
        }
    };
    overlay.querySelector("#scan-file-camera").addEventListener("change", onFileChosen);
    overlay.querySelector("#scan-file-gallery").addEventListener("change", onFileChosen);
    overlay.querySelector("#scan-file-any").addEventListener("change", onFileChosen);
    const driveBtn = overlay.querySelector("#btn-pick-drive");
    if (driveBtn) {
        warmDrivePicker();
        driveBtn.onclick = async () => {
            const errEl = overlay.querySelector("#scan-upload-area .error-msg");
            try {
                driveBtn.disabled = true;
                const file = await pickFromDrive();
                driveBtn.disabled = false;
                if (file) processFile(file);
            } catch (e) { driveBtn.disabled = false; if (errEl) { errEl.textContent = e.message; errEl.style.display = "block"; } }
        };
    }

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

    // סוג היחידה האפקטיבי של השורה (מוצר קיים - לפי חומרי הגלם; חדש - לפי הבחירה)
    const rowUnit = (it) => (it.matched_pantry_item_id ? it.matched_unit_type : it._unit || "weight");

    function renderResults() {
        overlay.querySelector("#scan-loading").style.display = "none";
        overlay.querySelector("#scan-results").style.display = "block";
        overlay.__dirty = true; // יש תוצאות סריקה שטרם נשמרו
        { const sk = overlay.querySelector("#scan-skipped"); if (sk) { sk.style.display = scannedSkipped ? "block" : "none"; sk.textContent = scannedSkipped ? `${scannedSkipped} שורות בחשבונית לא נקראו במלואן (חסרה כמות או מחיר) ולכן לא מופיעות. בדוק מול החשבונית והוסף ידנית אם צריך.` : ""; } }
        {
            const rt = overlay.querySelector("#scan-returns");
            rt.style.display = scannedReturns.length ? "block" : "none";
            rt.innerHTML = scannedReturns.length ? `החזרות / זיכויים (לא משנים מחיר, נספרים בסכום):<br>${scannedReturns.map((r) => `${escapeHtml(r.name)}: ${cur()}${Number(r.amount).toFixed(2)}`).join("<br>")}` : "";
        }
        const returnsSum = scannedReturns.reduce((n, r) => n + (Number(r.amount) || 0), 0);
        const box = overlay.querySelector("#scan-items-box");
        box.innerHTML = "";

        if (scannedItems.length === 0) {
            box.innerHTML = '<div class="muted">לא זוהו מוצרים בתמונה.</div>';
            overlay.querySelector("#scan-total").textContent = `${cur()}0.00`;
            return;
        }

        // סיכומי המע"מ כמו בחשבונית (רק מה שנקרא ממנה)
        overlay.querySelector("#scan-vat").innerHTML = vatLines(scannedVat).map(([label, v]) => `<div class="card-row"><span>${escapeHtml(label)}</span><span>${cur()}${Number(v).toFixed(2)}</span></div>`).join("");

        const updateTotal = () => {
            let t = returnsSum;
            const warn = overlay.querySelector("#scan-total-warn");
            scannedItems.forEach((_, i) => {
                const q = parseFloat(overlay.querySelector(`#scan-qty-${i}`)?.value) || 0;
                const pr = parseFloat(overlay.querySelector(`#scan-price-${i}`)?.value) || 0;
                t += q * pr;
            });
            overlay.querySelector("#scan-total").textContent = `${cur()}${t.toFixed(2)}`;
            overlay.querySelector("#scan-sum").textContent = `${cur()}${t.toFixed(2)}`;
            // סכום השורות הוא לפני מע"מ, ולכן משווים אותו ל"סה"כ ללא מע"מ" ולא לסכום הסופי
            const cmp = totalsReference(scannedVat, printedTotal);
            if (cmp && Math.abs(cmp.ref - t) >= 1) {
                warn.textContent = `שים לב: ${cmp.label} בחשבונית ${cur()}${Number(cmp.ref).toFixed(2)} שונה מסה"כ השורות (הפרש ${cur()}${Math.abs(cmp.ref - t).toFixed(2)}). בדוק שורות חסרות, כמויות ומבצעים.`;
                warn.style.display = "block";
            } else {
                warn.style.display = "none";
            }
        };
        box.oninput = updateTotal;

        let attentionCount = 0, okCount = 0;
        scannedItems.forEach((it, idx) => {
            const unitPriceNum = parseFloat(it.unit_price) || 0;
            const defFactor = it.default_factor > 0 && !it._pack && !it._case ? it.default_factor : 1;
            const cmpPrice = unitPriceNum / defFactor; // מחיר ליחידת חומרי גלם
            const relChange = it.matched_pantry_item_id && it.matched_price > 0 ? Math.abs(cmpPrice - it.matched_price) / it.matched_price : 0;
            const priceChanged = it.matched_pantry_item_id && it.matched_price != null && relChange >= 0.01;
            const ut = rowUnit(it);
            const packUnits = ut === "liter" ? [["l", "ליטר"], ["ml", 'מ"ל']] : [["kg", 'ק"ג'], ["g", "גרם"]];
            const nameEmpty = !String(it.name || "").trim();
            // חריגות שכדאי לבדוק (המחיר בחומרי הגלם הוא ליחידת חומרי גלם, לכן לא משווים כשיש גודל אריזה/ארגז)
            const flags = [];
            if (it.matched_pantry_item_id && it.matched_price > 0 && unitPriceNum > 0 && !it._pack && !it._case) {
                const dev = ((cmpPrice - it.matched_price) / it.matched_price) * 100;
                if (Math.abs(dev) >= 40) flags.push(`המחיר שונה ב-${Math.round(dev)}% מהמחיר בחומרי הגלם - ודא שזו לא טעות בקריאה או באריזה`);
            }
            const qn = parseFloat(it.quantity);
            if (!(qn > 0) || qn >= 100) flags.push("כמות חריגה - ודא שהמספר נקרא נכון");
            const nameKey = String(it.name || "").trim().toLowerCase();
            if (nameKey && scannedItems.filter((x) => String(x.name || "").trim().toLowerCase() === nameKey).length > 1) {
                flags.push("השם מופיע יותר מפעם אחת בקבלה - ייתכן שצריך לאחד שורות");
            }
            // שורה "תקינה" = מוכרת בחומרי הגלם, בלי חריגות ובלי שינוי מחיר מעל 5% - מוסתרת, ורק מה שדורש תשומת לב מוצג
            const needsAttention = !it.matched_pantry_item_id || nameEmpty || flags.length > 0 || relChange >= 0.05 || !!it.suggested_pantry_item_id;
            if (needsAttention) attentionCount++; else okCount++;
            const row = h(`
                <div class="item-row-inputs" data-ok="${needsAttention ? 0 : 1}" style="${needsAttention ? "" : "display:none;"}${priceChanged ? "border-color:var(--danger);background:#fdecea;" : ""}">
                    <div class="top-line">
                        <strong>שורה ${idx + 1}</strong>
                        <div class="btn-row">
                            ${idx > 0 && promoLike(it) ? `<button type="button" class="btn btn-accent btn-small" data-promo="${idx}">🏷 זו שורת מבצע - הפחת מהמוצר שמעל</button>` : ""}
                            <button type="button" class="btn btn-secondary btn-small" data-remove="${idx}">✕ הסר שורה</button>
                        </div>
                    </div>
                    ${it.discount_applied ? `<div class="hint">כולל מבצע: הנחה ${cur()}${it.discount_applied.toFixed(2)} שולבה במחיר (מחיר מחירון ${cur()}${Number(it.list_unit_price).toFixed(2)} ליחידה)</div>` : ""}
                    ${flags.map((f) => `<div class="hint-warn">⚠ ${escapeHtml(f)}</div>`).join("")}
                    ${nameEmpty ? '<div class="hint-warn">חסר שם מוצר - הזן שם, או לחץ "הסר שורה" אם זו לא שורת מוצר (למשל מבצע).</div>' : ""}
                    <div class="field"><label>שם מוצר</label><input type="text" id="scan-name-${idx}" value="${escapeHtml(it.name)}"></div>
                    ${it.auto_matched ? `<div class="hint">זוהה כ-"${escapeHtml(it.auto_matched)}" שבחומרי הגלם</div>` : ""}
                    <div class="field"><label>כמות</label><input type="number" step="any" id="scan-qty-${idx}" value="${it.quantity}"></div>
                    ${it.suggested_pantry_item_id && !it.matched_pantry_item_id ? `
                    <div class="hint-warn">
                        האם התכוונת ל-"${escapeHtml(it.suggested_name)}" הקיים בחומרי הגלם?
                        <div class="btn-row">
                            <button type="button" class="btn btn-primary btn-small" data-accept="${idx}">כן, זה אותו מוצר</button>
                            <button type="button" class="btn btn-secondary btn-small" data-reject="${idx}">לא, זה מוצר חדש</button>
                        </div>
                    </div>` : ""}
                    <div class="field">
                        <label>מחיר יחידה${priceChanged ? " - שונה מהמחיר הקיים!" : ""}</label>
                        <input type="number" step="any" id="scan-price-${idx}" value="${it.unit_price}" style="${priceChanged ? "border-color:var(--danger);color:var(--danger);font-weight:700;" : ""}">
                        ${priceChanged ? `<div class="hint" style="color:var(--danger);">מחיר קודם: ${cur()}${it.matched_price.toFixed(2)} → מחיר חדש: ${cur()}${cmpPrice.toFixed(2)}${defFactor !== 1 ? " (לפי האריזה מהקנייה הקודמת)" : ""}</div>` : ""}
                    </div>
                    <div class="field">
                        <label>קטגוריה${it.matched_pantry_item_id ? "" : it._catGuessed && it._cat === it.guess_category ? " (הוצעה אוטומטית - בדוק)" : " (חובה למוצר חדש)"}</label>
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
                el.textContent = factor !== 1 && price > 0 ? `מחיר שיישמר בחומרי הגלם: ${cur()}${(price / factor).toFixed(2)} ל${label}` : "";
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

        // כותרת סיכום: כמה שורות תקינות (מוסתרות) וכמה דורשות תשומת לב
        const sum = overlay.querySelector("#scan-summary");
        sum.innerHTML = `${okCount ? `<div class="card-row"><span>✓ ${okCount} שורות זוהו ותקינות</span><button type="button" class="btn btn-secondary btn-small" id="btn-show-ok">הצג</button></div>` : ""}
            ${attentionCount ? `<div class="hint-warn">⚠ ${attentionCount} שורות דורשות תשומת לב (מוצגות למטה)</div>` : '<div class="hint" style="color:#2e7d32;font-weight:700;">✓ הכול זוהה - אפשר לאשר ולשמור</div>'}`;
        // כמה שורות מחכות ל"האם התכוונת": כפתור אחד לאשר את כולן
        const pending = scannedItems.filter((x) => x.suggested_pantry_item_id && !x.matched_pantry_item_id);
        if (pending.length >= 2) {
            sum.insertAdjacentHTML("beforeend", `<button type="button" class="btn btn-primary btn-block" id="btn-accept-all" style="margin-top:6px;">✓ אשר את כל ההתאמות המוצעות (${pending.length})</button>`);
            sum.querySelector("#btn-accept-all").onclick = () => {
                captureInputs();
                for (const x of pending) {
                    x.matched_pantry_item_id = x.suggested_pantry_item_id;
                    x.matched_category = x.suggested_category;
                    x.matched_price = x.suggested_price;
                    x.matched_unit_type = x.suggested_unit_type;
                }
                renderResults();
            };
        }
        const showOk = sum.querySelector("#btn-show-ok");
        if (showOk) showOk.onclick = () => {
            const hidden = box.querySelectorAll('[data-ok="1"]');
            const nowShown = hidden[0] && hidden[0].style.display !== "none";
            hidden.forEach((r) => { r.style.display = nowShown ? "none" : ""; });
            showOk.textContent = nowShown ? "הצג" : "הסתר";
        };
        maybeAutoSave(attentionCount);
    }

    // שמירה אוטומטית (אם הופעלה בהגדרות): רק כשהכול תקין, יש ספק, והסכום מתאים לקבלה. 5 שניות לעצור.
    function maybeAutoSave(attentionCount) {
        stopAuto();
        if (!autoSaveEnabled || !supplierAware || attentionCount > 0 || scannedItems.length === 0) return;
        const supplier = overlay.querySelector("#scan-supplier").value;
        const warnShown = overlay.querySelector("#scan-total-warn").style.display !== "none";
        if (!supplier || warnShown || !overlay.querySelector("#scan-date").value) return;
        let left = 5;
        const banner = overlay.querySelector("#scan-autosave");
        const paint = () => { banner.innerHTML = `שמירה אוטומטית בעוד ${left} שניות <button type="button" class="btn btn-secondary btn-small" id="btn-auto-stop">עצור</button>`; banner.querySelector("#btn-auto-stop").onclick = stopAuto; };
        banner.style.display = "block";
        paint();
        autoTimer = setInterval(() => {
            left -= 1;
            if (left <= 0) { stopAuto(); overlay.querySelector("#btn-apply").click(); } else paint();
        }, 1000);
    }

    overlay.querySelector("#btn-cancel").onclick = () => { stopAuto(); attemptClose(overlay); };
    overlay.querySelector("#btn-apply").onclick = busy(async () => {
        stopAuto();
        const items = scannedItems.map((it, idx) => ({
            name: overlay.querySelector(`#scan-name-${idx}`).value,
            orig_name: it.orig_name || "",
            default_factor: it.default_factor || null,
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
            const image = supplierId && (scannedAttachment || scannedFile) ? (scannedAttachment || (await compressImage(scannedFile))) : undefined;
            const pettyCash = supplierAware && overlay.querySelector("#scan-petty").checked;
            const purchaser = supplierAware ? overlay.querySelector("#scan-purchaser").value : "";
            const result = await applyScannedInvoice({ items, supplierId, invoiceDate, image, pettyCash, purchaser, vat: scannedVat });
            closeModal();
            const kept = result.kept_price || [];
            const keptNote = kept.length ? ` · חשבונית ישנה - יש חשבונית חדשה יותר, המחיר הנוכחי נשאר עבור: ${kept.join(", ")}` : "";
            toast((supplierId ? "נשמר גם כחשבונית בדף הספקים" : "נשמר בחומרי הגלם בלבד (לא נבחר ספק)") + keptNote);
            if (onDone) onDone();
            if (result.invoice_id) {
                const changes = await priceChanges({ thresholdPct: 10, invoiceId: result.invoice_id });
                if (changes.length) await showPriceChangesDialog(changes);
            }
        } catch (e) {
            const el = overlay.querySelector("#scan-apply-error");
            el.textContent = e.message;
            el.style.display = "block";
        }
    });

    if (initialFile) processFile(initialFile);
}
