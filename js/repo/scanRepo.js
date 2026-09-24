// סריקת חשבונית - קריאה ישירה ל-Gemini מהדפדפן (אין שרת שמסתיר את המפתח - ראה הגדרות).
// תרגום מדויק של /api/scan-invoice ו-/api/scan-invoice/apply מ-main.py.
import { dbGetAll, dbGet, dbPut } from "../db.js";
import { getCloseMatches } from "../fuzzyMatch.js";
import { CATEGORY_GROUPS, UNIT_TYPES } from "../constants.js";
import { saveInvoice } from "./suppliersRepo.js";
import { NON_FOOD_CATEGORIES } from "../constants.js";
import { RECIPE_SCAN_PROMPT, buildRecipeDraft } from "../recipeParse.js";

const PROMPT = (
    "אתה מערכת לניתוח חשבוניות ספק של מסעדה. נתח את התמונה הזו וחלץ ממנה מידע.\n" +
    "החזר אך ורק JSON תקין, בדיוק בפורמט הזה, בלי שום טקסט נוסף לפני או אחרי:\n" +
    "{\n" +
    '  "supplier_name": "שם הספק אם מופיע בבירור, אחרת null",\n' +
    '  "invoice_date": "תאריך בפורמט YYYY-MM-DD אם מופיע, אחרת null",\n' +
    '  "items": [\n' +
    '    {"name": "שם המוצר בעברית", "quantity": 1.0, "unit_price": 10.0}\n' +
    "  ]\n" +
    "}\n" +
    "quantity ו-unit_price חייבים להיות מספרים. אם לא ניתן לקרוא שורה בבירור - דלג עליה. " +
    "אל תמציא נתונים שלא מופיעים בתמונה. " +
    "שים לב במיוחד לשנה בתאריך: העתק אותה בדיוק כפי שהיא כתובה בתמונה, ספרה ספרה - אל תנחש ואל תעגל אותה."
);

function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

export async function scanInvoiceImage(apiKey, file) {
    if (!apiKey) throw new Error("לא הוגדר מפתח API של Gemini. הזן אותו במסך ההגדרות.");
    const imageData = await fileToBase64(file);
    const mimeType = file.type || "image/jpeg";

    let response;
    try {
        response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: PROMPT }, { inline_data: { mime_type: mimeType, data: imageData } }] }],
                }),
            }
        );
    } catch (e) {
        throw new Error(`שגיאת רשת בפנייה ל-API: ${e.message}`);
    }
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`שגיאה מה-API (${response.status}): ${text.slice(0, 300)}`);
    }
    const result = await response.json();
    let parsed;
    try {
        let text = result.candidates[0].content.parts[0].text.trim();
        if (text.startsWith("```")) {
            text = text.split("```")[1];
            if (text.startsWith("json")) text = text.slice(4);
        }
        parsed = JSON.parse(text.trim());
    } catch (e) {
        throw new Error(`לא הצלחתי לפרש את התשובה: ${e.message}`);
    }

    const pantryRows = (await dbGetAll("pantryItems")).filter((r) => !r.parent_id);
    const byName = new Map(pantryRows.map((r) => [r.name.trim().toLowerCase(), r]));
    const items = parsed.items || [];
    const enrichedItems = [];

    for (const it of items) {
        const name = String(it.name || "").trim();
        const quantity = parseFloat(it.quantity);
        const unitPrice = parseFloat(it.unit_price);
        if (!name || Number.isNaN(quantity) || Number.isNaN(unitPrice)) continue;

        const match = byName.get(name.trim().toLowerCase());
        let suggested = null;
        if (!match) {
            const close = getCloseMatches(name.trim().toLowerCase(), [...byName.keys()], 1, 0.75);
            if (close.length) suggested = byName.get(close[0]);
        }

        enrichedItems.push({
            name, quantity, unit_price: unitPrice,
            matched_pantry_item_id: match ? match.id : null,
            matched_category: match ? match.category : null,
            matched_price: match ? match.price : null,
            matched_unit_type: match ? match.unit_type : null,
            suggested_pantry_item_id: suggested ? suggested.id : null,
            suggested_name: suggested ? suggested.name : null,
            suggested_category: suggested ? suggested.category : null,
            suggested_price: suggested ? suggested.price : null,
            suggested_unit_type: suggested ? suggested.unit_type : null,
        });
    }

    return { supplier_name: parsed.supplier_name || null, invoice_date: parsed.invoice_date || null, items: enrichedItems };
}

