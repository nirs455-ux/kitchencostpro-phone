import { CATEGORY_GROUPS, UNIT_TYPES } from "./constants.js";
// פרסור סריקת חשבונית/קבלה - טהור (בלי רשת/DB). משקף את INVOICE_SCAN_PROMPT, merge_discount_lines ו-compute_stock_factor
// ב-main.py, ונבדק מול אותם קלטים בדיוק (tests/invoice_parse.verify.*).

export const INVOICE_SCAN_PROMPT =
    "אתה מערכת לניתוח חשבוניות וקבלות של מסעדה. נתח את התמונה הזו וחלץ ממנה מידע.\n" +
    "החזר אך ורק JSON תקין, בדיוק בפורמט הזה, בלי שום טקסט נוסף לפני או אחרי:\n" +
    "{\n" +
    '  "supplier_name": "שם הספק (העסק שהוציא את המסמך) אם מופיע בבירור, אחרת null",\n' +
    '  "customer_name": "שם הלקוח (מי שמקבל את המסמך) אם מופיע, אחרת null",\n' +
    '  "invoice_date": "תאריך בפורמט YYYY-MM-DD אם מופיע, אחרת null",\n' +
    '  "invoice_total": 123.45,\n' +
    '  "totals": {"taxable": 75.75, "exempt": 77.6, "subtotal": 153.35, "vat": 13.64, "total": 166.99},\n' +
    '  "items": [\n' +
    '    {"name": "שם המוצר בעברית", "quantity": 1.0, "unit_price": 10.0, "line_total": 10.0, "is_discount": false, "category_guess": "ירקניה", "unit_guess": "weight"}\n' +
    "  ]\n" +
    "}\n" +
    "הספק הוא מי שהוציא את המסמך: השם והלוגו בראשו, ליד המילים חשבונית / תעודת משלוח / קבלה. מי שכתוב אחרי 'לכבוד', 'לקוח' או 'קוד לקוח' הוא הלקוח (הקונה) ולא הספק: את שמו החזר רק ב-customer_name. " +
    "name הוא שם המוצר כפי שמודפס בשורה, בלי להחליף אותו במוצר דומה ובלי להוסיף מוצרים שלא מופיעים. אם בסוגריים כתוב שם הספק או היצרן (למשל '(מהדרין)'), השמט אותו מהשם, ואם שם הספק לא כתוב בראש המסמך - שם כזה בסוגריים הוא שם הספק ויש להחזירו ב-supplier_name. " +
    "quantity חייב להיות מספר: הכמות או המשקל שנקנו, מעמודת הכמות בלבד (לא מעמודת תכולה או יחידות באריזה). unit_price הוא מספר, או null אם בשורה לא מודפס מחיר ולא סכום: אל תעתיק לשדה המחיר את הכמות או המשקל, ואל תמציא מחיר. line_total הוא הסכום שמודפס בשורה (יכול להיות שלילי). " +
    "אם לא ניתן לקרוא שורה בבירור - דלג עליה. אל תמציא נתונים שלא מופיעים בתמונה.\n" +
    "שורת מבצע/הנחה נפרדת (למשל 'מבצע 3 ב-50', שורה עם סכום שלילי מתחת למוצר, או הנחה כללית על כל החשבונית): " +
    "החזר אותה כשורה נפרדת עם is_discount=true ו-line_total=סכום ההנחה כפי שמודפס (שלילי). " +
    "אל תפחית את ההנחה בעצמך ממחיר המוצר, ואל תשנה את quantity/unit_price של המוצר עצמו. בכל שאר השורות is_discount=false.\n" +
    "אם בשורה עצמה יש עמודות מחיר מחירון, אחוז הנחה ומחיר אחרי הנחה: unit_price הוא המחיר אחרי ההנחה (מה ששולם ליחידה), ואל תחזיר שורת הנחה נפרדת עבורה.\n" +
    "החזרה או זיכוי של מוצר (מוצר שהוחזר, פיקדון שהוחזר): שורה עם שם המוצר, is_discount=false ו-line_total שלילי כפי שמודפס.\n" +
    "category_guess: הקטגוריה המתאימה ביותר למוצר, אחת מהבאות בלבד: מהים, קצביה, ירקניה, יבשים, מחלבה, בר, מחסן (ניקיון/חד-פעמי). " +
    "unit_guess: weight אם המוצר נמכר לפי משקל, liter אם נוזל לפי נפח, unit אם נמכר ביחידות/חבילות/גבעולים.\n" +
    "invoice_total הוא הסכום הסופי לתשלום כולל מע\"מ כפי שמודפס בתחתית הקבלה (מספר), או null אם לא מופיע בבירור.\n" +
    "totals: סיכומי החשבונית כפי שמודפסים בתחתית, מספרים או null אם לא מופיעים: taxable=סה\"כ חייב במע\"מ, exempt=סה\"כ לא חייב במע\"מ, subtotal=סה\"כ ללא מע\"מ, vat=סכום המע\"מ, total=סה\"כ כולל מע\"מ. העתק בדיוק כפי שכתוב, אל תחשב בעצמך.\n" +
    "שים לב במיוחד לשנה בתאריך: העתק אותה בדיוק כפי שהיא כתובה בתמונה, ספרה ספרה - אל תנחש ואל תעגל אותה.";

