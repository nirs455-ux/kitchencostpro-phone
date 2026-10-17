// חלון התראות שינוי מחיר: מה השתנה, בכמה, ואילו מנות מושפעות.
import { openModal, closeModal, escapeHtml, info, cur } from "../ui.js";
import { dishesAffectedByPantryItem } from "../repo/suppliersRepo.js";

const UNIT_LABEL = { weight: 'ק"ג', liter: "ליטר", unit: "יחידה" };

export async function renderPriceChangeRows(changes) {
    const rows = [];
    for (const c of changes) {
        const up = c.pct > 0;
        const dishes = await dishesAffectedByPantryItem(c.pantry_item_id);
        rows.push(`
            <div class="card" style="border-color:${up ? "#c0392b" : "#2e7d32"};">
                <div class="card-title">${escapeHtml(c.name)}</div>
                <div class="card-row"><span>${cur()}${c.prev.toFixed(2)} ← ${cur()}${c.cur.toFixed(2)} ל${UNIT_LABEL[c.unit_type] || "יחידה"}</span>
                    <span style="font-weight:700;color:${up ? "#c0392b" : "#2e7d32"};">${up ? "▲" : "▼"} ${Math.abs(c.pct)}%</span></div>
                <div class="muted">${c.date}${dishes.length ? ` · משפיע על: ${dishes.map(escapeHtml).join(", ")}` : ""}</div>
            </div>`);
    }
    return rows.join("");
}

export async function showPriceChangesDialog(changes, title = "שינויי מחיר בחשבונית") {
    if (!changes.length) return;
    const html = await renderPriceChangeRows(changes);
    const overlay = openModal(`
        <h2>${title} ${info("מחיר ליחידת מזווה מול הקנייה הקודמת של אותו מוצר (שינוי של 10% ומעלה).")}</h2>
        ${html}
        <div class="modal-actions"><button type="button" class="btn btn-primary" id="pa-close">הבנתי</button></div>
    `);
    await new Promise((resolve) => {
        overlay.querySelector("#pa-close").onclick = () => { closeModal(); resolve(); };
    });
}
