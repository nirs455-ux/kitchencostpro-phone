// הופך JSON שחילץ ה-AI מתמונת מתכון לטיוטה: כמויות לגרם, והתאמת כל מרכיב למוצר במזווה.
// טהור (בלי רשת/DB) - משקף את build_recipe_draft ב-main.py, ונבדק מול אותו קלט בדיוק.
import { getCloseMatches } from "./fuzzyMatch.js";
import { smartMatch, quantityInName, cleanName, sizeInName } from "./nameMatch.js";
import { unitWeightG, juiceInfo, juiceFruitName, gramsFromJuiceMl } from "./produceKb.js";
import { RECIPE_CATEGORIES } from "./constants.js";

// נוזלים: 1 מ"ל = 1 גרם (כמו בממשק המתכונים הקיים)
export const RECIPE_UNIT_GRAMS = { g: 1, kg: 1000, ml: 1, l: 1000, tbsp: 15, tsp: 5, cup: 240 };

export const recipeScanPrompt = (categories = RECIPE_CATEGORIES) =>
    "אתה מערכת לקריאת מתכונים למסעדה. נתח את התמונה/הקובץ וחלץ ממנו את המתכון.\n" +
    "החזר אך ורק JSON תקין, בדיוק בפורמט הזה, בלי שום טקסט נוסף לפני או אחרי:\n" +
    "{\n" +
    '  "name": "שם המתכון",\n' +
    '  "category": "אחת מ: ' + categories.join(", ") + '",\n' +
    '  "final_weight_g": משקל סופי של המתכון בגרם אם כתוב במפורש, אחרת null,\n' +
    '  "method": "הוראות ההכנה כפי שכתובות במתכון (טקסט חופשי, אפשר בכמה שורות), או null אם אין",\n' +
    '  "ingredients": [\n' +
    '    {"name": "שם המרכיב בעברית", "quantity": 2.5, "unit": "g"}\n' +
    "  ]\n" +
    "}\n" +
    'unit חייב להיות אחד מ: "g" (גרם), "kg" (ק"ג), "ml" (מ"ל), "l" (ליטר), "tbsp" (כף), ' +
    '"tsp" (כפית), "cup" (כוס), "unit" (יחידות, למשל 2 ביצים), או null אם לא כתוב. ' +
    "quantity מספר עשרוני (שברים כמו חצי -> 0.5), או null אם לא כתובה כמות. " +
    "אל תמציא מרכיבים או כמויות שלא מופיעים. אם לא ניתן לקרוא שורה בבירור - דלג עליה.";
export const RECIPE_SCAN_PROMPT = recipeScanPrompt();

const round2 = (x) => Math.round(x * 100) / 100;

export function buildRecipeDraft(parsed, pantryItems, categories = RECIPE_CATEGORIES) {
    const byName = new Map(pantryItems.map((r) => [r.name.trim().toLowerCase(), r]));

    const name = String(parsed.name || "").trim();
    const category = categories.includes(parsed.category) ? parsed.category : "כללי";
    let finalWeight = parseFloat(parsed.final_weight_g);
    finalWeight = Number.isFinite(finalWeight) && finalWeight > 0 ? finalWeight : null;

    const ingredients = [];
    for (const ing of parsed.ingredients || []) {
        let ingName = String((ing && ing.name) || "").trim();
        if (!ingName) continue;
        let qty = parseFloat(ing.quantity);
        qty = Number.isFinite(qty) ? qty : null;
        let unit = ing.unit || null;
        // כמות שנכתבה בתוך השם ("עגבניות 200"): השם הוא "עגבניות", והכמות 200
        const inName = qty === null ? quantityInName(ingName) : null;
        if (inName) { qty = inName.qty; unit = unit || inName.unit; ingName = cleanName(ingName); }

        const key = ingName.toLowerCase();
        let match = byName.get(key) || null;
        let fuzzy = false;
        // "מיץ לימון טרי" = סחוט מלימונים: לא מתאימים למיץ קנוי שיש במזווה, אלא מחשבים מהפרי
        const wantsFresh = /טרי|טרייה/.test(ingName) && !!juiceFruitName(ingName);
        if (!match && !wantsFresh) { // התאמה לפי מילים: מתעלמת ממספרים, יחידות וריכוז ("חומץ 5%" מול "חומץ"), ומרבים/יחיד
            const sm = smartMatch(ingName, pantryItems);
            if (sm) { match = sm.item; fuzzy = !sm.exact; }
        }
        // "מיץ לימון 300 מ"ל" ובמזווה יש לימון: מחשבים כמה לימונים צריך (לפי ממוצע)
        let est = null;
        if (!match) {
            const fruit = juiceFruitName(ingName);
            const fm = fruit ? smartMatch(fruit, pantryItems) : null;
            const mlQty = qty > 0 && unit in RECIPE_UNIT_GRAMS && unit !== "g" && unit !== "kg" ? qty * RECIPE_UNIT_GRAMS[unit] : null;
            if (fm && juiceInfo(fm.item.name) && mlQty) {
                match = fm.item;
                fuzzy = true;
                est = { est_mode: "juice", est_n: round2(mlQty), grams: round2(gramsFromJuiceMl(fm.item.name, mlQty)) };
            }
        }
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

        // "6 עגבניות בינוניות" ובמזווה עגבניות בק"ג: מעריכים משקל לפי ממוצע (קטנה/בינונית/גדולה)
        if (!est && unit === "unit" && qty > 0 && match && match.unit_type === "weight") {
            const size = sizeInName(String((ing && ing.name) || ""));
            const w = unitWeightG(match.name, size);
            if (w) est = { est_mode: "est_" + size, est_n: qty, grams: round2(qty * w) };
        }
        if (est) quantityG = est.grams;

        ingredients.push({
            ...(est ? { est_mode: est.est_mode, est_n: est.est_n } : {}),
            original_name: ingName,
            original_quantity: qty,
            original_unit: unit,
            quantity_g: quantityG,
            pantry_item_id: match ? match.id : null,
            matched_name: match ? match.name : null,
            fuzzy,
        });
    }
    const method = String(parsed.method || "").trim() || null;
    return { name, category, final_weight: finalWeight, method, ingredients };
}