// מחיל את שורות הסריקה על המזווה (ואופציונלית שומר כחשבונית מקושרת לספק). מקביל ל-apply_scanned_invoice.
export async function applyScannedInvoice({ items, supplierId, invoiceDate }) {
    const resolvedPantryIds = [];
    const invoiceLineItems = [];

    for (const it of items) {
        const name = (it.name || "").trim();
        if (!name) throw new Error("יש למלא שם מוצר לכל שורה");
        const quantity = parseFloat(it.quantity);
        const unitPrice = parseFloat(it.unit_price);
        if (Number.isNaN(quantity) || Number.isNaN(unitPrice)) throw new Error(`כמות/מחיר לא תקינים עבור '${name}'`);

        const unitsPerCase = it.units_per_case === "" || it.units_per_case == null ? null : parseFloat(it.units_per_case);
        const pantryPrice = unitsPerCase && unitsPerCase > 0 ? unitPrice / unitsPerCase : unitPrice;

        let pantryItemId = it.pantry_item_id || null;
        if (pantryItemId) {
            const existing = await dbGet("pantryItems", pantryItemId);
            if (!existing) throw new Error(`מוצר '${name}' לא נמצא`);
            const isFrozen = !!it.is_frozen;
            if (!existing.parent_id) {
                const category = it.category || existing.category;
                if (!(category in CATEGORY_GROUPS)) throw new Error(`קטגוריה לא תקינה עבור '${name}'`);
                Object.assign(existing, { price: pantryPrice, category, is_frozen: isFrozen ? 1 : 0 });
            } else {
                Object.assign(existing, { price: pantryPrice, is_frozen: isFrozen ? 1 : 0 });
            }
            await dbPut("pantryItems", existing);
            resolvedPantryIds.push(pantryItemId);
        } else {
            const category = it.category;
            if (!(category in CATEGORY_GROUPS)) throw new Error(`יש לבחור קטגוריה עבור '${name}'`);
            const unitType = it.unit_type || "weight";
            if (!UNIT_TYPES.includes(unitType)) throw new Error(`יחידת מידה לא תקינה עבור '${name}'`);
            let unitAmount = null;
            if (unitType === "unit") {
                unitAmount = parseFloat(it.unit_amount);
                if (Number.isNaN(unitAmount)) throw new Error(`יש להזין משקל/נפח ליחידה עבור '${name}'`);
            }
            const isFrozen = !!it.is_frozen;
            pantryItemId = await dbPut("pantryItems", {
                name, category, subcategory: null, unit_type: unitType, unit_amount: unitAmount,
                price: pantryPrice, yield_pct: 100, weight_before: null, weight_after: null,
                is_frozen: isFrozen ? 1 : 0, parent_id: null,
            });
            resolvedPantryIds.push(pantryItemId);
        }

        invoiceLineItems.push({ product_name: name, quantity, unit_price: unitPrice, pantry_item_id: pantryItemId });
    }

    let invoiceId = null;
    if (supplierId) {
        if (!invoiceDate) throw new Error("יש להזין תאריך לחשבונית");
        invoiceId = await saveInvoice(null, {
            supplier_id: supplierId, invoice_date: invoiceDate, document_type: "invoice", items: invoiceLineItems,
        });
    }
    return { pantry_item_ids: resolvedPantryIds, invoice_id: invoiceId };
}


// סריקת מתכון מתמונה: מחזיר טיוטה (name, category, final_weight, ingredients) - שום דבר לא נשמר.
export async function scanRecipeImage(apiKey, file) {
    if (!apiKey) throw new Error("לא הוגדר מפתח API של Gemini. הזן אותו במסך ההגדרות.");
    const imageData = await fileToBase64(file);
    const mimeType = file.type || "image/jpeg";

    let response;
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            response = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: RECIPE_SCAN_PROMPT }, { inline_data: { mime_type: mimeType, data: imageData } }] }],
                    }),
                }
            );
        } catch (e) {
            throw new Error(`שגיאת רשת בפנייה ל-API: ${e.message}`);
        }
        if ((response.status === 429 || response.status === 503) && attempt < 2) {
            await new Promise((r) => setTimeout(r, 2000));
            continue;
        }
        break;
    }
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`שגיאה מה-API (${response.status}): ${text.slice(0, 300)}`);
    }
    let parsed;
    try {
        const result = await response.json();
        let text = result.candidates[0].content.parts[0].text.trim();
        if (text.startsWith("```")) {
            text = text.split("```")[1];
            if (text.startsWith("json")) text = text.slice(4);
        }
        parsed = JSON.parse(text.trim());
    } catch (e) {
        throw new Error(`לא הצלחתי לפרש את התשובה: ${e.message}`);
    }
    const pantry = (await dbGetAll("pantryItems")).filter((r) => !NON_FOOD_CATEGORIES.has(r.category));
    return buildRecipeDraft(parsed, pantry);
}
