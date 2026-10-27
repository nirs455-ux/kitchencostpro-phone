// ארכיון מחוקים: שחזור או מחיקה סופית. מה שנשאר בארכיון יותר מ-30 יום נמחק לבד.
import { openModal, closeModal, confirmDialog, toast, escapeHtml, money, info } from "../ui.js";
import { listInvoicesWithItems, restoreInvoice, purgeInvoice } from "../repo/suppliersRepo.js";

export async function openTrashModal(onChange) {
    const trashed = await listInvoicesWithItems({ trashed: true });
    trashed.sort((a, b) => (b.deleted_at || "").localeCompare(a.deleted_at || ""));
    const overlay = openModal(`
        <h2>ארכיון מחוקים ${info("חשבוניות שנמחקו נשמרות כאן 30 יום, ואפשר לשחזר אותן. אחר כך הן נמחקות סופית.")}</h2>
        <div id="trash-list">${trashed.length ? "" : '<div class="empty-state">הארכיון ריק.</div>'}</div>
        <div class="modal-actions"><button type="button" class="btn btn-secondary" id="trash-close">סגור</button></div>
    `);
    overlay.querySelector("#trash-close").onclick = closeModal;
    const list = overlay.querySelector("#trash-list");
    for (const inv of trashed) {
        const row = document.createElement("div");
        row.className = "card";
        row.innerHTML = `<div class="card-title">${escapeHtml(inv.supplier_name)} · ${money(inv.total_amount)}</div>
            <div class="muted">${inv.invoice_date} · נמחקה ${new Date(inv.deleted_at).toLocaleDateString("he-IL")} · ${inv.items.length} שורות</div>
            <div class="card-actions"><button type="button" class="btn btn-primary btn-small" data-restore>שחזר</button>
                <button type="button" class="btn btn-danger btn-small" data-purge>מחק סופית</button></div>`;
        row.querySelector("[data-restore]").onclick = async () => {
            await restoreInvoice(inv.id);
            toast("שוחזר");
            closeModal();
            if (onChange) await onChange();
        };
        row.querySelector("[data-purge]").onclick = async () => {
            if (!(await confirmDialog("למחוק את החשבונית סופית? אי אפשר יהיה לשחזר אותה."))) { openTrashModal(onChange); return; }
            await purgeInvoice(inv.id);
            toast("נמחקה סופית");
            if (onChange) await onChange();
            openTrashModal(onChange);
        };
        list.appendChild(row);
    }
}
