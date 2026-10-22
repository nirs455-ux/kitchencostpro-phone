// חישוב עלויות מחדש: עלות מתכון ומנה נשמרת בעת השמירה, ולכן כששינו מחיר/ניצולת/קפוא של מוצר במזווה (ידנית או דרך חשבונית)
// העלויות נשארו ישנות. כאן מחשבים מחדש את כל המתכונים (לפי המזווה הנוכחי) ואז את כל המנות (שתלויות בהם ובמזווה).
// רכיב שנמחק מהמזווה נשאר עם העלות האחרונה שלו (אי אפשר לחשב), ומסומן ghost. כותבים למסד רק מה ששינה ערך.
import { dbGetAll, dbGet, dbPut, dbGetByIndex, onDbChange } from "../db.js";
import { recipeCostPerGram, computeDishPricing } from "../formulas.js";
import { resolveRecipeItems } from "./recipesRepo.js";
import { resolveDishItems } from "./dishesRepo.js";

const r2 = (n) => Math.round(n * 100) / 100;
const differs = (a, b) => Math.abs((Number(a) || 0) - (Number(b) || 0)) > 1e-9;

async function recalcRecipes() {
    let changed = 0;
    for (const recipe of await dbGetAll("recipes")) {
        const rows = await dbGetByIndex("recipeItems", "recipe_id", recipe.id);
        if (!rows.length) continue;
        const live = [], ghosts = [];
        for (const r of rows) ((await dbGet("pantryItems", r.pantry_item_id)) ? live : ghosts).push(r);
        let resolved = { resolved: [], totalCost: 0, rawWeight: 0 };
        try {
            if (live.length) resolved = await resolveRecipeItems(live.map((r) => ({ pantry_item_id: r.pantry_item_id, quantity_g: r.quantity_g, egg_part: r.egg_part })));
        } catch (e) { continue; } // למשל מוצר ביחידות שאיבד משקל ליחידה: משאירים כמו שהיה
        const ghostCost = ghosts.reduce((n, r) => n + (Number(r.item_cost) || 0), 0);
        const ghostGrams = ghosts.reduce((n, r) => n + (Number(r.quantity_g) || 0), 0);
        const total = resolved.totalCost + ghostCost;
        const finalWeight = recipe.is_auto_weight ? resolved.rawWeight + ghostGrams : recipe.final_weight;
        const cpg = recipeCostPerGram(total, finalWeight);
        const newTotal = r2(total);

        let rowChanged = false;
        for (let i = 0; i < live.length; i++) {
            const n = resolved.resolved[i];
            if (differs(live[i].item_cost, n.item_cost) || differs(live[i].price_per_gram, n.price_per_gram) || live[i].ingredient_name !== n.ingredient_name) {
                await dbPut("recipeItems", { ...live[i], item_cost: n.item_cost, price_per_gram: n.price_per_gram, ingredient_name: n.ingredient_name });
                rowChanged = true;
            }
        }
        if (rowChanged || differs(recipe.total_cost, newTotal) || differs(recipe.cost_per_gram, cpg) || differs(recipe.final_weight, finalWeight)) {
            await dbPut("recipes", { ...recipe, total_cost: newTotal, cost_per_gram: cpg, final_weight: finalWeight });
            changed++;
        }
    }
    return changed;
}

async function recalcDishes() {
    let changed = 0;
    for (const dish of await dbGetAll("dishes")) {
        const rows = await dbGetByIndex("dishItems", "dish_id", dish.id);
        if (!rows.length) continue;
        const live = [], ghosts = [];
        for (const r of rows) {
            const src = await dbGet(r.source_type === "recipe" ? "recipes" : "pantryItems", r.source_id);
            (src ? live : ghosts).push(r);
        }
        let resolved = { resolved: [], totalCost: 0 };
        try {
            if (live.length) resolved = await resolveDishItems(live.map((r) => ({ source_type: r.source_type, source_id: r.source_id, quantity_g: r.quantity_g })));
        } catch (e) { continue; } // מתכון שחזר להיות טיוטה וכו': משאירים
        const total = resolved.totalCost + ghosts.reduce((n, r) => n + (Number(r.item_cost) || 0), 0);
        const pricing = computeDishPricing(total, dish.selling_price, dish.vat_pct);
        let rowChanged = false;
        for (let i = 0; i < live.length; i++) {
            const n = resolved.resolved[i];
            if (differs(live[i].item_cost, n.item_cost) || differs(live[i].price_per_gram, n.price_per_gram) || live[i].source_name !== n.source_name) {
                await dbPut("dishItems", { ...live[i], item_cost: n.item_cost, price_per_gram: n.price_per_gram, source_name: n.source_name });
                rowChanged = true;
            }
        }
        if (rowChanged || differs(dish.total_cost, pricing.total_cost) || differs(dish.food_cost_pct, pricing.food_cost_pct) || differs(dish.profit_amount, pricing.profit_amount)) {
            await dbPut("dishes", { ...dish, ...pricing });
            changed++;
        }
    }
    return changed;
}

// מחשב מחדש הכול. מחזיר כמה מתכונים ומנות השתנו.
export async function recalcAllCosts() {
    const recipes = await recalcRecipes();
    const dishes = await recalcDishes();
    return { recipes, dishes };
}

// ---- הפעלה אוטומטית: כל שינוי במזווה מפעיל חישוב מחדש (בהשהיה קצרה). ניווט בין מסכים ממתין לסיומו. ----
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
    onDbChange((store) => { if (store === "pantryItems") schedule(); });
}
