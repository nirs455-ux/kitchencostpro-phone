// רשימת רכיבים לתווית מתוך מתכון: מסודרת לפי משקל יורד (כמו בתיוג מזון), עם אחוזים אופציונליים,
// והצהרת אלרגנים מצטברת מכל הרכיבים. טהור (בלי DOM/DB) כדי שאפשר לבדוק אותו ב-Node.
// שמות הרכיבים נקיים ("שום" ולא "שום שלם 4 יחידות"), והאלרגנים מגיעים מהגדרה ידנית / צילום תווית / מאגר הידע.
// רכיב שהאפליקציה לא מכירה מסומן "לא ידוע" ולא "ללא אלרגנים". אין ניחוש לפי שם.
// חשוב: זו טיוטה לעזר. האחריות לתיוג ולתקנות היא של בעל העסק.
import { ALLERGENS, ALLERGEN_LABEL } from "./allergens.js";
import { resolveAllergens } from "./allergenResolve.js";

// items: [{ pantry_item_id, ingredient_name, quantity_g }], pantryById: Map/obj של שורות מזווה (עם parent_id ו-allergens)
// labelNames: { מזהה_מוצר: "שם בתווית" } (לא חובה)
export function buildLabel({ items, pantryById, showPercent = false, labelNames = {} }) {
    const get = (id) => (pantryById instanceof Map ? pantryById.get(id) : pantryById[id]);
    const merged = new Map(); // שם נקי -> גרמים (מאחדים מרכיב שחוזר, וגם "שום קלוף" עם "שום")
    const allergenKeys = new Set();
    const unknown = [];
    const partial = [];
    let total = 0;

    for (const it of items || []) {
        const row = get(it.pantry_item_id);
        const grams = it.unit_count ? 0 : Number(it.quantity_g) || 0; // יחידות בלי משקל: מופיע ברשימת הרכיבים, בלי אחוז
        const res = row ? resolveAllergens(row, pantryById, labelNames) : null;
        const name = (res && res.name) || it.ingredient_name || "";
        if (!name) continue;
        merged.set(name, (merged.get(name) || 0) + grams);
        total += grams;
        if (!res || res.status === "unknown") { if (!unknown.includes(name)) unknown.push(name); continue; }
        for (const k of res.keys) allergenKeys.add(k);
        if (res.status === "partial" && !partial.includes(name)) partial.push(name);
    }

    const ingredients = [...merged.entries()]
        .map(([name, grams]) => ({ name, grams: Math.round(grams * 100) / 100, pct: total > 0 && grams > 0 ? (grams / total) * 100 : null }))
        .sort((a, b) => b.grams - a.grams || a.name.localeCompare(b.name, "he"));

    // סדר האלרגנים כפי שהוגדר ברשימה הקבועה
    const allergens = ALLERGENS.filter((a) => allergenKeys.has(a.key)).map((a) => a.label);
    const fmtPct = (p) => (p >= 10 ? Math.round(p) : Math.round(p * 10) / 10);

    const ingredientsLine = ingredients.map((i) => (showPercent && i.pct != null ? `${i.name} (${fmtPct(i.pct)}%)` : i.name)).join(", ");
    const lines = [];
    if (ingredients.length) lines.push(`רכיבים: ${ingredientsLine}.`);
    lines.push(allergens.length ? `מכיל: ${allergens.join(", ")}.` : unknown.length || partial.length || !ingredients.length ? "לא הוגדרו אלרגנים ברכיבים." : "אין אלרגנים ידועים ברכיבים (לפי הגדרות ומאגר הידע).");
    if (unknown.length) lines.push(`שים לב: לא הוגדרו אלרגנים עבור: ${unknown.join(", ")}. צלם תווית או הגדר ידנית.`);
    if (partial.length) lines.push(`שים לב: ייתכנו אלרגנים נוספים ב: ${partial.join(", ")}. צלם תווית כדי לדעת.`);

    return { ingredients, allergens, unknown, partial, text: lines.join("\n"), totalGrams: Math.round(total * 100) / 100 };
}

export { ALLERGEN_LABEL };
