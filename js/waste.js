// פחת: חישוב עלות רישום וסיכום לדוח. טהור (בלי DOM/DB) כדי שאפשר לבדוק אותו ב-Node.
// עלות מוצר שנזרק: מוצר ברמה העליונה לפי מחיר הקנייה (זרקו את הגולמי), תוצר מפורק לפי מחיר אמיתי אחרי ניצולת,
// ומתכון שהוכן לפי עלות לגרם. לא נוגעים בנוסחאות התמחור - רק קוראים ממחיר שכבר קיים.
import { effectivePrice } from "./formulas.js";

export const WASTE_REASONS = [
    { key: "expired", label: "פג תוקף" },
    { key: "spoiled", label: "התקלקל" },
    { key: "spilled", label: "נשפך / נפל" },
    { key: "leftover", label: "שארית שלא נוצלה" },
    { key: "other", label: "אחר" },
];
export const REASON_LABEL = Object.fromEntries(WASTE_REASONS.map((r) => [r.key, r.label]));

// יחידות הזנה לפי סוג המוצר
export const WASTE_UNITS = {
    weight: [["kg", 'ק"ג'], ["g", "גרם"]],
    liter: [["l", "ליטר"], ["ml", 'מ"ל']],
    unit: [["unit", "יחידות"]],
    recipe: [["kg", 'ק"ג'], ["g", "גרם"]],
};

const round2 = (x) => Math.round(x * 100) / 100;

// row: שורת חומרי גלם; qty: כמות בהזנה; unit: g | kg | ml | l | unit. מחזיר עלות או null אם אי אפשר לחשב.
export function pantryWasteCost(row, qty, unit) {
    qty = Number(qty);
    if (!row || !(qty > 0)) return null;
    const perUnitPrice = row.parent_id ? effectivePrice(row.price, row.yield_pct, row.is_frozen) : Number(row.price);
    if (!Number.isFinite(perUnitPrice)) return null;
    if (row.unit_type === "unit") return unit === "unit" ? round2(qty * perUnitPrice) : null;
    // weight / liter: המחיר לק"ג או לליטר
    if (unit === "g" || unit === "ml") return round2((qty / 1000) * perUnitPrice);
    if (unit === "kg" || unit === "l") return round2(qty * perUnitPrice);
    return null;
}

export function recipeWasteCost(recipe, qty, unit) {
    qty = Number(qty);
    if (!recipe || !(qty > 0)) return null;
    const grams = unit === "kg" ? qty * 1000 : qty;
    return round2((Number(recipe.cost_per_gram) || 0) * grams);
}

// תחילת תקופה (תאריך YYYY-MM-DD) לפי מצב: today | week | month | all. now ניתן להזרקה לבדיקות.
export function periodStart(mode, now = new Date()) {
    const d = new Date(now);
    const iso = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
    if (mode === "today") return iso(d);
    if (mode === "week") { d.setDate(d.getDate() - 6); return iso(d); }
    if (mode === "month") { d.setDate(1); return iso(d); }
    return "";
}

// סיכום לדוח: logs = רישומי פחת, purchasesTotal = סך קניות באותה תקופה (לחישוב אחוז פחת)
// כל מה שנזרק הוא הפסד.
export function summarizeWaste(logs, purchasesTotal = 0) {
    const total = round2(logs.reduce((n, l) => n + (Number(l.cost) || 0), 0));
    const byReason = new Map();
    const byItem = new Map();
    for (const l of logs) {
        const c = Number(l.cost) || 0;
        byReason.set(l.reason, round2((byReason.get(l.reason) || 0) + c));
        const k = l.name;
        const cur = byItem.get(k) || { name: k, cost: 0, count: 0 };
        cur.cost = round2(cur.cost + c);
        cur.count += 1;
        byItem.set(k, cur);
    }
    return {
        total, count: logs.length,
        pctOfPurchases: purchasesTotal > 0 ? Math.round((total / purchasesTotal) * 1000) / 10 : null,
        byReason: [...byReason.entries()].map(([reason, cost]) => ({ reason, cost })).sort((a, b) => b.cost - a.cost),
        topItems: [...byItem.values()].sort((a, b) => b.cost - a.cost).slice(0, 5),
    };
}
