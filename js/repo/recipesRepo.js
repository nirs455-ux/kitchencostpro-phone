// לוגיקת מתכונים - תרגום מדויק של _resolve_recipe_items / add_recipe / update_recipe / delete_recipe.
import { dbGetAll, dbGet, dbPut, dbDelete, dbGetByIndex, dbDeleteWhere } from "../db.js";
import { RECIPE_CATEGORIES } from "../constants.js";
import { pricePerGram, itemCost as calcItemCost, recipeCostPerGram } from "../formulas.js";

export async function listRecipesWithItems() {
    const recipes = await dbGetAll("recipes");
    const out = [];
    for (const r of recipes) {
        const items = await dbGetByIndex("recipeItems", "recipe_id", r.id);
        out.push({ ...r, items });
    }
    return out;
}

async function resolveRecipeItems(items) {
    const resolved = [];
    let totalCost = 0;
    let rawWeight = 0;
    for (const it of items) {
        const pantryId = parseInt(it.pantry_item_id, 10);
        const qty = parseFloat(it.quantity_g);
        if (Number.isNaN(pantryId) || Number.isNaN(qty)) throw new Error("מרכיב עם נתונים לא תקינים");
        if (qty <= 0) throw new Error("כמות חייבת להיות גדולה מ-0");
        const row = await dbGet("pantryItems", pantryId);
        if (!row) throw new Error("מרכיב לא נמצא במזווה");
        const ppg = pricePerGram(row);
        const cost = calcItemCost(ppg, qty);
        totalCost += cost;
        rawWeight += qty;
        resolved.push({ pantry_item_id: pantryId, ingredient_name: row.name, quantity_g: qty, price_per_gram: ppg, item_cost: cost });
    }
    return { resolved, totalCost, rawWeight };
}

function computeWeight(manualWeight, rawWeight) {
    const mw = manualWeight === "" || manualWeight == null ? 0 : parseFloat(manualWeight);
    if (mw && mw > 0) return { finalWeight: mw, isAutoWeight: 0 };
    return { finalWeight: rawWeight, isAutoWeight: 1 };
}

export async function saveRecipe(existingId, data) {
    const name = (data.name || "").trim();
    if (!name) throw new Error("יש להזין שם מתכון");
    if (!RECIPE_CATEGORIES.includes(data.category)) throw new Error("קטגוריה לא תקינה");
    if (!data.items || data.items.length === 0) throw new Error("יש להוסיף לפחות מרכיב אחד");

    const { resolved, totalCost, rawWeight } = await resolveRecipeItems(data.items);
    const { finalWeight, isAutoWeight } = computeWeight(data.final_weight, rawWeight);
    const costPerGram = recipeCostPerGram(totalCost, finalWeight);

    const recipeRow = {
        name, category: data.category, final_weight: finalWeight, is_auto_weight: isAutoWeight,
        total_cost: Math.round(totalCost * 100) / 100, cost_per_gram: costPerGram,
    };
    let recipeId = existingId;
    if (existingId) {
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

export async function deleteRecipe(id) {
    await dbDeleteWhere("recipeItems", "recipe_id", id);
    await dbDelete("recipes", id);
}
