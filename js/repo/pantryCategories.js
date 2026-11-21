// קטגוריות ותתי-קטגוריות של חומרי הגלם שהמשתמש מנהל: להוסיף, לשנות שם, למחוק ולהעביר. מחיקה לא מוחקת מוצרים: הם עוברים ל"כללי".
// הרשימה נשמרת בהגדרות (pantry_categories) ונטענת בהפעלה לתוך CATEGORY_GROUPS (אותו אובייקט שכל המסכים קוראים), כך שאין צורך לשנות אותם.
// "ללא עלות", "מחסן" ו"כללי" מוגנות: אי אפשר למחוק או לשנות להן שם (יש להן משמעות).
import { CATEGORY_GROUPS } from "../constants.js";
import { getSetting, setSetting } from "./settingsRepo.js";
import { dbGetAll, dbPut } from "../db.js";

export const FALLBACK = "כללי";
export const PROTECTED = new Set(["ללא עלות", "מחסן", FALLBACK]);
const KEY = "pantry_categories";
const MAX_LEN = 30;

const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();
const same = (a, b) => clean(a).toLowerCase() === clean(b).toLowerCase();

// ברירת המחדל: הרשימה הקבועה מהקוד (נקלטת פעם אחת, לפני שמשנים את האובייקט) ועוד "כללי"
const DEFAULT_PAIRS = (() => {
    const p = Object.entries(CATEGORY_GROUPS).map(([c, s]) => [c, [...s]]);
    if (!p.some(([c]) => same(c, FALLBACK))) { const i = p.findIndex(([c]) => c === "ללא עלות"); p.splice(i < 0 ? p.length : i, 0, [FALLBACK, []]); }
    return p;
})();

// v: ההגדרה השמורה (או כל דבר). מחזיר זוגות [קטגוריה, [תתי-קטגוריות]] תקינים; פגום/ריק = ברירת מחדל. קטגוריות מוגנות תמיד קיימות
export function normalizePairs(v) {
    const raw = v && Array.isArray(v.groups) ? v.groups : null;
    const out = [], seen = new Set();
    for (const g of raw || []) {
        const c = clean(Array.isArray(g) ? g[0] : "");
        if (!c || c.length > MAX_LEN || seen.has(c.toLowerCase())) continue;
        seen.add(c.toLowerCase());
        const subs = [];
        for (const s of Array.isArray(g[1]) ? g[1] : []) { const t = clean(s); if (t && t.length <= MAX_LEN && !subs.some((x) => same(x, t))) subs.push(t); }
        out.push([c, subs]);
    }
    const base = out.length ? out : DEFAULT_PAIRS.map(([c, s]) => [c, [...s]]);
    for (const p of PROTECTED) if (!base.some(([c]) => c === p)) base.push([p, []]);
    return base;
}

// מוסיף לרשימה קטגוריות ותתי-קטגוריות שקיימות במוצרים אבל חסרות בה (למשל אחרי שחזור מגיבוי ישן)
export function withMissing(pairs, items) {
    const out = pairs.map(([c, s]) => [c, [...s]]);
    for (const it of items || []) {
        const c = clean(it.category);
        if (!c) continue;
        let g = out.find(([x]) => same(x, c));
        if (!g) { g = [c, []]; out.push(g); }
        const s = clean(it.subcategory);
        if (s && !g[1].some((x) => same(x, s))) g[1].push(s);
    }
    return out;
}

export function applyToConstants(pairs) {
    for (const k of Object.keys(CATEGORY_GROUPS)) delete CATEGORY_GROUPS[k];
    for (const [c, s] of pairs) CATEGORY_GROUPS[c] = [...s];
}

const current = () => Object.entries(CATEGORY_GROUPS).map(([c, s]) => [c, [...s]]);
async function save(pairs) { await setSetting(KEY, { v: 1, groups: pairs }); applyToConstants(pairs); }

// בהפעלה (אחרי פתיחת המסד, לפני ציור המסכים)
export async function loadPantryCategories() {
    const pairs = withMissing(normalizePairs(await getSetting(KEY)), await dbGetAll("pantryItems"));
    applyToConstants(pairs);
    return pairs;
}

export async function pantryCategoryCounts() {
    const counts = new Map(), subCounts = new Map();
    for (const it of await dbGetAll("pantryItems")) {
        if (it.parent_id) continue;
        counts.set(it.category, (counts.get(it.category) || 0) + 1);
        if (it.subcategory) subCounts.set(`${it.category}|${it.subcategory}`, (subCounts.get(`${it.category}|${it.subcategory}`) || 0) + 1);
    }
    return { counts, subCounts };
}

