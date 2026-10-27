// שיטה אחת לכמויות בכל האפליקציה. שני מצבים (נבחרים באשף שפה ומטבע ובהגדרות, ברירת מחדל גרמים):
//   גרמים (g): מקלידים מספר שלם בגרמים. 100 = 100 גרם, 1500 = קילו וחצי. לנוזלים: מ"ל.
//   ק"ג (kg): מקלידים ק"ג עם נקודה עשרונית, כמו על מאזני מטבח. 0.100 = 100 גרם, 1.5 = קילו וחצי.
// הנתונים נשמרים תמיד בגרמים; כאן רק קריאה והצגה. טהור (בלי DOM).

let mode = "g";
export function setQtyMode(m) { mode = m === "kg" ? "kg" : "g"; }
export function getQtyMode() { return mode; }
export const isGramMode = () => mode === "g";

// שם יחידת ההקלדה לתוויות: גרם / ק"ג, ובנוזלים מ"ל / ליטר
export const qtyUnit = ({ liquid = false } = {}) => (mode === "g" ? (liquid ? 'מ"ל' : "גרם") : liquid ? "ליטר" : 'ק"ג');

const NUM = /^\d*\.?\d+$|^\d+\.$/;
function parseNum(text) {
    if (text == null) return null;
    const t = String(text).trim().replace(",", ".");
    if (t === "" || !NUM.test(t)) return null;
    const n = parseFloat(t);
    return Number.isFinite(n) ? n : null;
}

// "0.350", "0,350", ".5", "1.5" -> ק"ג כמספר. null אם ריק או לא תקין
export function parseKg(text) { return parseNum(text); }

// ק"ג -> גרמים (עד 2 ספרות אחרי הנקודה בגרמים, למשל 0.0255 ק"ג = 25.5 גרם)
export function kgToGrams(kg) {
    return Math.round(kg * 1000 * 100) / 100;
}

// מה שהוקלד -> גרמים, לפי המצב. null אם ריק או לא תקין
export function textToGrams(text) {
    const n = parseNum(text);
    if (n == null) return null;
    return mode === "g" ? Math.round(n * 100) / 100 : kgToGrams(n);
}

// גרמים -> טקסט להצגה בשדה, לפי המצב: 350 -> "350" (גרמים) או "0.350" (ק"ג)
export function gramsToKgText(g) {
    g = Number(g);
    if (!Number.isFinite(g) || g <= 0) return "";
    if (mode === "g") return String(+g.toFixed(2));
    let s = (g / 1000).toFixed(4);
    s = s.replace(/0+$/, "");
    const dec = s.split(".")[1] || "";
    if (dec.length < 3) s = s.split(".")[0] + "." + dec.padEnd(3, "0");
    // מספר עגול בק"ג שלם: 1.500 -> 1.5, 2.000 -> 2
    if (/^\d+\.000$/.test(s)) s = s.split(".")[0];
    else if (/^\d+\.\d00$/.test(s) && Number(s) >= 1) s = s.replace(/0+$/, "");
    return s;
}
export const gramsToText = gramsToKgText;

// שורת אישור מתחת לשדה: מה המערכת הבינה. liquid -> מ"ל/ליטר במקום גרם/ק"ג
export function describeQty(text, { liquid = false } = {}) {
    const g = textToGrams(text);
    if (g == null) return "";
    const small = liquid ? 'מ"ל' : "גרם";
    const big = liquid ? "ליטר" : 'ק"ג';
    const n = +g.toFixed(2);
    if (mode === "g") return g >= 1000 ? `= ${+(g / 1000).toFixed(3)} ${big}` : ""; // בגרמים: מראים את הצד השני רק מעל קילו
    return g >= 1000 ? `= ${n} ${small} (${+(g / 1000).toFixed(3)} ${big})` : `= ${n} ${small}`;
}

// אזהרה על כמות חשודה (מחזיר טקסט או null)
export function qtyWarning(text, { liquid = false } = {}) {
    const n = parseNum(text);
    const raw = String(text == null ? "" : text).trim();
    const big = liquid ? "ליטר" : 'ק"ג';
    const small = liquid ? 'מ"ל' : "גרם";
    if (mode === "g") {
        if (raw !== "" && n == null) return "לא הבנתי את המספר. כותבים מספר בגרמים.";
        if (n == null) return null;
        if (n > 0 && n < 1) return `פחות מ${small} אחד. אם התכוונת ${Math.round(n * 1000)} ${small}, כתוב ${Math.round(n * 1000)}.`;
        if (n > 25000) return `${n} ${small}? זה ${+(n / 1000).toFixed(1)} ${big}. בטוח?`;
        return null;
    }
    if (raw !== "" && n == null) return 'לא הבנתי את המספר. כותבים למשל 0.350 (ק"ג).';
    if (n == null) return null;
    if (n > 25) return `${n} ${big}? אם התכוונת ${n} ${small}, כתוב ${+(n / 1000).toFixed(3)}.`;
    if (n > 0 && n < 0.0005) return `פחות מחצי ${small}. בטוח?`;
    return null;
}

// מוצר ספירה (יחידות בלי משקל, למשל לחמניה): מקלידים מספר יחידות רגיל. "2" = 2 יחידות. null אם ריק או לא תקין
export function textToCount(text) {
    const n = parseNum(text);
    return n != null && n > 0 ? n : null;
}

export function countToText(n) {
    n = Number(n);
    return Number.isFinite(n) && n > 0 ? String(+n.toFixed(4)) : "";
}

export function describeCount(text) {
    const n = textToCount(text);
    return n == null ? "" : `= ${n} יחידות`;
}

export function countWarning(text) {
    const raw = String(text == null ? "" : text).trim();
    if (raw !== "" && textToCount(raw) == null) return "לא הבנתי את המספר. כותבים מספר יחידות.";
    const n = textToCount(raw);
    if (n != null && n > 1000) return `${n} יחידות? בטוח?`;
    return null;
}
