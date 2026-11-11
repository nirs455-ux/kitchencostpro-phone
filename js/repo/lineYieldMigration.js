// העברה חד-פעמית: ניצולת עוברת לשורת המתכון. כל שורה (של מוצר רגיל: לא תוצר מפורק, לא קפוא, לא ביצים ולא יחידות) מקבלת
// line_yield לפי מה שחל עליה עד היום: "בלי ניצולת" = 100, אחרת ניצולת המוצר. כך עלות כל מתכון נשארת זהה בדיוק.
// לפני הכתיבה מחשבים את העלות של כל מתכון בשני האופנים (בזיכרון). אם משהו שונה, לא כותבים כלום והדגל נשאר "blocked".
import { dbGetAll, dbPut } from "../db.js";
import { getSetting, setSetting } from "./settingsRepo.js";
import { isEggProduct } from "../eggs.js";
import { resolveRecipeItems } from "./recipesRepo.js";

export const LINE_YIELD_FLAG = "line_yield_v1"; // "done" | "blocked"

const toResolveInput = (r) => ({ pantry_item_id: r.pantry_item_id, sub_recipe_id: r.sub_recipe_id, quantity_g: r.quantity_g, egg_part: r.egg_part, prep: r.prep, line_yield: r.line_yield });

// מחזיר את השורות שצריכות line_yield (העתקות עם הערך), בלי לכתוב
export function planLineYield(items, pantryById) {
    const out = [];
    for (const it of items) {
        if (it.pantry_item_id == null || it.egg_part || it.line_yield != null) continue;
        const p = pantryById.get(it.pantry_item_id);
        if (!p || p.parent_id || p.is_frozen || p.unit_type !== "weight" || isEggProduct(p)) continue;
        const py = Number(p.yield_pct);
        const y = it.prep === "raw" ? 100 : py > 0 && py <= 100 ? py : 100;
        out.push({ ...it, line_yield: y });
    }
    return out;
}

export async function migrateLineYield() {
    const flag = await getSetting(LINE_YIELD_FLAG, "");
    if (flag === "done") return { status: "done", changed: 0 };
    const pantry = new Map((await dbGetAll("pantryItems")).map((r) => [r.id, r]));
    const all = await dbGetAll("recipeItems");
    const planned = planLineYield(all, pantry);
    const newById = new Map(planned.map((p) => [p.id, p]));
    const byRecipe = new Map();
    for (const it of all) byRecipe.set(it.recipe_id, [...(byRecipe.get(it.recipe_id) || []), it]);
    const mismatched = [];
    for (const [rid, list] of byRecipe) {
        if (!list.some((it) => newById.has(it.id))) continue;
        try {
            const before = (await resolveRecipeItems(list.map(toResolveInput), { selfId: rid })).totalCost;
            const after = (await resolveRecipeItems(list.map((it) => toResolveInput(newById.get(it.id) || it)), { selfId: rid })).totalCost;
            if (Math.abs(before - after) > 1e-6) mismatched.push(rid);
        } catch (e) { mismatched.push(rid); }
    }
    if (mismatched.length) { await setSetting(LINE_YIELD_FLAG, "blocked"); return { status: "blocked", changed: 0, mismatched }; }
    for (const p of planned) await dbPut("recipeItems", p);
    await setSetting(LINE_YIELD_FLAG, "done");
    return { status: "done", changed: planned.length };
}
