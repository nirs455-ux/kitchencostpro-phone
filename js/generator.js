// מחולל מתכונים: הגדלה/הקטנה, עיגול נוח, והמרת יחידות (כוסות, אונקיות, ליברות...) לגרמים. טהור (בלי DOM/DB) כדי שאפשר לבדוק ב-Node.
// הכמויות נשמרות תמיד בגרמים. המרת נפח לגרמים תלויה בחומר (כוס קמח != כוס סוכר), לכן יש טבלת צפיפויות להערכה.
import { isEggProduct, eggSizeOf, allocateEggCosts, partGrams, EGG_PART_LABEL } from "./eggs.js";
import { effectivePrice } from "./formulas.js";

// יחידות: weight = גרמים ליחידה, volume = מ"ל ליחידה
export const UNITS = [
    { key: "g", label: "גרם", weight: 1 },
    { key: "kg", label: 'ק"ג', weight: 1000 },
    { key: "oz", label: "אונקיה (oz)", weight: 28.3495 },
    { key: "lb", label: "ליברה (lb)", weight: 453.592 },
    { key: "ml", label: 'מ"ל', volume: 1 },
    { key: "l", label: "ליטר", volume: 1000 },
    { key: "tsp", label: "כפית", volume: 4.929 },
    { key: "tbsp", label: "כף", volume: 14.787 },
    { key: "cup", label: "כוס (US)", volume: 236.588 },
    { key: "floz", label: "fl oz", volume: 29.5735 },
];
const UNIT_BY_KEY = Object.fromEntries(UNITS.map((u) => [u.key, u]));

// גרם למ"ל לפי חומר (הערכה: כוס קמח ~125 גרם, כוס סוכר ~200 וכו'). הספציפי ראשון.
export const DENSITIES = [
    { keys: ["אבקת סוכר", "powdered sugar", "icing sugar"], d: 0.507 },
    { keys: ["סוכר חום", "brown sugar"], d: 0.9 },
    { keys: ["סוכר", "sugar"], d: 0.845 },
    { keys: ["קמח תירס", "קורנפלור", "cornstarch"], d: 0.54 },
    { keys: ["קמח", "flour"], d: 0.529 },
    { keys: ["קקאו", "cocoa"], d: 0.36 },
    { keys: ["חמאה", "butter"], d: 0.96 },
    { keys: ["דבש", "honey"], d: 1.437 },
    { keys: ["סילאן", "מולסה", "מייפל", "syrup", "molasses"], d: 1.37 },
    { keys: ["שמן", "oil"], d: 0.92 },
    { keys: ["שמנת", "cream"], d: 1.01 },
    { keys: ["יוגורט", "yogurt"], d: 1.04 },
    { keys: ["טחינה", "tahini"], d: 1.01 },
    { keys: ["חלב", "milk"], d: 1.036 },
    { keys: ["אורז", "rice"], d: 0.78 },
    { keys: ["שיבולת שועל", "oats"], d: 0.38 },
    { keys: ["מלח", "salt"], d: 1.22 },
    { keys: ["מים", "water"], d: 1.0 },
];

// צפיפויות שהמשתמש קבע לעצמו (נשמרות פעם אחת לפי שם נקי של מוצר): { "קמח מלא": 0.5 } = גרם למ"ל. קודמות לטבלה.
let learned = {};
export const learnKey = (name) => String(name || "").toLowerCase().replace(/s+/g, " ").trim();
export function setLearnedDensities(obj) { learned = obj && typeof obj === "object" ? { ...obj } : {}; }
export function learnedDensityFor(name) {
    const n = learnKey(name);
    if (!n) return null;
    if (learned[n] > 0) return learned[n];
    const hit = Object.keys(learned).filter((k) => k && n.includes(k)).sort((a, b) => b.length - a.length)[0]; // "קמח מלא ביו" מזהה את "קמח מלא"
    return hit ? learned[hit] : null;
}
// כמה גרם יש ביחידת נפח אחת (כוס/כף/כפית) -> צפיפות בגרם למ"ל. null אם לא תקין
export function densityFromUnitGrams(unit, gramsPerUnit) {
    const u = UNIT_BY_KEY[unit];
    const g = Number(gramsPerUnit);
    if (!u || !u.volume || !(g > 0)) return null;
    return Math.round((g / u.volume) * 1e6) / 1e6;
}

export function densityFor(name) {
    const l = learnedDensityFor(name);
    if (l) return l;
    const n = String(name || "").toLowerCase();
    for (const e of DENSITIES) if (e.keys.some((k) => n.includes(k))) return e.d;
    return null;
}

// הערה למשתמש: מאיפה הצפיפות (ערך שהוא שמר / טבלה / לא זוהה)
function densityNote(name, d, tip) {
    if (d && learnedDensityFor(name)) return "לפי הערך ששמרת למוצר הזה";
    return d ? "הערכה לפי צפיפות ממוצעת של החומר" : `לא זוהה החומר - חושב כמו מים (1 גרם למ"ל). ${tip}`;
}

