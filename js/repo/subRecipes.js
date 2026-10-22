// תת-מתכונים: מתכון שמשמש כרכיב במתכון אחר (למשל רוטב בתוך מנה). פונקציות טהורות (בלי DB/DOM) כדי שאפשר לבדוק ב-Node.
// שורת תת-מתכון ב-recipeItems: { recipe_id, pantry_item_id: null, sub_recipe_id, ingredient_name, quantity_g, price_per_gram, item_cost }
// quantity_g = כמה גרם מהמוצר המוגמר של תת-המתכון משתמשים.
export const MAX_SUB_DEPTH = 6;

export const isSubRow = (row) => row && row.sub_recipe_id != null;

// כל המתכונים שמשתמשים (ישירות או דרך מתכון אחר) באחד המתכונים שב-seedIds
export function expandToParents(seedIds, allItems) {
    const result = new Set(seedIds);
    let grew = true;
    while (grew) {
        grew = false;
        for (const r of allItems) {
            if (isSubRow(r) && result.has(r.sub_recipe_id) && !result.has(r.recipe_id)) { result.add(r.recipe_id); grew = true; }
        }
    }
    return result;
}

// האם המתכון recipeId כולל (ישירות או בעומק) את המתכון targetId. recipeId === targetId נחשב כן (מעגל מיידי).
export function includesRecipe(recipeId, targetId, allItems) {
    if (recipeId === targetId) return true;
    const seen = new Set([recipeId]);
    const stack = [recipeId];
    while (stack.length) {
        const cur = stack.pop();
        for (const r of allItems) {
            if (r.recipe_id !== cur || !isSubRow(r)) continue;
            if (r.sub_recipe_id === targetId) return true;
            if (!seen.has(r.sub_recipe_id)) { seen.add(r.sub_recipe_id); stack.push(r.sub_recipe_id); }
        }
    }
    return false;
}

// פורש רשימת רכיבים לרמת מוצרי המזווה בלבד: שורת תת-מתכון הופכת לרכיבים שלו, בכמות יחסית לכמות שבשימוש.
// recipeById: Map מזהה -> מתכון, itemsOf(recipeId): שורות ה-recipeItems שלו. שורה של מתכון שנמחק (או מעגל) נשמטת.
export function flattenRecipeItems(direct, recipeById, itemsOf, factor = 1, depth = 0, trail = new Set()) {
    const out = [];
    for (const it of direct) {
        if (!isSubRow(it)) {
            out.push(factor === 1 ? it : { ...it, quantity_g: (Number(it.quantity_g) || 0) * factor, item_cost: (Number(it.item_cost) || 0) * factor });
            continue;
        }
        const sub = recipeById.get(it.sub_recipe_id);
        if (!sub || depth >= MAX_SUB_DEPTH || trail.has(sub.id)) continue;
        const subRows = itemsOf(sub.id);
        const raw = subRows.reduce((n, r) => n + (Number(r.quantity_g) || 0), 0);
        const fw = Number(sub.final_weight) > 0 ? Number(sub.final_weight) : raw;
        if (!(fw > 0)) continue;
        const f = factor * ((Number(it.quantity_g) || 0) / fw);
        out.push(...flattenRecipeItems(subRows, recipeById, itemsOf, f, depth + 1, new Set([...trail, sub.id])));
    }
    return out;
}
