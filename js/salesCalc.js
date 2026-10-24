// מכירות וצריכה תיאורטית: פירוק שורות מכירה (ופחת) לחומרי גלם, מלאי תיאורטי, ודוח פער (עלות בפועל מול תיאורטית).
// טהור (בלי DOM/DB) כדי שאפשר לבדוק ב-Node. תרגום מהאפליקציה הישנה (explode_sales_line / consumption_events), בתוספת תת-מתכונים, ביצים ופחת.
// לא נוגעים בנוסחאות התמחור: כאן רק פירוק כמויות, והעלות נלקחת ממחיר הקנייה שכבר קיים.
import { ICE_GLAZE_DEDUCTION } from "./formulas.js";
import { flattenRecipeItems } from "./repo/subRecipes.js";
import { isEggProduct, eggSizeOf, partGrams } from "./eggs.js";

export const SALES_LINE_TYPES = ["sold", "staff_meal", "cancelled_returned", "cancelled_consumed"];
export const SALES_LINE_LABELS = { sold: "נמכר", staff_meal: "ארוחת צוות", cancelled_returned: "בוטל - חזר למלאי", cancelled_consumed: "בוטל - נצרך/נזרק" };
// שורות שצורכות חומר גלם. "בוטל - חזר למלאי" לא צורך כלום.
export const CONSUMING_TYPES = new Set(["sold", "staff_meal", "cancelled_consumed"]);

const round3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// גורם הניצולת והקרח של מוצר (כמו effectivePrice, אך כגורם): גרם שמיש -> גרם גולמי שנקנה
function yieldIceFactor(row) {
    let y = (Number(row.yield_pct) || 100) / 100;
    if (y <= 0) y = 1;
    return y * (row.is_frozen ? 1 - ICE_GLAZE_DEDUCTION : 1);
}

// גרמים "שמישים" של מוצר -> כמות ביחידת הקנייה שלו (ק"ג / ליטר / יחידות)
export function gramsToPurchaseUnits(row, grams) {
    const raw = grams / yieldIceFactor(row);
    if (row.unit_type === "weight" || row.unit_type === "liter") return raw / 1000;
    return raw / (Number(row.unit_amount) || 1);
}

// ctx: { pantry: Map(id->שורה), recipes: Map, recipeItems: Map(recipeId->שורות), dishes: Map, dishItems: Map(dishId->שורות) }
const topId = (row) => row.parent_id || row.id;

function addUnits(out, id, units) { out[id] = (out[id] || 0) + units; }

// מפרק גרמים של מתכון (לפי משקל סופי) לחומרי גלם ביחידות קנייה. תת-מתכונים נפרשים לרכיביהם.
function explodeRecipe(ctx, recipeId, grams, pantryOut) {
    const recipe = ctx.recipes.get(recipeId);
    if (!recipe || !(Number(recipe.final_weight) > 0) || !(grams > 0)) return;
    const factor = grams / recipe.final_weight; // אותה חלוקה במשקל הסופי שבה עלות לגרם מחושבת
    const rows = ctx.recipeItems.get(recipeId) || [];
    const flat = flattenRecipeItems(rows, ctx.recipes, (id) => ctx.recipeItems.get(id) || []);
    const eggs = new Map(); // מזהה ביצה -> { white, yolk } בגרמים. חלבון וחלמון מאותן ביצים, ולכן לוקחים את המקסימום
    for (const it of flat) {
        const row = it.pantry_item_id != null ? ctx.pantry.get(it.pantry_item_id) : null;
        if (!row) continue;
        const g = (Number(it.quantity_g) || 0) * factor;
        if (isEggProduct(row) && (it.egg_part === "white" || it.egg_part === "yolk")) {
            const acc = eggs.get(row.id) || { white: 0, yolk: 0, row };
            acc[it.egg_part] += g;
            eggs.set(row.id, acc);
            continue;
        }
        addUnits(pantryOut, topId(row), gramsToPurchaseUnits(row, g));
    }
    for (const acc of eggs.values()) {
        const size = eggSizeOf(acc.row);
        const units = Math.max(acc.white / partGrams(size, "white"), acc.yolk / partGrams(size, "yolk"));
        addUnits(pantryOut, topId(acc.row), units);
    }
}

// מפרק שורת מכירה: מחזיר { pantry: {מזהה ראשי: יחידות קנייה}, recipes: {מזהה: גרם} }
// מנה: quantity = מספר מנות. מתכון שנמכר ישירות: quantity = גרם.
export function explodeSale(line, ctx) {
    const pantry = {}, recipes = {};
    const qty = Number(line.quantity) || 0;
    if (!(qty > 0)) return { pantry, recipes };
    if (line.source_type === "recipe") {
        recipes[line.source_id] = (recipes[line.source_id] || 0) + qty;
        explodeRecipe(ctx, line.source_id, qty, pantry);
    } else {
        for (const it of ctx.dishItems.get(line.source_id) || []) {
            const grams = (Number(it.quantity_g) || 0) * qty;
            if (it.source_type === "pantry") {
                const row = ctx.pantry.get(it.source_id);
                if (row) addUnits(pantry, topId(row), gramsToPurchaseUnits(row, grams));
            } else if (it.source_type === "recipe") {
                recipes[it.source_id] = (recipes[it.source_id] || 0) + grams;
                explodeRecipe(ctx, it.source_id, grams, pantry);
            }
        }
    }
    return { pantry, recipes };
}

