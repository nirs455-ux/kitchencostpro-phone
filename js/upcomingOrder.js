// הזמנה לימים הקרובים: כמה להזמין מכל נתח לטווח ימים, לכל ספק טווח משלו. טהור (בלי DOM/DB).
// הכמות לכל יום מגיעה מהתחזית (סועדים x גרם לסועד x מרווח). סוכמים ימים בלי עיגול, מפחיתים מלאי, ומעגלים כלפי מעלה לאריזות שלמות.
import { groupBySupplier } from "./prepPlan.js";

export const RANGE_OPTIONS = [[1, "יום"], [3, "3 ימים"], [7, "שבוע"], [14, "שבועיים"], [30, "חודש"]];
const round3 = (n) => Math.round(n * 1000) / 1000;
const ceilTo = (n, step) => Math.ceil(Math.round((n / step) * 1e6) / 1e6) * step;

// סה"כ ליחידות קנייה (ק"ג או יחידות) לכל נתח, לימים 0..count-1 של התחזית. מפחית מלאי (stock: Map מזהה -> כמות, אף פעם לא שלילי)
export function unitsFor(model, count, ids, stock = new Map()) {
    const out = {};
    const days = model.days.slice(0, count);
    for (const d of days) {
        for (const l of d.lines) {
            if (ids && !ids.has(l.id)) continue;
            if (!(l.raw > 0)) continue;
            out[l.id] = (out[l.id] || 0) + (l.cnt ? l.raw : l.raw / 1000);
        }
    }
    for (const id of Object.keys(out)) {
        const units = out[id] - (stock.get(Number(id)) || 0);
        const cnt = model.days[0].lines.find((l) => String(l.id) === id).cnt;
        out[id] = units > 0 ? (cnt ? Math.ceil(round3(units)) : ceilTo(round3(units), 0.01)) : 0;
        if (!(out[id] > 0)) delete out[id];
    }
    return out;
}

// model: תחזית (buildForecast) שמתחילה בתאריך הראשון של ההזמנה. defaultCount: כמה ימים. counts: { מפתח ספק: ימים } לספק עם טווח משלו ("none" = בלי ספק)
export function orderGroups({ model, defaultCount, counts = {}, pantry, suppliers, stock }) {
    const first = groupBySupplier(unitsFor(model, defaultCount, null, stock), pantry, suppliers);
    return first.map((g) => {
        const key = g.supplier ? String(g.supplier.id) : "none";
        const count = counts[key] || defaultCount;
        const ids = new Set(g.lines.map((l) => l.id));
        const again = groupBySupplier(unitsFor(model, count, ids, stock), pantry, suppliers);
        const lines = again.flatMap((x) => x.lines);
        return { key, supplier: g.supplier, count, lines, from: model.days[0].date, to: model.days[count - 1].date };
    }).filter((g) => g.lines.length);
}

// טווח שהוזמן כבר: נשמר בהערה של ההזמנה בהיסטוריית הספק, כ"טווח YYYY-MM-DD עד YYYY-MM-DD"
export const rangeNote = (from, to) => `טווח ${from} עד ${to}`;
export function overlappingOrders(history, from, to) {
    const out = [];
    for (const h of history || []) {
        const m = /טווח (\d{4}-\d{2}-\d{2}) עד (\d{4}-\d{2}-\d{2})/.exec(h.note || "");
        if (m && m[1] <= to && from <= m[2]) out.push({ date: h.date, from: m[1], to: m[2] });
    }
    return out;
}

// טקסט כמות בשורת הזמנה: אריזות שלמות כשיש, אחרת ק"ג או יחידות
export function lineText(l) {
    const n = +Number(l.units).toFixed(2);
    if (l.pack) return `${l.pack.count} אריזות · ${n} ${l.unit}`;
    return `${n} ${l.unit}`;
}
