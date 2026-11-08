// דף סרוויס: חישוב צריכה בפועל לנתח. טהור (בלי DOM/DB).
// צריכה בפועל = יצא לסרוויס פחות חזר מסרוויס פחות נזרק פחות פחת. גרם (או יחידות) לסועד = צריכה בפועל חלקי סועדים.
const toNum = (v) => {
    const s = String(v == null ? "" : v).trim().replace(",", ".");
    const n = parseFloat(s);
    return Number.isFinite(n) && n >= 0 ? n : 0;
};
const has = (v) => String(v == null ? "" : v).trim() !== "";

// קלט: { out, back, thrown, shrink } כמחרוזות (ק"ג, או יחידות). מחזיר null כשלא הוזן "יצא"
export function serviceRow(r, guests, isCount = false) {
    if (!r || !has(r.out)) return null;
    const out = toNum(r.out), back = toNum(r.back), thrown = toNum(r.thrown), shrink = toNum(r.shrink);
    const eaten = Math.round((out - back - thrown - shrink) * 1e6) / 1e6;
    const g = toNum(guests);
    const perGuest = g > 0 && eaten >= 0 ? (isCount ? eaten / g : (eaten * 1000) / g) : null;
    // מוצר ביחידות שנשקל גם: משקל כולל שיצא פחות משקל שחזר (ק"ג), גרם לסועד וגרם ליחידה
    let weight = null;
    if (isCount && has(r.wout)) {
        const kg = Math.round((toNum(r.wout) - toNum(r.wback)) * 1e6) / 1e6;
        if (kg >= 0) weight = { kg, perGuestG: g > 0 ? (kg * 1000) / g : null, perUnitG: eaten > 0 ? (kg * 1000) / eaten : null };
    }
    return { out, back, thrown, shrink, eaten, perGuest, invalid: eaten < 0, weight };
}

// צמחוני וטבעוני אינם אוכלים מהנתחים: מורידים אותם מחישוב הגרם לסועד. כשר לא מורד
const dietCount = (needCounts, key) => Math.round(toNum((needCounts || {})[key]));
export function meatGuests(total, needCounts) {
    const t = toNum(total);
    if (!(t > 0)) return 0;
    return Math.max(0, t - dietCount(needCounts, "vegetarian") - dietCount(needCounts, "vegan"));
}
export function dietText(needCounts) {
    const v = dietCount(needCounts, "vegetarian"), g = dietCount(needCounts, "vegan");
    return [v > 0 ? `צמחוני ${v}` : "", g > 0 ? `טבעוני ${g}` : ""].filter(Boolean).join(" · ");
}

export const seatsTotal = (s1, s2) => Math.round(toNum(s1) + toNum(s2));

// יום בשבוע בעברית מתאריך yyyy-mm-dd
export function weekdayHe(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
    if (!m) return "";
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return ["יום ראשון", "יום שני", "יום שלישי", "יום רביעי", "יום חמישי", "יום שישי", "שבת"][d.getDay()];
}
