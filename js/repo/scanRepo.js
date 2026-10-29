// סריקת חשבונית - קריאה ישירה ל-Gemini מהדפדפן (אין שרת שמסתיר את המפתח - ראה הגדרות).
// תרגום מדויק של /api/scan-invoice ו-/api/scan-invoice/apply מ-main.py.
import { dbGetAll, dbGet, dbPut } from "../db.js";
import { geminiFetch } from "./gemini.js";
import { getCloseMatches } from "../fuzzyMatch.js";
import { CATEGORY_GROUPS, UNIT_TYPES } from "../constants.js";
import { saveInvoice, validateInvoicePayload } from "./suppliersRepo.js";
import { getSetting, setSetting } from "./settingsRepo.js";
import { compressImage } from "../imageUtil.js";
import { prepareParts } from "../filePrep.js";
import { buildBasePrompt, parseBaseAnswer } from "../bakers.js";
import { NON_FOOD_CATEGORIES } from "../constants.js";
import { recipeScanPrompt, buildRecipeDraft } from "../recipeParse.js";
import { getRecipeCategories } from "./recipeCategories.js";
import { INVOICE_SCAN_PROMPT, mergeDiscountLines, computeStockFactor, toFloat, cleanVatTotals } from "../invoiceParse.js";
import { LABEL_SCAN_PROMPT, parseLabelAnswer } from "../labelParse.js";
import { COUNT_SCAN_PROMPT } from "../countAssist.js";

function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// עוזר AI מחזיר 503 עם סיבה: agent_unavailable (מפתח/קרדיטים) או agent_off (מתג כיבוי). מחזיר true אם זו בעיה בצד הבעלים.
async function agentDown(response) {
    if (response.status !== 503) return false;
    try { const j = await response.clone().json(); return j && (j.error === "agent_unavailable" || j.error === "agent_off"); } catch (e) { return false; }
}
const AGENT_DOWN_MSG = "עוזר AI לא זמין כרגע (ייתכן שהקרדיטים נגמרו). זה לא קשור אליך: אפשר לשמור את התמונה לעיבוד מאוחר ולנסות שוב בהמשך.";

// שגיאת פענוח של תשובת Gemini -> הודעה ברורה (תשובה ריקה/חסומה או טקסט שאינו JSON)
function unreadableMessage(e) {
    if (e instanceof TypeError) return "עוזר AI לא החזיר תשובה (ייתכן שהתמונה לא ברורה או נחסמה). נסה לצלם שוב.";
    return "לא הצלחתי לקרוא את התוכן. נסה לצלם שוב, ישר ובאור טוב.";
}

