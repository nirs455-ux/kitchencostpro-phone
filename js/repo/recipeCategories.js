// קטגוריות מתכונים שהמשתמש מנהל: יוצר, משנה שם ומוחק. הרשימה נשמרת בהגדרות; ברירת המחדל היא הרשימה הקבועה מהאפליקציה הישנה.
// "כללי" תמיד קיימת ואי אפשר למחוק או לשנות אותה: לשם עוברים מתכונים של קטגוריה שנמחקה.
import { getSetting, setSetting } from "./settingsRepo.js";
import { dbGetAll, dbPut } from "../db.js";
import { RECIPE_CATEGORIES } from "../constants.js";

const KEY = "recipe_categories";
export const FALLBACK_CATEGORY = "כללי";
const MAX_LEN = 30;

const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();
const same = (a, b) => clean(a).toLowerCase() === clean(b).toLowerCase();

async function stored() {
    const v = await getSetting(KEY);
    const list = Array.isArray(v) && v.length ? v.map(clean).filter(Boolean) : [...RECIPE_CATEGORIES];
    if (!list.some((c) => same(c, FALLBACK_CATEGORY))) list.unshift(FALLBACK_CATEGORY);
    return list;
}

// הרשימה להצגה: הרשימה השמורה, ועוד קטגוריות שקיימות במתכונים (למשל ממתכון שיובא) ואינן ברשימה
export async function getRecipeCategories() {
    const list = await stored();
    for (const r of await dbGetAll("recipes")) {
        const c = clean(r.category);
        if (c && !list.some((x) => same(x, c))) list.push(c);
    }
    return list;
}

function validateName(name, list, except = null) {
    const n = clean(name);
    if (!n) throw new Error("יש להזין שם לקטגוריה");
    if (n.length > MAX_LEN) throw new Error("שם הקטגוריה ארוך מדי");
    if (list.some((c) => same(c, n) && !(except && same(c, except)))) throw new Error("כבר יש קטגוריה בשם הזה");
    return n;
}

export async function addRecipeCategory(name) {
    const list = await getRecipeCategories();
    const n = validateName(name, list);
    await setSetting(KEY, [...list, n]);
    return n;
}

// מוסיף אם עוד לא קיימת (שמירת מתכון עם קטגוריה חדשה). בלי שגיאה אם כבר יש.
export async function ensureRecipeCategory(name) {
    const n = clean(name);
    if (!n) return;
    const list = await getRecipeCategories();
    if (!list.some((c) => same(c, n))) await setSetting(KEY, [...list, n.slice(0, MAX_LEN)]);
}

export async function renameRecipeCategory(oldName, newName) {
    if (same(oldName, FALLBACK_CATEGORY)) throw new Error("אי אפשר לשנות את הקטגוריה כללי");
    const list = await getRecipeCategories();
    const n = validateName(newName, list, oldName);
    await setSetting(KEY, list.map((c) => (same(c, oldName) ? n : c)));
    let moved = 0;
    for (const r of await dbGetAll("recipes")) if (same(r.category, oldName)) { await dbPut("recipes", { ...r, category: n }); moved++; }
    return moved;
}

// מחיקה: המתכונים שבקטגוריה עוברים ל"כללי". אף מתכון לא נמחק. מחזיר כמה מתכונים הועברו
export async function deleteRecipeCategory(name) {
    if (same(name, FALLBACK_CATEGORY)) throw new Error("אי אפשר למחוק את הקטגוריה כללי");
    const list = await getRecipeCategories();
    await setSetting(KEY, list.filter((c) => !same(c, name)));
    let moved = 0;
    for (const r of await dbGetAll("recipes")) if (same(r.category, name)) { await dbPut("recipes", { ...r, category: FALLBACK_CATEGORY }); moved++; }
    return moved;
}

export async function recipeCategoryCounts() {
    const counts = new Map();
    for (const r of await dbGetAll("recipes")) counts.set(clean(r.category), (counts.get(clean(r.category)) || 0) + 1);
    return counts;
}
