// התאמת שם מרכיב משורת מתכון למוצר במזווה: מבינה שמספר ויחידת מידה אינם חלק מהשם ("עגבניות 200" = עגבניות, כמות 200),
// ש-"חומץ 5%" הוא חומץ עם ריכוז, ושרבים/יחיד ("עגבניות" / "עגבנייה") אותו מוצר. טהור (בלי DOM), נבדק ב-tests/name_match.verify.mjs

// גודל ("עגבניות בינוניות"): לא חלק מהשם, אבל קובע הערכת משקל. s קטנה, m בינונית, l גדולה
const SIZE_WORDS = { "קטן": "s", "קטנה": "s", "קטנים": "s", "קטנות": "s", "בינוני": "m", "בינונית": "m", "בינוניים": "m", "בינוניות": "m", "גדול": "l", "גדולה": "l", "גדולים": "l", "גדולות": "l" };
export function sizeInName(raw) {
    for (const t of String(raw || "").split(/\s+/)) if (SIZE_WORDS[t]) return SIZE_WORDS[t];
    return "m";
}

const UNIT_WORDS = new Set(["גרם", "גר", "קג", "קילו", "קילוגרם", "מל", "ליטר", "ל", "כף", "כפות", "כפית", "כפיות", "כוס", "כוסות", "יחידות", "יחידה", "יח"]);

// מפרק שם לחלקים: מילים (בלי מספרים ויחידות), אחוז (ריכוז) אם יש, ומספר ראשון שנשאר (כמות שנכתבה בתוך השם)
export function parseNameParts(raw) {
    let s = String(raw || "").toLowerCase();
    let pct = null;
    s = s.replace(/(\d+(?:[.,]\d+)?)\s*%/g, (m, n) => { if (pct == null) pct = parseFloat(n.replace(",", ".")); return " "; });
    s = s.replace(/%/g, " ");
    let num = null;
    s = s.replace(/\d+(?:[.,]\d+)?/g, (m) => { if (num == null) num = parseFloat(m.replace(",", ".")); return " "; });
    s = s.replace(/["'`׳״]/g, "").replace(/[()\[\],;:/\\\-–־_.*+]/g, " ");
    const tokens = s.split(/\s+/).filter((t) => t && !UNIT_WORDS.has(t) && !SIZE_WORDS[t]);
    return { tokens, pct, num };
}

// שם נקי להצגה וליצירת מוצר חדש: בלי כמות ויחידה, עם הריכוז אם יש
export function cleanName(raw) {
    const { tokens, pct } = parseNameParts(raw);
    if (!tokens.length) return String(raw || "").trim();
    return tokens.join(" ") + (pct != null ? ` ${pct}%` : "");
}

const commonPrefix = (a, b) => { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return i; };

// שתי מילים נחשבות אותה מילה: זהות, אחת תחילית של השנייה, או שורש משותף (עגבניות / עגבנייה)
export function tokenMatch(a, b) {
    if (a === b) return true;
    const min = Math.min(a.length, b.length);
    if (min < 3) return false;
    if (a.startsWith(b) || b.startsWith(a)) return true;
    const cp = commonPrefix(a, b);
    return cp >= 4 && cp >= min - 2;
}

// מחזיר { item, score, exact } למוצר הקרוב ביותר, או null. כל מילות המרכיב חייבות להופיע בשם המוצר.
export function smartMatch(name, items) {
    const q = parseNameParts(name);
    if (!q.tokens.length) return null;
    let best = null;
    for (const it of items) {
        const p = parseNameParts(it.name);
        if (!p.tokens.length) continue;
        if (!q.tokens.every((t) => p.tokens.some((u) => tokenMatch(t, u)))) continue;
        const mp = p.tokens.filter((u) => q.tokens.some((t) => tokenMatch(t, u))).length;
        let score = mp / p.tokens.length;
        if (q.pct != null && p.pct != null) score += q.pct === p.pct ? 0.5 : -0.3;
        else if (q.pct == null && p.pct == null) score += 0.05;
        if (!best || score > best.score) best = { item: it, score, exact: p.tokens.length === q.tokens.length && (q.pct ?? null) === (p.pct ?? null) };
    }
    return best;
}

const UNIT_MAP = { "גרם": "g", "גר": "g", "קג": "kg", "קילו": "kg", "קילוגרם": "kg", "מל": "ml", "ליטר": "l", "ל": "l", "כף": "tbsp", "כפות": "tbsp", "כפית": "tsp", "כפיות": "tsp", "כוס": "cup", "כוסות": "cup", "יחידות": "unit", "יחידה": "unit", "יח": "unit" };

// כמות שנכתבה בתוך השם ("עגבניות 200", "שמן 1 ליטר"): { qty, unit } או null. בלי יחידה = גרם. אחוזים ("5%") אינם כמות. "00" (סוג קמח) אינו כמות.
export function quantityInName(raw) {
    const s = String(raw || "").toLowerCase().replace(/["'`׳״]/g, "");
    const re = /(\d+(?:[.,]\d+)?)(\s*%)?/g;
    let m;
    while ((m = re.exec(s))) {
        if (m[2]) continue;
        const qty = parseFloat(m[1].replace(",", "."));
        if (!(qty > 0) || /^0\d/.test(m[1])) continue;
        const next = (s.slice(m.index + m[0].length).match(/^\s*([֐-׿]+)/) || [])[1];
        return { qty, unit: next && UNIT_MAP[next] ? UNIT_MAP[next] : "g" };
    }
    return null;
}

// האם כל מילות החיפוש נמצאות בשם (מתעלם ממספרים, אחוזים ויחידות, וסובל רבים/יחיד): "חומץ 5%" מוצא "חומץ", "עגבניות" מוצא "עגבנייה"
export function nameCovers(query, name) {
    const q = parseNameParts(query).tokens;
    if (!q.length) return false;
    const p = parseNameParts(name).tokens;
    return q.every((t) => p.some((u) => tokenMatch(t, u)));
}
