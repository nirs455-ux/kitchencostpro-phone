// עזרים לספירת מלאי בלי הקלדה: דף ספירה להדפסה, קריאת דף בכתב יד מתמונה, והקראה בקול. טהור (בלי DOM/DB/רשת) כדי שאפשר לבדוק ב-Node.
// rows: [{ n, id, name, cat, unit, expected }] לפי סדר המסך (n = מספר שורה, מודפס בדף ומשמש להתאמה).
import { smartMatch, parseNameParts } from "./nameMatch.js";
import { getCloseMatches } from "./fuzzyMatch.js";

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ---------- דף ספירה להדפסה ----------
// cats: קבוצת קטגוריות להדפסה (ריק = הכול). מחזיר מסמך HTML מלא לכתיבה ידנית: # | מוצר | יחידה | צפוי | נספר
export function countSheetHtml(rows, { date = "", cats = null, title = "דף ספירת מלאי" } = {}) {
    const use = rows.filter((r) => !cats || !cats.size || cats.has(r.cat));
    let body = "";
    let lastCat = null;
    for (const r of use) {
        if (r.cat !== lastCat) { body += `<tr class="cat"><td colspan="5">${esc(r.cat)}</td></tr>`; lastCat = r.cat; }
        body += `<tr><td class="n">${r.n}</td><td class="nm">${esc(r.name)}</td><td>${esc(r.unit)}</td><td class="ex">${r.expected == null ? "" : esc(r.expected)}</td><td class="box"></td></tr>`;
    }
    return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
@page{size:A4;margin:10mm}
body{font-family:Arial,"Segoe UI",sans-serif;font-size:13px;color:#000;margin:0}
h1{font-size:18px;margin:0 0 4px}.sub{margin:0 0 8px;font-size:12px}
table{width:100%;border-collapse:collapse}
td,th{border:1px solid #000;padding:0 5px;height:9mm}
th{background:#eee;font-size:12px;height:7mm}
td.n{width:9mm;text-align:center;font-weight:700}
td.nm{font-weight:700}
td.ex{width:20mm;text-align:center;color:#555}
td.box{width:34mm}
tr.cat td{background:#ddd;font-weight:700;height:7mm;border-top:2px solid #000}
tr{page-break-inside:avoid}
</style></head><body>
<h1>${esc(title)}</h1><div class="sub">תאריך: ${esc(date) || "____________"} &nbsp; שם הסופר: ____________ &nbsp; כותבים את הכמות בעמודה "נספר" ביחידה שמודפסת (מספר עשרוני עם נקודה, למשל 4.5)</div>
<table><thead><tr><th>#</th><th>מוצר</th><th>יחידה</th><th>צפוי</th><th>נספר</th></tr></thead><tbody>${body}</tbody></table>
<script>window.onload=function(){setTimeout(function(){window.print()},300)}</script>
</body></html>`;
}

// ---------- קריאת דף בכתב יד (Gemini) ----------
export const COUNT_SCAN_PROMPT = `You are reading a photo of a handwritten inventory count sheet (Hebrew). The sheet is a printed table with columns: # (row number), product name, unit, expected quantity (printed), counted quantity (filled in BY HAND, last column). There may be several categories.
For EVERY row that has a handwritten number in the counted column, return it. Skip rows whose counted cell is empty. NEVER copy the printed expected quantity as the counted value. Numbers may use a decimal point or comma ("4.5" or "4,5"); "½" means .5. If a handwritten number is hard to read, still give your best reading and set "uncertain" to true.
Return ONLY valid JSON, no markdown, in exactly this shape:
{ "rows": [ { "n": number or null (the printed row number), "name": string (the printed product name), "counted": number, "uncertain": boolean } ], "notes": string or null }`;

const toNum = (x) => {
    if (x == null || x === "") return null;
    const n = typeof x === "number" ? x : parseFloat(String(x).replace(",", ".").replace(/[^\d.\-]/g, ""));
    return Number.isFinite(n) && n >= 0 ? n : null;
};

const plain = (s) => String(s || "").toLowerCase().replace(/["'`׳״]/g, "").replace(/[()\[\],;:/\\\-–־_.*+]/g, " ").replace(/\s+/g, " ").trim();
const sameName = (a, b) => { const x = plain(a), y = plain(b); return !!x && !!y && (x === y || x.includes(y) || y.includes(x) || !!smartMatch(a, [{ name: b }])); };

// התאמת שם חופשי לשורה: smartMatch ואז דמיון טקסט. מחזיר שורה או null
export function matchRow(name, rows) {
    const q = String(name || "").trim();
    if (!q || !rows.length) return null;
    const sm = smartMatch(q, rows);
    if (sm) return sm.item;
    const close = getCloseMatches(plain(q), rows.map((r) => plain(r.name)), 1, 0.7)[0];
    return close ? rows.find((r) => plain(r.name) === close) : null;
}

// answer: JSON מ-Gemini. מחזיר { matched: [{ row, qty, uncertain }], unmatched: [{ name, qty }], notes }
export function parseCountAnswer(answer, rows) {
    const list = answer && Array.isArray(answer.rows) ? answer.rows : [];
    const byN = new Map(rows.map((r) => [r.n, r]));
    const matched = new Map();
    const unmatched = [];
    for (const x of list) {
        const qty = toNum(x && x.counted);
        if (qty == null) continue;
        const n = toNum(x.n);
        const printed = String(x.name || "").trim();
        let row = null;
        let uncertain = !!x.uncertain;
        const byNum = n != null ? byN.get(n) : null;
        if (byNum && (!printed || sameName(byNum.name, printed))) row = byNum;
        else {
            row = printed ? matchRow(printed, rows) : null;
            if (!row && byNum) { row = byNum; uncertain = true; } // מספר שורה בלי שם תואם: מסמנים לבדיקה
        }
        if (!row) { unmatched.push({ name: printed || (n != null ? `שורה ${n}` : ""), qty }); continue; }
        matched.set(row.id, { row, qty, uncertain });
    }
    return { matched: [...matched.values()], unmatched, notes: String((answer && answer.notes) || "").trim() };
}

// כמות שונה מאוד מהצפוי: שווה לבדוק (טעות קריאה או הקלדה)
export function suspicious(qty, expected) {
    const e = Number(expected);
    if (!Number.isFinite(e) || e <= 0) return false;
    return qty > e * 3 || qty < e / 3;
}

// ---------- הקראה בקול ----------
const UNITS = { "אפס": 0, "אחד": 1, "אחת": 1, "שניים": 2, "שנים": 2, "שתיים": 2, "שתים": 2, "שני": 2, "שתי": 2, "שלוש": 3, "שלושה": 3, "ארבע": 4, "ארבעה": 4, "חמש": 5, "חמישה": 5, "שש": 6, "שישה": 6, "שבע": 7, "שבעה": 7, "שמונה": 8, "תשע": 9, "תשעה": 9, "עשר": 10, "עשרה": 10 };
const TENS = { "עשרים": 20, "שלושים": 30, "ארבעים": 40, "חמישים": 50, "שישים": 60, "שבעים": 70, "שמונים": 80, "תשעים": 90 };
const HUNDREDS = new Set(["מאה", "מאות"]);
const FRACS = { "חצי": 0.5, "רבע": 0.25 };
const UNIT_TAIL = new Set(["קילו", "קילוגרם", "קג", "ליטר", "ליטרים", "יחידות", "יחידה", "יח", "אריזות", "אריזה", "ארגזים", "ארגז", "קילוגרמים"]);
const GRAM_TAIL = new Set(["גרם", "גרמים"]);

// מילה במספר, עם ו' חיבור אופציונלית ("וחצי", "ועשרים"): מחזיר את המילה בלי ו' או null
function numWord(t) {
    const known = (w) => w in UNITS || w in TENS || w in FRACS || HUNDREDS.has(w) || w === "מאתיים" || w === "אלף" || w === "נקודה";
    if (known(t)) return t;
    if (t.length > 2 && t[0] === "ו" && known(t.slice(1))) return t.slice(1);
    return null;
}
const isNumTok = (t) => /^\d+(\.\d+)?$/.test(t) || numWord(t) != null;

function evalNumber(toks) {
    let total = 0, cur = 0, frac = 0, dec = null;
    for (const raw of toks) {
        if (/^\d+(\.\d+)?$/.test(raw)) {
            if (dec != null) dec += raw.replace(".", ""); else cur += parseFloat(raw);
            continue;
        }
        const w = numWord(raw);
        if (w === "נקודה") { dec = ""; continue; }
        if (w in UNITS) { if (dec != null) dec += String(UNITS[w]); else cur += UNITS[w]; }
        else if (w in TENS) cur += TENS[w];
        else if (HUNDREDS.has(w)) { total += (cur || 1) * 100; cur = 0; }
        else if (w === "מאתיים") total += 200;
        else if (w === "אלף") { total += (cur || 1) * 1000; cur = 0; }
        else if (w in FRACS) frac += FRACS[w];
    }
    return total + cur + frac + (dec ? Number("0." + dec) : 0);
}

// "עגבניות ארבע וחצי" / "שמן 3.5 ליטר" / "קמח עשרים ק"ג" -> { name, qty, row, text }. row = שורת המוצר שזוהתה (או null).
export function parseSpoken(text, rows) {
    const clean = String(text || "").replace(/(\d)[,،](\d)/g, "$1.$2").replace(/["'`׳״]/g, "").replace(/[,،;:!?]/g, " ").replace(/\.(?!\d)/g, " ").replace(/(?<!\d)\./g, " ").trim();
    const toks = clean.split(/\s+/).filter(Boolean);
    let end = toks.length;
    let grams = false;
    if (end && GRAM_TAIL.has(toks[end - 1])) { grams = true; end--; } else if (end && UNIT_TAIL.has(toks[end - 1])) end--;
    let i = end;
    while (i > 0 && isNumTok(toks[i - 1])) i--;
    if (i === end) return { name: toks.slice(0, end).join(" "), qty: null, row: null, text: clean };
    let qty = evalNumber(toks.slice(i, end));
    if (grams) qty = qty / 1000;
    const name = toks.slice(0, i).join(" ");
    return { name, qty: Math.round(qty * 1000) / 1000, row: matchRow(name, rows), text: clean, grams };
}

// מספר לקריאה בחזרה בקול: 4.5 -> "4.5" (הדפדפן יקריא)
export const spokenQty = (q) => String(+Number(q).toFixed(3));

export { parseNameParts };
