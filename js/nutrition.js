// ערכים תזונתיים למתכון: חישוב מרכיבים (ל-100 גרם מוצר) ופירוש תשובות ממאגרים (USDA, Open Food Facts). טהור (בלי DOM/DB/רשת).
// הערכים הם הערכה. אין כאן התחשבות באיבוד/שינוי ערכים בבישול (רק משקל סופי אחרי בישול), ולתיוג רשמי נדרשת בדיקה מקצועית.

export const NUTRIENTS = [
    { key: "kcal", label: 'אנרגיה (קק"ל)', short: 'קק"ל', dec: 0 },
    { key: "fat", label: "שומן (גרם)", short: "שומן", dec: 1 },
    { key: "sat", label: "מזה רווי (גרם)", short: "רווי", dec: 1 },
    { key: "carbs", label: "פחמימות (גרם)", short: "פחמימות", dec: 1 },
    { key: "sugars", label: "מזה סוכרים (גרם)", short: "סוכרים", dec: 1 },
    { key: "protein", label: "חלבון (גרם)", short: "חלבון", dec: 1 },
    { key: "sodium", label: 'נתרן (מ"ג)', short: "נתרן", dec: 0 },
];

const round = (n, dec) => { const f = 10 ** dec; return Math.round((Number(n) || 0) * f) / f; };
const numOrNull = (x) => { if (x == null || x === "") return null; const n = Number(x); return Number.isFinite(n) && n >= 0 ? n : null; };

// ---- USDA FoodData Central: תשובת /foods/search ----
const USDA_NUM = { 204: "fat", 606: "sat", 205: "carbs", 203: "protein", 307: "sodium" };
export function parseUsdaFoods(json) {
    const out = [];
    for (const f of (json && json.foods) || []) {
        const per100 = {};
        let kcal957 = null;
        for (const n of f.foodNutrients || []) {
            const num = String(n.nutrientNumber || n.nutrientId || "");
            const v = numOrNull(n.value);
            if (v == null) continue;
            if (num === "208") per100.kcal = v;
            else if (num === "957" || num === "958") kcal957 = kcal957 ?? v;
            else if (num.startsWith("269")) per100.sugars = v;
            else if (USDA_NUM[num]) per100[USDA_NUM[num]] = v;
        }
        if (per100.kcal == null && kcal957 != null) per100.kcal = kcal957;
        if (per100.kcal == null && per100.protein == null && per100.fat == null && per100.carbs == null) continue;
        out.push({ name: String(f.description || "").trim(), type: f.dataType || "", per100 });
    }
    return out;
}

// ---- Open Food Facts: תשובת /product/<barcode> ----
export function parseOffProduct(json) {
    const p = json && json.product;
    if (!p || !p.nutriments) return null;
    const n = p.nutriments;
    const per100 = {};
    const set = (key, v, mult = 1) => { const x = numOrNull(v); if (x != null) per100[key] = x * mult; };
    set("kcal", n["energy-kcal_100g"] ?? (numOrNull(n["energy_100g"]) != null ? n["energy_100g"] / 4.184 : null));
    set("fat", n["fat_100g"]);
    set("sat", n["saturated-fat_100g"]);
    set("carbs", n["carbohydrates_100g"]);
    set("sugars", n["sugars_100g"]);
    set("protein", n["proteins_100g"]);
    if (numOrNull(n["sodium_100g"]) != null) set("sodium", n["sodium_100g"], 1000);
    else if (numOrNull(n["salt_100g"]) != null) set("sodium", n["salt_100g"] / 2.5, 1000);
    if (!Object.keys(per100).length) return null;
    return { name: String(p.product_name || p.product_name_he || "").trim(), per100 };
}

// ניקוי ערכים שהוזנו (ידנית או ממאגר): מחזיר אובייקט עם מפתחות תקינים בלבד
export function cleanNutrition(v) {
    const out = {};
    for (const nu of NUTRIENTS) { const x = numOrNull(String((v && v[nu.key]) ?? "").replace(",", ".")); if (x != null && String((v && v[nu.key]) ?? "").trim() !== "") out[nu.key] = x; }
    return out;
}

