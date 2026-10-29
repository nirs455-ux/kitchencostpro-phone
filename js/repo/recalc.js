// חישוב עלויות מחדש: עלות מתכון ומנה נשמרת בעת השמירה, ולכן כששינו מחיר/ניצולת/קפוא של מוצר בחומרי הגלם (ידנית או דרך חשבונית)
// העלויות נשארו ישנות. כאן מחשבים מחדש את כל המתכונים (לפי חומרי הגלם הנוכחי) ואז את כל המנות (שתלויות בהם ובחומרי הגלם).
// רכיב שנמחק מחומרי הגלם נשאר עם העלות האחרונה שלו (אי אפשר לחשב), ומסומן ghost. כותבים למסד רק מה ששינה ערך.
import { dbGet, dbGetAll, dbPut, onDbChange } from "../db.js";
import { isSubRow } from "./subRecipes.js";
import { recipeCostPerGram, computeDishPricing } from "../formulas.js";
import { resolveRecipeItems } from "./recipesRepo.js";
import { resolveDishItems } from "./dishesRepo.js";

const r2 = (n) => Math.round(n * 100) / 100;
// כותב רק את שדות העלות על השורה העדכנית במסד (לא על עותק שנטען קודם): עריכה שנשמרה בזמן החישוב לא נדרסת
async function patchRow(store, id, patch) {
    const fresh = await dbGet(store, id);
    if (!fresh) return null;
    const row = { ...fresh, ...patch };
    await dbPut(store, row);
    return row;
}
const differs = (a, b) => Math.abs((Number(a) || 0) - (Number(b) || 0)) > 1e-9;

// תת-מתכונים: מחשבים קודם את תת-המתכון ואז את מי שמשתמש בו (סדר טופולוגי; מעגל לא תוקע כי כל מתכון מבוקר פעם אחת)
async function recipesInDependencyOrder() {
    const recipes = await dbGetAll("recipes");
    const allItems = await dbGetAll("recipeItems");
    const byId = new Map(recipes.map((r) => [r.id, r]));
    const subsOf = new Map();
    for (const row of allItems) if (isSubRow(row)) { if (!subsOf.has(row.recipe_id)) subsOf.set(row.recipe_id, []); subsOf.get(row.recipe_id).push(row.sub_recipe_id); }
    const seen = new Set();
    const order = [];
    const visit = (id) => {
        if (seen.has(id) || !byId.has(id)) return;
        seen.add(id);
        for (const s of subsOf.get(id) || []) visit(s);
        order.push(byId.get(id));
    };
    for (const r of recipes) visit(r.id);
    return order;
}

// טוענים מוצרים, מתכונים ושורות פעם אחת (במקום קריאה למסד לכל רכיב): חישוב מחדש של מאות מתכונים הופך מכמה שניות לחלקיק שנייה.
async function loadCache() {
    const [pantry, recipes, recipeItems] = await Promise.all([dbGetAll("pantryItems"), dbGetAll("recipes"), dbGetAll("recipeItems")]);
    const byRecipe = new Map();
    for (const row of recipeItems) { if (!byRecipe.has(row.recipe_id)) byRecipe.set(row.recipe_id, []); byRecipe.get(row.recipe_id).push(row); }
    return { pantry: new Map(pantry.map((p) => [p.id, p])), recipes: new Map(recipes.map((r) => [r.id, r])), recipeItems, byRecipe };
}

