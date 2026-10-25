// שיטה אחת לכמויות בכל האפליקציה: מקלידים ק"ג (או ליטר) עם נקודה עשרונית, כמו על מאזני מטבח.
// 0.500 = 500 גרם, 0.025 = 25 גרם, 1.5 = קילו וחצי. הנתונים נשמרים בגרמים; כאן רק קריאה והצגה. טהור (בלי DOM).

// "0.350", "0,350", ".5", "1.5" -> ק"ג כמספר. null אם ריק או לא תקין
export function parseKg(text) {
    if (text == null) return null;
    const t = String(text).trim().replace(",", ".");
    if (t === "" || !/^\d*\.?\d+$|^\d+\.$/.test(t)) return null;
    const n = parseFloat(t);
    return Number.isFinite(n) ? n : null;
}

// ק"ג -> גרמים (עד 2 ספרות אחרי הנקודה בגרמים, למשל 0.0255 ק"ג = 25.5 גרם)
export function kgToGrams(kg) {
    return Math.round(kg * 1000 * 100) / 100;
}

export function textToGrams(text) {
    const kg = parseKg(text);
    return kg == null ? null : kgToGrams(kg);
}

// גרמים -> טקסט להצגה בשדה ק"ג: 350 -> "0.350", 1500 -> "1.5", 25.5 -> "0.0255", 80 -> "0.080"
export function gramsToKgText(g) {
    g = Number(g);
    if (!Number.isFinite(g) || g <= 0) return "";
    let s = (g / 1000).toFixed(4);
    s = s.replace(/0+$/, "");
    const dec = s.split(".")[1] || "";
    if (dec.length < 3) s = s.split(".")[0] + "." + dec.padEnd(3, "0");
    // מספר עגול בק"ג שלם: 1.500 -> 1.5, 2.000 -> 2
    if (/^\d+\.000$/.test(s)) s = s.split(".")[0];
    else if (/^\d+\.\d00$/.test(s) && Number(s) >= 1) s = s.replace(/0+$/, "");
    return s;
}

// שורת אישור מתחת לשדה: מה המערכת הבינה. liquid -> מ"ל/ליטר במקום גרם/ק"ג
export function describeQty(text, { liquid = false } = {}) {
    const g = textToGrams(text);
    if (g == null) return "";
    const small = liquid ? 'מ"ל' : "גרם";
    const big = liquid ? "ליטר" : 'ק"ג';
    const n = +g.toFixed(2);
    return g >= 1000 ? `= ${n} ${small} (${+(g / 1000).toFixed(3)} ${big})` : `= ${n} ${small}`;
}

// אזהרה על כמות חשודה (מחזיר טקסט או null)
export function qtyWarning(text, { liquid = false } = {}) {
    const kg = parseKg(text);
    const raw = String(text == null ? "" : text).trim();
    if (raw !== "" && kg == null) return 'לא הבנתי את המספר. כותבים למשל 0.350 (ק"ג).';
    if (kg == null) return null;
    const big = liquid ? "ליטר" : 'ק"ג';
    const small = liquid ? 'מ"ל' : "גרם";
    if (kg > 25) return `${kg} ${big}? אם התכוונת ${kg} ${small}, כתוב ${+(kg / 1000).toFixed(3)}.`;
    if (kg > 0 && kg < 0.0005) return `פחות מחצי ${small}. בטוח?`;
    return null;
}

// מוצר ספירה (יחידות בלי משקל, למשל לחמניה): מקלידים מספר יחידות רגיל. "2" = 2 יחידות. null אם ריק או לא תקין
export function textToCount(text) {
    if (text == null) return null;
    const t = String(text).trim().replace(",", ".");
    if (t === "" || !/^\d*\.?\d+$|^\d+\.$/.test(t)) return null;
    const n = parseFloat(t);
    return Number.isFinite(n) && n > 0 ? n : null;
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
