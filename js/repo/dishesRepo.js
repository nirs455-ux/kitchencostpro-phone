// לוגיקת מנות - תרגום מדויק של _resolve_dish_items / _parse_dish_payload / add_dish / update_dish / delete_dish.
import { dbGetAll, dbGet, dbPut, dbDelete, dbGetByIndex, dbDeleteWhere } from "../db.js";
import { pricePerGram, itemCost as calcItemCost, computeDishPricing } from "../formulas.js";

export async function listDishesWithItems() {
    const dishes = await dbGetAll("dishes");
    const out = [];
    for (const d of dishes) {
        const items = await dbGetByIndex("dishItems", "dish_id", d.id);
        out.push({ ...d, items });
    }
    return out;
}

// cache (לא חובה): { pantry: Map, recipes: Map } שנטענו פעם אחת (חישוב מחדש של הכול)
export async function resolveDishItems(items, { cache = null } = {}) {
    const resolved = [];
    let totalCost = 0;
    for (const it of items) {
        const sourceType = it.source_type;
        const sourceId = parseInt(it.source_id, 10);
        const qty = parseFloat(it.quantity_g);
        if (Number.isNaN(sourceId) || Number.isNaN(qty)) throw new Error("מרכיב עם נתונים לא תקינים");
        if (qty <= 0) throw new Error("כמות חייבת להיות גדולה מ-0");

        let ppg, sourceName;
        if (sourceType === "pantry") {
            const row = cache ? cache.pantry.get(sourceId) : await dbGet("pantryItems", sourceId);
            if (!row) throw new Error("מרכיב לא נמצא במזווה");
            if (row.unit_type === "unit" && !row.unit_amount) throw new Error(`'${row.name}' חסר משקל ליחידה - השלם אותו במזווה לפני השימוש במנה`);
            ppg = pricePerGram(row);
            sourceName = row.name;
        } else if (sourceType === "recipe") {
            const row = cache ? cache.recipes.get(sourceId) : await dbGet("recipes", sourceId);
            if (!row) throw new Error("מתכון לא נמצא");
            if (row.status === "draft") throw new Error(`המתכון '${row.name}' עדיין טיוטה (חסרים רכיבים). השלם אותו בדף המתכונים לפני שימוש במנה.`);
            ppg = row.cost_per_gram;
            sourceName = row.name;
        } else {
            throw new Error("סוג מרכיב לא תקין");
        }
        const cost = calcItemCost(ppg, qty);
        totalCost += cost;
        resolved.push({ source_type: sourceType, source_id: sourceId, source_name: sourceName, quantity_g: qty, price_per_gram: ppg, item_cost: cost });
    }
    return { resolved, totalCost };
}

function parseDishPayload(data) {
    const name = (data.name || "").trim();
    if (!name) throw new Error("יש להזין שם מנה");
    if (!data.items || data.items.length === 0) throw new Error("יש להוסיף לפחות מרכיב אחד");
    const sellingPrice = parseFloat(data.selling_price);
    if (Number.isNaN(sellingPrice) || sellingPrice <= 0) throw new Error("יש להזין מחיר מכירה תקין");
    if (sellingPrice > 1000000) throw new Error("מחיר המכירה גבוה מדי - בדוק שלא הוזן מספר שגוי");
    let vatPct = parseFloat(data.vat_pct);
    if (Number.isNaN(vatPct)) vatPct = 0;
    if (vatPct < 0 || vatPct > 100) throw new Error("מע\"מ חייב להיות בין 0 ל-100");
    let targetProfitPct = data.target_profit_pct === "" || data.target_profit_pct == null ? null : parseFloat(data.target_profit_pct);
    if (Number.isNaN(targetProfitPct)) targetProfitPct = null;
    let multiplier = data.multiplier === "" || data.multiplier == null ? null : parseFloat(data.multiplier);
    if (Number.isNaN(multiplier)) multiplier = null;
    return { name, items: data.items, selling_price: sellingPrice, vat_pct: vatPct, target_profit_pct: targetProfitPct, multiplier };
}

export async function saveDish(existingId, data) {
    const clean = parseDishPayload(data);
    {
        const key = clean.name.toLowerCase();
        const prevName = existingId ? String(((await dbGet("dishes", existingId)) || {}).name || "").trim().toLowerCase() : null;
        const clash = prevName === key ? null : (await dbGetAll("dishes")).find((d) => d.id !== existingId && String(d.name || "").trim().toLowerCase() === key);
        if (clash) throw new Error("כבר קיימת מנה בשם הזה. שנה את השם או ערוך את הקיימת.");
    }
    const { resolved, totalCost } = await resolveDishItems(clean.items);
    const pricing = computeDishPricing(totalCost, clean.selling_price, clean.vat_pct);

    const dishRow = {
        name: clean.name, vat_pct: clean.vat_pct, target_profit_pct: clean.target_profit_pct,
        multiplier: clean.multiplier, selling_price: clean.selling_price, ...pricing,
    };
    let dishId = existingId;
    if (existingId) {
        dishRow.id = existingId;
        await dbPut("dishes", dishRow);
        await dbDeleteWhere("dishItems", "dish_id", existingId);
    } else {
        dishId = await dbPut("dishes", dishRow);
    }
    for (const it of resolved) {
        await dbPut("dishItems", { ...it, dish_id: dishId });
    }
    return dishId;
}

export async function deleteDish(id) {
    await dbDeleteWhere("dishItems", "dish_id", id);
    await dbDelete("dishes", id);
}