// פחת כצריכה: מוצר מזווה לפי כמות (יחידות הקנייה), מתכון שהוכן נפרש לחומרי הגלם שלו
export function explodeWaste(log, ctx) {
    const pantry = {}, recipes = {};
    const qty = Number(log.qty) || 0;
    if (!(qty > 0)) return { pantry, recipes };
    if (log.source_type === "recipe") {
        const grams = log.unit === "kg" ? qty * 1000 : qty;
        recipes[log.source_id] = grams;
        explodeRecipe(ctx, log.source_id, grams, pantry);
        return { pantry, recipes };
    }
    const row = ctx.pantry.get(log.source_id);
    if (!row) return { pantry, recipes };
    if (row.parent_id) { // תוצר מפורק שנזרק: גרמים שמישים -> חומר הגלם הראשי
        const grams = log.unit === "kg" || log.unit === "l" ? qty * 1000 : qty;
        addUnits(pantry, topId(row), gramsToPurchaseUnits(row, grams));
    } else if (row.unit_type === "unit") addUnits(pantry, row.id, qty);
    else addUnits(pantry, row.id, log.unit === "g" || log.unit === "ml" ? qty / 1000 : qty);
    return { pantry, recipes };
}

// כל אירועי הצריכה: [{ date, kind: "sale"|"waste", type, pantry, recipes, line }] ממוינים לפי תאריך
export function consumptionEvents(salesLines, wasteLogs, ctx) {
    const events = [];
    for (const l of salesLines || []) {
        if (!CONSUMING_TYPES.has(l.line_type)) continue;
        const e = explodeSale(l, ctx);
        events.push({ date: l.report_date, kind: "sale", type: l.line_type, ...e, line: l });
    }
    for (const w of wasteLogs || []) {
        const e = explodeWaste(w, ctx);
        events.push({ date: w.date, kind: "waste", type: "waste", ...e, line: w });
    }
    return events.sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

// צריכה של מוצר ראשי בין תאריכים: after בלעדי (אחרי ספירה), upto כולל. kinds: אילו סוגים לכלול (ברירת מחדל: הכול)
export function consumedBetween(events, pantryId, after = "", upto = "", kinds = null) {
    let total = 0;
    for (const e of events) {
        if (kinds && !kinds.includes(e.kind)) continue;
        if (after && !(e.date > after)) continue;
        if (upto && e.date > upto) continue;
        total += e.pantry[pantryId] || 0;
    }
    return round3(total);
}

// מלאי תיאורטי = ספירה אחרונה + קניות - צריכה (מכירות) - פחת, מאז הספירה
export function theoreticalStock({ lastCounted = 0, purchased = 0, soldConsumed = 0, wasted = 0 }) {
    return round3(lastCounted + purchased - soldConsumed - wasted);
}

// ---- דוח פער: עלות בפועל מול תיאורטית לתקופה (from, to] ----
// products: שורות מזווה ראשיות; counts: [{pantry_item_id, count_date, counted_quantity}]; purchases: [{pantry_item_id, date, qty}] (ביחידות קנייה, זיכוי שלילי)
// events: מ-consumptionEvents; salesLines: שורות מכירה; dishes: Map(id->מנה) לחישוב הכנסה (price_before_vat)
export function gapReport({ from, to, products, counts, purchases, events, salesLines, dishes }) {
    const byProd = new Map();
    for (const c of counts) { if (!byProd.has(c.pantry_item_id)) byProd.set(c.pantry_item_id, []); byProd.get(c.pantry_item_id).push(c); }
    const rows = [];
    const missing = [];
    for (const p of products) {
        const list = (byProd.get(p.id) || []).sort((a, b) => String(a.count_date).localeCompare(String(b.count_date)) || (a.id || 0) - (b.id || 0));
        const start = [...list].reverse().find((c) => c.count_date <= from);
        const end = [...list].reverse().find((c) => c.count_date <= to && (!start || c.count_date > start.count_date));
        if (!start || !end) { missing.push(p); continue; }
        const bought = purchases.filter((x) => x.pantry_item_id === p.id && x.date > start.count_date && x.date <= end.count_date).reduce((n, x) => n + x.qty, 0);
        const actual = round3(start.counted_quantity + bought - end.counted_quantity);
        const sales = consumedBetween(events, p.id, start.count_date, end.count_date, ["sale"]);
        const waste = consumedBetween(events, p.id, start.count_date, end.count_date, ["waste"]);
        const theoretical = round3(sales + waste);
        const price = Number(p.price) || 0;
        rows.push({ id: p.id, name: p.name, unit_type: p.unit_type, start: start.count_date, end: end.count_date, actual, sales, waste, theoretical, gap: round3(actual - theoretical), actualCost: round2(actual * price), theoreticalCost: round2(theoretical * price), gapValue: round2((actual - theoretical) * price) });
    }
    let revenue = 0, unpricedUnits = 0;
    for (const l of salesLines) {
        if (l.line_type !== "sold" || l.report_date <= from || l.report_date > to) continue;
        const d = l.source_type === "dish" ? dishes.get(l.source_id) : null;
        if (d && Number(d.price_before_vat) > 0) revenue += (Number(l.quantity) || 0) * Number(d.price_before_vat);
        else unpricedUnits += 1;
    }
    const totals = {
        revenue: round2(revenue), unpricedLines: unpricedUnits,
        actualCost: round2(rows.reduce((n, r) => n + r.actualCost, 0)),
        theoreticalCost: round2(rows.reduce((n, r) => n + r.theoreticalCost, 0)),
        gapValue: round2(rows.reduce((n, r) => n + r.gapValue, 0)),
    };
    totals.actualPct = revenue > 0 ? round2((totals.actualCost / revenue) * 100) : null;
    totals.theoreticalPct = revenue > 0 ? round2((totals.theoreticalCost / revenue) * 100) : null;
    rows.sort((a, b) => Math.abs(b.gapValue) - Math.abs(a.gapValue));
    return { rows, missing, totals };
}

// ---- CSV: תאריך,שם מנה,כמות[,סוג] ----
const TYPE_ALIASES = { sold: "sold", "נמכר": "sold", "מכירה": "sold", staff: "staff_meal", staff_meal: "staff_meal", "צוות": "staff_meal", "ארוחת צוות": "staff_meal", returned: "cancelled_returned", cancelled_returned: "cancelled_returned", "בוטל חזר": "cancelled_returned", "ביטול חזר": "cancelled_returned", consumed: "cancelled_consumed", cancelled_consumed: "cancelled_consumed", "בוטל נצרך": "cancelled_consumed", "ביטול נצרך": "cancelled_consumed" };
const normName = (s) => String(s || "").toLowerCase().replace(/["'`׳״]/g, "").replace(/\s+/g, " ").trim();

function splitCsvLine(line) {
    const out = [];
    let cur = "", inQ = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQ) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') inQ = false; else cur += ch; }
        else if (ch === '"') inQ = true;
        else if (ch === "," || ch === "\t" || ch === ";") { out.push(cur); cur = ""; }
        else cur += ch;
    }
    out.push(cur);
    return out.map((x) => x.trim());
}

// תאריך מקובל: YYYY-MM-DD, DD/MM/YYYY, DD.MM.YYYY, DD-MM-YYYY (או DD/MM/YY)
export function parseDateFlexible(s) {
    const t = String(s || "").trim();
    let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    let y, mo, d;
    if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
    else if ((m = t.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/))) { d = +m[1]; mo = +m[2]; y = +m[3]; if (y < 100) y += 2000; }
    else return "";
    const dt = new Date(y, mo - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return "";
    return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// מנתח טקסט CSV של מכירות. dishes: [{id, name}]. מחזיר { lines, unmatched, bad } (lines: מוכנות לשמירה)
export function parseSalesCsv(text, dishes) {
    const byName = new Map(dishes.map((d) => [normName(d.name), d]));
    const lines = [], unmatched = [], bad = [];
    const rows = String(text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    rows.forEach((row, idx) => {
        const cols = splitCsvLine(row);
        const date = parseDateFlexible(cols[0]);
        if (!date) { if (idx === 0) return; /* כותרת */ bad.push(`שורה ${idx + 1}: תאריך לא תקין`); return; }
        const dish = byName.get(normName(cols[1]));
        const qty = parseFloat(String(cols[2] || "").replace(",", "."));
        if (!(qty > 0)) { bad.push(`שורה ${idx + 1}: כמות לא תקינה`); return; }
        const type = cols[3] ? TYPE_ALIASES[normName(cols[3])] || TYPE_ALIASES[cols[3].trim()] : "sold";
        if (!type) { bad.push(`שורה ${idx + 1}: סוג לא מוכר "${cols[3]}"`); return; }
        if (!dish) { unmatched.push(cols[1] || "(ריק)"); return; }
        lines.push({ report_date: date, source_type: "dish", source_id: dish.id, source_name: dish.name, quantity: qty, line_type: type });
    });
    return { lines, unmatched: [...new Set(unmatched)], bad };
}
