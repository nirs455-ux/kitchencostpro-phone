// קריאת תווית יצרן (תמונה) ל-Gemini: פרומפט ופירוש התשובה. טהור (בלי DOM/DB/רשת) כדי שאפשר לבדוק ב-Node.
// התוצאה היא טיוטה לבדיקה: המשתמש מאשר ומתקן לפני שמירה. האחריות לתיוג רשמי היא של בעל העסק.
import { ALLERGENS } from "./allergens.js";
import { NUTRIENTS } from "./nutrition.js";

const KEYS = ALLERGENS.map((a) => a.key);

export const LABEL_SCAN_PROMPT = `You are reading a photo of a packaged food product label (Hebrew, English or other). Extract ONLY what is clearly printed. Never guess or invent values. If a value is not visible or not readable, use null.
Return ONLY valid JSON, no markdown, in exactly this shape:
{
  "product_name": string or null,
  "ingredients_text": string or null (the ingredients list exactly as printed, in its original language),
  "contains": [allergen keys declared as CONTAINED (e.g. "מכיל: חלב, סויה")],
  "may_contain": [allergen keys declared as "may contain traces" (e.g. "עלול להכיל עקבות")],
  "nutrition_per_100": { "kcal": number or null, "fat": number or null, "sat": number or null, "carbs": number or null, "sugars": number or null, "protein": number or null, "sodium_mg": number or null, "salt_g": number or null } or null,
  "serving_size_g": number or null,
  "nutrition_per_serving": same shape as nutrition_per_100 or null,
  "net_weight_g": number or null (net weight/volume of the package in grams or ml),
  "notes": string or null (anything unclear or partly unreadable)
}
Allergen keys must be chosen ONLY from: ${KEYS.join(", ")}. Mapping: gluten = wheat/barley/rye/oats/spelt (גלוטן, חיטה, שעורה, שיפון, שיבולת שועל), milk = חלב, eggs = ביצים, peanuts = בוטנים, tree_nuts = אגוזים/שקדים/קשיו/פקאן/פיסטוק/לוז, sesame = שומשום, soy = סויה, fish = דגים, shellfish = סרטנים/רכיכות, celery = סלרי, mustard = חרדל, sulfites = סולפיטים (above 10mg/kg), lupin = תורמוס.
Nutrition: use the "per 100 g" (or per 100 ml) column when it exists. kcal = energy in kilocalories (if only kJ is printed, divide by 4.184). Energy in kJ is NOT kcal. sodium_mg is sodium in milligrams (if the label shows sodium in grams multiply by 1000); if only salt is printed give salt_g.`;

const numOrNull = (x) => {
    if (x == null || x === "") return null;
    const n = typeof x === "number" ? x : parseFloat(String(x).replace(",", ".").replace(/[^\d.\-]/g, ""));
    return Number.isFinite(n) && n >= 0 ? n : null;
};

function readNutrition(src) {
    const out = {};
    if (!src || typeof src !== "object") return out;
    for (const k of ["kcal", "fat", "sat", "carbs", "sugars", "protein"]) { const v = numOrNull(src[k]); if (v != null) out[k] = v; }
    let sodium = numOrNull(src.sodium_mg);
    if (sodium == null && numOrNull(src.sodium_g) != null) sodium = numOrNull(src.sodium_g) * 1000;
    if (sodium == null && numOrNull(src.salt_g) != null) sodium = (numOrNull(src.salt_g) / 2.5) * 1000; // מלח -> נתרן
    if (sodium != null) out.sodium = Math.round(sodium);
    return out;
}

const cleanKeys = (arr) => [...new Set((Array.isArray(arr) ? arr : []).map((k) => String(k).trim().toLowerCase()).filter((k) => KEYS.includes(k)))];

// answer: אובייקט JSON שחזר מ-Gemini. מחזיר { name, ingredients, contains, mayContain, per100, netG, notes, warnings }
export function parseLabelAnswer(answer) {
    const a = answer && typeof answer === "object" ? answer : {};
    const warnings = [];
    let per100 = readNutrition(a.nutrition_per_100);
    let fromServing = false;
    if (!Object.keys(per100).length) {
        const serving = numOrNull(a.serving_size_g);
        const ps = readNutrition(a.nutrition_per_serving);
        if (serving > 0 && Object.keys(ps).length) {
            for (const [k, v] of Object.entries(ps)) per100[k] = Math.round((v * 100) / serving * 10) / 10;
            fromServing = true;
            warnings.push(`הערכים הומרו ל-100 גרם מתוך מנה של ${serving} גרם. בדוק אותם מול התווית.`);
        }
    }
    // בדיקות היגיון (ל-100 גרם): קלוריות אי אפשר מעל ~900, ומאקרו לא יותר מ-100 גרם
    if (per100.kcal != null && per100.kcal > 950) warnings.push('קק"ל גבוה מדי ל-100 גרם. ייתכן שנקראו קילו-ג\'ול (kJ) במקום קק"ל. בדוק.');
    const macro = (per100.fat || 0) + (per100.carbs || 0) + (per100.protein || 0);
    if (macro > 105) warnings.push("סכום שומן + פחמימות + חלבון גבוה מ-100 גרם. בדוק את הערכים.");
    if (per100.sugars != null && per100.carbs != null && per100.sugars > per100.carbs + 0.5) warnings.push("סוכרים גבוהים מפחמימות. בדוק.");
    if (per100.sat != null && per100.fat != null && per100.sat > per100.fat + 0.5) warnings.push("שומן רווי גבוה משומן. בדוק.");

    const contains = cleanKeys(a.contains);
    const mayContain = cleanKeys(a.may_contain).filter((k) => !contains.includes(k));
    return {
        name: String(a.product_name || "").trim(),
        ingredients: String(a.ingredients_text || "").trim(),
        contains, mayContain, per100, fromServing,
        netG: numOrNull(a.net_weight_g),
        notes: String(a.notes || "").trim(),
        warnings,
        empty: !Object.keys(per100).length && !contains.length && !mayContain.length && !String(a.ingredients_text || "").trim(),
    };
}

export { NUTRIENTS };
