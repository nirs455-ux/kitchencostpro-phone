// לוגיקת מתכונים - תרגום מדויק של _resolve_recipe_items / add_recipe / update_recipe / delete_recipe.
import { dbGetAll, dbGet, dbPut, dbDelete, dbGetByIndex, dbDeleteWhere, dbAtomic, txReplaceChildren } from "../db.js";
import { ensureRecipeCategory } from "./recipeCategories.js";
import { pricePerGram, itemCost as calcItemCost, recipeCostPerGram, effectivePrice, isCountItem } from "../formulas.js";
import { ensureEggDefaults } from "./pantryRepo.js";
import { isEggProduct, eggSizeOf, allocateEggCosts } from "../eggs.js";
import { isSubRow, includesRecipe, expandToParents, flattenRecipeItems } from "./subRecipes.js";

// r.direct_items = השורות כפי שנשמרו (כולל תת-מתכונים). r.items = אותן שורות פרושות למוצרי חומרי גלם בלבד (לתווית, אלרגנים, תזונה, אחוזים ומחולל).
export async function listRecipesWithItems() {
    const recipes = await dbGetAll("recipes");
    const allItems = await dbGetAll("recipeItems");
    const byRecipe = new Map();
    for (const row of allItems) { if (!byRecipe.has(row.recipe_id)) byRecipe.set(row.recipe_id, []); byRecipe.get(row.recipe_id).push(row); }
    const recipeById = new Map(recipes.map((r) => [r.id, r]));
    const itemsOf = (id) => byRecipe.get(id) || [];
    return recipes.map((r) => {
        const direct = itemsOf(r.id).map((row) => (isSubRow(row) && !recipeById.has(row.sub_recipe_id) ? { ...row, sub_missing: true } : row));
        const hasSub = direct.some(isSubRow);
        return { ...r, direct_items: direct, has_sub: hasSub, items: hasSub ? flattenRecipeItems(direct, recipeById, itemsOf) : direct };
    });
}

// מתכונים שאפשר להוסיף כתת-מתכון: מוכנים (לא טיוטה), לא המתכון עצמו ולא מתכון שכבר כולל אותו (מעגל)
export async function listSubRecipeOptions(selfId = null) {
    const recipes = await dbGetAll("recipes");
    const allItems = selfId ? await dbGetAll("recipeItems") : [];
    return recipes
        .filter((r) => r.status !== "draft" && r.id !== selfId && !(selfId && includesRecipe(r.id, selfId, allItems)))
        .map((r) => ({ id: r.id, name: r.name, category: r.category, cost_per_gram: r.cost_per_gram, final_weight: r.final_weight }));
}

// בכמה מתכונים אחרים המתכון משמש כתת-מתכון (ישירות או בעומק)
export async function recipeParentCount(id) {
    const parents = expandToParents([id], await dbGetAll("recipeItems"));
    parents.delete(id);
    return parents.size;
}

// selfId: המתכון שנשמר כרגע (כדי לחסום מעגל: מתכון שמכיל את עצמו)
// cache (לא חובה): { pantry: Map, recipes: Map, recipeItems: [] } שנטענו פעם אחת (חישוב מחדש של הכול). בלעדיו קוראים מהמסד לכל רכיב.
// שורה שהוקלדה באחוזים: הגרמים נשמרים ב-quantity_g (כך כל החישובים נשארים כמו שהיו), והאחוז נשמר רק כדי להציג אותו שוב בעריכה
const EST_MODES = ["est_s", "est_m", "est_l", "juice"];
const pctFields = (it) => ({
    ...((it.pct_mode === "base" || it.pct_mode === "total") && Number(it.pct) > 0 ? { pct: Number(it.pct), pct_mode: it.pct_mode } : {}),
    // הערכה: יחידות לפי משקל ממוצע (est_s/m/l) או מ"ל מיץ שמחושבים לפירות (juice). quantity_g נשמר בגרמים
    ...(EST_MODES.includes(it.est_mode) && Number(it.est_n) > 0 ? { est_mode: it.est_mode, est_n: Number(it.est_n) } : {}),
});

