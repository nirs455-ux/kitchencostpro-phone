// השוואת צריכה לסועד: הערב האחרון, ממוצע שבועי (כל הימים), ממוצע של אותו יום בשבוע. טהור (בלי DOM/DB).
// נקודה (point) = { date, guests, eatenKg, perGuestG, perCut: [{ name, kg, g }] } כמו שמחזיר pointFromSummary.
// ממוצע מחושב כסך הצריכה חלקי סך הסועדים (לא ממוצע של ממוצעים), כדי שערב קטן לא ישקול כמו ערב גדול.
import { weekdayHe } from "./serviceCalc.js";

export const SAME_DAY_COUNT = 6; // כמה ערבים של אותו יום בשבוע נכנסים לממוצע
export const MIN_SAME_DAY = 2;   // פחות מזה אין ממוצע שאפשר לסמוך עליו

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const minusDays = (isoDate, n) => { const [y, m, d] = String(isoDate).split("-").map(Number); return iso(new Date(y, m - 1, d - n)); };

const perGuest = (pts, kgOf) => {
    let kg = 0, guests = 0;
    for (const p of pts) { const k = kgOf(p); if (k == null) continue; kg += k; guests += p.guests; }
    return guests > 0 && kg > 0 ? (kg * 1000) / guests : null;
};
const delta = (now, base) => (now == null || base == null ? null : { diff: now - base, pct: base > 0 ? ((now - base) / base) * 100 : null });

// mode: "last" | "week" | "same". cur: נקודה של הערב הנוכחי. history: נקודות של שאר הערבים (כל סדר)
export function compareService(mode, cur, history) {
    const before = (history || []).filter((p) => p.date < cur.date).sort((a, b) => String(a.date).localeCompare(String(b.date)));
    let set;
    if (mode === "last") set = before.slice(-1);
    else if (mode === "week") { const from = minusDays(cur.date, 7); set = before.filter((p) => p.date >= from); }
    else { const wd = weekdayHe(cur.date); set = before.filter((p) => weekdayHe(p.date) === wd).slice(-SAME_DAY_COUNT); }
    const min = mode === "same" ? MIN_SAME_DAY : 1;
    if (set.length < min) return { mode, available: false, n: set.length, need: min };
    const total = { now: cur.perGuestG, base: perGuest(set, (p) => p.eatenKg) };
    total.d = delta(total.now, total.base);
    const cuts = cur.perCut.map((c) => {
        const base = perGuest(set.filter((p) => p.perCut.some((x) => x.name === c.name)), (p) => (p.perCut.find((x) => x.name === c.name) || {}).kg);
        return { name: c.name, now: c.g, base, d: delta(c.g, base) };
    });
    return { mode, available: true, n: set.length, total, cuts };
}

// טקסט שינוי: "עלתה ב-37 גרם, 22%" / "ירדה ב-20 גרם" / "ללא שינוי"
export function changeText(d) {
    if (!d) return "";
    const g = Math.round(d.diff);
    if (g === 0) return "ללא שינוי";
    const pct = d.pct == null ? "" : `, ${Math.round(Math.abs(d.pct))}%`;
    return `${g > 0 ? "עלתה" : "ירדה"} ב-${Math.abs(g)} גרם${pct}`;
}
