// רשימת רכיבים לתווית מתוך מתכון: מסודרת לפי משקל יורד (כמו בתיוג מזון), עם אחוזים אופציונליים,
// והצהרת אלרגנים מצטברת מכל הרכיבים. טהור (בלי DOM/DB) כדי שאפשר לבדוק אותו ב-Node.
// חשוב: זו טיוטה לעזר. האחריות לתיוג ולתקנות היא של בעל העסק; רכיב בלי הגדרת אלרגנים מסומן כ"לא מוגדר" ולא כ"ללא אלרגנים".
import { ALLERGENS, ALLERGEN_LABEL } from "./allergens.js";

// items: [{ pantry_item_id, ingredient_name, quantity_g }], pantryById: Map/obj של שורות מזווה (עם parent_id ו-allergens)
export function buildLabel({ items, pantryById, showPercent = false }) {
    const get = (id) => (pantryById instanceof Map ? pantryById.get(id) : pantryById[id]);
    const merged = new Map(); // שם -> גרמים (מאחדים מרכיב שחוזר)
    const allergenKeys = new Set();
    const unknown = [];
    let total = 0;

    for (const it of items || []) {
        const row = get(it.pantry_item_id);
        const grams = Number(it.quantity_g) || 0;
        const name = (row && row.name) || it.ingredient_name || "";
        if (!name) continue;
        merged.set(name, (merged.get(name) || 0) + grams);
        total += grams;
        // תוצר מפורק יורש אלרגנים מחומר הגלם שלו
        const source = row && row.parent_id ? get(row.parent_id) || row : row;
        const defs = source ? source.allergens : undefined;
        if (!Array.isArray(defs)) { if (!unknown.includes(name)) unknown.push(name); }
        else for (const k of defs) allergenKeys.add(k);
    }

    const ingredients = [...merged.entries()]
        .map(([name, grams]) => ({ name, grams: Math.round(grams * 100) / 100, pct: total > 0 ? (grams / total) * 100 : null }))
        .sort((a, b) => b.grams - a.grams || a.name.localeCompare(b.name, "he"));

    // סדר האלרגנים כפי שהוגדר ברשימה הקבועה
    const allergens = ALLERGENS.filter((a) => allergenKeys.has(a.key)).map((a) => a.label);
    const fmtPct = (p) => (p >= 10 ? Math.round(p) : Math.round(p * 10) / 10);

    const ingredientsLine = ingredients.map((i) => (showPercent && i.pct != null ? `${i.name} (${fmtPct(i.pct)}%)` : i.name)).join(", ");
    const lines = [];
    if (ingredients.length) lines.push(`רכיבים: ${ingredientsLine}.`);
    lines.push(allergens.length ? `מכיל: ${allergens.join(", ")}.` : "לא הוגדרו אלרגנים ברכיבים.");
    if (unknown.length) lines.push(`שים לב: לא הוגדרו אלרגנים עבור: ${unknown.join(", ")}.`);

    return { ingredients, allergens, unknown, text: lines.join("\n"), totalGrams: Math.round(total * 100) / 100 };
}

export { ALLERGEN_LABEL };
