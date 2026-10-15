// מתכון באחוזים ("אחוזי אופים"): הרכיבים המרכזיים (הבסיס) = 100%, וכל רכיב אחר באחוז מהם.
// הבסיס הוא לא תמיד הרכיב הגדול ביותר - לכן יש הצעה לפי היגיון (שם המתכון, קמח במאפים, סדר הכתיבה), אפשר לבקש מבינה מלאכותית,
// והמשתמש תמיד יכול לבחור ידנית. טהור (בלי DOM/DB/רשת) כדי שאפשר לבדוק ב-Node.

const norm = (s) => String(s || "").trim().toLowerCase().replace(/[״"']/g, "");
const FLOUR_WORDS = ["קמח", "סולת", "סמולינה"];
const isFlour = (name) => FLOUR_WORDS.some((w) => norm(name).includes(w));

// items: [{ id, name, quantity_g }] לפי סדר הכתיבה במתכון
// מחזיר { ids: [...], reason }
export function suggestBaseHeuristic(recipeName, items) {
    const list = (items || []).filter((i) => Number(i.quantity_g) > 0);
    if (!list.length) return { ids: [], reason: "אין רכיבים עם כמות" };
    const rn = norm(recipeName);

    // 1. רכיב ששמו מופיע בשם המתכון (רוטב עגבניות -> עגבניות). אם כמה - ממשיכים לכולם, כי אולי הם יחד הבסיס.
    const inName = list.filter((i) => {
        const n = norm(i.name);
        return n.length >= 3 && rn.includes(n);
    });
    if (inName.length) {
        // אם יש קמח בין התוצאות, או שהמתכון מכיל קמח משמעותי ושמו מרמז על מאפה - מעדיפים קמחים
        return { ids: inName.map((i) => i.id), reason: `שם המתכון מכיל: ${inName.map((i) => i.name).join(", ")}` };
    }

    // 2. מאפים: אם הקמחים יחד הם חלק משמעותי מהמשקל - הקמחים הם הבסיס (כל הקמחים יחד = 100%)
    const total = list.reduce((n, i) => n + Number(i.quantity_g), 0);
    const flours = list.filter((i) => isFlour(i.name));
    const flourSum = flours.reduce((n, i) => n + Number(i.quantity_g), 0);
    if (flours.length && flourSum / total >= 0.2) {
        return { ids: flours.map((i) => i.id), reason: `מאפה: ${flours.map((i) => i.name).join(" + ")} הם הבסיס (כל הקמחים יחד = 100%)` };
    }

    // 3. אחרת: הרכיב הראשון שנכתב (לרוב זה הרכיב המרכזי)
    return { ids: [list[0].id], reason: `הרכיב הראשון במתכון: ${list[0].name}` };
}

// אחוזים: base = סכום הגרמים של רכיבי הבסיס. מחזיר שורות + סך אחוזים
export function computePercentages(items, baseIds) {
    const baseSet = new Set(baseIds || []);
    const list = (items || []).filter((i) => Number(i.quantity_g) > 0);
    const baseGrams = list.filter((i) => baseSet.has(i.id)).reduce((n, i) => n + Number(i.quantity_g), 0);
    if (!(baseGrams > 0)) return { baseGrams: 0, rows: [], totalPct: 0 };
    const rows = list.map((i) => ({ id: i.id, name: i.name, grams: Number(i.quantity_g), pct: (Number(i.quantity_g) / baseGrams) * 100, isBase: baseSet.has(i.id) }));
    return { baseGrams: Math.round(baseGrams * 100) / 100, rows, totalPct: rows.reduce((n, r) => n + r.pct, 0) };
}

// מקדם את כל המתכון כך שהבסיס יהיה newBaseGrams (שומר על האחוזים)
export function scaleToBase(items, baseIds, newBaseGrams) {
    const { baseGrams, rows } = computePercentages(items, baseIds);
    if (!(baseGrams > 0) || !(newBaseGrams > 0)) return [];
    const factor = newBaseGrams / baseGrams;
    return rows.map((r) => ({ ...r, scaledGrams: Math.round(r.grams * factor * 10) / 10 }));
}

export const fmtPct = (p) => (p >= 10 ? Math.round(p * 10) / 10 : Math.round(p * 100) / 100);

// פרומפט לבינה מלאכותית: בחירת הבסיס לפי הגיון של אופים/טבח. התשובה נבדקת (שמות חייבים להיות מהרשימה).
export function buildBasePrompt(recipeName, items) {
    return [
        "אתה טכנולוג מזון ואופה מנוסה. עליך לבחור את הרכיב המרכזי (הבסיס) של מתכון, לצורך חישוב אחוזי אופים: הבסיס = 100%.",
        "כללים: הבסיס הוא לא בהכרח הרכיב בכמות הגדולה ביותר. הוא הרכיב שמגדיר את המוצר ומשמש כנקודת ייחוס. לרוב הוא מופיע ראשון.",
        "במאפים ובצקים הבסיס הוא הקמח (אם יש כמה סוגי קמח - כולם יחד). ברוטב עגבניות - עגבניות. בממרח חצילים - חצילים. בריבה - הפרי.",
        "החזר אך ורק JSON בפורמט: {\"base\": [\"שם רכיב מהרשימה\"], \"reason\": \"משפט קצר בעברית למה\"} - בלי טקסט נוסף. השמות חייבים להיות בדיוק כפי שברשימה.",
        `שם המתכון: ${recipeName}`,
        "הרכיבים (לפי סדר הכתיבה, עם גרמים):",
        ...items.map((i, k) => `${k + 1}. ${i.name} - ${i.quantity_g} גרם`),
    ].join("\n");
}

// מאמת תשובת בינה מלאכותית מול הרשימה האמיתית. מחזיר { ids, reason } או null אם לא תקינה
export function parseBaseAnswer(parsed, items) {
    if (!parsed || !Array.isArray(parsed.base)) return null;
    const byName = new Map((items || []).map((i) => [norm(i.name), i]));
    const ids = [];
    for (const n of parsed.base) {
        const hit = byName.get(norm(n));
        if (hit && !ids.includes(hit.id)) ids.push(hit.id);
    }
    if (!ids.length) return null;
    return { ids, reason: String(parsed.reason || "").trim() || "הוצע על ידי בינה מלאכותית" };
}
