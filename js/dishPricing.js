// מחיר מומלץ למנה לפי מכפיל או יעד עלות מזון. המחיר השמור לא משתנה מעצמו - רק מוצע (בעריכת מנה ובהתראה בדף הבית).
// טהור (בלי DOM/DB), נבדק ב-tests/dish_pricing.verify.mjs

const round2 = (x) => Math.round(x * 100) / 100;

// מחיר לפני מע"מ לפי המכפיל (עדיפות) או היעד; null כשאין מכפיל/יעד תקין או עלות
export function suggestedPrice(cost, multiplier, targetPct) {
    const m = parseFloat(multiplier);
    const t = parseFloat(targetPct);
    if (!(cost > 0)) return null;
    if (m > 0) return round2(cost * m);
    if (t > 0 && t < 100) return round2(cost / (t / 100));
    return null;
}

// מנות שהמחיר השמור (לפני מע"מ) נמוך מהמומלץ ב-minPct אחוז ומעלה: [{ dish, current, suggested }]
export function underpricedDishes(dishes, minPct = 3) {
    const out = [];
    for (const d of dishes || []) {
        const suggested = suggestedPrice(Number(d.total_cost), d.multiplier, d.target_profit_pct);
        const current = Number(d.price_before_vat) || 0;
        if (suggested === null || !(current > 0)) continue;
        if (suggested >= current * (1 + minPct / 100)) out.push({ dish: d, current, suggested });
    }
    return out;
}
