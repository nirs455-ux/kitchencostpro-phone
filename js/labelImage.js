// מדבקה כתמונה (שחור על לבן) להדפסה במדפסת מדבקות כמו Niimbot: מציירים על canvas בגודל המדבקה ומייבאים את התמונה באפליקציית המדפסת.
// גדלים במ"מ. הרזולוציה: 12 פיקסלים למ"מ (כ-300dpi), האפליקציה של המדפסת מקטינה לפי הצורך.
export const LABEL_SIZES = {
    "31x31": { w: 31, h: 31, label: "31×31 מ\"מ" },
    "50x30": { w: 50, h: 30, label: "50×30 מ\"מ" },
    "70x40": { w: 70, h: 40, label: "70×40 מ\"מ" },
};
const PX_PER_MM = 12;

// מידות בפועל: לאורך = הצלעות מוחלפות (50×30 הופך 30×50). קונפיגורציה אחת לכל המדבקות.
export function labelDims(size, portrait) {
    const spec = LABEL_SIZES[size] || LABEL_SIZES["50x30"];
    return portrait ? { w: spec.h, h: spec.w } : { w: spec.w, h: spec.h };
}
export const labelSizeText = (size, portrait) => { const d = labelDims(size, portrait); return `${d.w}×${d.h}`; };

// סיבוב 90 מעלות (למדפסת שמוציאה את התמונה מסובבת)
export function rotateCanvas(c) {
    const out = document.createElement("canvas");
    out.width = c.height; out.height = c.width;
    const x = out.getContext("2d");
    x.translate(out.width, 0); x.rotate(Math.PI / 2); x.drawImage(c, 0, 0);
    return out;
}

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

export function renderLabel({ size, name, prepared, expiry, allergens, weight, portrait = false, rotate = false }) {
    const spec = labelDims(size, portrait);
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
        if (prepared) blocks.push({ text: `ייצור: ${prepared}`, base: 0.13, bold: false, maxLines: 1 });
        if (expiry) blocks.push({ text: `תוקף: ${expiry}`, base: 0.15, bold: true, maxLines: 1 });
    } else {
        const dates = [prepared ? `ייצור: ${prepared}` : "", expiry ? `תוקף: ${expiry}` : ""].filter(Boolean).join("   ");
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
    return rotate ? rotateCanvas(canvas) : canvas;
}

// מדבקת ערכים תזונתיים: טבלה של ערכים ל-100 גרם (ובמדבקה רחבה גם למנה). במדבקה הקטנה רק הערכים העיקריים.
// nutrients: [{ key, label, short, dec }], per100 / perServing: { [key]: number }
export function renderNutritionLabel({ size, name, nutrients, per100, perServing, portrait = false, rotate = false }) {
    const spec = labelDims(size, portrait);
    const W = spec.w * PX_PER_MM;
    const H = spec.h * PX_PER_MM;
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#000"; ctx.strokeStyle = "#000";
    ctx.textBaseline = "middle";
    const small = spec.w * spec.h < 1200; // רק המדבקה הקטנה (31×31) מקבלת את הערכים העיקריים
    const m = Math.round(1.2 * PX_PER_MM);
    const innerW = W - 2 * m;
    const list = small ? nutrients.filter((n) => ["kcal", "fat", "carbs", "protein"].includes(n.key)) : nutrients;
    const withServing = !!perServing && !small && spec.w >= 40;
    const font = (px, bold) => `${bold ? "700 " : "400 "}${px}px Arial, "Segoe UI", sans-serif`;
    const rows = list.length + 1; // כותרת עמודות + שורות
    const titleH = Math.round(H * (small ? 0.17 : 0.15));
    const rowH = (H - 2 * m - titleH) / rows;
    const fs = Math.min(Math.round(rowH * 0.78), Math.round(W * 0.075));
    // כותרת: שם המנה, מותאמת לרוחב
    ctx.direction = "rtl"; ctx.textAlign = "right";
    let tsize = Math.round(titleH * 0.8);
    ctx.font = font(tsize, true);
    while (ctx.measureText(name).width > innerW && tsize > 10) { tsize -= 2; ctx.font = font(tsize, true); }
    ctx.fillText(name, W - m, m + titleH / 2, innerW);
    // עמודות הערכים בצד שמאל, התוויות בצד ימין: לא נוגעות זו בזו
    const valueX = withServing ? [m + Math.round(innerW * 0.35), m + Math.round(innerW * 0.09)] : [m + Math.round(innerW * 0.2)];
    const labelW = innerW * (withServing ? 0.5 : 0.64);
    let y = m + titleH;
    // כותרות עמודות
    ctx.font = font(Math.round(fs * 0.7), true);
    ctx.textAlign = "center";
    ctx.fillText("ל-100 גרם", valueX[0], y + rowH / 2);
    if (withServing) ctx.fillText("למנה", valueX[1], y + rowH / 2);
    y += rowH;
    ctx.lineWidth = 2;
    for (const n of list) {
        ctx.beginPath(); ctx.moveTo(m, y); ctx.lineTo(W - m, y); ctx.stroke();
        ctx.direction = "rtl"; ctx.textAlign = "right"; ctx.font = font(fs, n.key === "kcal");
        ctx.fillText(small ? n.short : n.label, W - m, y + rowH / 2, labelW);
        ctx.textAlign = "center"; ctx.direction = "ltr"; ctx.font = font(fs, true);
        ctx.fillText(String(per100[n.key] ?? 0), valueX[0], y + rowH / 2);
        if (withServing) ctx.fillText(String(perServing[n.key] ?? 0), valueX[1], y + rowH / 2);
        y += rowH;
    }
    return rotate ? rotateCanvas(canvas) : canvas;
}
