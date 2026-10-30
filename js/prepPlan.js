// תכנון הכנות והזמנות: כמה מנות להכין ואילו חומרי גלם להזמין, לפי מספר סועדים / מנות, עם מרווח ביטחון.
// טהור (בלי DOM/DB). הפירוק לחומרי גלם הוא בדיוק הפירוק של דוח המכירות (explodeSale), כולל ניצולת, קרח, תת-מתכונים וביצים.
// לא נוגעים בנוסחאות התמחור: כאן רק הכפלת כמויות.
import { explodeSale } from "./salesCalc.js";

export const DEFAULT_MARGIN_PCT = 10;

const num = (v) => { const n = parseFloat(String(v == null ? "" : v).replace(",", ".")); return Number.isFinite(n) ? n : 0; };
const ceilTo = (n, step) => Math.ceil(Math.round((n / step) * 1e6) / 1e6) * step;
const round3 = (n) => Math.round(n * 1000) / 1000;

// כמה מנות: סועדים x אחוז שבוחרים את המנה x מנות לסועד (מעוגל כלפי מעלה, כדי לא להכין פחות)
export function portionsFor(guests, sharePct, perGuest = 1) {
    const g = num(guests), s = num(sharePct), p = num(perGuest) || 1;
    if (!(g > 0) || !(s > 0)) return 0;
    return Math.ceil(Math.round(g * (s / 100) * p * 1e6) / 1e6);
}

// פריט בתפריט -> כמות כוללת: סועדים x כמות ממוצעת לסועד (מנות לסועד, או גרם לסועד למתכון) x אחוז הסועדים שבוחרים בו
export function entryQuantity(guests, perGuest, sharePct = 100) {
    const g = num(guests), p = num(perGuest), s = sharePct === "" || sharePct == null ? 100 : num(sharePct);
    if (!(g > 0) || !(p > 0) || !(s > 0)) return 0;
    return Math.round(g * p * (s / 100) * 1e6) / 1e6;
}

// entries: [{ source_type: "dish"|"recipe", source_id, quantity }] (מנה: מספר מנות. מתכון: גרם)
// ctx: כמו ב-loadSalesCtx. מחזיר:
//   dishes: [{ id, name, portions }]  (עם מרווח הביטחון, מעוגל למעלה)
//   recipes: { id: גרם }  (מתכונים שצריך להכין, כולל תת-מתכונים)
//   pantry: { id ראשי: יחידות קנייה (ק"ג / ליטר / יחידות) }  (מעוגל למעלה)
//   foodGrams: סך גרמי האוכל המוגש (בלי מרווח)
export function planPrep(entries, ctx, marginPct = DEFAULT_MARGIN_PCT) {
    const factor = 1 + Math.max(0, num(marginPct)) / 100;
    const pantry = {}, recipes = {};
    const dishes = new Map();
    let foodGrams = 0;
    for (const e of entries || []) {
        const qty = num(e.quantity);
        if (!(qty > 0)) continue;
        const sale = explodeSale({ source_type: e.source_type, source_id: e.source_id, quantity: qty * factor }, ctx);
        for (const [id, u] of Object.entries(sale.pantry)) pantry[id] = (pantry[id] || 0) + u;
        for (const [id, g] of Object.entries(sale.recipes)) recipes[id] = (recipes[id] || 0) + g;
        if (e.source_type === "recipe") foodGrams += qty;
        else {
            const d = ctx.dishes.get(e.source_id);
            const per = (ctx.dishItems.get(e.source_id) || []).reduce((s, it) => s + (Number(it.quantity_g) || 0), 0);
            foodGrams += per * qty;
            const cur = dishes.get(e.source_id) || { id: e.source_id, name: d ? d.name : "", portions: 0 };
            cur.portions += qty * factor;
            dishes.set(e.source_id, cur);
        }
    }
    const outPantry = {};
    for (const [id, u] of Object.entries(pantry)) {
        const row = ctx.pantry.get(Number(id));
        outPantry[id] = row && row.unit_type === "unit" ? Math.ceil(round3(u)) : ceilTo(round3(u), 0.01);
    }
    const outRecipes = {};
    for (const [id, g] of Object.entries(recipes)) outRecipes[id] = Math.ceil(round3(g));
    return {
        dishes: [...dishes.values()].map((d) => ({ ...d, portions: Math.ceil(round3(d.portions)) })),
        recipes: outRecipes, pantry: outPantry, foodGrams: Math.round(foodGrams),
    };
}

const BASE_UNIT = { weight: 'ק"ג', liter: "ליטר", unit: "יח'" };

// מחלק את חומרי הגלם לספקים לפי רשימות ההזמנה הקבועות שלהם (שורה שמקושרת לחומר הגלם).
// שורה עם stock_factor (ארגז/אריזה) מחושבת באריזות שלמות כלפי מעלה. חומר גלם בלי ספק -> קבוצה "ללא ספק".
// מחזיר [{ supplier: שורת ספק | null, lines: [{ id, name, units, unit, pack: { count, factor } | null }] }]
export function groupBySupplier(pantryUnits, pantryMap, suppliers) {
    const owner = new Map(); // מזהה חומר גלם -> { supplier, line }
    for (const s of [...(suppliers || [])].sort((a, b) => String(a.name).localeCompare(String(b.name), "he"))) {
        for (const l of s.order_list || []) {
            const pid = l.pantry_item_id;
            if (!pid) continue;
            const prev = owner.get(pid);
            if (!prev || (!prev.line.stock_factor && l.stock_factor)) owner.set(pid, { supplier: s, line: l });
        }
    }
    const groups = new Map();
    for (const [idStr, units] of Object.entries(pantryUnits)) {
        const id = Number(idStr);
        const row = pantryMap.get(id);
        if (!row) continue;
        const own = owner.get(id);
        const key = own ? own.supplier.id : "none";
        const g = groups.get(key) || { supplier: own ? own.supplier : null, lines: [] };
        const f = own && Number(own.line.stock_factor) > 1 ? Number(own.line.stock_factor) : 0;
        g.lines.push({ id, name: row.name, units, unit: BASE_UNIT[row.unit_type] || "", pack: f ? { count: Math.ceil(round3(units / f)), factor: f } : null });
        groups.set(key, g);
    }
    const out = [...groups.values()];
    for (const g of out) g.lines.sort((a, b) => a.name.localeCompare(b.name, "he"));
    return out.sort((a, b) => (a.supplier ? 0 : 1) - (b.supplier ? 0 : 1) || String(a.supplier && a.supplier.name).localeCompare(String(b.supplier && b.supplier.name), "he"));
}
