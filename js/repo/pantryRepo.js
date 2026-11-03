// לוגיקת חומרי גלם - תרגום מדויק של _validate_payload / add_item / update_item / update_item_yield / delete_item מ-main.py.
import { isWaterName } from "../freeItems.js";
import { dbGetAll, dbGet, dbPut, dbDelete, dbGetByIndex } from "../db.js";
import { CATEGORY_GROUPS, UNIT_TYPES } from "../constants.js";
import { computeYieldPct, isCountItem } from "../formulas.js";
import { estimateYield } from "../yieldKb.js";
import { EGG_SIZES, guessEggSize } from "../eggs.js";
import { expandToParents } from "./subRecipes.js";

export async function listAllPantryItems() {
    return dbGetAll("pantryItems");
}

export async function listTopLevelPantryItems() {
    const all = await dbGetAll("pantryItems");
    return all.filter((it) => !it.parent_id);
}

export async function getChildren(parentId) {
    return dbGetByIndex("pantryItems", "parent_id", parentId);
}

function validateBase(data) {
    const weightBefore = data.weight_before === "" || data.weight_before == null ? null : parseFloat(data.weight_before);
    const weightAfter = data.weight_after === "" || data.weight_after == null ? null : parseFloat(data.weight_after);
    if ((data.weight_before !== "" && data.weight_before != null && Number.isNaN(weightBefore)) ||
        (data.weight_after !== "" && data.weight_after != null && Number.isNaN(weightAfter))) {
        throw new Error("משקל לפני/אחרי לא תקין");
    }
    let yieldPct;
    try {
        yieldPct = computeYieldPct(weightBefore, weightAfter, data.yield_pct === "" || data.yield_pct == null ? 100 : parseFloat(data.yield_pct));
    } catch (e) {
        throw new Error("ניצולת חייבת להיות מספר חיובי");
    }
    const isFrozen = !!data.is_frozen;
    return { weightBefore, weightAfter, yieldPct, isFrozen };
}

// מוסיף מוצר עצמאי חדש (מקביל ל-POST /api/items).
// קלט מספרי: פסיק עשרוני נתמך; מחזיר NaN אם לא מספר תקין. מחיר חייב להיות 0 עד מיליון, משקל ליחידה חיובי.
const numIn = (v) => { const n = parseFloat(String(v ?? "").trim().replace(",", ".")); return Number.isFinite(n) ? n : NaN; };
function checkPrice(v) {
    const n = numIn(v);
    if (Number.isNaN(n)) throw new Error("מחיר לא תקין");
    if (n < 0) throw new Error("מחיר לא יכול להיות שלילי");
    if (n > 1000000) throw new Error("המחיר גבוה מדי - בדוק שלא הוזן מספר שגוי");
    return n;
}
function checkUnitAmount(v) {
    const n = numIn(v);
    if (Number.isNaN(n)) throw new Error("יש להזין משקל/נפח ליחידה");
    if (n <= 0) throw new Error("משקל/נפח ליחידה חייב להיות גדול מ-0");
    if (n > 1000000) throw new Error("משקל/נפח ליחידה גבוה מדי - בדוק את היחידות (ק\"ג, לא גרם)");
    return n;
}

// שם כפול ברמה העליונה (בלי הבדל רישיות/רווחים). excludeId = המוצר שעורכים כרגע
async function assertUniqueName(name, excludeId = null) {
    const key = name.trim().toLowerCase();
    const clash = (await dbGetAll("pantryItems")).find((r) => !r.parent_id && r.id !== excludeId && r.name.trim().toLowerCase() === key);
    if (clash) throw new Error("כבר קיים מוצר בשם הזה בחומרי הגלם. בחר אותו מהרשימה או שנה את השם.");
}

// משקל יחידה בגרמים למוצר שנקנה במשקל או בנפח אבל סופרים ביחידות במתכון (עלה דפנה, פרוסה, חתיכה). null = לא הוגדר
export const pieceGrams = (v) => { const n = parseFloat(String(v ?? "").replace(",", ".")); return Number.isFinite(n) && n > 0 && n < 100000 ? Math.round(n * 1000) / 1000 : null; };
export async function setPieceWeight(id, grams) {
    const row = await dbGet("pantryItems", id);
    if (!row || row.unit_type === "unit") return;
    const g = pieceGrams(grams);
    if (g) row.piece_g = g; else delete row.piece_g;
    await dbPut("pantryItems", row);
}

