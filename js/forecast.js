// תחזית סועדים והכנות לכמה ימים קדימה. טהור (בלי DOM/DB).
// כמות להכנה ליום = סועדים x גרם לסועד (ידני, או נלמד מהסרוויסים הקודמים) x (1 + מרווח ביטחון).
import { weekdayHe } from "./serviceCalc.js";

export const SAME_DAY_COUNT = 6; // כמה ערבים של אותו יום בשבוע נכנסים להצעת הסועדים
export const LEARN_COUNT = 8;    // כמה סרוויסים אחרונים נכנסים ללמידת גרם לסועד

const pad = (n) => String(n).padStart(2, "0");
export const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const addDays = (iso, n) => { const [y, m, d] = String(iso).split("-").map(Number); return isoOf(new Date(y, m - 1, d + n)); };

export function parseNum(v) {
    const n = parseFloat(String(v == null ? "" : v).trim().replace(",", "."));
    return Number.isFinite(n) && n >= 0 ? n : 0;
}

const byDate = (a, b) => String(a.date).localeCompare(String(b.date));

// הצעת סועדים לתאריך: ממוצע של אותו יום בשבוע בערבים קודמים. null אם אין
export function suggestedDiners(points, iso) {
    const wd = weekdayHe(iso);
    const same = [...(points || [])].sort(byDate).filter((p) => p.date < iso && weekdayHe(p.date) === wd).slice(-SAME_DAY_COUNT);
    if (!same.length) return null;
    return Math.round(same.reduce((s, p) => s + p.guests, 0) / same.length);
}

// גרם (או יחידות) לסועד לפי הסרוויסים האחרונים: סך הצריכה חלקי סך הסועדים. null אם אין נתונים
export function learnedPerDiner(points, id) {
    const pts = [...(points || [])].sort(byDate).filter((p) => (p.perItem || []).some((x) => x.id === id)).slice(-LEARN_COUNT);
    let amt = 0, guests = 0, cnt = false;
    for (const p of pts) { const it = p.perItem.find((x) => x.id === id); amt += it.amt; guests += p.guests; cnt = !!it.cnt; }
    if (!(guests > 0 && amt > 0)) return null;
    return { per: cnt ? amt / guests : (amt * 1000) / guests, cnt, n: pts.length };
}

// items: [{ id, name, per (טקסט ידני, ריק = לפי הלמידה), cnt (אם ידוע מהמוצר) }]
export function dayLines(diners, items, points, marginPct) {
    const f = 1 + Math.max(0, parseNum(marginPct)) / 100;
    return items.map((it) => {
        const manual = parseNum(it.per);
        const learned = learnedPerDiner(points, it.id);
        const per = manual > 0 ? manual : learned ? learned.per : 0;
        const cnt = !!(it.cnt || (learned && learned.cnt));
        const raw = diners > 0 && per > 0 ? diners * per * f : 0;
        const qty = raw > 0 ? (cnt ? Math.ceil(Math.round(raw * 1e6) / 1e6) : Math.ceil(Math.round((raw / 100) * 1e6) / 1e6) * 100) : 0; // יחידות שלמות, או גרמים מעוגלים ל-100 למעלה
        return { id: it.id, name: it.name, cnt, per, source: manual > 0 ? "manual" : learned ? "learned" : null, qty };
    });
}

// startIso: היום הראשון. days: כמה ימים. extraDays: ימים נוספים רק לחישוב הפשרה (לא נכנסים לסה"כ). entered: { תאריך: טקסט סועדים }
export function buildForecast({ startIso, days, extraDays = 0, entered, points, items, marginPct }) {
    const out = [];
    const totals = new Map();
    for (let i = 0; i < days + extraDays; i++) {
        const date = addDays(startIso, i);
        const has = entered && Object.prototype.hasOwnProperty.call(entered, date) && String(entered[date]).trim() !== "";
        const suggested = suggestedDiners(points, date);
        const diners = has ? parseNum(entered[date]) : suggested || 0;
        const lines = dayLines(diners, items, points, marginPct);
        if (i < days) for (const l of lines) { const t = totals.get(l.id) || { id: l.id, name: l.name, cnt: l.cnt, qty: 0 }; t.qty += l.qty; totals.set(l.id, t); }
        out.push({ date, weekday: weekdayHe(date), entered: has, suggested, diners, lines, extra: i >= days });
    }
    return { days: out, totals: [...totals.values()] };
}

// ימי הפשרה לנתח (מספר שלם, 0 = בלי הפשרה). thaw: { מזהה: טקסט }
export const thawDaysOf = (thaw, id) => Math.min(14, Math.floor(parseNum(thaw && thaw[id])));

// מה להוציא מהמקפיא ביום i: לכל נתח עם זמן הפשרה, הכמות שצריך ביום i + ימי ההפשרה
export function thawFor(model, index, thaw) {
    const out = [];
    for (const l of model.days[index].lines) {
        const t = thawDaysOf(thaw, l.id);
        if (!(t > 0)) continue;
        const target = model.days[index + t];
        if (!target) continue;
        const tl = target.lines.find((x) => x.id === l.id);
        if (tl && tl.qty > 0) out.push({ id: l.id, name: l.name, cnt: tl.cnt, qty: tl.qty, forDate: target.date, forWeekday: target.weekday });
    }
    return out;
}