// ממיר כמות ביחידה כלשהי לגרמים. מחזיר { grams, estimated, note } או null אם לא תקין.
export function convertToGrams({ qty, unit, name }) {
    qty = Number(qty);
    const u = UNIT_BY_KEY[unit];
    if (!u || !(qty > 0)) return null;
    if (u.weight) return { grams: Math.round(qty * u.weight * 100) / 100, estimated: false, note: "" };
    const d = densityFor(name);
    const ml = qty * u.volume;
    return {
        grams: Math.round(ml * (d || 1) * 10) / 10,
        estimated: true,
        note: densityNote(name, d, "עדיף לשקול"),
    };
}

// עיגול נוח לשימוש במטבח
export function niceRound(g) {
    if (!(g > 0)) return 0;
    const step = g < 10 ? 0.5 : g < 100 ? 1 : g < 1000 ? 5 : 10;
    return Math.max(step, Math.round(g / step) * step);
}

// מקדם הגדלה: לפי משקל סופי רצוי או לפי מספר ישיר
export function factorFor({ mode, value, currentWeight }) {
    const v = Number(value);
    if (!(v > 0)) return null;
    if (mode === "weight" || mode === "ingredient") return currentWeight > 0 ? v / currentWeight : null; // currentWeight: המשקל הכולל, או הכמות הנוכחית של הרכיב שנבחר
    return v;
}

// items: [{ pantry_item_id, ingredient_name, quantity_g, item_cost, egg_part }], rows: שורות מזווה.
// מחזיר שורות מוגדלות עם כמות מעוגלת (אופציונלי) ועלות. עלות ביצים מחושבת מחדש: כל הביצים ששוברים * מחיר.
export function scaleRecipe(items, factor, rows, { round = true } = {}) {
    const byId = new Map(rows.map((r) => [r.id, r]));
    const out = items.map((i) => {
        const raw = Number(i.quantity_g) * factor;
        const grams = i.egg_part || i.unit_count ? Math.round(raw * 100) / 100 : round ? niceRound(raw) : Math.round(raw * 100) / 100; // יחידות בלי משקל: מספר יחידות, לא מעגלים לגרמים
        return { ...i, grams, cost: (Number(i.item_cost) || 0) * factor };
    });
    // ביצים: חישוב מחדש לפי הגרמים המוגדלים
    const groups = new Map();
    out.forEach((o, idx) => {
        const row = byId.get(Number(o.pantry_item_id));
        if (o.egg_part && isEggProduct(row)) groups.set(row.id, [...(groups.get(row.id) || []), idx]);
    });
    const eggs = [];
    for (const [id, idxs] of groups) {
        const row = byId.get(id);
        const size = eggSizeOf(row);
        const { costs, breakdown } = allocateEggCosts(idxs.map((k) => ({ egg_part: out[k].egg_part, grams: out[k].grams })), size, effectivePrice(row.price, row.yield_pct, row.is_frozen));
        idxs.forEach((k, j) => {
            out[k].cost = costs[j];
            out[k].eggUnits = Math.round((out[k].grams / partGrams(size, out[k].egg_part)) * 10) / 10;
            out[k].eggLabel = EGG_PART_LABEL[out[k].egg_part];
        });
        if (breakdown) eggs.push({ name: row.name, ...breakdown });
    }
    return {
        rows: out,
        totalGrams: Math.round(out.reduce((n, o) => n + (o.unit_count ? 0 : o.grams), 0) * 100) / 100,
        totalCost: Math.round(out.reduce((n, o) => n + o.cost, 0) * 100) / 100,
        eggs,
    };
}

// עיצוב כמות: גרמים, ומעל 1000 גם בק"ג
export function fmtQty(g) {
    const n = Math.round(g * 100) / 100;
    return n >= 1000 ? `${n} גרם (${+(n / 1000).toFixed(2)} ק"ג)` : `${n} גרם`;
}

// המרה כמו ממיר מטבעות: מיחידה אחת לאחרת. משקל<->משקל ונפח<->נפח מדויקים; משקל<->נפח דורש צפיפות (הערכה לפי שם החומר).
// מחזיר { value, estimated, note } או null אם לא תקין.
export function convertUnits({ qty, from, to, name }) {
    qty = Number(qty);
    const a = UNIT_BY_KEY[from];
    const b = UNIT_BY_KEY[to];
    if (!a || !b || !(qty > 0)) return null;
    const round = (n) => Math.round(n * 1000) / 1000;
    if (a.weight && b.weight) return { value: round((qty * a.weight) / b.weight), estimated: false, note: "" };
    if (a.volume && b.volume) return { value: round((qty * a.volume) / b.volume), estimated: false, note: "" };
    const d = densityFor(name);
    const dens = d || 1;
    const note = densityNote(name, d, "הקלד חומר כמו קמח או סוכר");
    if (a.volume) return { value: round((qty * a.volume * dens) / b.weight), estimated: true, note };
    return { value: round((qty * a.weight) / dens / b.volume), estimated: true, note };
}