export async function addPantryItem(data) {
    const name = (data.name || "").trim();
    const base = validateBase(data);
    const { weightBefore, weightAfter, isFrozen } = base;
    let { yieldPct } = base;
    // ניצולת מוערכת לפי שם המוצר (גזר, אבטיח...) כשלא הוזנה ניצולת או משקלים. עיבוד אמיתי דורס אותה
    let yieldEst = false;
    if (data.unit_type === "weight" && !isFrozen && weightBefore == null && weightAfter == null && yieldPct === 100 && !data.no_yield_est) {
        const est = estimateYield(name);
        if (est) { yieldPct = est; yieldEst = true; }
    }

    if (!name || !(data.category in CATEGORY_GROUPS) || !UNIT_TYPES.includes(data.unit_type)) {
        throw new Error("נתונים חסרים או שגויים");
    }
    await assertUniqueName(name);
    const allowedSubs = CATEGORY_GROUPS[data.category];
    let subcategory = (data.subcategory || "").trim() || null;
    if (subcategory && allowedSubs.length && !allowedSubs.includes(subcategory)) {
        throw new Error("תת-קטגוריה לא תקינה");
    }
    if (!allowedSubs.length || !subcategory) subcategory = null;

    // הוספה תוך כדי עבודה (למשל מתוך מתכון): אפשר בלי מחיר. נשמר עם סימון "חסר מחיר" עד שמשלימים
    const isFree = !!data.free || (!!data.allow_no_price && String(data.price ?? "").trim() === "" && isWaterName(name));
    const noPrice = !isFree && !!data.allow_no_price && String(data.price ?? "").trim() === "";
    const price = isFree || noPrice ? 0 : checkPrice(data.price);

    let unitAmount = null;
    if (data.unit_type === "unit") unitAmount = numIn(data.unit_amount) > 0 ? checkUnitAmount(data.unit_amount) : null; // משקל ליחידה לא חובה

    const row = {
        name, category: data.category, subcategory, unit_type: data.unit_type, unit_amount: unitAmount,
        pkg_size: data.unit_type !== "unit" && parseFloat(data.pkg_size) > 0 ? parseFloat(data.pkg_size) : null, // גודל אריזה (ק"ג/ליטר) לספירה באריזות
        price, yield_pct: yieldPct, weight_before: weightBefore, weight_after: weightAfter,
        is_frozen: isFrozen ? 1 : 0, parent_id: null, ...(yieldEst ? { yield_est: true } : {}), ...(noPrice ? { price_missing: true } : {}), ...(isFree ? { free: true } : {}),
        ...(data.unit_type !== "unit" && pieceGrams(data.piece_g) ? { piece_g: pieceGrams(data.piece_g) } : {}),
        ...(data.unit_type === "unit" && EGG_SIZES[data.egg_size] ? { egg_size: data.egg_size } : {}),
                // אלרגנים: רק אם הוגדרו במפורש. אחרת השדה לא קיים = "לא ידוע" (המאגר מכריע בזמן התצוגה). אין ניחוש לפי שם.
        ...(Array.isArray(data.allergens) ? { allergens: data.allergens, allergens_auto: false } : {}),
    };
    const id = await dbPut("pantryItems", row);
    return id;
}

// מילוי ניצולת מוערכת למוצרים קיימים (rows: [{ id, to }]); ביטול מחזיר ל-100 רק את מה שסומן כהערכה. עלויות מתעדכנות אוטומטית
export async function applyYieldEstimates(rows) {
    let n = 0;
    for (const r of rows) {
        const row = await dbGet("pantryItems", r.id);
        if (!row || row.parent_id || row.yield_est || Number(row.yield_pct || 100) !== 100 || !(r.to > 0)) continue;
        row.yield_pct = r.to; row.yield_est = true;
        await dbPut("pantryItems", row);
        n++;
    }
    return n;
}
export async function undoYieldEstimates() {
    let n = 0;
    for (const row of await dbGetAll("pantryItems")) {
        if (!row.yield_est) continue;
        row.yield_pct = 100; delete row.yield_est;
        await dbPut("pantryItems", row);
        n++;
    }
    return n;
}

// מוסיף תוצר מפורק שנגזר מחומר גלם קיים (מקביל ל-_validate_payload עם parent_id, נקרא מ-processing.js).
export async function addBreakdownProduct(parentId, data) {
    const parent = await dbGet("pantryItems", parentId);
    if (!parent) throw new Error("חומר הגלם שנבחר לא נמצא");
    if (parent.parent_id) throw new Error("לא ניתן לגזור תוצר מתוצר אחר");
    const name = (data.name || "").trim();
    if (!name) throw new Error("יש להזין שם לתוצר");
    const { weightBefore, weightAfter, yieldPct, isFrozen } = validateBase(data);

    const row = {
        name, category: parent.category, subcategory: parent.subcategory, unit_type: parent.unit_type,
        unit_amount: parent.unit_amount, price: parent.price, yield_pct: yieldPct,
        weight_before: weightBefore, weight_after: weightAfter, is_frozen: isFrozen ? 1 : 0, parent_id: parentId,
    };
    return dbPut("pantryItems", row);
}