// items: [{ pantry_item_id, ingredient_name, quantity_g }], byId: Map של מוצרי חומרי גלם, nutritionById: { [id]: per100 },
// weightG: המשקל שאליו מחלקים (משקל סופי אחרי בישול, או סכום הרכיבים הגולמי אם לא הוגדר)
// nameFn(src): שם להצגה (למשל שם נקי של חומר גלם). ברירת מחדל: שם המוצר בחומרי הגלם
export function computeNutrition({ items, byId, nutritionById, weightG, nameFn = null }) {
    const get = (id) => (byId instanceof Map ? byId.get(id) : byId[id]);
    const rowsMap = new Map();
    let rawG = 0;
    for (const it of items || []) {
        const grams = it.unit_count ? 0 : Number(it.quantity_g) || 0; // יחידות בלי משקל: אין משקל לחשב
        if (!(grams > 0)) continue;
        const row = get(it.pantry_item_id);
        const src = row && row.parent_id ? get(row.parent_id) || row : row; // תוצר מפורק יורש מחומר הגלם
        const id = src ? src.id : it.pantry_item_id;
        const name = (src && (nameFn ? nameFn(src) : src.name)) || it.ingredient_name || "";
        const val = nutritionById && nutritionById[id] ? nutritionById[id] : null;
        const cur = rowsMap.get(id) || { id, name, grams: 0, per100: val };
        cur.grams += grams;
        rowsMap.set(id, cur);
        rawG += grams;
    }
    const rows = [...rowsMap.values()].map((r) => ({ ...r, grams: round(r.grams, 2), has: !!(r.per100 && Object.keys(r.per100).length) })).sort((a, b) => b.grams - a.grams);
    const total = {};
    for (const nu of NUTRIENTS) total[nu.key] = 0;
    let coveredG = 0;
    for (const r of rows) {
        if (!r.has) continue;
        coveredG += r.grams;
        for (const nu of NUTRIENTS) total[nu.key] += (r.grams * (Number(r.per100[nu.key]) || 0)) / 100;
    }
    const base = Number(weightG) > 0 ? Number(weightG) : rawG;
    const per100 = {};
    const totalRounded = {};
    for (const nu of NUTRIENTS) { per100[nu.key] = base > 0 ? round((total[nu.key] / base) * 100, nu.dec) : 0; totalRounded[nu.key] = round(total[nu.key], nu.dec); }
    return {
        rows, per100, total: totalRounded, weightG: round(base, 1), rawG: round(rawG, 1),
        coveragePct: rawG > 0 ? Math.round((coveredG / rawG) * 100) : 0,
        missing: rows.filter((r) => !r.has).map((r) => r.name),
    };
}

// ערכים למנה (servingG גרם) מתוך ערכים ל-100 גרם
export function perServing(per100, servingG) {
    const s = Number(servingG);
    const out = {};
    for (const nu of NUTRIENTS) out[nu.key] = s > 0 ? round(((Number(per100[nu.key]) || 0) * s) / 100, nu.dec) : 0;
    return out;
}

// ---- דירוג תוצאות חיפוש USDA: גולמי וגנרי קודם, מעובד (שימורים, מיובש, רוטב...) בסוף ----
const NEGATIVE = ["canned", "dried", "dehydrated", "powder", "sauce", "cooked", "fried", "frozen", "pickled", "juice", "baby food", "babyfood", "restaurant", "fast food", "salad", "soup", "snack", "candies", "candy", "dessert", "flavored", "sweetened", "roasted", "boiled", "with added", "seasoning", "mix", "paste", "puree", "jam", "jelly", "chips", "oil-roasted", "dry-roasted", "microwave"];
export function rankUsdaFoods(foods, queryEn) {
    const q = String(queryEn || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
    const qText = q.join(" ");
    const scored = (foods || []).map((f, idx) => {
        const d = String(f.name || "").toLowerCase();
        const words = new Set(d.replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean));
        const matched = q.filter((w) => words.has(w) || [...words].some((x) => x.startsWith(w) && w.length > 3)).length;
        let score = q.length ? (10 * matched) / q.length : 0;
        if (q.length && d.startsWith(q[0])) score += 3;
        const asksProcessed = NEGATIVE.some((n) => qText.includes(n)); // אם ביקשת "powder"/"dried" וכד' - לא מעדיפים גולמי
        if (/\braw\b/.test(d) && !asksProcessed) score += 5;
        for (const n of NEGATIVE) if (d.includes(n) && !qText.includes(n)) score -= 4;
        score -= d.length * 0.03;
        if (f.type === "Foundation") score += 2; else if (f.type === "SR Legacy") score += 1;
        return { f, score, idx };
    });
    return scored.sort((a, b) => b.score - a.score || a.idx - b.idx).map((x) => x.f);
}