export async function scanInvoiceImage(apiKey, file, onRetry) {
    if (!apiKey) throw new Error("לא הוגדר מפתח API של Gemini. הזן אותו במסך ההגדרות.");
    // הכנת הקובץ: תמונה (מכווצת) / PDF נשלחים כמו שהם; Word / Excel / טקסט וכו' - חילוץ טקסט
    const prepared = await prepareParts(file, "תוכן החשבונית");

    // Gemini לפעמים עמוס (503/429): ניסיון חוזר קצר, ואז מודל גיבוי (js/repo/gemini.js). בלי לבקש מהמשתמש לצלם מחדש.
    let response;
    try {
        response = await geminiFetch(apiKey, { contents: [{ parts: [{ text: INVOICE_SCAN_PROMPT }, ...prepared.parts] }] }, {
            onRetry: (i) => { if (onRetry) onRetry(i.attempt, 3, i.model); },
        });
    } catch (e) {
        const err = new Error("אין חיבור לאינטרנט או שהשרת לא זמין. אפשר לנסות שוב, או לשמור את התמונה לעיבוד מאוחר.");
        err.queueable = true;
        throw err;
    }
    if (!response.ok) {
        const code = response.status;
        if (await agentDown(response)) { const err = new Error(AGENT_DOWN_MSG); err.queueable = true; throw err; }
        if (code === 503 || code === 429 || code === 500 || code === 502 || code === 504) {
            const err = new Error("שרת הקריאה של Google עמוס כרגע (זה זמני, לא קשור לאפליקציה). ניסינו כמה פעמים. אפשר לנסות שוב, או לשמור את התמונה לעיבוד מאוחר.");
            err.queueable = true;
            throw err;
        }
        if (code === 402) throw new Error("הגעת למגבלה היומית של עוזר AI. אפשר להמשיך מחר, או להזין מפתח Gemini אישי בהגדרות.");
        if (code === 413) throw new Error("הקובץ גדול מדי לסריקה. צלם שוב בגודל קטן יותר, או שלח רק חלק מהעמודים.");
        if (code === 400 || code === 403) throw new Error("מפתח ה-API לא תקין או חסרות הרשאות. בדוק את המפתח בהגדרות.");
        const text = await response.text();
        throw new Error(`שגיאה מהשרת (${code}): ${text.slice(0, 120)}`);
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
        throw new Error(unreadableMessage(e));
    }

    const pantryRows = (await dbGetAll("pantryItems")).filter((r) => !r.parent_id);
    const byName = new Map(pantryRows.map((r) => [r.name.trim().toLowerCase(), r]));
    const items = mergeDiscountLines(parsed.items || []);
    const skippedLines = items.skipped || 0;
    const enrichedItems = [];
    // כינויים שנלמדו מסריקות קודמות: שם בקבלה -> מוצר חומרי גלם שהמשתמש בחר
    const aliases = (await getSetting("scan_aliases")) || {};
    const byId = new Map(pantryRows.map((r) => [r.id, r]));
    // אריזה/ארגז אחרונים שנרשמו לכל מוצר - כדי שקנייה חוזרת לא תדרוש הזנה מחדש
    const lastFactor = new Map();
    {
        const invDates = Object.fromEntries((await dbGetAll("invoices")).filter((i) => !i.deleted_at).map((i) => [i.id, i.invoice_date || ""]));
        const lastDate = new Map();
        for (const li of await dbGetAll("invoiceItems")) {
            if (!li.pantry_item_id) continue;
            if (!(li.invoice_id in invDates)) continue;
            const d = invDates[li.invoice_id] || "";
            if (d >= (lastDate.get(li.pantry_item_id) ?? "")) { lastDate.set(li.pantry_item_id, d); lastFactor.set(li.pantry_item_id, li.stock_factor || null); }
        }
    }

    for (const it of items) {
        const name = it.name;
        const quantity = it.quantity;
        const unitPrice = it.unit_price;
        // שורה בלי שם נשארת (המשתמש ימלא שם או יסיר אותה במסך הבדיקה)

        let match = name ? byName.get(name.trim().toLowerCase()) : null;
        if (!match && name && byId.has(aliases[name.trim().toLowerCase()])) match = byId.get(aliases[name.trim().toLowerCase()]);
        let suggested = null;
        if (!match && name) {
            const close = getCloseMatches(name.trim().toLowerCase(), [...byName.keys()], 1, 0.75);
            if (close.length) suggested = byName.get(close[0]);
        }

        enrichedItems.push({
            name, orig_name: name, quantity, unit_price: unitPrice,
            guess_category: it.category_guess || null, guess_unit: it.unit_guess || null,
            default_factor: match ? lastFactor.get(match.id) || null : null,
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

    return { skipped_lines: skippedLines, supplier_name: parsed.supplier_name || null, invoice_date: parsed.invoice_date || null, invoice_total: toFloat(parsed.invoice_total), vat: cleanVatTotals(parsed.totals), items: enrichedItems, attachment: prepared.attachment, partial: !!prepared.partial };
}

// מחיל את שורות הסריקה על חומרי הגלם (ואופציונלית שומר כחשבונית מקושרת לספק). מקביל ל-apply_scanned_invoice.
export async function applyScannedInvoice({ items, supplierId, invoiceDate, image, pettyCash = false, purchaser = "", vat = null }) {
    // שלב 1: אימות מלא ובניית תוכנית - שום כתיבה עד שכל השורות תקינות (אין שמירה חלקית)
    const plan = [];
    for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const where = `שורה ${i + 1}`;
        const name = (it.name || "").trim();
        if (!name) throw new Error(`${where}: יש למלא שם מוצר, או להסיר את השורה`);
        const quantity = parseFloat(it.quantity);
        const unitPrice = parseFloat(it.unit_price);
        if (!Number.isFinite(quantity) || !Number.isFinite(unitPrice)) throw new Error(`${where}: כמות/מחיר לא תקינים עבור '${name}'`);
        if (quantity <= 0 || unitPrice < 0) throw new Error(`${where}: כמות חייבת להיות גדולה מ-0 ומחיר לא שלילי עבור '${name}'`);

        const unitsPerCase = it.units_per_case === "" || it.units_per_case == null ? null : parseFloat(it.units_per_case);
        const packageSize = it.package_size === "" || it.package_size == null ? null : parseFloat(it.package_size);
        if (packageSize !== null && (Number.isNaN(packageSize) || packageSize <= 0)) throw new Error(`${where}: גודל אריזה לא תקין עבור '${name}'`);

        let existing = null;
        let category = null, unitType = null, unitAmount = null;
        let linkedId = it.pantry_item_id;
        if (!linkedId) {
            // שם שהמשתמש תיקן לשם של מוצר שכבר קיים = אותו מוצר (לא יוצרים כפילות)
            const same = (await dbGetAll("pantryItems")).find((r) => !r.parent_id && r.name.trim().toLowerCase() === name.toLowerCase());
            if (same) linkedId = same.id;
        }
        if (linkedId) {
            existing = await dbGet("pantryItems", linkedId);
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
            if (unitType === "unit" && it.unit_amount !== "" && it.unit_amount != null) {
                unitAmount = parseFloat(it.unit_amount);
                if (!(unitAmount > 0)) throw new Error(`${where}: משקל ליחידה לא תקין עבור '${name}'`);
            }
        }

        if (packageSize && packageSize < 1 && (it.package_unit === "g" || it.package_unit === "ml")) {
            throw new Error(`${where}: גודל אריזה ${packageSize} ב${it.package_unit === "g" ? "גרם" : 'מ"ל'} נראה קטן מדי - התכוונת ל-${packageSize} ${it.package_unit === "g" ? 'ק"ג' : "ליטר"}?`);
        }
        let { factor, error } = computeStockFactor(unitType, unitsPerCase, packageSize, it.package_unit);
        if (error) throw new Error(`${where}: ${error} ('${name}')`);
        // לא הוזנה אריזה/ארגז: משתמשים באלה של הקנייה הקודמת של אותו מוצר
        if (existing && !unitsPerCase && !packageSize && it.default_factor > 0) factor = it.default_factor;
        const stockFactor = factor && factor !== 1 ? factor : null;
        const pantryPrice = unitPrice / (factor || 1);
        plan.push({ it, orig: (it.orig_name || "").trim(), name, quantity, unitPrice, existing, category, unitType, unitAmount, pantryPrice, stockFactor });
    }

    // אימות חשבונית (ספק/תאריך) לפני כל כתיבה - אחרת מוצרים כבר נכתבו וה-חשבונית נכשלת
    if (supplierId) {
        if (!invoiceDate) throw new Error("יש להזין תאריך לחשבונית");
        if (!(await dbGet("suppliers", parseInt(supplierId, 10)))) throw new Error("ספק לא נמצא");
        // אימות מלא (שנה סבירה, סכומים) לפני שמחירי חומרי הגלם משתנים: טעות OCR בשנה לא משאירה מחירים מעודכנים בלי חשבונית
        await validateInvoicePayload({
            supplier_id: supplierId, invoice_date: invoiceDate, document_type: "invoice", petty_cash: pettyCash, purchaser,
            items: plan.map((p) => ({ product_name: p.name, quantity: p.quantity, unit_price: p.unitPrice, stock_factor: p.stockFactor })),
        });
    }

    // שלב 2: כתיבה
    const createdByName = new Map(); // שני מוצרים חדשים באותו שם בסריקה אחת = מוצר אחד
    const resolvedPantryIds = [];
    const invoiceLineItems = [];
    const aliasPairs = [];
    for (const p of plan) {
        const isFrozen = p.it.is_frozen ? 1 : 0;
        let pantryItemId;
        if (p.existing) {
            if (!p.existing.parent_id) Object.assign(p.existing, { price: p.pantryPrice, category: p.category, is_frozen: isFrozen });
            else Object.assign(p.existing, { price: p.pantryPrice, is_frozen: isFrozen });
            await dbPut("pantryItems", p.existing);
            pantryItemId = p.existing.id;
        } else if (createdByName.has(p.name.toLowerCase())) {
            pantryItemId = createdByName.get(p.name.toLowerCase());
        } else {
            pantryItemId = await dbPut("pantryItems", {
                name: p.name, category: p.category, subcategory: null, unit_type: p.unitType, unit_amount: p.unitAmount,
                price: p.pantryPrice, yield_pct: 100, weight_before: null, weight_after: null,
                is_frozen: isFrozen, parent_id: null,
            });
            createdByName.set(p.name.toLowerCase(), pantryItemId);
        }
        resolvedPantryIds.push(pantryItemId);
        const finalName = p.existing ? p.existing.name : p.name;
        if (p.orig && p.orig.toLowerCase() !== finalName.trim().toLowerCase()) aliasPairs.push([p.orig.toLowerCase(), pantryItemId]);
        invoiceLineItems.push({ product_name: p.name, quantity: p.quantity, unit_price: p.unitPrice, pantry_item_id: pantryItemId, stock_factor: p.stockFactor });
    }

    let invoiceId = null;
    if (supplierId) {
        if (!invoiceDate) throw new Error("יש להזין תאריך לחשבונית");
        invoiceId = await saveInvoice(null, {
            supplier_id: supplierId, invoice_date: invoiceDate, document_type: "invoice", items: invoiceLineItems,
            image: image instanceof Blob ? image : undefined,
            petty_cash: pettyCash, purchaser, vat,
        });
    }
    if (aliasPairs.length) {
        const aliases = (await getSetting("scan_aliases")) || {};
        for (const [a, id] of aliasPairs) aliases[a] = id;
        await setSetting("scan_aliases", aliases);
    }
    return { pantry_item_ids: resolvedPantryIds, invoice_id: invoiceId };
}


// סריקת מתכון מתמונה: מחזיר טיוטה (name, category, final_weight, ingredients) - שום דבר לא נשמר.
export async function scanRecipeImage(apiKey, file) {
    if (!apiKey) throw new Error("לא הוגדר מפתח API של Gemini. הזן אותו במסך ההגדרות.");
    const prepared = await prepareParts(file, "טקסט המתכון");
    const filePart = prepared.parts;
    const categories = await getRecipeCategories();

    let response;
    try {
        response = await geminiFetch(apiKey, { contents: [{ parts: [{ text: recipeScanPrompt(categories) }, ...filePart] }] });
    } catch (e) {
        throw new Error("אין חיבור לאינטרנט או שהשרת לא זמין. נסה שוב בעוד רגע.");
    }
    if (!response.ok) {
        if (await agentDown(response)) throw new Error(AGENT_DOWN_MSG);
        if (response.status === 413) throw new Error("הקובץ גדול מדי לסריקה. צלם שוב בגודל קטן יותר, או שלח רק חלק מהעמודים.");
        if (response.status === 402) throw new Error("הגעת למגבלה היומית של עוזר AI. אפשר להמשיך מחר, או להזין מפתח Gemini אישי בהגדרות.");
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
        throw new Error(unreadableMessage(e));
    }
    const pantry = (await dbGetAll("pantryItems")).filter((r) => !NON_FOOD_CATEGORIES.has(r.category));
    const draft = buildRecipeDraft(parsed, pantry, categories);
    // המקור נשמר עם המתכון ("מתכון כפי שהוא"): הקובץ המקורי (תמונה מכווצת / PDF / מסמך), ואם הוא מסמך טקסט - גם הטקסט שחולץ
    draft.source_file = prepared.attachment || null;
    return draft;
}

// סריקת תווית יצרן: מחזיר טיוטה (שם, רכיבים, אלרגנים, ערכים תזונתיים ל-100 גרם). שום דבר לא נשמר.
export async function scanLabelImage(apiKey, file) {
    if (!apiKey) throw new Error("לא הוגדר מפתח API של Gemini. הזן אותו במסך ההגדרות.");
    const prepared = await prepareParts(file, "טקסט התווית");
    let response;
    try {
        response = await geminiFetch(apiKey, { contents: [{ parts: [{ text: LABEL_SCAN_PROMPT }, ...prepared.parts] }] });
    } catch (e) {
        throw new Error("אין חיבור לאינטרנט או שהשרת לא זמין. נסה שוב בעוד רגע.");
    }
    if (!response.ok) {
        if (await agentDown(response)) throw new Error(AGENT_DOWN_MSG);
        if (response.status === 413) throw new Error("התמונה גדולה מדי. צלם שוב קרוב יותר לתווית.");
        if (response.status === 402) throw new Error("הגעת למגבלה היומית של עוזר AI. אפשר להמשיך מחר, או להזין מפתח Gemini אישי בהגדרות.");
        if (response.status === 503 || response.status === 429) throw new Error("שרת הקריאה של Google עמוס כרגע. נסה שוב בעוד רגע.");
        const text = await response.text();
        throw new Error(`שגיאה מה-API (${response.status}): ${text.slice(0, 200)}`);
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
        throw new Error(unreadableMessage(e));
    }
    const draft = parseLabelAnswer(parsed);
    if (draft.empty) throw new Error("לא הצלחתי לקרוא נתונים מהתווית. צלם שוב: קרוב, ישר, באור טוב, כשהטבלה התזונתית ורשימת הרכיבים בפריים.");
    return draft;
}

// קריאת דף ספירה בכתב יד: מחזיר את ה-JSON הגולמי { rows: [{ n, name, counted, uncertain }] } להתאמה ב-countAssist.js. שום דבר לא נשמר.
export async function scanCountSheet(apiKey, file) {
    if (!apiKey) throw new Error("לא הוגדר מפתח API של Gemini. הזן אותו במסך ההגדרות.");
    const prepared = await prepareParts(file, "דף ספירה");
    let response;
    try {
        response = await geminiFetch(apiKey, { contents: [{ parts: [{ text: COUNT_SCAN_PROMPT }, ...prepared.parts] }] });
    } catch (e) {
        throw new Error("אין חיבור לאינטרנט או שהשרת לא זמין. נסה שוב בעוד רגע.");
    }
    if (!response.ok) {
        if (await agentDown(response)) throw new Error(AGENT_DOWN_MSG);
        if (response.status === 413) throw new Error("התמונה גדולה מדי. צלם שוב, דף אחד בכל צילום.");
        if (response.status === 402) throw new Error("הגעת למגבלה היומית של עוזר AI. אפשר להמשיך מחר, או להזין מפתח Gemini אישי בהגדרות.");
        if (response.status === 503 || response.status === 429) throw new Error("שרת הקריאה של Google עמוס כרגע. נסה שוב בעוד רגע.");
        const text = await response.text();
        throw new Error(`שגיאה מה-API (${response.status}): ${text.slice(0, 200)}`);
    }
    try {
        const result = await response.json();
        let text = result.candidates[0].content.parts[0].text.trim();
        if (text.startsWith("```")) {
            text = text.split("```")[1];
            if (text.startsWith("json")) text = text.slice(4);
        }
        return JSON.parse(text.trim());
    } catch (e) {
        throw new Error(unreadableMessage(e));
    }
}


// יצירת מוצר חדש בחומרי הגלם מתוך חשבונית ידנית. price = מחיר ליחידת חומרי הגלם (ק"ג / ליטר / יחידה).
export async function createPantryItemFromInvoice({ name, category, unitType, unitAmount, price }) {
    name = (name || "").trim();
    if (!name) throw new Error("יש להזין שם מוצר");
    if (!(category in CATEGORY_GROUPS)) throw new Error(`יש לבחור קטגוריה עבור '${name}'`);
    if (!UNIT_TYPES.includes(unitType)) throw new Error(`יחידת מידה לא תקינה עבור '${name}'`);
    const dup = (await dbGetAll("pantryItems")).find((r) => !r.parent_id && r.name.trim().toLowerCase() === name.toLowerCase());
    if (dup) throw new Error(`'${name}' כבר קיים בחומרי הגלם - בחר אותו מהרשימה במקום ליצור חדש`);
    let amount = null;
    if (unitType === "unit" && unitAmount !== "" && unitAmount != null) {
        amount = parseFloat(unitAmount);
        if (!(amount > 0)) throw new Error(`משקל ליחידה לא תקין עבור '${name}'`);
    }
    return dbPut("pantryItems", {
        name, category, subcategory: null, unit_type: unitType, unit_amount: amount,
        price, yield_pct: 100, weight_before: null, weight_after: null, is_frozen: 0, parent_id: null,
    });
}

// מבקש מ-Gemini להציע את הרכיב המרכזי (בסיס לאחוזי אופים). מחזיר { ids, reason } או null (אין מפתח / כשל / תשובה לא תקינה).
export async function suggestRecipeBase(apiKey, recipeName, items) {
    if (!apiKey || !items.length) return null;
    const prompt = buildBasePrompt(recipeName, items);
    try {
        const response = await geminiFetch(apiKey, { contents: [{ parts: [{ text: prompt }] }] });
        if (!response.ok) return null;
        const result = await response.json();
        let text = result.candidates[0].content.parts[0].text.trim();
        if (text.startsWith("```")) {
            text = text.split("```")[1];
            if (text.startsWith("json")) text = text.slice(4);
        }
        return parseBaseAnswer(JSON.parse(text.trim()), items);
    } catch (e) {
        return null;
    }
}
