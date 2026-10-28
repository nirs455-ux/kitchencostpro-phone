// מדבקה כתמונה (שחור על לבן) להדפסה במדפסת מדבקות כמו Niimbot: מציירים על canvas בגודל המדבקה ומייבאים את התמונה באפליקציית המדפסת.
// גדלים במ"מ. הרזולוציה: 12 פיקסלים למ"מ (כ-300dpi), האפליקציה של המדפסת מקטינה לפי הצורך.
export const LABEL_SIZES = {
    "31x31": { w: 31, h: 31, label: "31×31 מ\"מ" },
    "50x30": { w: 50, h: 30, label: "50×30 מ\"מ" },
    "70x40": { w: 70, h: 40, label: "70×40 מ\"מ" },
};
const PX_PER_MM = 12;

export const shortDateText = (d) => `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getFullYear()).slice(2)}`;

// עוטף טקסט לשורות לפי רוחב (בפיקסלים) עם הפונט הנוכחי של ה-context
function wrap(ctx, text, maxW) {
    const words = String(text).split(/\s+/).filter(Boolean);
    const lines = [];
    let cur = "";
    for (const w of words) {
        const t = cur ? `${cur} ${w}` : w;
        if (cur && ctx.measureText(t).width > maxW) { lines.push(cur); cur = w; } else cur = t;
    }
    if (cur) lines.push(cur);
    return lines;
}

// blocks: [{ text, base (גודל פונט יחסי לצלע הקצרה), bold, maxLines }]. מקטינים את כל הגדלים עד שהכול נכנס.
export function layoutLabel(ctx, W, H, blocks) {
    const m = Math.round(1.4 * PX_PER_MM);
    const innerW = W - 2 * m;
    const innerH = H - 2 * m;
    const short = Math.min(W, H);
    for (let s = 1; s >= 0.3; s -= 0.04) {
        const out = [];
        let total = 0;
        let ok = true;
        for (const b of blocks) {
            const size = Math.max(10, Math.round(b.base * short * s));
            ctx.font = `${b.bold ? "700 " : "400 "}${size}px Arial, "Segoe UI", sans-serif`;
            const lines = wrap(ctx, b.text, innerW);
            if (lines.some((l) => ctx.measureText(l).width > innerW) || lines.length > (b.maxLines || 3)) { ok = false; break; }
            const lh = Math.round(size * 1.18);
            out.push({ size, lh, bold: b.bold, lines, gap: Math.round(size * 0.25) });
            total += lines.length * lh + Math.round(size * 0.25);
        }
        if (ok && total - (out.length ? out[out.length - 1].gap : 0) <= innerH) return { rows: out, m, innerW };
    }
    return null;
}

export function renderLabel({ size, name, prepared, expiry, allergens, weight }) {
    const spec = LABEL_SIZES[size] || LABEL_SIZES["50x30"];
    const W = spec.w * PX_PER_MM;
    const H = spec.h * PX_PER_MM;
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#000";
    ctx.direction = "rtl"; ctx.textAlign = "right"; ctx.textBaseline = "top";
    const small = spec.w <= 35;
    const blocks = [{ text: name, base: 0.3, bold: true, maxLines: 2 }];
    if (small) {
        if (prepared) blocks.push({ text: `הוכן: ${prepared}`, base: 0.13, bold: false, maxLines: 1 });
        if (expiry) blocks.push({ text: `תוקף: ${expiry}`, base: 0.15, bold: true, maxLines: 1 });
    } else {
        const dates = [prepared ? `הוכן: ${prepared}` : "", expiry ? `תוקף: ${expiry}` : ""].filter(Boolean).join("   ");
        if (dates) blocks.push({ text: dates, base: 0.14, bold: true, maxLines: 1 });
    }
    if (weight) blocks.push({ text: weight, base: 0.12, bold: false, maxLines: 1 });
    if (allergens) blocks.push({ text: `אלרגנים: ${allergens}`, base: 0.11, bold: false, maxLines: small ? 3 : 2 });
    let lay = layoutLabel(ctx, W, H, blocks);
    if (!lay) lay = layoutLabel(ctx, W, H, blocks.map((b) => ({ ...b, maxLines: 6 }))); // שמות/אלרגנים ארוכים: מאפשרים יותר שורות
    if (lay) {
        let y = lay.m;
        for (const r of lay.rows) {
            ctx.font = `${r.bold ? "700 " : "400 "}${r.size}px Arial, "Segoe UI", sans-serif`;
            for (const line of r.lines) { ctx.fillText(line, W - lay.m, y, lay.innerW); y += r.lh; }
            y += r.gap;
        }
    }
    return canvas;
}
