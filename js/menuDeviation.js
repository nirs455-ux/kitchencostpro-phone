// סטייה בין הגרם לסועד שבתפריט לבין מה שהיה בפועל בסרוויסים. טהור (בלי DOM/DB).
// ירוק עד 7 אחוז, כתום עד 15, אדום מעל. הממוצע הוא של עד 5 הסרוויסים האחרונים, ולפחות 2.
export const LIMITS = { ok: 7, warn: 15 };
export const RECENT = 5;
export const MIN_POINTS = 2;
export const LEVEL_COLOR = { ok: "#2e7d32", warn: "#c77700", bad: "#c62828" };

const num = (v) => { const n = parseFloat(String(v == null ? "" : v).replace(",", ".")); return Number.isFinite(n) && n > 0 ? n : 0; };

// planned: מהתפריט (טקסט). actual: בפועל (מספר). null כשחסר אחד מהם
export function deviation(planned, actual) {
    const p = num(planned), a = num(actual);
    if (!p || !a) return null;
    const pct = ((a - p) / p) * 100, abs = Math.round(Math.abs(pct) * 10) / 10;
    return { pct, level: abs <= LIMITS.ok ? "ok" : abs <= LIMITS.warn ? "warn" : "bad" };
}

// points: נקודות היסטוריה (historyPoints). ממוצע הגרם (או היחידות) לסועד של נתח, מהסרוויסים שלפני התאריך
export function recentAverage(points, id, beforeDate, n = RECENT) {
    const vals = (points || []).filter((p) => !beforeDate || p.date < beforeDate)
        .sort((a, b) => String(b.date).localeCompare(String(a.date)))
        .map((p) => (p.perItem || []).find((x) => x.id === id))
        .filter((x) => x && x.pg > 0).slice(0, n).map((x) => x.pg);
    if (vals.length < MIN_POINTS) return null;
    return { avg: vals.reduce((s, v) => s + v, 0) / vals.length, n: vals.length };
}