// הפרומפט הרגיל, ובנוסף רשימת המוצרים שבמזווה: ה-AI בוחר לכל שורה את המוצר הקיים לפי משמעותו (לא לפי דמיון אותיות)
export function invoicePromptWithPantry(names) {
    const list = [...new Set((names || []).map((n) => String(n).trim()).filter(Boolean))].slice(0, 700);
    if (!list.length) return INVOICE_SCAN_PROMPT;
    return INVOICE_SCAN_PROMPT + "\n" +
        "בנוסף, בכל פריט הוסף שדה pantry_match: השם המדויק, תו אחר תו, של המוצר מהרשימה שלמטה שהשורה מתייחסת אליו, או null אם אין ברשימה מוצר כזה. הרשימה היא רק לצורך התאמה: אל תוסיף שורות בגללה, ואל תשנה את name לפיה - name נשאר כפי שמודפס בחשבונית. " +
        "התאם לפי משמעות המוצר ולא לפי דמיון אותיות: תפוז ותפוח הם מוצרים שונים. ריבוי או יחיד, מותג, מקור וגודל אריזה לא משנים את המוצר. אם יש ספק, החזר null.\n" +
        "רשימת המוצרים במזווה:\n" + list.join("\n");
}

// כמו float() של פייתון: null/ריק/לא-מספר -> null
export function toFloat(v) {
    if (v === null || v === undefined || v === "") return null;
    let s = v;
    // טקסט עם פסיק: "12,50" = עשרוני, "1,250" או "1,250.50" = אלפים (Number("12,50") היה NaN והשורה נזרקה)
    if (typeof v === "string" && v.includes(",")) {
        const t = v.trim().replace(/\s/g, "");
        if (/^-?\d+,\d{1,2}$/.test(t)) s = t.replace(",", ".");
        else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) s = t.replace(/,/g, "");
    }
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
}

function truthy(v) {
    if (typeof v === "string") return ["true", "1", "yes"].includes(v.trim().toLowerCase());
    return Boolean(v);
}

// סיכומי מע"מ מהחשבונית כפי שמודפסים: { taxable, exempt, subtotal, vat, total } - מספרים או null. null אם אין אף אחד.
export function cleanVatTotals(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const out = {};
    let any = false;
    for (const k of ["taxable", "exempt", "subtotal", "vat", "total"]) {
        const n = toFloat(raw[k]);
        out[k] = n === null ? null : Math.round(n * 100) / 100;
        if (out[k] !== null) any = true;
    }
    return any ? out : null;
}

// שורות הסיכום בסדר שבו הן מופיעות בחשבונית (רק מה שקיים): [[תווית, סכום]]
export function vatLines(vat) {
    if (!vat) return [];
    return [['סה"כ חייב במע"מ', vat.taxable], ['סה"כ לא חייב במע"מ', vat.exempt], ['סה"כ ללא מע"מ', vat.subtotal], ['סכום המע"מ', vat.vat], ['סה"כ כולל מע"מ', vat.total]].filter(([, v]) => v !== null && v !== undefined);
}

// הסכום שאליו משווים את סכום השורות (שהוא לפני מע"מ): "סה"כ ללא מע"מ", או "כולל מע"מ פחות המע"מ"; רק בלי שניהם: הסכום הסופי.
// מחזיר { ref, label } או null כשאין עם מה להשוות.
export function totalsReference(vat, printedTotal) {
    if (vat && vat.subtotal != null) return { ref: vat.subtotal, label: 'סה"כ ללא מע"מ' };
    const total = vat && vat.total != null ? vat.total : printedTotal;
    if (total != null && vat && vat.vat != null) return { ref: Math.round((total - vat.vat) * 100) / 100, label: 'סה"כ ללא מע"מ' };
    if (total != null) return { ref: total, label: "סכום החשבונית" };
    return null;
}

// שורת פיקדון: חבית/מכל = חוזר לספק (keg), כל פיקדון אחר = בקבוקים שלא חוזרים (bottle). null = לא פיקדון
export function detectDeposit(name) {
    const n = String(name ?? "");
    if (!/פיקדון|פקדון/.test(n)) return null;
    return /חבית|חביות|מכל|קג/.test(n) ? "keg" : "bottle";
}

const round = (x, d) => Math.round(x * 10 ** d) / 10 ** d;

// שורה שלילית היא הנחה רק אם סומנה כהנחה, בלי שם, או ששמה אומר הנחה/מבצע. אחרת זו החזרה/זיכוי של מוצר.
const DISCOUNT_NAME = /הנחה|הנחת|מבצע|discount/i;

