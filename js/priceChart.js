// גרף קווי קטן להיסטוריית מחירים (SVG). טהור (בלי DOM/DB) כדי שאפשר לבדוק ב-Node.
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// סיכום סדרת מחירים: points = [{ date, price }] ממוינות לפי תאריך
export function summarizePrices(points) {
    const prices = points.map((p) => p.price).filter((n) => Number.isFinite(n));
    if (!prices.length) return null;
    const first = prices[0], last = prices[prices.length - 1];
    return {
        count: prices.length, first, last,
        min: Math.min(...prices), max: Math.max(...prices),
        avg: prices.reduce((n, x) => n + x, 0) / prices.length,
        changePct: first > 0 ? ((last - first) / first) * 100 : null,
    };
}

// מחזיר מחרוזת SVG. נקודה אחת = עיגול בלבד. צבעים מתוך משתני העיצוב של האפליקציה.
export function buildPriceChartSvg(points, { width = 320, height = 150, currency = "₪" } = {}) {
    const pts = points.filter((p) => Number.isFinite(p.price));
    if (!pts.length) return "";
    const padL = 44, padR = 12, padT = 14, padB = 24;
    const w = width - padL - padR, h = height - padT - padB;
    let min = Math.min(...pts.map((p) => p.price)), max = Math.max(...pts.map((p) => p.price));
    if (max === min) { min = min * 0.9; max = max * 1.1 || 1; }
    const span = max - min;
    const x = (i) => padL + (pts.length === 1 ? w / 2 : (i / (pts.length - 1)) * w);
    const y = (v) => padT + h - ((v - min) / span) * h;
    const fmt = (v) => `${currency}${v >= 100 ? v.toFixed(0) : v.toFixed(2)}`;
    const line = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.price).toFixed(1)}`).join(" ");
    const dots = pts.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.price).toFixed(1)}" r="3.5" fill="var(--brand)"><title>${esc(p.date)}: ${esc(fmt(p.price))}</title></circle>`).join("");
    const ticks = [max, (max + min) / 2, min].map((v) => `<line x1="${padL}" x2="${width - padR}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="var(--border)" stroke-dasharray="3 3"/><text x="${padL - 6}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="var(--text-2)">${esc(fmt(v))}</text>`).join("");
    const shortDate = (d) => { const [yy, m, dd] = String(d || "").split("-"); return dd ? `${parseInt(dd, 10)}.${parseInt(m, 10)}` : String(d || ""); };
    const xl = pts.length > 1
        ? `<text x="${padL}" y="${height - 6}" font-size="10" fill="var(--text-2)">${esc(shortDate(pts[0].date))}</text><text x="${width - padR}" y="${height - 6}" text-anchor="end" font-size="10" fill="var(--text-2)">${esc(shortDate(pts[pts.length - 1].date))}</text>`
        : `<text x="${width / 2}" y="${height - 6}" text-anchor="middle" font-size="10" fill="var(--text-2)">${esc(shortDate(pts[0].date))}</text>`;
    return `<svg viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="גרף מחירים" style="direction:ltr;display:block;">${ticks}${pts.length > 1 ? `<path d="${line}" fill="none" stroke="var(--brand)" stroke-width="2"/>` : ""}${dots}${xl}</svg>`;
}
