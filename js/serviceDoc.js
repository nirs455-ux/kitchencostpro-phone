// דף סרוויס: סיכום, טקסט לשליחה (וואטסאפ, מייל), מסמך להדפסה, ונקודות להיסטוריה וגרפים. טהור (בלי DOM/DB).
import { serviceRow, seatsTotal, weekdayHe, meatGuests, dietText } from "./serviceCalc.js";

export const n2 = (v) => +Number(v).toFixed(2);
export const dateDots = (iso) => String(iso || "").split("-").reverse().join(".");

// plan: תוכנית מיז אן פלאס עם svc. pantry: Map של חומרי גלם
export function serviceSummary(plan, pantry) {
    const guests = seatsTotal(plan.seat1, plan.seat2) || Math.round(parseFloat(String(plan.guests).replace(",", ".")) || 0);
    const price = parseFloat(String(plan.price || "").replace(",", ".")) || 0;
    const mg = meatGuests(guests, plan.needCounts); // הגרם לסועד לפי מי שאוכל מהנתחים
    const rows = [];
    const t = { out: 0, back: 0, thrown: 0, shrink: 0, eaten: 0 };
    let cost = 0;
    for (const r of plan.rows || []) {
        if (r.source_type !== "pantry") continue;
        const row = pantry.get(r.source_id);
        if (!row) continue;
        const cnt = row.unit_type === "unit";
        const res = serviceRow((plan.svc || {})[`pantry:${r.source_id}`], mg, cnt);
        rows.push({ id: r.source_id, name: r.name || row.name, cnt, res });
        if (!res) continue;
        if (!cnt && !res.invalid) for (const k of Object.keys(t)) t[k] += res[k];
        if (!res.invalid && Number(row.price) > 0) cost += res.eaten * Number(row.price);
    }
    const hasData = rows.some((x) => x.res);
    const perGuestG = mg > 0 && t.eaten > 0 ? (t.eaten * 1000) / mg : null;
    const costPerDiner = guests > 0 && cost > 0 ? cost / guests : null;
    const foodCostPct = price > 0 && costPerDiner ? (costPerDiner / price) * 100 : null;
    return { title: plan.name || "", date: plan.date, weekday: weekdayHe(plan.date), seat1: plan.seat1, seat2: plan.seat2, guests, diets: dietText(plan.needCounts), price, rows, totals: t, perGuestG, costPerDiner, foodCostPct, hasData };
}

export const unitOf = (x) => (x.cnt ? "יח'" : 'ק"ג');
export const amt = (v, x) => (v > 0 ? `${n2(v)} ${unitOf(x)}` : "");

// טקסט קצר לוואטסאפ ולמייל
export function serviceText(s) {
    const L = [];
    L.push(`🥩 ${s.title || "סרוויס"} · ${[s.weekday, dateDots(s.date)].filter(Boolean).join(" ")}`);
    if (s.guests) L.push(`סועדים: ${s.seat1 || 0} + ${s.seat2 || 0} = ${s.guests}${s.diets ? ` · ${s.diets}` : ""}`);
    L.push("");
    for (const x of s.rows) {
        if (!x.res) { L.push(`${x.name}: אין נתונים`); continue; }
        const r = x.res;
        const parts = [`יצא ${amt(r.out, x)}`, r.back > 0 ? `חזר ${amt(r.back, x)}` : "", r.shrink > 0 ? `פחת ${amt(r.shrink, x)}` : "", r.thrown > 0 ? `נזרק ${amt(r.thrown, x)}` : ""].filter(Boolean);
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

// נקודה אחת להיסטוריה ולהשוואות, מסיכום של ערב. null אם אין נתונים או סועדים
export function pointFromSummary(s) {
    if (!s.hasData || !s.guests) return null;
    return {
        date: s.date, title: s.title, guests: s.guests, perGuestG: s.perGuestG, eatenKg: s.totals.eaten, thrown: s.totals.thrown, costPerDiner: s.costPerDiner,
        perCut: s.rows.filter((x) => x.res && !x.cnt && x.res.perGuest != null).map((x) => ({ name: x.name, g: x.res.perGuest, kg: x.res.eaten })),
        perItem: s.rows.filter((x) => x.res && !x.res.invalid && x.id != null).map((x) => ({ id: x.id, name: x.name, cnt: x.cnt, amt: x.res.eaten })), // ק"ג, או יחידות למוצר ביחידות
    };
}

// נקודות להיסטוריה: מכל תוכנית עם נתוני סרוויס. ממויין מהישן לחדש
export function historyPoints(plans, pantry) {
    const out = [];
    for (const p of plans || []) { const pt = pointFromSummary(serviceSummary(p, pantry)); if (pt) out.push(pt); }
    return out.sort((a, b) => String(a.date).localeCompare(String(b.date)));
}