// עריכה בסיסית (עמוד 1) - שם/קטגוריה/יחידה/מחיר/קפוא. מקביל ל-PUT /api/items/<id>.
export async function updatePantryItem(id, data) {
    const existing = await dbGet("pantryItems", id);
    if (!existing) throw new Error("מוצר לא נמצא");
    const name = (data.name || "").trim();
    if (!name) throw new Error("יש להזין שם מוצר");
    const isFrozen = !!data.is_frozen;

    if (existing.parent_id) {
        existing.name = name;
        existing.is_frozen = isFrozen ? 1 : 0;
        await dbPut("pantryItems", existing);
        return;
    }

    if (!(data.category in CATEGORY_GROUPS) || !UNIT_TYPES.includes(data.unit_type)) {
        throw new Error("נתונים חסרים או שגויים");
    }
    if (name.toLowerCase() !== String(existing.name || "").trim().toLowerCase()) await assertUniqueName(name, id); // רק אם שינו שם (כפילויות ישנות לא חוסמות עריכת מחיר)
    const isFree = !!data.free;
    const price = isFree ? 0 : checkPrice(data.price);

    let unitAmount = null;
    if (data.unit_type === "unit") unitAmount = numIn(data.unit_amount) > 0 ? checkUnitAmount(data.unit_amount) : null; // משקל ליחידה לא חובה

    // מעבר בין "ספירה" (יחידות בלי משקל) לבין משקל משנה את משמעות הכמות ששמורה במתכונים ובמנות, ולכן חסום כשהמוצר בשימוש
    const wasCount = isCountItem(existing);
    const willCount = data.unit_type === "unit" && !(unitAmount > 0);
    if (wasCount !== willCount || (existing.unit_type !== data.unit_type && (wasCount || willCount))) {
        const usedInRecipe = (await dbGetAll("recipeItems")).some((r) => r.pantry_item_id === id);
        const usedInDish = (await dbGetAll("dishItems")).some((r) => r.source_type === "pantry" && r.source_id === id);
        if (usedInRecipe || usedInDish) throw new Error("המוצר בשימוש במתכונים או במנות. אי אפשר להוסיף או להסיר לו משקל ליחידה, כי הכמויות שהוזנו שם נשמרו אחרת. הסר אותו מהם קודם, או צור מוצר חדש.");
    }

    let newSubcategory = existing.subcategory;
    if ("subcategory" in data) newSubcategory = String(data.subcategory || "").trim() || null; // הטופס שולח את הבחירה, וריק = בלי תת-קטגוריה
    const allowedSubs = CATEGORY_GROUPS[data.category];
    if (newSubcategory && !allowedSubs.includes(newSubcategory)) newSubcategory = null;

    Object.assign(existing, {
        name, category: data.category, subcategory: newSubcategory, unit_type: data.unit_type,
        unit_amount: unitAmount, price, is_frozen: isFrozen ? 1 : 0,
    });
    if (price > 0 || isFree) delete existing.price_missing; // הושלם מחיר
    if (isFree) existing.free = true; else delete existing.free;
    if ("piece_g" in data) { const pg = data.unit_type !== "unit" ? pieceGrams(data.piece_g) : null; if (pg) existing.piece_g = pg; else delete existing.piece_g; }
    if (data.unit_type === "unit" && EGG_SIZES[data.egg_size]) existing.egg_size = data.egg_size;
    existing.pkg_size = data.unit_type !== "unit" && parseFloat(data.pkg_size) > 0 ? parseFloat(data.pkg_size) : null;
    if (Array.isArray(data.allergens)) { existing.allergens = data.allergens; existing.allergens_auto = false; }
    await dbPut("pantryItems", existing);
}

