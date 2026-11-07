// גרף קווים פשוט ב-SVG (בלי ספריות). points: [{ x: תווית, y: מספר|null }]
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export function chartSvg(points, { fmt = (v) => String(Math.round(v)) } = {}) {
    const pts = (points || []).filter((p) => p.y != null && Number.isFinite(p.y));
    if (!pts.length) return "";
    const W = 320, H = 180, L = 36, R = 12, T = 18, B = 34;
    const max = Math.max(...pts.map((p) => p.y), 0) || 1;
    const top = max * 1.15;
    const xs = (i) => (pts.length === 1 ? (L + (W - R)) / 2 : L + ((W - L - R) * i) / (pts.length - 1));
    const ys = (v) => T + (H - T - B) * (1 - v / top);
    const grid = [0, 0.5, 1].map((f) => { const v = top * f; return `<line x1="${L}" x2="${W - R}" y1="${ys(v)}" y2="${ys(v)}" stroke="var(--border,#8884)" stroke-width="1"/><text x="${L - 4}" y="${ys(v) + 4}" text-anchor="end" font-size="10" fill="var(--muted,#888)">${esc(fmt(v))}</text>`; }).join("");
    const line = pts.length > 1 ? `<polyline fill="none" stroke="var(--accent,#d97706)" stroke-width="2.5" stroke-linejoin="round" points="${pts.map((p, i) => `${xs(i)},${ys(p.y)}`).join(" ")}"/>` : "";
    const dots = pts.map((p, i) => `<circle cx="${xs(i)}" cy="${ys(p.y)}" r="4" fill="var(--accent,#d97706)"/><text x="${xs(i)}" y="${ys(p.y) - 8}" text-anchor="middle" font-size="10" font-weight="700" fill="currentColor">${esc(fmt(p.y))}</text>`).join("");
    const step = Math.ceil(pts.length / 6);
    const labels = pts.map((p, i) => (i % step === 0 || i === pts.length - 1 ? `<text x="${xs(i)}" y="${H - 12}" text-anchor="middle" font-size="10" fill="var(--muted,#888)">${esc(p.x)}</text>` : "")).join("");
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:100%;direction:ltr;" role="img">${grid}${line}${dots}${labels}</svg>`;
}
