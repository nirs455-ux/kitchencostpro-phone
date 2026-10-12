// סריקת חשבונית - קריאה ישירה ל-Gemini מהדפדפן (אין שרת שמסתיר את המפתח - ראה הגדרות).
// תרגום מדויק של /api/scan-invoice ו-/api/scan-invoice/apply מ-main.py.
import { dbGetAll, dbGet, dbPut } from "../db.js";
import { getCloseMatches } from "../fuzzyMatch.js";
import { CATEGORY_GROUPS, UNIT_TYPES } from "../constants.js";
import { saveInvoice } from "./suppliersRepo.js";
import { NON_FOOD_CATEGORIES } from "../constants.js";
import { RECIPE_SCAN_PROMPT, buildRecipeDraft } from "../recipeParse.js";
import { INVOICE_SCAN_PROMPT, mergeDiscountLines, computeStockFactor } from "../invoiceParse.js";

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
                    contents: [{ parts: [{ text: INVOICE_SCAN_PROMPT }, { inline_data: { mime_type: mimeType, data: imageData } }] }],
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
    const items = mergeDiscountLines(parsed.items || []);
    const enrichedItems = [];

    for (const it of items) {
        const name = it.name;
        const quantity = it.quantity;
        const unitPrice = it.unit_price;
        // שורה בלי שם נשארת (המשתמש ימלא שם או יסיר אותה במסך הבדיקה)

        const match = name ? byName.get(name.trim().toLowerCase()) : null;
        let suggested = null;
        if (!match && name) {
            const close = getCloseMatches(name.trim().toLowerCase(), [...byName.keys()], 1, 0.75);
            if (close.length) suggested = byName.get(close[0]);
        }

        enrichedItems.push({
            name, quantity, unit_price: unitPrice,
            discount_applied: it.discount_applied || 0, list_unit_price: it.list_unit_price ?? null,
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
export async function applyScannedInvoice({ items, supplierId, invoiceDate, image }) {
    // שלב 1: אימות מלא ובניית תוכנית - שום כתיבה עד שכל השורות תקינות (אין שמירה חלקית)
    const plan = [];
    for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const where = `שורה ${i + 1}`;
        const name = (it.name || "").trim();
        if (!name) throw new Error(`${where}: יש למלא שם מוצר, או להסיר את השורה`);
        const quantity = parseFloat(it.quantity);
        const unitPrice = parseFloat(it.unit_price);
        if (Number.isNaN(quantity) || Number.isNaN(unitPrice)) throw new Error(`${where}: כמות/מחיר לא תקינים עבור '${name}'`);

        const unitsPerCase = it.units_per_case === "" || it.units_per_case == null ? null : parseFloat(it.units_per_case);
        const packageSize = it.package_size === "" || it.package_size == null ? null : parseFloat(it.package_size);
        if (packageSize !== null && (Number.isNaN(packageSize) || packageSize <= 0)) throw new Error(`${where}: גודל אריזה לא תקין עבור '${name}'`);

        let existing = null;
        let category = null, unitType = null, unitAmount = null;
        if (it.pantry_item_id) {
            existing = await dbGet("pantryItems", it.pantry_item_id);
            if (!existing) throw new Error(`${where}: מוצר '${name}' לא נמצא`);
            unitType = existing.unit_type;
            if (!existing.parent_id) {
                category = it.category || existing.category;
                if (!(category in CATEGORY_GROUPS)) throw new Error(`${where}: קטגוריה לא תקינה עבור '${name}'`);
            }
        } else {
            category = it.category;
            if (!(category in CATEGORY_GROUPS)) throw new Error(`${where}: יש לבחור קטגוריה עבור '${name}'`);
            unitType = it.unit_type || "weight";
            if (!UNIT_TYPES.includes(unitType)) throw new Error(`${where}: יחידת מידה לא תקינה עבור '${name}'`);
            if (unitType === "unit") {
                unitAmount = parseFloat(it.unit_amount);
                if (Number.isNaN(unitAmount)) throw new Error(`${where}: יש להזין משקל/נפח ליחידה עבור '${name}'`);
            }
        }

        const { factor, error } = computeStockFactor(unitType, unitsPerCase, packageSize, it.package_unit);
        if (error) throw new Error(`${where}: ${error} ('${name}')`);
        const stockFactor = factor && factor !== 1 ? factor : null;
        const pantryPrice = unitPrice / (factor || 1);
        plan.push({ it, name, quantity, unitPrice, existing, category, unitType, unitAmount, pantryPrice, stockFactor });
    }

    // שלב 2: כתיבה
    const resolvedPantryIds = [];
    const invoiceLineItems = [];
    for (const p of plan) {
        const isFrozen = p.it.is_frozen ? 1 : 0;
        let pantryItemId;
        if (p.existing) {
            if (!p.existing.parent_id) Object.assign(p.existing, { price: p.pantryPrice, category: p.category, is_frozen: isFrozen });
            else Object.assign(p.existing, { price: p.pantryPrice, is_frozen: isFrozen });
            await dbPut("pantryItems", p.existing);
            pantryItemId = p.existing.id;
        } else {
            pantryItemId = await dbPut("pantryItems", {
                name: p.name, category: p.category, subcategory: null, unit_type: p.unitType, unit_amount: p.unitAmount,
                price: p.pantryPrice, yield_pct: 100, weight_before: null, weight_after: null,
                is_frozen: isFrozen, parent_id: null,
            });
        }
        resolvedPantryIds.push(pantryItemId);
        invoiceLineItems.push({ product_name: p.name, quantity: p.quantity, unit_price: p.unitPrice, pantry_item_id: pantryItemId, stock_factor: p.stockFactor });
    }

    let invoiceId = null;
    if (supplierId) {
        if (!invoiceDate) throw new Error("יש להזין תאריך לחשבונית");
        invoiceId = await saveInvoice(null, {
            supplier_id: supplierId, invoice_date: invoiceDate, document_type: "invoice", items: invoiceLineItems,
            image: image instanceof Blob ? image : undefined,
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


// יצירת מוצר חדש במזווה מתוך חשבונית ידנית. price = מחיר ליחידת המזווה (ק"ג / ליטר / יחידה).
export async function createPantryItemFromInvoice({ name, category, unitType, unitAmount, price }) {
    name = (name || "").trim();
    if (!name) throw new Error("יש להזין שם מוצר");
    if (!(category in CATEGORY_GROUPS)) throw new Error(`יש לבחור קטגוריה עבור '${name}'`);
    if (!UNIT_TYPES.includes(unitType)) throw new Error(`יחידת מידה לא תקינה עבור '${name}'`);
    const dup = (await dbGetAll("pantryItems")).find((r) => !r.parent_id && r.name.trim().toLowerCase() === name.toLowerCase());
    if (dup) throw new Error(`'${name}' כבר קיים במזווה - בחר אותו מהרשימה במקום ליצור חדש`);
    let amount = null;
    if (unitType === "unit") {
        amount = parseFloat(unitAmount);
        if (Number.isNaN(amount) || amount <= 0) throw new Error(`יש להזין משקל/נפח ליחידה עבור '${name}'`);
    }
    return dbPut("pantryItems", {
        name, category, subcategory: null, unit_type: unitType, unit_amount: amount,
        price, yield_pct: 100, weight_before: null, weight_after: null, is_frozen: 0, parent_id: null,
    });
}