export async function resolveRecipeItems(items, { selfId = null, cache = null } = {}) {
    const getRecipe = async (id) => (cache ? cache.recipes.get(id) : await dbGet("recipes", id));
    const getPantry = async (id) => (cache ? cache.pantry.get(id) : await dbGet("pantryItems", id));
    const resolved = [];
    const eggRows = [];
    let totalCost = 0;
    let rawWeight = 0;
    let allRecipeItems = null;
    for (const it of items) {
        if (it.sub_recipe_id != null && it.sub_recipe_id !== "") {
            const subId = parseInt(it.sub_recipe_id, 10);
            const q = parseFloat(it.quantity_g);
            if (Number.isNaN(subId) || Number.isNaN(q)) throw new Error("מרכיב עם נתונים לא תקינים");
            if (q <= 0) throw new Error("כמות חייבת להיות גדולה מ-0");
            const sub = await getRecipe(subId);
            if (!sub) throw new Error("תת-מתכון לא נמצא");
            if (selfId != null) {
                if (!allRecipeItems) allRecipeItems = cache ? cache.recipeItems : await dbGetAll("recipeItems");
                if (includesRecipe(subId, selfId, allRecipeItems)) throw new Error(`אי אפשר להוסיף את '${sub.name}' למתכון הזה: הוא כולל אותו בעצמו (מעגל).`);
            }
            if (sub.status === "draft") throw new Error(`'${sub.name}' עדיין טיוטה (חסרים רכיבים). השלם אותו לפני שימוש כתת-מתכון.`);
            const spg = sub.cost_per_gram || 0;
            const scost = calcItemCost(spg, q);
            totalCost += scost;
            rawWeight += q;
            resolved.push({ pantry_item_id: null, sub_recipe_id: subId, ingredient_name: sub.name, quantity_g: q, price_per_gram: spg, item_cost: scost, ...pctFields(it) });
            continue;
        }
        const pantryId = parseInt(it.pantry_item_id, 10);
        const qty = parseFloat(it.quantity_g);
        if (Number.isNaN(pantryId) || Number.isNaN(qty)) throw new Error("מרכיב עם נתונים לא תקינים");
        if (qty <= 0) throw new Error("כמות חייבת להיות גדולה מ-0");
        let row = await getPantry(pantryId);
        if (!row) throw new Error("מרכיב לא נמצא בחומרי הגלם");
        const eggPart = ["whole", "white", "yolk"].includes(it.egg_part) && isEggProduct(row) ? it.egg_part : null;
        if (eggPart) row = await ensureEggDefaults(row); // גודל ומשקל ללא קליפה אוטומטיים אם חסרים
        if (isCountItem(row) && isEggProduct(row)) throw new Error(`'${row.name}' חסר משקל ליחידה - השלם אותו בחומרי הגלם לפני השימוש במתכון`);
        const count = isCountItem(row);
        const ppg = pricePerGram(row);
        const cost = calcItemCost(ppg, qty);
        totalCost += cost;
        if (!count) rawWeight += qty; // מוצר ספירה (יחידות בלי משקל): הכמות היא יחידות ולא גרמים
        resolved.push({ pantry_item_id: pantryId, ingredient_name: row.name, quantity_g: qty, price_per_gram: ppg, item_cost: cost, ...(count ? { unit_count: true } : {}), ...(eggPart ? { egg_part: eggPart } : {}), ...pctFields(it) });
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
    data = { ...data, category: String(data.category || "").replace(/\s+/g, " ").trim() };
    if (!data.category || data.category.length > 30) throw new Error("קטגוריה לא תקינה");
    await ensureRecipeCategory(data.category);
    // רכיבים שעדיין לא בחומרי הגלם נשמרים כטיוטה (draft_ingredients) ואפשר להשלים אותם אחר כך; העלות מחושבת רק מהרכיבים שבחומרי הגלם
    const draftIngredients = (data.draft_ingredients || [])
        .map((d) => ({ name: String(d.name || "").trim(), quantity: d.quantity ?? null, unit: d.unit ?? null, ...(d.manual ? { manual: true } : {}) }))
        .filter((d) => d.name);
    const items = data.items || [];
    if (items.length === 0 && draftIngredients.length === 0) throw new Error("יש להוסיף לפחות מרכיב אחד");
    {
        const key = name.toLowerCase();
        const prevName = existingId ? String(((await dbGet("recipes", existingId)) || {}).name || "").trim().toLowerCase() : null;
        const clash = prevName === key ? null : (await dbGetAll("recipes")).find((r) => r.id !== existingId && String(r.name || "").trim().toLowerCase() === key);
        if (clash) throw new Error("כבר קיים מתכון בשם הזה. שנה את השם או ערוך את הקיים.");
    }

    const { resolved, totalCost, rawWeight } = await resolveRecipeItems(items, { selfId: existingId });
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
    }
    // המתכון והרכיבים נשמרים בטרנזקציה אחת: קריסה באמצע לא משאירה מתכון בלי רכיבים
    await dbAtomic(["recipes", "recipeItems"], (t) => {
        if (existingId) {
            t.objectStore("recipes").put(recipeRow);
            txReplaceChildren(t, "recipeItems", "recipe_id", existingId, resolved.map((it) => ({ ...it, recipe_id: existingId })));
        } else {
            const req = t.objectStore("recipes").put(recipeRow);
            req.onsuccess = () => { recipeId = req.result; for (const it of resolved) t.objectStore("recipeItems").put({ ...it, recipe_id: recipeId }); };
        }
    });
    return recipeId;
}

