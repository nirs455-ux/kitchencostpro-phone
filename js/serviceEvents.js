// סרוויס -> אירועי צריכה למלאי התיאורטי ולדוח הסטיות. טהור (בלי DOM/DB).
// צריכה מהמלאי = יצא פחות חזר. מתוכה, נזרק ופחת הם kind "waste", והשאר kind "sale" מסוג "service".
// סה"כ זהה לצריכה מהמלאי, ולכן המלאי התיאורטי נכון בכל מקרה. ההפרדה משפיעה רק על התצוגה.
// הכמויות ביחידות קנייה של המוצר הראשי: ק"ג, ליטר או יחידות, כמו שהוזנו בדף הסרוויס.
const toNum = (v) => { const n = parseFloat(String(v == null ? "" : v).trim().replace(",", ".")); return Number.isFinite(n) && n > 0 ? n : 0; };

// log: { id, date, rows: [{ id, name, out, back, thrown, shrink }] }. pantry: Map של חומרי גלם
export function serviceEvents(logs, pantry) {
    const events = [];
    for (const log of logs || []) {
        for (const r of log.rows || []) {
            const p = pantry.get(Number(r.id));
            if (!p || p.parent_id) continue; // מוצר שנמחק או תוצר מפורק: אין למה לשייך
            const net = toNum(r.out) - toNum(r.back);
            if (!(net > 0)) continue;
            const waste = Math.min(net, toNum(r.thrown) + toNum(r.shrink));
            const sale = net - waste;
            const line = { service_log: log.id, product: p.id };
            if (sale > 1e-9) events.push({ date: log.date, kind: "sale", type: "service", pantry: { [p.id]: sale }, recipes: {}, line });
            if (waste > 1e-9) events.push({ date: log.date, kind: "waste", type: "service_waste", pantry: { [p.id]: waste }, recipes: {}, line });
        }
    }
    return events;
}

// נתוני סרוויס מתוך תוכנית מיז אן פלאס -> רשומת סרוויס לשמירה. null אם אין נתונים
export function logFromPlan(plan) {
    const svc = plan.svc || {};
    const rows = [];
    for (const [key, v] of Object.entries(svc)) {
        const m = /^pantry:(\d+)$/.exec(key);
        if (!m) continue;
        const pr = (plan.rows || []).find((r) => r.source_type === "pantry" && String(r.source_id) === m[1]);
        if (!pr) continue; // נתונים של פריט שכבר לא בתפריט לא נספרים, כמו בדף הסרוויס
        rows.push({ id: Number(m[1]), name: pr.name, out: v.out || "", back: v.back || "", thrown: v.thrown || "", shrink: v.shrink || "" });
    }
    if (!rows.length) return null;
    return { id: plan.id, date: plan.date, title: plan.name || "", seat1: plan.seat1 || "", seat2: plan.seat2 || "", guests: plan.guests || "", needCounts: { vegetarian: String((plan.needCounts || {}).vegetarian || ""), vegan: String((plan.needCounts || {}).vegan || "") }, price: plan.price || "", rows, updated: Date.now() };
}

// רשומת סרוויס -> אובייקט כמו תוכנית, כדי שסיכומים והיסטוריה (serviceSummary, historyPoints) יעבדו עליו בלי שינוי
export function logAsPlan(log) {
    return {
        id: log.id, name: log.title, date: log.date, seat1: log.seat1, seat2: log.seat2, guests: log.guests, needCounts: log.needCounts || {}, price: log.price, margin: "10",
        rows: log.rows.map((r) => ({ source_type: "pantry", source_id: r.id, name: r.name, per: "", share: "" })),
        svc: Object.fromEntries(log.rows.map((r) => [`pantry:${r.id}`, { out: r.out, back: r.back, thrown: r.thrown, shrink: r.shrink }])),
    };
}
