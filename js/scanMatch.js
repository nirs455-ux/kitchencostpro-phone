// התאמת שם מוצר שנסרק לחומר גלם קיים - טהור (בלי רשת/DB), כדי שחשבונית שנסרקת שוב לא תשאל על כל שורה.

export const AUTO_ACCEPT = 0.85; // דמיון מעל זה: מתאימים אוטומטית (ומסמנים בשורה)

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

// מילה בלי סיומות ריבוי ונקבה ובלי ה' הידיעה, כדי ש"עגבניה" ו"עגבניות" ייחשבו אותה מילה
export function stemWord(w) {
    let s = w.replace(/^ה(?=.{3})/, "");
    if (s.length > 4 && /(ים|ות)$/.test(s)) s = s.slice(0, -2);
    else if (s.length > 3 && /[היתו]$/.test(s)) s = s.slice(0, -1);
    return s;
}
const stemsOf = (s) => normName(s).split(/[\s,.;:\-\/()"'%]+/).filter((w) => w && !/^\d/.test(w)).map(stemWord);
const oneLetterApart = (a, b) => {
    if (a.length !== b.length || a.length < 3) return false;
    let d = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && ++d > 1) return false;
    return d === 1;
};
// אותן מילים (בלי סדר, ריבוי ויחיד זהים)
const digitsOf = (s) => (normName(s).match(/\d+(?:[.,]\d+)?/g) || []).join("|");
export function sameWords(a, b) {
    if (digitsOf(a) !== digitsOf(b)) return false;
    const x = [...new Set(stemsOf(a))].sort().join(" "), y = [...new Set(stemsOf(b))].sort().join(" ");
    return !!x && x === y;
}
// שני שמות שמכילים מילים שנבדלות באות אחת (תפוז/תפוח) הם מוצרים שונים
export function conflicts(a, b) {
    const x = stemsOf(a), y = stemsOf(b);
    return x.some((p) => !y.includes(p) && y.some((q) => !x.includes(q) && oneLetterApart(p, q)));
}

// pantryRows: חומרי גלם (בלי תתי-מוצרים). aliases: { שם-בקבלה-באותיות-קטנות: מזהה-חומר-גלם }. aiName: השם שה-AI בחר מהמזווה.
// מחזיר { match } או null: התאמה רק כשהיא בטוחה (שם זהה, כינוי, בחירת AI, או אותן מילים). בלי הצעות ובלי ניחוש לפי אותיות.
export function matchPantryName(name, pantryRows, aliases = {}, aiName = null) {
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
    if (aliased && !conflicts(raw, aliased.name)) return { ...out, match: aliased, score: 1 };
    const ai = aiName ? byKey.get(normName(aiName)) : null;
    if (ai && !conflicts(raw, ai.name)) return { ...out, match: ai, auto: true, score: 0.9 };
    const same = pantryRows.find((r) => sameWords(raw, r.name));
    if (same) return { ...out, match: same, auto: true, score: 0.9 };
    return out;
}