function checkName(name, list, except = null) {
    const n = clean(name);
    if (!n) throw new Error("יש להזין שם");
    if (n.length > MAX_LEN) throw new Error("השם ארוך מדי");
    if (list.some((c) => same(c, n) && !(except && same(c, except)))) throw new Error("כבר יש כזה בשם הזה");
    return n;
}

export async function addPantryCategory(name) {
    const pairs = current();
    const n = checkName(name, pairs.map(([c]) => c));
    await save([...pairs, [n, []]]);
    return n;
}

export async function addPantrySubcategory(cat, name) {
    const pairs = current();
    const g = pairs.find(([c]) => c === cat);
    if (!g) throw new Error("קטגוריה לא נמצאה");
    g[1].push(checkName(name, g[1]));
    await save(pairs);
}

// כותב על מוצר ועל ילדיו (תוצרי פירוק שומרים עותק של הקטגוריה של האב)
async function patchItems(match, patch) {
    const all = await dbGetAll("pantryItems");
    const hit = new Set(all.filter(match).map((i) => i.id));
    let n = 0;
    for (const it of all) if (hit.has(it.id) || (it.parent_id && hit.has(it.parent_id))) { await dbPut("pantryItems", { ...it, ...patch(it) }); n++; }
    return n;
}

export async function renamePantryCategory(oldName, newName) {
    if (PROTECTED.has(oldName)) throw new Error("אי אפשר לשנות שם לקטגוריה הזו");
    const pairs = current();
    const n = checkName(newName, pairs.map(([c]) => c), oldName);
    await patchItems((i) => i.category === oldName, () => ({ category: n }));
    await save(pairs.map(([c, s]) => [c === oldName ? n : c, s]));
    return n;
}

// מחיקת קטגוריה: המוצרים (וילדיהם) עוברים ל"כללי", בלי תת-קטגוריה. מחזיר כמה מוצרים עברו
export async function deletePantryCategory(name) {
    if (PROTECTED.has(name)) throw new Error("אי אפשר למחוק את הקטגוריה הזו");
    const moved = await patchItems((i) => i.category === name, () => ({ category: FALLBACK, subcategory: null }));
    await save(current().filter(([c]) => c !== name));
    return moved;
}

export async function renamePantrySubcategory(cat, oldSub, newSub) {
    const pairs = current();
    const g = pairs.find(([c]) => c === cat);
    if (!g) throw new Error("קטגוריה לא נמצאה");
    const n = checkName(newSub, g[1], oldSub);
    await patchItems((i) => i.category === cat && i.subcategory === oldSub, () => ({ subcategory: n }));
    g[1] = g[1].map((s) => (s === oldSub ? n : s));
    await save(pairs);
    return n;
}

// מחיקת תת-קטגוריה: המוצרים נשארים בקטגוריה, בלי תת-קטגוריה
export async function deletePantrySubcategory(cat, sub) {
    const moved = await patchItems((i) => i.category === cat && i.subcategory === sub, () => ({ subcategory: null }));
    const pairs = current();
    const g = pairs.find(([c]) => c === cat);
    if (g) g[1] = g[1].filter((s) => s !== sub);
    await save(pairs);
    return moved;
}

// העברת תת-קטגוריה לקטגוריה אחרת, עם כל המוצרים שלה. אם ליעד יש כבר תת-קטגוריה באותו שם, הן מתאחדות
export async function movePantrySubcategory(fromCat, sub, toCat) {
    if (fromCat === toCat) return 0;
    const pairs = current();
    const from = pairs.find(([c]) => c === fromCat), to = pairs.find(([c]) => c === toCat);
    if (!from || !to) throw new Error("קטגוריה לא נמצאה");
    const moved = await patchItems((i) => i.category === fromCat && i.subcategory === sub, () => ({ category: toCat }));
    from[1] = from[1].filter((s) => s !== sub);
    if (!to[1].some((s) => same(s, sub))) to[1].push(sub);
    await save(pairs);
    return moved;
}

// העברה מרובה של מוצרים (לפי מזהים) לקטגוריה, ואם רוצים לתת-קטגוריה שלה. תוצרי פירוק עוברים עם המוצר
export async function movePantryItems(ids, cat, sub = null) {
    const g = current().find(([c]) => c === cat);
    if (!g) throw new Error("קטגוריה לא נמצאה");
    const s = clean(sub) || null;
    if (s && !g[1].includes(s)) throw new Error("תת-קטגוריה לא נמצאה");
    const set = new Set(ids.map(Number));
    return patchItems((i) => set.has(i.id), () => ({ category: cat, subcategory: s }));
}
