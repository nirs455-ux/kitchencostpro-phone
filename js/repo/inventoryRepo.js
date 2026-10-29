// לוגיקת ספירת מלאי - תרגום מדויק של inventory_page / save_inventory_counts.
import { dbGetAll, dbGet, dbGetByIndex, dbAtomic } from "../db.js";
import { loadSalesCtx } from "./salesRepo.js";
import { consumptionEvents, consumedBetween, theoreticalStock } from "../salesCalc.js";

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
        if (!inv || inv.deleted_at) continue;
        if (sinceDate && !(inv.invoice_date > sinceDate)) continue;
        const q = it.quantity * (it.stock_factor ?? 1);
        total += inv.document_type === "credit" ? -q : q;
    }
    return Math.round(total * 1000) / 1000;
}

export async function buildInventoryView() {
    const all = await dbGetAll("pantryItems");
    // צריכה תיאורטית מדוח המכירות ומהפחת (פירוק מנות ומתכונים לחומרי גלם). בלי מכירות/פחת התוצאה זהה לקודם.
    let events = [];
    try {
        const ctx = await loadSalesCtx();
        events = consumptionEvents(await dbGetAll("salesLines"), await dbGetAll("wasteLogs"), ctx);
    } catch (e) { events = []; }
    const topLevel = all.filter((it) => !it.parent_id).sort((a, b) => a.category.localeCompare(b.category, "he") || a.name.localeCompare(b.name, "he"));

    const out = [];
    for (const p of topLevel) {
        const last = await lastCountFor(p.id);
        const lastCountedQuantity = last ? last.counted_quantity : 0;
        const lastCountDate = last ? last.count_date : null;
        const purchased = await purchasedSince(p.id, lastCountDate);
        const soldConsumed = consumedBetween(events, p.id, lastCountDate || "", "", ["sale"]);
        const wasted = consumedBetween(events, p.id, lastCountDate || "", "", ["waste"]);
        const theoretical = theoreticalStock({ lastCounted: lastCountedQuantity, purchased, soldConsumed, wasted });
        out.push({
            id: p.id, name: p.name, category: p.category, subcategory: p.subcategory || "", unit_type: p.unit_type, pkg_size: p.pkg_size || 0,
            last_count_date: lastCountDate, last_counted_quantity: lastCountedQuantity,
            purchased_since: purchased, sold_since: soldConsumed, waste_since: wasted, theoretical_quantity: theoretical,
        });
    }
    return out;
}

export async function saveInventoryCounts(countDate, counts) {
    if (!countDate) throw new Error("יש לבחור תאריך ספירה");
    if (!counts || counts.length === 0) throw new Error("יש להזין כמות שנספרה לפחות למוצר אחד");
    // קודם מאמתים הכול, ורק אז כותבים בטרנזקציה אחת: ערך לא תקין באמצע לא משאיר ספירה חלקית (ושמירה חוזרת לא יוצרת כפילויות)
    const rows = [];
    for (const c of counts) {
        const pantryItemId = parseInt(c.pantry_item_id, 10);
        const countedQuantity = parseFloat(c.counted_quantity);
        if (Number.isNaN(pantryItemId) || Number.isNaN(countedQuantity)) throw new Error("נתוני ספירה לא תקינים");
        if (countedQuantity < 0) throw new Error("כמות שנספרה לא יכולה להיות שלילית");
        const item = await dbGet("pantryItems", pantryItemId);
        if (!item) throw new Error(`מוצר לא נמצא (מזהה ${pantryItemId})`);
        rows.push({ pantry_item_id: pantryItemId, count_date: countDate, counted_quantity: countedQuantity });
    }
    await dbAtomic(["inventoryCounts"], (t) => { for (const r of rows) t.objectStore("inventoryCounts").put(r); });
}