// עדכון ניצולת/משקל/קפוא (עמוד 2 - עיבוד). מקביל ל-PUT /api/items/<id>/yield.
export async function updatePantryItemYield(id, data) {
    const existing = await dbGet("pantryItems", id);
    if (!existing) throw new Error("מוצר לא נמצא");
    const name = (data.name || "").trim() || existing.name;
    const { weightBefore, weightAfter, yieldPct, isFrozen } = validateBase(data);

    let subcategory = (data.subcategory || "").trim() || null;
    const allowedSubs = CATEGORY_GROUPS[existing.category] || [];
    if (subcategory && allowedSubs.length && !allowedSubs.includes(subcategory)) {
        throw new Error("תת-קטגוריה לא תקינה");
    }
    if (!allowedSubs.length) subcategory = null;
    if (subcategory === null && !("subcategory" in data)) subcategory = existing.subcategory;

    Object.assign(existing, {
        name, yield_pct: yieldPct, weight_before: weightBefore, weight_after: weightAfter,
        is_frozen: isFrozen ? 1 : 0, subcategory,
    });
    delete existing.yield_est; // הוזנה ניצולת או משקל בעיבוד: כבר לא הערכה
    await dbPut("pantryItems", existing);
}

// פחת משורת מתכון: שומר את הניצולת במוצר (הוזנה ביד, לא הערכה). אם המוצר עוד לא היה בניצולת פעילה,
// שורות קיימות במתכונים אחרים מסומנות "בלי עיבוד" כדי שהעלות שלהן לא תשתנה.
export async function setLineYield(id, { yieldPct, weightBefore = "", weightAfter = "" }) {
    const existing = await dbGet("pantryItems", id);
    if (!existing) throw new Error("מוצר לא נמצא");
    if (!(yieldPct > 0 && yieldPct < 100)) throw new Error("ניצולת חייבת להיות בין 0 ל-100 אחוז");
    const wasActive = Number(existing.yield_pct || 100) !== 100 && !existing.yield_est;
    if (!wasActive) {
        for (const it of await dbGetAll("recipeItems")) {
            if (it.pantry_item_id === id && !it.prep) await dbPut("recipeItems", { ...it, prep: "raw" });
        }
    }
    existing.yield_pct = yieldPct;
    existing.weight_before = weightBefore === "" ? null : Number(weightBefore);
    existing.weight_after = weightAfter === "" ? null : Number(weightAfter);
    delete existing.yield_est;
    await dbPut("pantryItems", existing);
}

// ניצולת מוערכת הפכה לחלה תמיד בשורת מתכון: שורות קיימות של מוצר עם ניצולת מוערכת מסומנות "בלי ניצולת"
// פעם אחת, כדי שהעלות של מתכונים שכבר נשמרו לא תשתנה. מופעל פעם אחת בלבד (דגל בהגדרות).
export async function freezeEstimatedLines() {
    const pantry = new Map((await dbGetAll("pantryItems")).map((r) => [r.id, r]));
    for (const it of await dbGetAll("recipeItems")) {
        const row = it.pantry_item_id != null ? pantry.get(it.pantry_item_id) : null;
        if (row && row.yield_est && !it.prep) await dbPut("recipeItems", { ...it, prep: "raw" });
    }
}

// מוצר שנבחר בשורת מתכון ויש לו ניצולת מוכרת בטבלה: נשמרת כהערכה במוצר וחלה מעכשיו. שורות קיימות של אותו מוצר לא משתנות.
export async function setEstimatedYield(id, pct) {
    const row = await dbGet("pantryItems", id);
    if (!row || row.parent_id || row.unit_type !== "weight" || row.is_frozen || row.yield_est || !(pct > 0 && pct < 100)) return false;
    if (Number(row.yield_pct || 100) !== 100 || row.weight_before != null || row.weight_after != null) return false;
    for (const it of await dbGetAll("recipeItems")) {
        if (it.pantry_item_id === id && !it.prep) await dbPut("recipeItems", { ...it, prep: "raw" });
    }
    row.yield_pct = pct; row.yield_est = true;
    await dbPut("pantryItems", row);
    return true;
}

// מוחק פריט חומרי גלם אחד וכל מה שתלוי בו ישירות (ספירות מלאי), ומנתק אותו משורות חשבונית.
// מתכונים/מנות שהשתמשו בו נשארים עם העלות ששמורה בהם (תמונת מצב) - לא נמחקים.
async function purgePantryItem(id) {
    for (const c of await dbGetByIndex("inventoryCounts", "pantry_item_id", id)) {
        await dbDelete("inventoryCounts", c.id);
    }
    for (const it of await dbGetByIndex("invoiceItems", "pantry_item_id", id)) {
        await dbPut("invoiceItems", { ...it, pantry_item_id: null });
    }
    await dbDelete("pantryItems", id);
}

