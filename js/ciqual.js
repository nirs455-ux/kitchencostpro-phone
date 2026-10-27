// מאגר Ciqual של ANSES (צרפת): ~3,500 מזונות עם שמות באנגלית ובצרפתית, ערכים ל-100 גרם. רישיון Licence Ouverte 2.0 (Etalab), מקור: ANSES, Ciqual.
// הקובץ data/ciqual.json נבנה על ידי tools/build_ciqual.py. כאן רק חיפוש ודירוג (טהור, נבדק ב-Node).

export const CIQUAL_CREDIT = "ANSES, Table de composition nutritionnelle Ciqual (Licence Ouverte 2.0)";

// שורה: [קוד, שם צרפתי, שם אנגלי, קק"ל, שומן, רווי, פחמימות, סוכרים, חלבון, נתרן מ"ג]
const KEYS = ["kcal", "fat", "sat", "carbs", "sugars", "protein", "sodium"];
export function rowToFood(r) {
    const per100 = {};
    KEYS.forEach((k, i) => { if (r[3 + i] != null) per100[k] = r[3 + i]; });
    return { code: r[0], name: r[2] || r[1], nameFr: r[1], type: "Ciqual", per100 };
}

const words = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
const stem = (w) => (w.length > 3 ? w.replace(/(ies|es|s)$/, (m) => (m === "ies" ? "y" : "")) : w); // tomatoes -> tomato, potatoes -> potato

// דירוג: מי ששמו מתחיל בדיוק במה שחיפשו ("Butter, ..." ולא "Butter bean"), ואז גולמי/ממוצע גנרי, קצר, ושלם בערכים. מעובד ואזורי בסוף.
const NEGATIVE = ["cooked", "fried", "canned", "dried", "powder", "sauce", "pastry", "sweetened", "roasted", "boiled", "juice", "soup", "salad", "dessert", "biscuit", "cake", "bread", "pizza", "sandwich", "jam", "compote", "flavoured", "drink", "sampled in", "unknown"];
export function rankCiqual(foods, q) {
    const qSet = [...new Set(q)].sort().join(" ");
    const asks = (w) => q.some((x) => w.startsWith(x) || x.startsWith(w));
    return foods
        .map((f, idx) => {
            const d = f.name.toLowerCase();
            let score = 0;
            const first = [...new Set(words(d.split(",")[0]).map(stem))].sort().join(" ");
            if (first === qSet) score += 10;
            if (/(average)/.test(d)) score += 1;
            if (/raw/.test(d) && !asks("raw")) score += 1.5;
            for (const n of NEGATIVE) if (d.includes(n) && !asks(n)) score -= 3;
            if (f.per100.kcal == null) score -= 3;
            score -= d.length * 0.03;
            return { f, score, idx };
        })
        .sort((a, b) => b.score - a.score || a.idx - b.idx)
        .map((x) => x.f);
}

// data = תוכן data/ciqual.json. מחזיר עד limit התאמות, מסודרות: גולמי וגנרי קודם
export function searchCiqual(data, queryEn, limit = 40) {
    const q = words(queryEn).map(stem);
    if (!q.length || !data || !Array.isArray(data.f)) return [];
    const hits = [];
    for (const r of data.f) {
        const nameWords = new Set(words(r[2] || r[1]).map(stem));
        const frWords = new Set(words(r[1]).map(stem));
        const all = q.every((w) => nameWords.has(w) || frWords.has(w) || [...nameWords].some((x) => x.startsWith(w) && w.length > 3));
        if (all) hits.push(rowToFood(r));
    }
    const ranked = rankCiqual(hits, q);
    return ranked.filter((f) => f.per100.kcal != null || f.per100.protein != null || f.per100.fat != null || f.per100.carbs != null).slice(0, limit);
}

let cache = null;
export async function loadCiqual(url = "data/ciqual.json") {
    if (cache) return cache;
    const res = await fetch(url);
    if (!res.ok) throw new Error("מאגר Ciqual לא נטען");
    cache = await res.json();
    return cache;
}