async function recalcRecipes(cache) {
    let changed = 0;
    for (const recipeStale of await recipesInDependencyOrder()) {
        const recipe = cache.recipes.get(recipeStale.id) || recipeStale;
        const rows = cache.byRecipe.get(recipe.id) || [];
        if (!rows.length) continue;
        const live = [], ghosts = [];
        for (const r of rows) ((isSubRow(r) ? cache.recipes.get(r.sub_recipe_id) : cache.pantry.get(r.pantry_item_id)) ? live : ghosts).push(r);
        let resolved = { resolved: [], totalCost: 0, rawWeight: 0 };
        try {
            if (live.length) resolved = await resolveRecipeItems(live.map((r) => ({ pantry_item_id: r.pantry_item_id, sub_recipe_id: r.sub_recipe_id, quantity_g: r.quantity_g, egg_part: r.egg_part })), { selfId: recipe.id, cache });
        } catch (e) { continue; } // למשל מוצר ביחידות שאיבד משקל ליחידה: משאירים כמו שהיה
        const ghostCost = ghosts.reduce((n, r) => n + (Number(r.item_cost) || 0), 0);
        const ghostGrams = ghosts.reduce((n, r) => n + (r.unit_count ? 0 : Number(r.quantity_g) || 0), 0);
        const total = resolved.totalCost + ghostCost;
        const finalWeight = recipe.is_auto_weight ? resolved.rawWeight + ghostGrams : recipe.final_weight;
        const cpg = recipeCostPerGram(total, finalWeight);
        const newTotal = r2(total);

        let rowChanged = false;
        for (let i = 0; i < live.length; i++) {
            const n = resolved.resolved[i];
            if (differs(live[i].item_cost, n.item_cost) || differs(live[i].price_per_gram, n.price_per_gram) || live[i].ingredient_name !== n.ingredient_name) {
                await patchRow("recipeItems", live[i].id, { item_cost: n.item_cost, price_per_gram: n.price_per_gram, ingredient_name: n.ingredient_name });
                rowChanged = true;
            }
        }
        if (rowChanged || differs(recipe.total_cost, newTotal) || differs(recipe.cost_per_gram, cpg) || differs(recipe.final_weight, finalWeight)) {
            const updated = (await patchRow("recipes", recipe.id, { total_cost: newTotal, cost_per_gram: cpg, final_weight: finalWeight })) || { ...recipe, total_cost: newTotal, cost_per_gram: cpg, final_weight: finalWeight };
            cache.recipes.set(recipe.id, updated); // תת-מתכון מחושב לפני מי שמשתמש בו: המתכון המשתמש רואה את העלות המעודכנת
            changed++;
        }
    }
    return changed;
}

async function recalcDishes(cache) {
    let changed = 0;
    const byDish = new Map();
    for (const row of await dbGetAll("dishItems")) { if (!byDish.has(row.dish_id)) byDish.set(row.dish_id, []); byDish.get(row.dish_id).push(row); }
    for (const dish of await dbGetAll("dishes")) {
        const rows = byDish.get(dish.id) || [];
        if (!rows.length) continue;
        const live = [], ghosts = [];
        for (const r of rows) {
            const src = r.source_type === "recipe" ? cache.recipes.get(r.source_id) : cache.pantry.get(r.source_id);
            (src ? live : ghosts).push(r);
        }
        let resolved = { resolved: [], totalCost: 0 };
        try {
            if (live.length) resolved = await resolveDishItems(live.map((r) => ({ source_type: r.source_type, source_id: r.source_id, quantity_g: r.quantity_g })), { cache });
        } catch (e) { continue; } // מתכון שחזר להיות טיוטה וכו': משאירים
        const total = resolved.totalCost + ghosts.reduce((n, r) => n + (Number(r.item_cost) || 0), 0);
        const pricing = computeDishPricing(total, dish.selling_price, dish.vat_pct);
        let rowChanged = false;
        for (let i = 0; i < live.length; i++) {
            const n = resolved.resolved[i];
            if (differs(live[i].item_cost, n.item_cost) || differs(live[i].price_per_gram, n.price_per_gram) || live[i].source_name !== n.source_name) {
                await patchRow("dishItems", live[i].id, { item_cost: n.item_cost, price_per_gram: n.price_per_gram, source_name: n.source_name });
                rowChanged = true;
            }
        }
        if (rowChanged || differs(dish.total_cost, pricing.total_cost) || differs(dish.food_cost_pct, pricing.food_cost_pct) || differs(dish.profit_amount, pricing.profit_amount)) {
            await patchRow("dishes", dish.id, pricing);
            changed++;
        }
    }
    return changed;
}

// מחשב מחדש הכול. מחזיר כמה מתכונים ומנות השתנו.
export async function recalcAllCosts() {
    const cache = await loadCache();
    const recipes = await recalcRecipes(cache);
    const dishes = await recalcDishes(cache);
    return { recipes, dishes };
}

// ---- הפעלה אוטומטית: כל שינוי בחומרי הגלם מפעיל חישוב מחדש (בהשהיה קצרה). ניווט בין מסכים ממתין לסיומו. ----
let timer = null;
let running = Promise.resolve();
let pending = false;
let started = false;

function schedule() {
    pending = true;
    clearTimeout(timer);
    timer = setTimeout(() => { run(); }, 350);
}
function run() {
    if (!pending) return running;
    pending = false;
    running = running.then(() => recalcAllCosts()).catch(() => {});
    return running;
}

// ממתין עד שכל חישוב מחדש שמתוזמן/רץ מסתיים (נקרא לפני הצגת מסך)
export async function ensureCostsFresh() {
    if (pending) { clearTimeout(timer); run(); }
    await running;
}

export function startAutoRecalc() {
    if (started) return;
    started = true;
    onDbChange((store) => { if (store === "pantryItems" || store === "recipes") schedule(); }); // שינוי במתכון מעדכן גם מתכונים ומנות שמשתמשים בו
}
