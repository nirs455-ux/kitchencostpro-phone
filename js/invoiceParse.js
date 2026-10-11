// פרסור סריקת חשבונית/קבלה - טהור (בלי רשת/DB). משקף את INVOICE_SCAN_PROMPT, merge_discount_lines ו-compute_stock_factor
// ב-main.py, ונבדק מול אותם קלטים בדיוק (tests/invoice_parse.verify.*).

export const INVOICE_SCAN_PROMPT =
    "אתה מערכת לניתוח חשבוניות וקבלות של מסעדה. נתח את התמונה הזו וחלץ ממנה מידע.\n" +
    "החזר אך ורק JSON תקין, בדיוק בפורמט הזה, בלי שום טקסט נוסף לפני או אחרי:\n" +
    "{\n" +
    '  "supplier_name": "שם הספק אם מופיע בבירור, אחרת null",\n' +
    '  "invoice_date": "תאריך בפורמט YYYY-MM-DD אם מופיע, אחרת null",\n' +
    '  "items": [\n' +
    '    {"name": "שם המוצר בעברית", "quantity": 1.0, "unit_price": 10.0, "line_total": 10.0, "is_discount": false}\n' +
    "  ]\n" +
    "}\n" +
    "quantity ו-unit_price חייבים להיות מספרים. line_total הוא הסכום שמודפס בשורה (יכול להיות שלילי). " +
    "אם לא ניתן לקרוא שורה בבירור - דלג עליה. אל תמציא נתונים שלא מופיעים בתמונה.\n" +
    "שורת מבצע/הנחה שמתייחסת למוצר מסוים (למשל 'מבצע 3 ב-50' או שורה עם סכום שלילי מתחת למוצר): " +
    "החזר אותה כשורה נפרדת עם is_discount=true ו-line_total=סכום ההנחה כפי שמודפס (שלילי). " +
    "אל תפחית את ההנחה בעצמך ממחיר המוצר, ואל תשנה את quantity/unit_price של המוצר עצמו. " +
    "הנחות כלליות על כל החשבונית (מועדון, הנחה בסוף הקבלה) - אל תחזיר בכלל. בכל שאר השורות is_discount=false.\n" +
    "שים לב במיוחד לשנה בתאריך: העתק אותה בדיוק כפי שהיא כתובה בתמונה, ספרה ספרה - אל תנחש ואל תעגל אותה.";

// כמו float() של פייתון: null/ריק/לא-מספר -> null
export function toFloat(v) {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

function truthy(v) {
    if (typeof v === "string") return ["true", "1", "yes"].includes(v.trim().toLowerCase());
    return Boolean(v);
}

const round = (x, d) => Math.round(x * 10 ** d) / 10 ** d;

// מאחד שורות מבצע/הנחה לתוך המוצר שמעליהן (שלא יהפכו למוצרים נפרדים). שורת הנחה בלי מוצר לפניה נזרקת.
export function mergeDiscountLines(items) {
    const merged = [];
    for (const it of items || []) {
        if (!it || typeof it !== "object" || Array.isArray(it)) continue;
        const name = String(it.name ?? "").trim();
        const qty = toFloat(it.quantity);
        const price = toFloat(it.unit_price);
        const lineTotal = toFloat(it.line_total);
        const amount = lineTotal !== null ? lineTotal : (qty !== null && price !== null ? qty * price : null);
        const isDiscount = truthy(it.is_discount) || (amount !== null && amount < 0) || (price !== null && price < 0);
        if (isDiscount) {
            const discount = amount !== null ? Math.abs(amount) : (price !== null ? Math.abs(price) : 0);
            if (merged.length && discount) {
                const prev = merged[merged.length - 1];
                prev.discount_applied = round(prev.discount_applied + discount, 2);
            }
            continue;
        }
        if (qty === null || price === null) continue;
        merged.push({ name, quantity: qty, unit_price: price, discount_applied: 0 });
    }
    for (const m of merged) {
        if (m.discount_applied && m.quantity > 0) {
            m.list_unit_price = m.unit_price;
            m.unit_price = round(Math.max(m.quantity * m.unit_price - m.discount_applied, 0) / m.quantity, 4);
        }
    }
    return merged;
}

// גודל אריזה -> ק"ג/ליטר (יחידת המזווה). משקל: g/kg. נפח: ml/l.
export const PACKAGE_UNIT_TO_BASE = { weight: { g: 0.001, kg: 1.0 }, liter: { ml: 0.001, l: 1.0 } };

// כמה יחידות מזווה (ק"ג/ליטר/יחידות) יש ביחידה אחת של שורת החשבונית. מחזיר { factor, error }.
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
