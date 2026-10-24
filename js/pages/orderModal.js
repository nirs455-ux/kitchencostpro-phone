// הזמנה לספק: רשימת המוצרים שקנית ממנו (לפי חשבוניות), מזינים כמויות ושולחים בוואטסאפ או מעתיקים. לא נשמר דבר מלבד טלפון הספק.
import { openModal, closeModal, toast, escapeHtml, cur } from "../ui.js";
import { listSupplierProducts, setSupplierPhone } from "../repo/suppliersRepo.js";
import { buildInventoryView } from "../repo/inventoryRepo.js";
import { whatsappUrl, orderText, normalizePhoneIL } from "../shareText.js";

const shortDate = (d) => { const [y, m, day] = String(d || "").split("-"); return day ? `${parseInt(day, 10)}.${parseInt(m, 10)}.${y.slice(2)}` : String(d || ""); };

export async function openOrderModal(supplier, onChanged) {
    const products = await listSupplierProducts(supplier.id);
    let stock = new Map();
    try { stock = new Map((await buildInventoryView()).map((x) => [x.id, x])); } catch (e) { /* המלאי הוא רק רמז */ }
    const today = new Date().toLocaleDateString("he-IL");
    const rowsHtml = products.map((p, i) => {
        const st = p.pantry_item_id ? stock.get(p.pantry_item_id) : null;
        const stockHint = st && Number.isFinite(Number(st.theoretical_quantity)) ? ` · מלאי תיאורטי ${+Number(st.theoretical_quantity).toFixed(2)}` : "";
        const hint = `קנית בתאריך ${escapeHtml(shortDate(p.last_date))}: ${p.last_qty != null ? +Number(p.last_qty).toFixed(3) : "?"}${p.last_price != null ? ` · ${cur()}${Number(p.last_price).toFixed(2)}` : ""}${stockHint}`;
        return `<div class="item-row-inputs"><div class="top-line"><div style="flex:2;min-width:0;"><div style="font-weight:600;">${escapeHtml(p.name)}</div><div class="hint" style="margin:0;">${hint}</div></div>
            <input type="text" inputmode="decimal" data-oq="${i}" placeholder="כמות" style="width:84px;"></div></div>`;
    }).join("");
    const ov = openModal(`
        <h2>הזמנה: ${escapeHtml(supplier.name)}</h2>
        ${products.length ? `<div class="hint" style="margin-bottom:6px;">הזן כמות רק למה שרוצים להזמין. אפשר לכתוב גם עם יחידה (למשל "5 ק"ג" או "2 ארגזים").</div>` : '<div class="empty-state">עדיין אין מוצרים של הספק הזה בחשבוניות. אפשר לכתוב את ההזמנה ידנית למטה.</div>'}
        <div id="oq-list">${rowsHtml}</div>
        <div class="field" style="margin-top:8px;"><label>מוצרים נוספים / הערות</label><textarea id="oq-note" rows="3" style="width:100%;" placeholder="למשל: 3 ארגזי עגבניות, לספק עד 7 בבוקר"></textarea></div>
        <div class="field"><label>טלפון הספק (לוואטסאפ)</label><input type="tel" id="oq-phone" value="${escapeHtml(supplier.phone || "")}" placeholder="050-1234567"></div>
        <div class="error-msg"></div>
        <div class="modal-actions" style="flex-wrap:wrap;">
            <button type="button" class="btn btn-secondary" id="oq-close">סגור</button>
            <button type="button" class="btn btn-secondary" id="oq-copy">📋 העתק</button>
            <button type="button" class="btn btn-primary" id="oq-send">💬 שלח בוואטסאפ</button>
        </div>`);

    const build = () => {
        const lines = [];
        ov.querySelectorAll("[data-oq]").forEach((inp) => {
            const q = inp.value.trim();
            if (q) lines.push({ name: products[Number(inp.dataset.oq)].name, qty: q });
        });
        return { lines, text: orderText(supplier.name, today, lines, ov.querySelector("#oq-note").value) };
    };
    const hasContent = (b) => b.lines.length || ov.querySelector("#oq-note").value.trim();
    const err = ov.querySelector(".error-msg");
    ov.querySelector("#oq-close").onclick = closeModal;
    ov.querySelector("#oq-copy").onclick = async () => {
        const b = build();
        if (!hasContent(b)) { err.textContent = "לא הוזנה אף כמות."; err.style.display = "block"; return; }
        try { await navigator.clipboard.writeText(b.text); toast("ההזמנה הועתקה"); } catch (e) { toast("לא הצלחתי להעתיק"); }
    };
    ov.querySelector("#oq-send").onclick = async () => {
        const b = build();
        if (!hasContent(b)) { err.textContent = "לא הוזנה אף כמות."; err.style.display = "block"; return; }
        const phone = ov.querySelector("#oq-phone").value.trim();
        if (phone && !normalizePhoneIL(phone)) { err.textContent = "מספר הטלפון לא תקין."; err.style.display = "block"; return; }
        try { if (phone !== (supplier.phone || "")) { await setSupplierPhone(supplier.id, phone); supplier.phone = phone; if (onChanged) onChanged(); } } catch (e) { err.textContent = e.message; err.style.display = "block"; return; }
        window.open(whatsappUrl(b.text, phone), "_blank", "noopener");
    };
}
