// לוגיקת מתכונים - תרגום מדויק של _resolve_recipe_items / add_recipe / update_recipe / delete_recipe.
import { dbGetAll, dbGet, dbPut, dbDelete, dbGetByIndex, dbDeleteWhere } from "../db.js";
import { RECIPE_CATEGORIES } from "../constants.js";
import { pricePerGram, itemCost as calcItemCost, recipeCostPerGram, effectivePrice } from "../formulas.js";
import { ensureEggDefaults } from "./pantryRepo.js";
import { isEggProduct, eggSizeOf, allocateEggCosts } from "../eggs.js";

export async function listRecipesWithItems() {
    const recipes = await dbGetAll("recipes");
    const out = [];
    for (const r of recipes) {
        const items = await dbGetByIndex("recipeItems", "recipe_id", r.id);
        out.push({ ...r, items });
    }
    return out;
}

export async function resolveRecipeItems(items) {
    const resolved = [];
    const eggRows = [];
    let totalCost = 0;
    let rawWeight = 0;
    for (const it of items) {
        const pantryId = parseInt(it.pantry_item_id, 10);
        const qty = parseFloat(it.quantity_g);
        if (Number.isNaN(pantryId) || Number.isNaN(qty)) throw new Error("מרכיב עם נתונים לא תקינים");
        if (qty <= 0) throw new Error("כמות חייבת להיות גדולה מ-0");
        let row = await dbGet("pantryItems", pantryId);
        if (!row) throw new Error("מרכיב לא נמצא במזווה");
        const eggPart = ["whole", "white", "yolk"].includes(it.egg_part) && isEggProduct(row) ? it.egg_part : null;
        if (eggPart) row = await ensureEggDefaults(row); // גודל ומשקל ללא קליפה אוטומטיים אם חסרים
        if (row.unit_type === "unit" && !row.unit_amount) throw new Error(`'${row.name}' חסר משקל ליחידה - השלם אותו במזווה לפני השימוש במתכון`);
        const ppg = pricePerGram(row);
        const cost = calcItemCost(ppg, qty);
        totalCost += cost;
        rawWeight += qty;
        resolved.push({ pantry_item_id: pantryId, ingredient_name: row.name, quantity_g: qty, price_per_gram: ppg, item_cost: cost, ...(eggPart ? { egg_part: eggPart } : {}) });
        if (eggPart) eggRows.push({ idx: resolved.length - 1, row });
    }
    // ביצים: משלמים על כל הביצים ששוברים (לא רק על הגרמים שבשימוש). העלות מתחלקת בין שורות הביצים של אותו מוצר
    const byEgg = new Map();
    for (const e of eggRows) byEgg.set(e.row.id, [...(byEgg.get(e.row.id) || []), e]);
    for (const group of byEgg.values()) {
        const row = group[0].row;
        const price = effectivePrice(row.price, row.yield_pct, row.is_frozen);
        const { costs } = allocateEggCosts(group.map((e) => ({ egg_part: resolved[e.idx].egg_part, grams: resolved[e.idx].quantity_g })), eggSizeOf(row), price);
        group.forEach((e, i) => {
            totalCost += costs[i] - resolved[e.idx].item_cost;
            resolved[e.idx].item_cost = costs[i];
            resolved[e.idx].price_per_gram = resolved[e.idx].quantity_g > 0 ? costs[i] / resolved[e.idx].quantity_g : 0;
        });
    }
    return { resolved, totalCost, rawWeight };
}

function computeWeight(manualWeight, rawWeight) {
    const mw = manualWeight === "" || manualWeight == null ? 0 : parseFloat(manualWeight);
    if (mw < 0) throw new Error("משקל סופי לא יכול להיות שלילי");
    if (mw && mw > 0) return { finalWeight: mw, isAutoWeight: 0 };
    return { finalWeight: rawWeight, isAutoWeight: 1 };
}

export async function saveRecipe(existingId, data) {
    const name = (data.name || "").trim();
    if (!name) throw new Error("יש להזין שם מתכון");
    if (!RECIPE_CATEGORIES.includes(data.category)) throw new Error("קטגוריה לא תקינה");
    // רכיבים שעדיין לא במזווה נשמרים כטיוטה (draft_ingredients) ואפשר להשלים אותם אחר כך; העלות מחושבת רק מהרכיבים שבמזווה
    const draftIngredients = (data.draft_ingredients || [])
        .map((d) => ({ name: String(d.name || "").trim(), quantity: d.quantity ?? null, unit: d.unit ?? null }))
        .filter((d) => d.name);
    const items = data.items || [];
    if (items.length === 0 && draftIngredients.length === 0) throw new Error("יש להוסיף לפחות מרכיב אחד");
    {
        const key = name.toLowerCase();
        const prevName = existingId ? String(((await dbGet("recipes", existingId)) || {}).name || "").trim().toLowerCase() : null;
        const clash = prevName === key ? null : (await dbGetAll("recipes")).find((r) => r.id !== existingId && String(r.name || "").trim().toLowerCase() === key);
        if (clash) throw new Error("כבר קיים מתכון בשם הזה. שנה את השם או ערוך את הקיים.");
    }

    const { resolved, totalCost, rawWeight } = await resolveRecipeItems(items);
    const { finalWeight, isAutoWeight } = computeWeight(data.final_weight, rawWeight);
    const costPerGram = recipeCostPerGram(totalCost, finalWeight);

    const recipeRow = {
        name, category: data.category, final_weight: finalWeight, is_auto_weight: isAutoWeight,
        total_cost: Math.round(totalCost * 100) / 100, cost_per_gram: costPerGram,
        status: draftIngredients.length ? "draft" : "ready",
        draft_ingredients: draftIngredients,
        method: (data.method || "").trim() || null,
    };
    // קובץ המקור: Blob חדש = החלפה; null = הסרה; לא הועבר = נשמר הקיים
    if (data.source_file instanceof Blob) recipeRow.source_file = data.source_file;
    if (data.source_text) recipeRow.source_text = data.source_text;
    let recipeId = existingId;
    if (existingId) {
        const prev = await dbGet("recipes", existingId);
        if (prev) {
            if (data.source_file === undefined && prev.source_file) recipeRow.source_file = prev.source_file;
            if (!data.source_text && prev.source_text) recipeRow.source_text = prev.source_text;
        }
        recipeRow.id = existingId;
        await dbPut("recipes", recipeRow);
        await dbDeleteWhere("recipeItems", "recipe_id", existingId);
    } else {
        recipeId = await dbPut("recipes", recipeRow);
    }
    for (const it of resolved) {
        await dbPut("recipeItems", { ...it, recipe_id: recipeId });
    }
    return recipeId;
}

// כמה מנות משתמשות במתכון (להתראה לפני מחיקה)
export async function recipeDishCount(id) {
    const rows = (await dbGetAll("dishItems")).filter((d) => d.source_type === "recipe" && d.source_id === id);
    return new Set(rows.map((r) => r.dish_id)).size;
}

export async function deleteRecipe(id) {
    await dbDeleteWhere("recipeItems", "recipe_id", id);
    await dbDelete("recipes", id);
}

// שומר את בחירת הבסיס (למתכון באחוזים): ids = מזהי מוצרי מזווה, source = manual | auto | ai
export async function setRecipeBase(id, { base_ids, base_source, base_reason }) {
    const r = await dbGet("recipes", id);
    if (!r) throw new Error("מתכון לא נמצא");
    await dbPut("recipes", { ...r, base_ids, base_source, base_reason: base_reason || "" });
}
