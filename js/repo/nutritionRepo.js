// ערכים תזונתיים של מוצרי חומרי גלם: שמירה (לפי מזהה מוצר, מחוץ לטבלת חומרי הגלם) וחיפוש במאגרים (USDA, Open Food Facts).
// נשמר בטבלת ההגדרות, כך שנכלל בגיבוי בלי שינוי מבנה מסד.
import { getSetting, setSetting } from "./settingsRepo.js";
import { parseUsdaFoods, parseOffProduct, cleanNutrition } from "../nutrition.js";
import { geminiFetch } from "./gemini.js";
import { localDate } from "../dates.js";

const DB_KEY = "nutrition_db";
const USDA_KEY = "usda_api_key";

export async function getNutritionDb() {
    const v = await getSetting(DB_KEY);
    return v && typeof v === "object" ? v : {};
}

// entry: { kcal, fat, ... } + source ("usda" | "off" | "manual") + label (שם ההתאמה שנבחרה)
export async function saveNutrition(pantryId, per100, { source = "manual", label = "" } = {}) {
    const clean = cleanNutrition(per100);
    if (!Object.keys(clean).length) throw new Error("יש להזין לפחות ערך אחד");
    const db = await getNutritionDb();
    db[pantryId] = { ...clean, _source: source, _label: label, _at: localDate() };
    await setSetting(DB_KEY, db);
    return db;
}

// זיכרון בחירות לפי שם נקי של חומר גלם: בחרת פעם התאמה ל"פלפל צילי אדום" - מוצר אחר עם אותו שם נקי יקבל אותה אוטומטית.
// נשמרות רק בחירות ממאגר USDA (חומר גלם גנרי), לא ערכים של מוצר ארוז ספציפי.
const CHOICES_KEY = "nutrition_choices";
export const normName = (s) => String(s || "").toLowerCase().replace(/["'`׳״]/g, "").replace(/\s+/g, " ").trim();

export async function getNutritionChoices() {
    const v = await getSetting(CHOICES_KEY);
    return v && typeof v === "object" ? v : {};
}
export async function rememberChoice(cleanName, per100, label = "") {
    const key = normName(cleanName);
    if (!key) return;
    const clean = cleanNutrition(per100);
    if (!Object.keys(clean).length) return;
    const all = await getNutritionChoices();
    all[key] = { ...clean, _label: label, _at: localDate() };
    await setSetting(CHOICES_KEY, all);
}

// מקבל שורות חומרי גלם (חומרי גלם) ופונקציית שם נקי; ממלא ערכים למי שחסר ויש עבורו בחירה שנזכרה. מחזיר את מסד הערכים המעודכן.
export async function applyRememberedNutrition(rows, nameFn) {
    const db = await getNutritionDb();
    const choices = await getNutritionChoices();
    let changed = false;
    for (const row of rows) {
        if (!row || (db[row.id] && Object.keys(db[row.id]).some((k) => !k.startsWith("_")))) continue;
        const c = choices[normName(nameFn(row))];
        if (!c) continue;
        const { _label, _at, ...vals } = c;
        db[row.id] = { ...vals, _source: "remembered", _label, _at: localDate() };
        changed = true;
    }
    if (changed) await setSetting(DB_KEY, db);
    return db;
}

export async function removeNutrition(pantryId) {
    const db = await getNutritionDb();
    delete db[pantryId];
    await setSetting(DB_KEY, db);
    return db;
}

// פרטי תווית של מוצר מוכן (רכיבים כפי שהודפסו + "עלול להכיל"). נשמר בהגדרות, מחוץ לטבלת חומרי הגלם.
const LABEL_KEY = "label_info";
export async function getLabelInfo() {
    const v = await getSetting(LABEL_KEY);
    return v && typeof v === "object" ? v : {};
}
export async function saveLabelInfo(pantryId, { ingredients = "", mayContain = [], net_g = null } = {}) {
    const all = await getLabelInfo();
    all[pantryId] = { ingredients: String(ingredients || "").trim(), may_contain: Array.isArray(mayContain) ? mayContain : [], net_g: Number(net_g) > 0 ? Number(net_g) : null, _at: localDate() };
    await setSetting(LABEL_KEY, all);
    return all[pantryId];
}

export async function getUsdaKey() { return (await getSetting(USDA_KEY)) || ""; }
export async function setUsdaKey(k) { await setSetting(USDA_KEY, String(k || "").trim()); }

// שם מוצר בעברית -> שם באנגלית לחיפוש (באמצעות Gemini אם יש מפתח). בלי מפתח/כשל מחזיר את השם כמו שהוא.
export async function toEnglishFoodName(geminiKey, name) {
    const clean = String(name || "").trim();
    if (!clean || !geminiKey || !/[֐-׿]/.test(clean)) return clean;
    try {
        const prompt = `Translate this food/ingredient name from Hebrew to a short English search term suitable for the USDA FoodData Central database (generic raw ingredient name, e.g. "olive oil", "garlic raw", "wheat flour white"). Answer with the English term only, no quotes, no explanation.\nName: ${clean}`;
        const res = await geminiFetch(geminiKey, { contents: [{ parts: [{ text: prompt }] }] });
        if (!res.ok) return clean;
        const j = await res.json();
        const text = String(j.candidates[0].content.parts[0].text || "").trim().replace(/^["'`]+|["'`]+$/g, "").split("\n")[0];
        return text && text.length < 80 ? text : clean;
    } catch (e) { return clean; }
}

// חיפוש ב-USDA (מפתח חינמי; בלעדיו משתמשים במפתח ההדגמה המוגבל). מחזיר { foods, error }
export async function searchUsda(query, apiKey = "") {
    const q = String(query || "").trim();
    if (!q) return { foods: [], error: "" };
    try {
        const url = `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(apiKey || "DEMO_KEY")}&query=${encodeURIComponent(q)}&dataType=Foundation,SR%20Legacy&pageSize=25`;
        const res = await fetch(url);
        if (res.status === 429) return { foods: [], error: "חרגת ממגבלת החיפוש של USDA. הוסף מפתח אישי בהגדרות או נסה מאוחר יותר." };
        if (res.status === 403) return { foods: [], error: "מפתח USDA לא תקין. בדוק אותו בהגדרות." };
        if (!res.ok) return { foods: [], error: "החיפוש ב-USDA נכשל. נסה שוב." };
        return { foods: parseUsdaFoods(await res.json()), error: "" };
    } catch (e) {
        return { foods: [], error: "אין חיבור לאינטרנט או שהמאגר לא זמין." };
    }
}

// חיפוש לפי ברקוד ב-Open Food Facts. מחזיר { product, error }
export async function lookupBarcode(code) {
    const c = String(code || "").replace(/\D/g, "");
    if (c.length < 8) return { product: null, error: "ברקוד לא תקין" };
    try {
        const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${c}.json?fields=product_name,product_name_he,nutriments`);
        if (!res.ok) return { product: null, error: "המוצר לא נמצא במאגר Open Food Facts." };
        const p = parseOffProduct(await res.json());
        return p ? { product: p, error: "" } : { product: null, error: "למוצר אין ערכים תזונתיים במאגר." };
    } catch (e) {
        return { product: null, error: "אין חיבור לאינטרנט או שהמאגר לא זמין." };
    }
}
