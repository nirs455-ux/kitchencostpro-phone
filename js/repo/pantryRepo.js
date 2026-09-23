// לוגיקת מזווה - תרגום מדויק של _validate_payload / add_item / update_item / update_item_yield / delete_item מ-main.py.
import { dbGetAll, dbGet, dbPut, dbDelete, dbGetByIndex } from "../db.js";
import { CATEGORY_GROUPS, UNIT_TYPES } from "../constants.js";
import { computeYieldPct } from "../formulas.js";

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
export async function addPantryItem(data) {
    const name = (data.name || "").trim();
    const { weightBefore, weightAfter, yieldPct, isFrozen } = validateBase(data);

    if (!name || !(data.category in CATEGORY_GROUPS) || !UNIT_TYPES.includes(data.unit_type)) {
        throw new Error("נתונים חסרים או שגויים");
    }
    const allowedSubs = CATEGORY_GROUPS[data.category];
    let subcategory = (data.subcategory || "").trim() || null;
    if (subcategory && allowedSubs.length && !allowedSubs.includes(subcategory)) {
        throw new Error("תת-קטגוריה לא תקינה");
    }
    if (!allowedSubs.length || !subcategory) subcategory = null;

    const price = parseFloat(data.price);
    if (Number.isNaN(price)) throw new Error("מחיר לא תקין");

    let unitAmount = null;
    if (data.unit_type === "unit") {
        unitAmount = parseFloat(data.unit_amount);
        if (Number.isNaN(unitAmount)) throw new Error("יש להזין משקל/נפח ליחידה");
    }

    const row = {
        name, category: data.category, subcategory, unit_type: data.unit_type, unit_amount: unitAmount,
        price, yield_pct: yieldPct, weight_before: weightBefore, weight_after: weightAfter,
        is_frozen: isFrozen ? 1 : 0, parent_id: null,
    };
    const id = await dbPut("pantryItems", row);
    return id;
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
    const price = parseFloat(data.price);
    if (Number.isNaN(price)) throw new Error("מחיר לא תקין");

    let unitAmount = null;
    if (data.unit_type === "unit") {
        unitAmount = parseFloat(data.unit_amount);
        if (Number.isNaN(unitAmount)) throw new Error("יש להזין משקל/נפח ליחידה");
    }

    let newSubcategory = existing.subcategory;
    const allowedSubs = CATEGORY_GROUPS[data.category];
    if (newSubcategory && !allowedSubs.includes(newSubcategory)) newSubcategory = null;

    Object.assign(existing, {
        name, category: data.category, subcategory: newSubcategory, unit_type: data.unit_type,
        unit_amount: unitAmount, price, is_frozen: isFrozen ? 1 : 0,
    });
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
    await dbPut("pantryItems", existing);
}

export async function deletePantryItem(id) {
    const children = await getChildren(id);
    if (children.length > 0) {
        throw new Error("לא ניתן למחוק חומר גלם שיש לו תוצרים מפורקים - מחק קודם את התוצרים");
    }
    await dbDelete("pantryItems", id);
}
