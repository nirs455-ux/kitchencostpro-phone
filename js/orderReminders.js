// תזכורות הזמנה לפי ימי החלוקה של הספקים: פופאפ בפתיחת האפליקציה (פעם ביום) ושורות במסך הבית.
import { openModal, closeModal, escapeHtml } from "./ui.js";
import { getSetting, setSetting } from "./repo/settingsRepo.js";
import { dueOrders, localDate } from "./repo/ordersRepo.js";
import { openOrderModal } from "./pages/orderModal.js";
import { isStaffMode } from "./staff.js";

// שורות להצגה במסך הבית: { cls, icon, text, btn, fn }
export async function orderAttnItems(onChanged) {
    if (isStaffMode()) return [];
    const due = await dueOrders();
    const open = (s) => () => openOrderModal(s, onChanged);
    const items = due.today.map((d) => ({ cls: d.overdue ? "danger" : "warn", icon: "📦", text: `הזמנה מ${d.supplier.name} היום${d.cutoff ? ` עד ${d.cutoff}` : ""}${d.overdue ? " - הזמן עבר" : ""}`, btn: "הזמן", fn: open(d.supplier) }));
    for (const d of due.tomorrow) items.push({ cls: "ok", icon: "📦", text: `מחר: הזמנה מ${d.supplier.name}${d.cutoff ? ` עד ${d.cutoff}` : ""}`, btn: "הזמן", fn: open(d.supplier) });
    return items;
}

// פופאפ בפתיחה: רק אם יש הזמנות להיום, ופעם אחת ביום
export async function maybeShowOrderPopup() {
    try {
        if (isStaffMode()) return;
        const due = await dueOrders();
        if (!due.today.length) return;
        const today = localDate(new Date());
        if ((await getSetting("order_popup_day")) === today) return;
        await setSetting("order_popup_day", today);
        const ov = openModal(`
            <h2>📦 הזמנות להיום</h2>
            <div id="op-list">${due.today.map((d, i) => `<div class="card-row" style="margin-bottom:8px;"><span><b>${escapeHtml(d.supplier.name)}</b>${d.cutoff ? `<br><small>עד ${escapeHtml(d.cutoff)}${d.overdue ? " - הזמן עבר" : ""}</small>` : ""}</span><button type="button" class="btn btn-primary btn-small" data-i="${i}">הזמן</button></div>`).join("")}</div>
            <div class="modal-actions"><button type="button" class="btn btn-secondary" id="op-later">אחר כך</button></div>`);
        ov.querySelector("#op-later").onclick = closeModal;
        ov.querySelectorAll("[data-i]").forEach((b) => { b.onclick = () => { closeModal(); openOrderModal(due.today[+b.dataset.i].supplier); }; });
    } catch (e) { /* תזכורת בלבד */ }
}