// מחליף בכל שורות המתכון את מוצר חומרי הגלם pantryItemId בתת-מתכון subId (אותה כמות בגרמים). שאר המתכון נשמר כמו שהוא.
export async function replaceIngredientWithSubRecipe(recipeId, pantryItemId, subId) {
    const recipe = await dbGet("recipes", recipeId);
    if (!recipe) throw new Error("מתכון לא נמצא");
    const rows = await dbGetByIndex("recipeItems", "recipe_id", recipeId);
    let replaced = 0;
    const items = rows.map((row) => {
        if (row.sub_recipe_id != null) return { sub_recipe_id: row.sub_recipe_id, quantity_g: row.quantity_g };
        if (row.pantry_item_id === pantryItemId) { replaced++; return { sub_recipe_id: subId, quantity_g: row.quantity_g }; }
        return { pantry_item_id: row.pantry_item_id, quantity_g: row.quantity_g, ...(row.egg_part ? { egg_part: row.egg_part } : {}) };
    });
    if (!replaced) throw new Error("הרכיב לא נמצא במתכון");
    await saveRecipe(recipeId, {
        name: recipe.name, category: recipe.category, items, draft_ingredients: recipe.draft_ingredients || [], method: recipe.method || "",
        final_weight: recipe.is_auto_weight ? "" : String(recipe.final_weight),
    });
    return replaced;
}

// כמה מנות משתמשות במתכון (להתראה לפני מחיקה)
export async function recipeDishCount(id) {
    const rows = (await dbGetAll("dishItems")).filter((d) => d.source_type === "recipe" && d.source_id === id);
    return new Set(rows.map((r) => r.dish_id)).size;
}

export async function deleteRecipe(id) {
    // מתכון שנמחק ומשמש כתת-מתכון: השורה אצל המתכון המשתמש נשארת כ"נמחק" (אדום) עם העלות האחרונה
    await dbDeleteWhere("recipeItems", "recipe_id", id);
    await dbDelete("recipes", id);
}

// שומר את בחירת הבסיס (למתכון באחוזים): ids = מזהי מוצרי חומרי גלם, source = manual | auto | ai
export async function setRecipeBase(id, { base_ids, base_source, base_reason }) {
    const r = await dbGet("recipes", id);
    if (!r) throw new Error("מתכון לא נמצא");
    await dbPut("recipes", { ...r, base_ids, base_source, base_reason: base_reason || "" });
}
