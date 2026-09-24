// הופך JSON שחילץ ה-AI מתמונת מתכון לטיוטה: כמויות לגרם, והתאמת כל מרכיב למוצר במזווה.
// טהור (בלי רשת/DB) - משקף את build_recipe_draft ב-main.py, ונבדק מול אותו קלט בדיוק.
import { getCloseMatches } from "./fuzzyMatch.js";
import { RECIPE_CATEGORIES } from "./constants.js";

// נוזלים: 1 מ"ל = 1 גרם (כמו בממשק המתכונים הקיים)
export const RECIPE_UNIT_GRAMS = { g: 1, kg: 1000, ml: 1, l: 1000, tbsp: 15, tsp: 5, cup: 240 };

export const RECIPE_SCAN_PROMPT =
    "אתה מערכת לקריאת מתכונים למסעדה. נתח את התמונה/הקובץ וחלץ ממנו את המתכון.\n" +
    "החזר אך ורק JSON תקין, בדיוק בפורמט הזה, בלי שום טקסט נוסף לפני או אחרי:\n" +
    "{\n" +
    '  "name": "שם המתכון",\n' +
    '  "category": "אחת מ: ' + RECIPE_CATEGORIES.join(", ") + '",\n' +
    '  "final_weight_g": משקל סופי של המתכון בגרם אם כתוב במפורש, אחרת null,\n' +
    '  "ingredients": [\n' +
    '    {"name": "שם המרכיב בעברית", "quantity": 2.5, "unit": "g"}\n' +
    "  ]\n" +
    "}\n" +
    'unit חייב להיות אחד מ: "g" (גרם), "kg" (ק"ג), "ml" (מ"ל), "l" (ליטר), "tbsp" (כף), ' +
    '"tsp" (כפית), "cup" (כוס), "unit" (יחידות, למשל 2 ביצים), או null אם לא כתוב. ' +
    "quantity מספר עשרוני (שברים כמו חצי -> 0.5), או null אם לא כתובה כמות. " +
    "אל תמציא מרכיבים או כמויות שלא מופיעים. אם לא ניתן לקרוא שורה בבירור - דלג עליה.";

const round2 = (x) => Math.round(x * 100) / 100;

export function buildRecipeDraft(parsed, pantryItems) {
    const byName = new Map(pantryItems.map((r) => [r.name.trim().toLowerCase(), r]));

    const name = String(parsed.name || "").trim();
    const category = RECIPE_CATEGORIES.includes(parsed.category) ? parsed.category : "כללי";
    let finalWeight = parseFloat(parsed.final_weight_g);
    finalWeight = Number.isFinite(finalWeight) && finalWeight > 0 ? finalWeight : null;

    const ingredients = [];
    for (const ing of parsed.ingredients || []) {
        const ingName = String((ing && ing.name) || "").trim();
        if (!ingName) continue;
        let qty = parseFloat(ing.quantity);
        qty = Number.isFinite(qty) ? qty : null;
        const unit = ing.unit || null;

        const key = ingName.toLowerCase();
        let match = byName.get(key) || null;
        let fuzzy = false;
        if (!match) {
            const close = getCloseMatches(key, [...byName.keys()], 1, 0.7);
            if (close.length) {
                match = byName.get(close[0]);
                fuzzy = true;
            }
        }

        let quantityG = null;
        if (qty !== null && qty > 0) {
            if (unit in RECIPE_UNIT_GRAMS) {
                quantityG = round2(qty * RECIPE_UNIT_GRAMS[unit]);
            } else if (unit === "unit" && match && match.unit_type === "unit" && match.unit_amount) {
                quantityG = round2(qty * match.unit_amount);
            }
        }

        ingredients.push({
            original_name: ingName,
            original_quantity: qty,
            original_unit: unit,
            quantity_g: quantityG,
            pantry_item_id: match ? match.id : null,
            matched_name: match ? match.name : null,
            fuzzy,
        });
    }
    return { name, category, final_weight: finalWeight, ingredients };
}
