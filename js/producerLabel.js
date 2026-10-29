// בניית מדבקת מוצר להדפסה (HTML). טהור (בלי DOM/DB) כדי שאפשר לבדוק ב-Node.
// זו טיוטה לעזר: האחריות לתיוג ולתקנות היא של בעל העסק.
import { NUTRITION_FIELDS, addDaysIso, fmtDateHe } from "./repo/producerRepo.js";
import { localDate } from "./dates.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// גדלים במ"מ. a4 = דף מלא עם 3 עמודות של מדבקות 63x38
export const LABEL_SIZES = [
    { key: "50x30", label: '50×30 מ"מ (קטנה)', w: 50, h: 30, font: 6.5 },
    { key: "70x40", label: '70×40 מ"מ (בינונית)', w: 70, h: 40, font: 8 },
    { key: "100x60", label: '100×60 מ"מ (גדולה)', w: 100, h: 60, font: 11 },
    { key: "a4", label: "דף A4 (3 בשורה)", w: 63, h: 60, font: 9, sheet: true },
];

export function netText(g) {
    const n = Number(g) || 0;
    if (!(n > 0)) return "";
    return n >= 1000 ? `${+(n / 1000).toFixed(3)} ק"ג` : `${+n.toFixed(1)} גרם`;
}

// data: { product, business, label: { ingredients:[{name}], allergens:[...], unknown:[...] }, productionDate (ISO), count, size, showNutrition }
export function buildLabelHtml(data) {
    const { product, business, label, productionDate, size = "70x40", showNutrition = false } = data;
    const count = Math.max(1, Math.min(500, Math.round(Number(data.count) || 1)));
    const sz = LABEL_SIZES.find((s) => s.key === size) || LABEL_SIZES[1];
    const ing = (label.ingredients || []).map((i) => i.name).join(", ");
    const prodDate = /^\d{4}-\d{2}-\d{2}$/.test(String(productionDate || "")) ? productionDate : localDate();
    const expiry = product.shelf_days > 0 ? addDaysIso(prodDate, product.shelf_days) : "";
    const hasNutrition = showNutrition && product.nutrition && NUTRITION_FIELDS.some((f) => product.nutrition[f.key] != null);

    const nutrition = hasNutrition ? `<table class="nu"><tr><th colspan="2">ערכים תזונתיים ל-100 גרם</th></tr>${NUTRITION_FIELDS.filter((f) => product.nutrition[f.key] != null).map((f) => `<tr><td>${esc(f.label)}</td><td>${esc(product.nutrition[f.key])}</td></tr>`).join("")}</table>` : "";
    const bizLine = [business.name, business.address, business.phone, business.reg ? `ח.פ./רישיון ${business.reg}` : ""].filter(Boolean).join(" · ");

    const one = `<div class="lb">
        <div class="nm">${esc(product.name)}</div>
        ${ing ? `<div><b>רכיבים:</b> ${esc(ing)}.</div>` : ""}
        ${label.allergens && label.allergens.length ? `<div class="al"><b>מכיל: ${esc(label.allergens.join(", "))}</b></div>` : ""}
        ${product.net_g > 0 ? `<div><b>משקל נטו:</b> ${esc(netText(product.net_g))}</div>` : ""}
        <div class="dt"><span><b>ייצור:</b> ${esc(fmtDateHe(prodDate))}</span>${expiry ? `<span><b>לשימוש עד:</b> ${esc(fmtDateHe(expiry))}</span>` : ""}</div>
        ${product.storage ? `<div>${esc(product.storage)}</div>` : ""}
        ${nutrition}
        ${bizLine ? `<div class="bz">${esc(bizLine)}</div>` : ""}
        ${product.barcode ? `<div class="bz">ברקוד: ${esc(product.barcode)}</div>` : ""}
    </div>`;

    const pageCss = sz.sheet ? "@page{size:A4;margin:8mm}" : `@page{size:${sz.w}mm ${sz.h}mm;margin:0}`;
    const css = `${pageCss}
        *{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;color:#000;direction:rtl}
        .lb{width:${sz.w}mm;${sz.sheet ? `min-height:${sz.h}mm;` : `height:${sz.h}mm;`}padding:${sz.sheet ? 2 : 1.5}mm;font-size:${sz.font}pt;line-height:1.25;overflow:hidden;page-break-inside:avoid;${sz.sheet ? "border:0.2mm dashed #bbb;" : "page-break-after:always;"}}
        .nm{font-size:${Math.round(sz.font * 1.5 * 10) / 10}pt;font-weight:800;margin-bottom:.6mm}
        .al{margin:.5mm 0}.dt{display:flex;gap:3mm;flex-wrap:wrap}.bz{font-size:${Math.max(5, sz.font - 1.5)}pt;color:#222;margin-top:.5mm}
        .nu{border-collapse:collapse;margin:.8mm 0;font-size:${Math.max(5, sz.font - 1.5)}pt;width:100%}.nu td,.nu th{border:0.15mm solid #000;padding:0 1mm;text-align:right}
        ${sz.sheet ? ".sheet{display:grid;grid-template-columns:repeat(3,63mm);gap:0}" : ""}`;
    const body = sz.sheet ? `<div class="sheet">${one.repeat(count)}</div>` : one.repeat(count);
    return `<!doctype html><html dir="rtl" lang="he"><head><meta charset="utf-8"><title>${esc(product.name)}</title><style>${css}</style></head><body>${body}</body></html>`;
}
