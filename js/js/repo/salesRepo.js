// דוח מכירות: שמירה, רשימה, מחיקה, ייבוא CSV, ודוח פער (עלות בפועל מול תיאורטית). הלוגיקה עצמה ב-salesCalc.js (טהור).
import { dbGetAll, dbGet, dbPut, dbDelete } from "../db.js";
import { SALES_LINE_TYPES, SALES_LINE_LABELS, consumptionEvents, gapReport, parseSalesCsv } from "../salesCalc.js";

const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
export { todayIso };

// טוען פעם אחת את כל מה שנדרש לפירוק מכירות (מוצרים, מתכונים, מנות)
export async function loadSalesCtx() {
    const [pantry, recipes, recipeItems, dishes, dishItems] = await Promise.all([dbGetAll("pantryItems"), dbGetAll("recipes"), dbGetAll("recipeItems"), dbGetAll("dishes"), dbGetAll("dishItems")]);
    const group = (rows, key) => { const m = new Map(); for (const r of rows) { if (!m.has(r[key])) m.set(r[key], []); m.get(r[key]).push(r); } return m; };
    return { pantry: new Map(pantry.map((p) => [p.id, p])), recipes: new Map(recipes.map((r) => [r.id, r])), recipeItems: group(recipeItems, "recipe_id"), dishes: new Map(dishes.map((d) => [d.id, d])), dishItems: group(dishItems, "dish_id") };
}

// lines: [{ source_type: dish|recipe, source_id, quantity, line_type }]. שומר הכול או כלום (מאמת קודם).
export async function addSalesReport(date, lines) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))) throw new Error("יש להזין תאריך");
    if (!lines || !lines.length) throw new Error("יש להוסיף לפחות שורה אחת");
    const rows = [];
    for (const [i, l] of lines.entries()) {
        const where = `שורה ${i + 1}`;
        if (l.source_type !== "dish" && l.source_type !== "recipe") throw new Error(`${where}: סוג פריט לא תקין (מנה/מתכון)`);
        const id = parseInt(l.source_id, 10);
        const qty = parseFloat(String(l.quantity).replace(",", "."));
        if (Number.isNaN(id) || Number.isNaN(qty)) throw new Error(`${where}: כמות/פריט לא תקינים`);
        if (!(qty > 0)) throw new Error(`${where}: כמות חייבת להיות גדולה מ-0`);
        if (qty > 100000) throw new Error(`${where}: הכמות גבוהה מדי - בדוק שלא הוזן מספר שגוי`);
        if (!SALES_LINE_TYPES.includes(l.line_type)) throw new Error(`${where}: סוג שורה לא תקין`);
        const src = await dbGet(l.source_type === "dish" ? "dishes" : "recipes", id);
        if (!src) throw new Error(`${where}: המנה/המתכון לא נמצאו`);
        rows.push({ report_date: date, source_type: l.source_type, source_id: id, source_name: src.name, quantity: qty, line_type: l.line_type });
    }
    for (const r of rows) await dbPut("salesLines", r);
    return rows.length;
}

// ייבוא שורות מוכנות (מ-CSV שכבר נותח). אימות מלא לפני כתיבה.
export async function importSalesLines(lines) {
    let n = 0;
    const byDate = new Map();
    for (const l of lines) { if (!byDate.has(l.report_date)) byDate.set(l.report_date, []); byDate.get(l.report_date).push(l); }
    for (const [date, ls] of byDate) n += await addSalesReport(date, ls);
    return n;
}

export async function listSalesLines() {
    return (await dbGetAll("salesLines")).sort((a, b) => b.report_date.localeCompare(a.report_date) || b.id - a.id);
}

export async function deleteSalesLine(id) {
    const row = await dbGet("salesLines", id);
    await dbDelete("salesLines", id);
    return row;
}
export async function restoreSalesLine(row) { await dbPut("salesLines", row); }

export async function parseCsvForDishes(text) {
    const dishes = (await dbGetAll("dishes")).map((d) => ({ id: d.id, name: d.name }));
    return parseSalesCsv(text, dishes);
}

// קניות מחשבוניות ביחידות קנייה (זיכוי שלילי, בלי חשבוניות בפח) בפורמט של gapReport
async function purchasesList() {
    const invoices = new Map((await dbGetAll("invoices")).filter((i) => !i.deleted_at).map((i) => [i.id, i]));
    const out = [];
    for (const it of await dbGetAll("invoiceItems")) {
        const inv = invoices.get(it.invoice_id);
        if (!inv || !it.pantry_item_id) continue;
        const q = (Number(it.quantity) || 0) * (it.stock_factor ?? 1);
        out.push({ pantry_item_id: it.pantry_item_id, date: inv.invoice_date || "", qty: inv.document_type === "credit" ? -q : q });
    }
    return out;
}

// דוח פער לתקופה (from, to]: מחשב עלות בפועל (ספירה + קניות - ספירה) מול תיאורטית (מכירות + פחת)
export async function buildGapReport(from, to) {
    if (!from || !to || from >= to) throw new Error("בחר תאריך התחלה וסיום, כשההתחלה לפני הסיום");
    const ctx = await loadSalesCtx();
    const salesLines = await dbGetAll("salesLines");
    const events = consumptionEvents(salesLines, await dbGetAll("wasteLogs"), ctx);
    const products = [...ctx.pantry.values()].filter((p) => !p.parent_id);
    const counts = await dbGetAll("inventoryCounts");
    const report = gapReport({ from, to, products, counts, purchases: await purchasesList(), events, salesLines, dishes: ctx.dishes });
    return { ...report, salesCount: salesLines.filter((l) => l.report_date > from && l.report_date <= to).length };
}

export { SALES_LINE_TYPES, SALES_LINE_LABELS };