// מאחד שורות מבצע/הנחה לתוך המוצר שמעליהן (שלא יהפכו למוצרים נפרדים). שורת הנחה בלי מוצר לפניה נזרקת.
// החזרה/זיכוי (שורה שלילית עם שם מוצר) לא נבלעת כהנחה ולא משנה מחיר: נאספת ב-merged.returns = [{ name, amount }] (amount שלילי)
export function mergeDiscountLines(items) {
    const merged = [];
    const returns = [];
    let skipped = 0; // שורות בלי כמות או מחיר (לא נקראו במלואן)
    for (const it of items || []) {
        if (!it || typeof it !== "object" || Array.isArray(it)) continue;
        const name = String(it.name ?? "").trim();
        let qty = toFloat(it.quantity);
        let price = toFloat(it.unit_price);
        const lineTotal = toFloat(it.line_total);
        const amount = lineTotal !== null ? lineTotal : (qty !== null && price !== null ? qty * price : null);
        const negative = (amount !== null && amount < 0) || (price !== null && price < 0);
        if (negative && !truthy(it.is_discount) && name && !DISCOUNT_NAME.test(name)) {
            const back = amount !== null ? amount : price;
            returns.push({ name, amount: round(-Math.abs(back), 2) });
            continue;
        }
        const isDiscount = truthy(it.is_discount) || negative;
        if (isDiscount) {
            // מבצע/הנחה: שורה נפרדת (סכום חיובי = גובה ההנחה). לא מצורפת למוצר ולא משנה את מחירו
            const discount = amount !== null ? Math.abs(amount) : (price !== null ? Math.abs(price) : 0);
            if (discount) merged.push({ name: name || "מבצע", quantity: 1, unit_price: round(discount, 4), discount_applied: 0, promo: true, category_guess: null, unit_guess: null });
            continue;
        }
        if (qty === null) { skipped++; continue; }
        // בלי מחיר ליחידה אבל יש סכום שורה: המחיר נגזר ממנו. בלי שניהם: השורה נשמרת בלי מחיר (null) ולא נזרקת
        if (price === null && lineTotal !== null && qty > 0) price = round(lineTotal / qty, 4);
        // כמות לא מתאימה לסכום השורה (למשל נקראה עמודת התכולה): אם הסכום חלקי המחיר הוא מספר שלם גדול מהכמות, הכמות מתוקנת
        let qtyFixed = false;
        let lineMismatch = false;
        if (price !== null && price > 0 && lineTotal !== null && lineTotal > 0 && qty > 0) {
            const ratio = lineTotal / price;
            const mismatch = Math.abs(qty * price - lineTotal) > Math.max(0.02 * lineTotal, 0.05);
            if (mismatch && ratio >= 1 && Math.round(ratio) !== qty && Math.abs(ratio - Math.round(ratio)) <= Math.max(0.005 * ratio, 0.005 * Math.round(ratio) / price) + 0.01) { qty = Math.round(ratio); qtyFixed = true; }
            else if (mismatch) lineMismatch = true; // הכמות, המחיר והסכום לא מתאימים ואין תיקון בטוח: מסמנים לבדיקה
        }
        const cat = String(it.category_guess ?? "").trim();
        const unit = String(it.unit_guess ?? "").trim();
        merged.push({
            name, quantity: qty, unit_price: price, discount_applied: 0,
            ...(qtyFixed ? { qty_fixed: true } : {}),
            ...(lineMismatch ? { line_mismatch: true } : {}),
            category_guess: cat in CATEGORY_GROUPS ? cat : null,
            unit_guess: UNIT_TYPES.includes(unit) ? unit : null,
            ...(typeof it.pantry_match === "string" && it.pantry_match.trim() ? { pantry_match: it.pantry_match.trim() } : {}),
        });
    }
    merged.skipped = skipped;
    merged.returns = returns;
    return merged;
}

// גודל אריזה -> ק"ג/ליטר (יחידת חומרי הגלם). משקל: g/kg. נפח: ml/l.
export const PACKAGE_UNIT_TO_BASE = { weight: { g: 0.001, kg: 1.0 }, liter: { ml: 0.001, l: 1.0 } };

// כמה יחידות חומרי גלם (ק"ג/ליטר/יחידות) יש ביחידה אחת של שורת החשבונית. מחזיר { factor, error }.
export function computeStockFactor(unitType, unitsPerCase, packageSize, packageUnit) {
    const caseN = unitsPerCase && unitsPerCase > 0 ? unitsPerCase : 1.0;
    let pack = 1.0;
    if (packageSize && packageSize > 0) {
        if (!(unitType in PACKAGE_UNIT_TO_BASE)) {
            return { factor: null, error: "גודל אריזה רלוונטי רק למוצר שנמדד במשקל או בליטרים" };
        }
        const base = PACKAGE_UNIT_TO_BASE[unitType][packageUnit];
        if (base === undefined) return { factor: null, error: "יחידת גודל האריזה לא תואמת ליחידת המוצר" };
        pack = packageSize * base;
    }
    return { factor: caseN * pack, error: null };
}
