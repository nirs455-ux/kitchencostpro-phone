// דף סרוויס: סיכום, טקסט לשליחה (וואטסאפ, מייל), מסמך להדפסה, ונקודות להיסטוריה וגרפים. טהור (בלי DOM/DB).
import { serviceRow, seatsTotal, weekdayHe } from "./serviceCalc.js";

export const n2 = (v) => +Number(v).toFixed(2);
export const dateDots = (iso) => String(iso || "").split("-").reverse().join(".");

// plan: תוכנית מיז אן פלאס עם svc. pantry: Map של חומרי גלם. plannedFn(r): טקסט "מתוכנן" לשורה (אופציונלי)
export function serviceSummary(plan, pantry, plannedFn = () => "") {
    const guests = seatsTotal(plan.seat1, plan.seat2) || Math.round(parseFloat(String(plan.guests).replace(",", ".")) || 0);
    const price = parseFloat(String(plan.price || "").replace(",", ".")) || 0;
    const rows = [];
    const t = { out: 0, back: 0, thrown: 0, shrink: 0, eaten: 0 };
    let cost = 0;
    for (const r of plan.rows || []) {
        if (r.source_type !== "pantry") continue;
        const row = pantry.get(r.source_id);
        if (!row) continue;
        const cnt = row.unit_type === "unit";
        const res = serviceRow((plan.svc || {})[`pantry:${r.source_id}`], guests, cnt);
        rows.push({ name: r.name || row.name, cnt, planned: plannedFn(r), res });
        if (!res) continue;
        if (!cnt && !res.invalid) for (const k of Object.keys(t)) t[k] += res[k];
        if (!res.invalid && Number(row.price) > 0) cost += res.eaten * Number(row.price);
    }
    const hasData = rows.some((x) => x.res);
    const perGuestG = guests > 0 && t.eaten > 0 ? (t.eaten * 1000) / guests : null;
    const costPerDiner = guests > 0 && cost > 0 ? cost / guests : null;
    const foodCostPct = price > 0 && costPerDiner ? (costPerDiner / price) * 100 : null;
    return { title: plan.name || "", date: plan.date, weekday: weekdayHe(plan.date), seat1: plan.seat1, seat2: plan.seat2, guests, price, rows, totals: t, perGuestG, costPerDiner, foodCostPct, hasData };
}

export const unitOf = (x) => (x.cnt ? "יח'" : 'ק"ג');
export const amt = (v, x) => (v > 0 ? `${n2(v)} ${unitOf(x)}` : "");

// טקסט קצר לוואטסאפ ולמייל
export function serviceText(s) {
    const L = [];
    L.push(`🥩 ${s.title || "סרוויס"} · ${[s.weekday, dateDots(s.date)].filter(Boolean).join(" ")}`);
    if (s.guests) L.push(`סועדים: ${s.seat1 || 0} + ${s.seat2 || 0} = ${s.guests}`);
    L.push("");
    for (const x of s.rows) {
        if (!x.res) { L.push(`${x.name}: אין נתונים`); continue; }
        const r = x.res;
        const parts = [`יצא ${amt(r.out, x)}`, r.back > 0 ? `חזר ${amt(r.back, x)}` : "", r.thrown > 0 ? `נזרק ${amt(r.thrown, x)}` : "", r.shrink > 0 ? `פחת ${amt(r.shrink, x)}` : ""].filter(Boolean);
        const per = r.perGuest == null ? "" : x.cnt ? ` · ${n2(r.perGuest)} יחידות לסועד` : ` · ${Math.round(r.perGuest)} גרם לסועד`;
        L.push(`${x.name}: ${parts.join(", ")} · צריכה בפועל ${amt(r.eaten, x)}${per}`);
    }
    if (s.hasData) {
        L.push("");
        L.push(`סה"כ צריכה בפועל ${n2(s.totals.eaten)} ק"ג${s.perGuestG ? ` · ${Math.round(s.perGuestG)} גרם לסועד` : ""}`);
        if (s.totals.thrown > 0) L.push(`סה"כ נזרק ${n2(s.totals.thrown)} ק"ג`);
        if (s.costPerDiner) L.push(`עלות בשר לסועד ${n2(s.costPerDiner)} ₪${s.foodCostPct ? ` · ${n2(s.foodCostPct)}% מהמחיר לסועד` : ""}`);
    }
    return L.join("\n");
}

export function serviceFileName(s) {
    const clean = String(s.title || "סרוויס").replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim() || "סרוויס";
    return `${s.date || "ללא תאריך"} ${clean}.pdf`;
}
export const serviceMonthFolder = (s) => String(s.date || "").slice(0, 7) || "ללא תאריך";

// נקודות להיסטוריה: מכל תוכנית עם נתוני סרוויס. ממויין מהישן לחדש
export function historyPoints(plans, pantry) {
    const out = [];
    for (const p of plans || []) {
        const s = serviceSummary(p, pantry);
        if (!s.hasData || !s.guests) continue;
        out.push({ date: s.date, title: s.title, guests: s.guests, perGuestG: s.perGuestG, thrown: s.totals.thrown, costPerDiner: s.costPerDiner, perCut: s.rows.filter((x) => x.res && !x.cnt && x.res.perGuest != null).map((x) => ({ name: x.name, g: x.res.perGuest })) });
    }
    return out.sort((a, b) => String(a.date).localeCompare(String(b.date)));
}
