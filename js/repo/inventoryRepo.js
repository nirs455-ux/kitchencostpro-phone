// לוגיקת ספירת מלאי - תרגום מדויק של inventory_page / save_inventory_counts.
import { dbGetAll, dbGet, dbPut, dbGetByIndex } from "../db.js";

async function lastCountFor(pantryItemId) {
    const rows = await dbGetByIndex("inventoryCounts", "pantry_item_id", pantryItemId);
    if (rows.length === 0) return null;
    rows.sort((a, b) => (b.count_date || "").localeCompare(a.count_date || "") || b.id - a.id);
    return rows[0];
}

async function purchasedSince(pantryItemId, sinceDate) {
    const items = await dbGetByIndex("invoiceItems", "pantry_item_id", pantryItemId);
    if (items.length === 0) return 0;
    const invoices = await dbGetAll("invoices");
    const invoiceById = Object.fromEntries(invoices.map((i) => [i.id, i]));
    let total = 0;
    for (const it of items) {
        const inv = invoiceById[it.invoice_id];
        if (!inv) continue;
        if (sinceDate && !(inv.invoice_date > sinceDate)) continue;
        total += inv.document_type === "credit" ? -it.quantity : it.quantity;
    }
    return Math.round(total * 1000) / 1000;
}

export async function buildInventoryView() {
    const all = await dbGetAll("pantryItems");
    const topLevel = all.filter((it) => !it.parent_id).sort((a, b) => a.category.localeCompare(b.category, "he") || a.name.localeCompare(b.name, "he"));

    const out = [];
    for (const p of topLevel) {
        const last = await lastCountFor(p.id);
        const lastCountedQuantity = last ? last.counted_quantity : 0;
        const lastCountDate = last ? last.count_date : null;
        const purchased = await purchasedSince(p.id, lastCountDate);
        const theoretical = Math.round((lastCountedQuantity + purchased) * 1000) / 1000;
        out.push({
            id: p.id, name: p.name, category: p.category,
            last_count_date: lastCountDate, last_counted_quantity: lastCountedQuantity,
            purchased_since: purchased, theoretical_quantity: theoretical,
        });
    }
    return out;
}

export async function saveInventoryCounts(countDate, counts) {
    if (!countDate) throw new Error("יש לבחור תאריך ספירה");
    if (!counts || counts.length === 0) throw new Error("יש להזין כמות שנספרה לפחות למוצר אחד");
    for (const c of counts) {
        const pantryItemId = parseInt(c.pantry_item_id, 10);
        const countedQuantity = parseFloat(c.counted_quantity);
        if (Number.isNaN(pantryItemId) || Number.isNaN(countedQuantity)) throw new Error("נתוני ספירה לא תקינים");
        const item = await dbGet("pantryItems", pantryItemId);
        if (!item) throw new Error(`מוצר לא נמצא (מזהה ${pantryItemId})`);
        await dbPut("inventoryCounts", { pantry_item_id: pantryItemId, count_date: countDate, counted_quantity: countedQuantity });
    }
}
