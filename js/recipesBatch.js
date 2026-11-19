// ייבוא קובץ עם הרבה מתכונים: פרומפטים, פענוח, והמרת טיוטה לנתוני שמירה. טהור (בלי רשת/DB), נבדק ב-tests/recipe_batch.verify.mjs.
import { isEggProduct } from "./eggs.js";

export const BATCH_SIZE = 5; // כמה מתכונים נקראים בכל קריאה
export const MULTI_MIN_CHARS = 2500; // טקסט קצר מזה נחשב מתכון אחד: בלי קריאת זיהוי נוספת
export const MULTI_MIN_PDF_BYTES = 120000;

export const TITLES_PROMPT =
    "אתה מערכת לקריאת מסמכי מתכונים למסעדה. במסמך יכולים להיות מתכון אחד או הרבה מתכונים נפרדים.\n" +
    "רשום את השמות של כל המתכונים הנפרדים במסמך, לפי הסדר שבו הם מופיעים, כפי שהשם כתוב.\n" +
    'החזר אך ורק JSON תקין בפורמט הזה, בלי טקסט נוסף: {"titles": ["שם מתכון 1", "שם מתכון 2"]}\n' +
    "אל תכלול כותרות של חלקים בתוך אותו מתכון (למשל רוטב או מסה שהם חלק ממתכון אחד). אל תמציא שמות.";

export const batchPrompt = (titles, categories = []) =>
    "אתה מערכת לקריאת מתכונים למסעדה. במסמך יש הרבה מתכונים. חלץ רק את המתכונים האלה, לפי השמות שלהם: " + JSON.stringify(titles) + ".\n" +
    "החזר אך ורק JSON תקין בפורמט הזה, בלי טקסט נוסף:\n" +
    '{"recipes": [{"name": "שם המתכון", "category": "אחת מ: ' + categories.join(", ") + '", "final_weight_g": null, "method": "הוראות ההכנה", ' +
    '"ingredients": [{"name": "חומר הגלם", "quantity": 2.5, "unit": "g"}]}]}\n' +
    'unit חייב להיות אחד מ: "g", "kg", "ml", "l", "tbsp", "tsp", "cup", "unit", או null אם לא כתוב. quantity מספר עשרוני, או null אם אין כמות. ' +
    '"קילו" = kg. כמויות לא מספריות כמו "קורט": quantity null.\n' +
    "method: העתק את הוראות ההכנה של המתכון מילה במילה בדיוק כפי שהן כתובות, בלי לשכתב, לקצר או לתקן. אם אין הוראות: null.\n" +
    "name של מרכיב: שם חומר הגלם בלבד (למשל בצל). פעולות הכנה כמו קצוץ דק, חלוט, רטוב או מגורד אינן חלק מהשם. " +
    "מילה שמבדילה בין מוצרים שקונים בנפרד נשארת בשם (שחור, מעושן, סגול). " +
    "אל תמציא מרכיבים או כמויות. מרכיב עם שני מרכיבים בשורה אחת פצל לשתי שורות. החזר רשימה אחת עם כל המתכונים שנמצאו מהרשימה.";

const txt = (v) => String(v == null ? "" : v).trim();

// parsed: אובייקט JSON מהמודל. מחזיר שמות ייחודיים לפי הסדר
export function parseTitles(parsed) {
    const arr = parsed && Array.isArray(parsed.titles) ? parsed.titles : Array.isArray(parsed) ? parsed : [];
    const seen = new Set(), out = [];
    for (const t of arr) {
        const s = txt(typeof t === "string" ? t : t && t.name);
        const k = s.toLowerCase();
        if (s && !seen.has(k)) { seen.add(k); out.push(s); }
    }
    return out;
}

export const chunkTitles = (titles, size = BATCH_SIZE) => { const out = []; for (let i = 0; i < titles.length; i += size) out.push(titles.slice(i, i + size)); return out; };

// רשימת מתכונים מתשובת קריאה: מקבל גם {recipes: [...]} וגם מתכון בודד
export function parseBatch(parsed) {
    if (Array.isArray(parsed)) return parsed.filter((r) => r && typeof r === "object");
    if (parsed && Array.isArray(parsed.recipes)) return parsed.recipes.filter((r) => r && typeof r === "object");
    return parsed && Array.isArray(parsed.ingredients) ? [parsed] : [];
}

// מוצר רגיל שמקבל ניצולת בשורה (כמו בהעברת הניצולת): לא תוצר מפורק, לא קפוא, לא ביצים ולא יחידות
const lineEligible = (p) => !!p && !p.parent_id && !p.is_frozen && p.unit_type === "weight" && !isEggProduct(p);

// draft: תוצאת buildRecipeDraft. pantryById: Map. lineYieldReady: האם ההעברה של ניצולת השורה הסתיימה
// מרכיב שנמצא וכמותו ידועה נכנס כרכיב; כל השאר (לא נמצא, או בלי כמות) נשמר כטיוטה להשלמה
export function importData(draft, pantryById, lineYieldReady, { allAsDraft = false } = {}) {
    const items = [], drafts = [];
    for (const ing of draft.ingredients || []) {
        const qty = Number(ing.quantity_g);
        if (!allAsDraft && ing.pantry_item_id && qty > 0) {
            const p = pantryById.get(ing.pantry_item_id);
            items.push({ pantry_item_id: ing.pantry_item_id, quantity_g: qty, ...(ing.est_mode ? { est_mode: ing.est_mode, est_n: ing.est_n } : {}), ...(lineYieldReady && lineEligible(p) ? { line_yield: 100 } : {}) });
        } else {
            drafts.push({ name: ing.original_name, quantity: ing.original_quantity ?? null, unit: ing.original_unit ?? null });
        }
    }
    return { name: draft.name, category: draft.category, final_weight: draft.final_weight || "", method: draft.method || "", items, draft_ingredients: drafts };
}
