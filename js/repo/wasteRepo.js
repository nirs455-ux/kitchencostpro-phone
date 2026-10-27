// רישום פחת. כל רישום שומר תמונת מצב של השם והעלות בזמן הרישום (כך שינוי מחיר אחר כך לא משנה היסטוריה).
import { dbGetAll, dbGet, dbPut, dbDelete } from "../db.js";
import { pantryWasteCost, recipeWasteCost, REASON_LABEL, WASTE_UNITS } from "../waste.js";

const todayIso = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export { todayIso };

// data: { source_type: "pantry" | "recipe", source_id, qty, unit, reason, note, by, date }
export async function addWaste(data) {
    const qty = parseFloat(data.qty);
    if (!(qty > 0)) throw new Error("יש להזין כמות גדולה מ-0");
    if (!REASON_LABEL[data.reason]) throw new Error("יש לבחור סיבה");
    const id = parseInt(data.source_id, 10);
    if (Number.isNaN(id)) throw new Error("יש לבחור מוצר או מתכון");
    let name, cost, unitType;
    if (data.source_type === "recipe") {
        const r = await dbGet("recipes", id);
        if (!r) throw new Error("המתכון לא נמצא");
        name = r.name; cost = recipeWasteCost(r, qty, data.unit); unitType = "recipe";
    } else {
        const p = await dbGet("pantryItems", id);
        if (!p) throw new Error("המוצר לא נמצא");
        name = p.name; cost = pantryWasteCost(p, qty, data.unit); unitType = p.unit_type;
    }
    if (!(WASTE_UNITS[unitType] || []).some(([u]) => u === data.unit)) throw new Error("יחידת מידה לא מתאימה");
    if (cost == null) throw new Error("לא ניתן לחשב עלות לרישום הזה");
    const row = {
        date: data.date || todayIso(), created_at: new Date().toISOString(),
        source_type: data.source_type === "recipe" ? "recipe" : "pantry", source_id: id, name,
        qty, unit: data.unit, cost, reason: data.reason, note: (data.note || "").trim(), by: (data.by || "").trim(),
    };
    return dbPut("wasteLogs", row);
}

export async function listWaste(fromDate = "") {
    const all = await dbGetAll("wasteLogs");
    return all.filter((l) => !fromDate || l.date >= fromDate).sort((a, b) => b.date.localeCompare(a.date) || (b.created_at || "").localeCompare(a.created_at || ""));
}

export async function deleteWaste(id) {
    const row = await dbGet("wasteLogs", id);
    await dbDelete("wasteLogs", id);
    return row;
}

export async function restoreWaste(row) {
    await dbPut("wasteLogs", row);
}

// סך הקניות מחשבוניות (בלי זיכויים ובלי פח) מתאריך מסוים - למכנה של אחוז הפחת
export async function purchasesSince(fromDate = "") {
    let total = 0;
    for (const inv of await dbGetAll("invoices")) {
        if (inv.deleted_at) continue;
        if (fromDate && (inv.invoice_date || "") < fromDate) continue;
        total += inv.document_type === "credit" ? -inv.total_amount : inv.total_amount;
    }
    return Math.max(0, Math.round(total * 100) / 100);
}