// מה יקרה אם מוחקים את הפריט: אילו תוצרים מפורקים יימחקו איתו, ובכמה מתכונים/מנות הוא משמש.
export async function getDeleteInfo(id) {
    const item = await dbGet("pantryItems", id);
    if (!item) throw new Error("מוצר לא נמצא");
    const children = await getChildren(id);
    const ids = new Set([id, ...children.map((c) => c.id)]);
    const allRecipeItems = await dbGetAll("recipeItems");
    const recipeIds = expandToParents(new Set(allRecipeItems.filter((r) => ids.has(r.pantry_item_id)).map((r) => r.recipe_id)), allRecipeItems); // כולל מתכונים שמשתמשים בהם כתת-מתכון
    const dishIds = new Set((await dbGetAll("dishItems")).filter((d) => d.source_type === "pantry" && ids.has(d.source_id)).map((d) => d.dish_id));
    return {
        id, name: item.name, is_child: !!item.parent_id,
        children: children.map((c) => ({ id: c.id, name: c.name })),
        recipe_count: recipeIds.size, dish_count: dishIds.size,
    };
}

const escHtml = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function deleteConfirmText(info) {
    let msg = `למחוק את "${escHtml(info.name)}"?`;
    if (info.children.length) msg += `<br>יימחקו גם ${info.children.length} תוצרים מפורקים שלו.`;
    if (info.recipe_count || info.dish_count) msg += `<br>משמש ב-${info.recipe_count} מתכונים וב-${info.dish_count} מנות.`;
    return msg;
}

// מחיקה בכל שלב: חומר גלם נמחק יחד עם התוצרים המפורקים שלו (האישור מציג מה יימחק).
export async function deletePantryItem(id) {
    for (const child of await getChildren(id)) {
        await purgePantryItem(child.id);
    }
    await purgePantryItem(id);
}

// מוחק רק את כל התוצרים המפורקים של חומר גלם (העיבוד), וחומר הגלם עצמו נשאר.
export async function deleteAllChildren(id) {
    const children = await getChildren(id);
    for (const child of children) {
        await purgePantryItem(child.id);
    }
    return children.length;
}

// ---- ביצים: הגודל נשמר על מוצר הביצה, והמשקל ללא קליפה נקבע ממנו (רק אם עוד אין משקל ליחידה) ----
// מנחש גודל לפי השם ושומר, ואם אין משקל ליחידה קובע את משקל הביצה ללא קליפה. מחזיר את שורת המוצר המעודכנת.
export async function ensureEggDefaults(row) {
    let changed = false;
    const size = row.egg_size && EGG_SIZES[row.egg_size] ? row.egg_size : guessEggSize(row.name);
    if (row.egg_size !== size) { row.egg_size = size; changed = true; }
    if (!(row.unit_amount > 0)) { row.unit_amount = EGG_SIZES[size].liquid; changed = true; }
    if (changed) await dbPut("pantryItems", row);
    return row;
}

// משנה גודל ביצה. משקל ליחידה מתעדכן אם הוא ריק, אם הוא היה ערך הטבלה של הגודל הקודם, או אם ביקשו במפורש (force)
export async function setEggSize(id, size, { force = false } = {}) {
    const row = await dbGet("pantryItems", id);
    if (!row || !EGG_SIZES[size]) throw new Error("ביצה לא נמצאה");
    const old = row.egg_size && EGG_SIZES[row.egg_size] ? EGG_SIZES[row.egg_size].liquid : null;
    row.egg_size = size;
    if (force || !(row.unit_amount > 0) || row.unit_amount === old) row.unit_amount = EGG_SIZES[size].liquid;
    await dbPut("pantryItems", row);
    return row;
}

// קובע אלרגנים למוצר (מאושר ידנית). תוצר מפורק יורש מחומר הגלם, לכן שומרים תמיד על מוצר ברמה העליונה.
// מחזיר את המוצר ל"לא ידוע" (מוחק הגדרה ידנית): המאגר יכריע אם הוא מכיר את הרכיב
export async function clearItemAllergens(id) {
    const row = await dbGet("pantryItems", id);
    if (!row) throw new Error("מוצר לא נמצא");
    const target = row.parent_id ? await dbGet("pantryItems", row.parent_id) : row;
    if (!target) throw new Error("מוצר לא נמצא");
    delete target.allergens;
    delete target.allergens_auto;
    await dbPut("pantryItems", target);
    return target;
}

export async function setItemAllergens(id, keys) {
    const row = await dbGet("pantryItems", id);
    if (!row) throw new Error("מוצר לא נמצא");
    const target = row.parent_id ? await dbGet("pantryItems", row.parent_id) : row;
    if (!target) throw new Error("מוצר לא נמצא");
    target.allergens = [...new Set(keys)];
    target.allergens_auto = false;
    await dbPut("pantryItems", target);
    return target;
}
