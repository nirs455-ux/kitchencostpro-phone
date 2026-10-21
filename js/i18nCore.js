// ליבת התרגום של הממשק (טהורה, בלי DOM): מקבלת מילון {קטע בעברית: תרגום} ומחזירה פונקציה שמתרגמת מחרוזת.
// הקטעים נשלפו מהקוד כך שאותה הקלדה בדיוק מופיעה בממשק. כשמספרים או שמות משולבים באמצע משפט, מחפשים בכל מקום
// את הקטע הארוך ביותר שמתחיל במילה, ומחליפים רק אותו. טקסט משתמש (שמות מוצרים וכו') שאינו במילון נשאר כמו שהוא.

const HEB = "\\u0590-\\u05FF";
const WORD_RE = new RegExp(`[${HEB}]+(?:["'\\u05F3\\u05F4][${HEB}]+)*['\\u05F3]?`, "g");
const HEB_CHAR = new RegExp(`[${HEB}]`);
const HEB_LETTERS = new RegExp(`[${HEB}]`, "g");

const letters = (s) => (s.match(HEB_LETTERS) || []).length;

export function makeTranslator(dict) {
    const exact = new Map(); // קטע שלם (כולל קצרים מאוד) -> תרגום
    const byFirst = new Map(); // המילה הראשונה -> רשימת קטעים (מהארוך לקצר)
    for (const [he, tr] of Object.entries(dict)) {
        exact.set(he, tr);
        if (letters(he) < 3 && !/["'׳״]/.test(he)) continue; // קטעים של 1-2 אותיות מתורגמים רק כשכל הטקסט הוא הם (כדי לא לפגוע במילים אחרות)
        const first = (he.match(WORD_RE) || [""])[0];
        if (!first) continue;
        if (!byFirst.has(first)) byFirst.set(first, []);
        byFirst.get(first).push(he);
    }
    for (const list of byFirst.values()) list.sort((a, b) => b.length - a.length);

    function translate(text) {
        if (!text || !HEB_CHAR.test(text)) return text;
        const trimmed = text.trim();
        if (exact.has(trimmed)) { const i = text.indexOf(trimmed); return text.slice(0, i) + exact.get(trimmed) + text.slice(i + trimmed.length); }
        let out = "";
        let last = 0;
        WORD_RE.lastIndex = 0;
        let m;
        while ((m = WORD_RE.exec(text))) {
            const cands = byFirst.get(m[0]);
            if (!cands) continue;
            for (const c of cands) {
                if (!text.startsWith(c, m.index)) continue;
                const after = text[m.index + c.length];
                if (after && HEB_CHAR.test(after)) continue; // הקטע נקטע באמצע מילה
                out += text.slice(last, m.index) + dict[c];
                last = m.index + c.length;
                WORD_RE.lastIndex = last;
                break;
            }
        }
        return out + text.slice(last);
    }
    return translate;
}
