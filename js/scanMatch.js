import { ratio } from "./fuzzyMatch.js";
// התאמת שם מוצר שנסרק לחומר גלם קיים - טהור (בלי רשת/DB), כדי שחשבונית שנסרקת שוב לא תשאל על כל שורה.

export const AUTO_ACCEPT = 0.85; // דמיון מעל זה: מתאימים אוטומטית (ומסמנים בשורה)
export const ASK_MIN = 0.75; // בין ASK_MIN ל-AUTO_ACCEPT: שואלים "האם התכוונת"

// שם להשוואה: בלי סימני כיוון נסתרים, רווחים כפולים, רווחים סביב פסיק/נקודה, וגרשיים/מירכאות אחידים, באותיות קטנות
export function normName(s) {
    return String(s ?? "")
        .normalize("NFKC")
        .replace(/[​-‏‪-‮⁦-⁩﻿]/g, "")
        .replace(/[״“”„]/g, '"')
        .replace(/[׳‘’‚]/g, "'")
        .replace(/\s+/g, " ")
        .replace(/\s*([,.;:])\s*/g, "$1")
        .trim()
        .toLowerCase();
}

const digitsOf = (s) => (s.match(/\d+(?:[.,]\d+)?/g) || []).join("|");

// pantryRows: חומרי גלם (בלי תתי-מוצרים). aliases: { שם-בקבלה-באותיות-קטנות: מזהה-חומר-גלם }.
// מחזיר { match, suggested, auto, score }: match = מוצר שהותאם (מדויק/כינוי/דמיון גבוה), suggested = מוצר לשאלה, auto = true אם הותאם לפי דמיון.
export function matchPantryName(name, pantryRows, aliases = {}) {
    const out = { match: null, suggested: null, auto: false, score: 0 };
    const raw = String(name ?? "").trim();
    if (!raw) return out;
    const key = normName(raw);
    const byKey = new Map();
    for (const r of pantryRows) { const k = normName(r.name); if (!byKey.has(k)) byKey.set(k, r); }
    const exact = byKey.get(key);
    if (exact) return { ...out, match: exact, score: 1 };
    const aliasId = aliases[raw.toLowerCase()] ?? aliases[key];
    const aliased = aliasId != null ? pantryRows.find((r) => r.id === aliasId) : null;
    if (aliased) return { ...out, match: aliased, score: 1 };
    let best = null, bestScore = 0;
    for (const [k, r] of byKey) {
        const s = ratio(key, k);
        if (s > bestScore) { bestScore = s; best = r; }
    }
    if (!best || bestScore < ASK_MIN) return out;
    // מספרים שונים בשם ("חלב 3%" מול "חלב 1%", "250 גרם" מול "500 גרם") = מוצרים שונים: תמיד שואלים, לא מתאימים לבד
    const sameNumbers = digitsOf(key) === digitsOf(normName(best.name));
    if (bestScore >= AUTO_ACCEPT && sameNumbers) return { ...out, match: best, auto: true, score: bestScore };
    return { ...out, suggested: best, score: bestScore };
}
