// מסמך אירוע להדפסה / שמירה כ-PDF ושליחה: כותרת ואלרגנים, תפריט, כמויות להכנה, מתכונים מלאים והזמנות לפי ספק. בלי מחירים.
// טהור (בלי DOM/DB): מקבל את התוכנית, ההקשר והתוצאה המחושבת, ופונקציית תרגום tr (זהות בעברית). שמות שהמשתמש כתב נשארים כמו שהם.
import { ALLERGENS } from "./allergens.js";
import { allergenCheck } from "./prepPlan.js";
import { entryQuantity } from "./prepPlan.js";

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = (v) => { const n = parseFloat(String(v == null ? "" : v).replace(",", ".")); return Number.isFinite(n) ? n : 0; };
const dateText = (iso) => String(iso || "").split("-").reverse().join("/");

// כמות בגרמים -> טקסט, בשפת המסמך
export function gramsText(g, en) {
    const n = Number(g) || 0;
    if (n >= 1000) return `${+(n / 1000).toFixed(3)} ${en ? "kg" : 'ק"ג'}`;
    return `${+n.toFixed(1)} ${en ? "g" : "גרם"}`;
}
const UNIT = { 'ק"ג': "kg", "ליטר": "L", "יח'": "pcs" };
const DRAFT_UNIT = { g: ["גרם", "g"], kg: ['ק"ג', "kg"], ml: ['מ"ל', "ml"], l: ["ליטר", "L"], tbsp: ["כף", "tbsp"], tsp: ["כפית", "tsp"], cup: ["כוס", "cup"], unit: ["יחידות", "pcs"] };
// רכיב טיוטה (עוד לא במזווה): כמות מספרית מוגדלת כמו שאר המתכון, וכמות לא ברורה מופיעה כפי שנכתבה
const draftQty = (d, k, en) => {
    const q = Number(d.quantity);
    const u = d.unit ? (DRAFT_UNIT[d.unit] ? DRAFT_UNIT[d.unit][en ? 1 : 0] : d.unit) : "";
    if (d.quantity == null || d.quantity === "") return u;
    return Number.isFinite(q) ? `${+(q * k).toFixed(2)}${u ? " " + u : ""}` : `${d.quantity}${u ? " " + u : ""}`;
};
const unitText = (u, en) => (en ? UNIT[u] || u : u);

// מרכיב את נתוני המסמך. result = planPrep(...), groups = שורות הזמנה לפי ספק (כולל extras ידניים), prepRecipes = [{id,name,g}]
export function buildEventDoc({ plan, ctx, result, groups, loose = [], prepRecipes = [], customPrep = [] }, en = false) {
    const rows = plan.rows.map((r) => {
        const legacy = r.source_type === "dish";
        const per = num(r.per);
        const total = entryQuantity(plan.guests, r.per, r.share);
        return { group: r.group || "", name: r.name, per: per > 0 ? (legacy ? `${+per.toFixed(2)} ${en ? "portions" : "מנות"}` : gramsText(per, en)) : "", total: total > 0 ? (legacy ? `${+total.toFixed(2)} ${en ? "portions" : "מנות"}` : gramsText(total, en)) : "" };
    });
    const algLabels = ALLERGENS.filter((a) => plan.allergens.includes(a.key)).map((a) => a.label);
    const chk = plan.allergens.length ? allergenCheck(plan.rows.map((r) => ({ source_type: r.source_type, source_id: r.source_id, name: r.name })), ctx, plan.allergens) : { hits: [], unknown: [] };

    // מתכונים מלאים, בכמות של האירוע: יחס = גרם להכנה / משקל סופי
    const recipes = prepRecipes.map((p) => {
        const rec = ctx.recipes.get(Number(p.id));
        if (!rec) return null;
        const fw = Number(rec.final_weight) || 0;
        const k = fw > 0 ? p.g / fw : 1;
        const items = (ctx.recipeItems.get(rec.id) || []).map((i) => {
            const sub = i.sub_recipe_id != null ? ctx.recipes.get(i.sub_recipe_id) : null;
            const pan = i.pantry_item_id != null ? ctx.pantry.get(i.pantry_item_id) : null;
            const q = (Number(i.quantity_g) || 0) * k;
            return { name: sub ? sub.name : pan ? pan.name : "", sub: !!sub, qty: i.unit_count ? `${+q.toFixed(2)} ${en ? "pcs" : "יחידות"}` : gramsText(q, en), g: i.unit_count ? 0 : q };
        }).filter((i) => i.name).sort((a, b) => b.g - a.g);
        for (const d of rec.draft_ingredients || []) items.push({ name: d.name, sub: false, qty: draftQty(d, k, en), g: 0 });
        return { name: rec.name, target: gramsText(p.g, en), scaled: fw > 0, method: rec.method || "", items };
    }).filter(Boolean);

    const orders = groups.map((g) => ({
        supplier: g.supplier ? g.supplier.name : "",
        lines: [...g.lines.map((l) => ({ name: l.name, qty: plan.overrides["o" + l.id] || (l.pack ? `${l.pack.count} ${en ? "packs" : "אריזות"} (${+Number(l.units).toFixed(2)} ${unitText(l.unit, en)})` : `${+Number(l.units).toFixed(2)} ${unitText(l.unit, en)}`) })), ...g.extras.map((c) => ({ name: c.label, qty: c.qty }))],
    })).concat(loose.length ? [{ supplier: "", extra: true, lines: loose.map((c) => ({ name: c.label, qty: c.qty })) }] : []);

    const prep = [
        ...result.dishes.map((d) => ({ name: d.name, qty: plan.overrides["d" + d.id] || `${d.portions} ${en ? "portions" : "מנות"}` })),
        ...prepRecipes.map((r) => ({ name: r.name, qty: plan.overrides["r" + r.id] || gramsText(r.g, en) })),
        ...customPrep.map((c) => ({ name: c.label, qty: c.qty })),
    ];
    return { title: plan.name, date: plan.date, guests: plan.guests, margin: plan.margin, algLabels, hits: chk.hits, unknown: [...new Set(chk.unknown)], hasCustom: plan.custom.length > 0, rows, prep, recipes, orders };
}

// tr: פונקציית תרגום לתוויות העברית. en: כיוון ושפה
export function eventDocHtml(doc, tr = (s) => s, en = false) {
    const dir = en ? "ltr" : "rtl", align = en ? "left" : "right";
    const T = (s) => esc(tr(s));
    const groups = [];
    for (const r of doc.rows) { let g = groups.find((x) => x.name === r.group); if (!g) { g = { name: r.group, rows: [] }; groups.push(g); } g.rows.push(r); }
    const menu = groups.map((g) => `${g.name ? `<tr class="gh"><td colspan="3">${esc(g.name)}</td></tr>` : groups.length > 1 ? `<tr class="gh"><td colspan="3">${T("פריטים נוספים")}</td></tr>` : ""}${g.rows.map((r) => `<tr><td>${esc(r.name)}</td><td class="q">${esc(r.per)}</td><td class="q">${esc(r.total)}</td></tr>`).join("")}`).join("");
    const alg = doc.algLabels.length ? `<div class="alg"><b>${T("אלרגנים בין הסועדים")}:</b> ${esc(doc.algLabels.map(tr).join(", "))}
        ${doc.hits.length ? `<ul>${doc.hits.map((h) => `<li>⚠ <b>${esc(h.name)}</b> - ${T("מכיל")} ${esc(h.labels.map(tr).join(", "))}</li>`).join("")}</ul>` : `<div>${T("לא נמצאו בתפריט פריטים עם האלרגנים האלה, לפי ההגדרות במערכת.")}</div>`}
        ${doc.unknown.length ? `<div>${T("לא הוגדרו אלרגנים ב")}: ${esc(doc.unknown.join(", "))}. ${T("יש לבדוק ידנית.")}</div>` : ""}
        ${doc.hasCustom ? `<div>${T("פריטים ידניים לא נבדקים.")}</div>` : ""}</div>` : "";
    const recipes = doc.recipes.map((r) => `<div class="rec"><h3>${esc(r.name)} <span class="tg">${esc(r.target)}</span></h3>
        ${r.scaled ? "" : `<div class="note">${T("אין משקל סופי במתכון, הכמויות לפי המתכון המקורי")}</div>`}
        <table><thead><tr><th>${T("רכיב")}</th><th class="q">${T("כמות")}</th></tr></thead><tbody>${r.items.map((i) => `<tr><td>${i.sub ? "📖 " : ""}${esc(i.name)}</td><td class="q">${esc(i.qty)}</td></tr>`).join("")}</tbody></table>
        ${r.method ? `<div class="m"><b>${T("אופן ההכנה")}</b><br>${esc(r.method)}</div>` : ""}</div>`).join("");
    const orders = doc.orders.map((o) => `<div class="ord"><h3>${o.supplier ? esc(o.supplier) : T(o.extra ? "הוספות ידניות" : "ללא ספק קבוע")}</h3>
        <table><tbody>${o.lines.map((l) => `<tr><td>${esc(l.name)}</td><td class="q">${esc(l.qty)}</td></tr>`).join("")}</tbody></table></div>`).join("");
    return `<!doctype html><html lang="${en ? "en" : "he"}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(doc.title || tr("מסמך אירוע"))}</title><style>
@page{size:A4;margin:12mm}
body{font-family:Arial,"Segoe UI",sans-serif;font-size:13px;color:#000;margin:0;padding:14px;line-height:1.45}
h1{font-size:24px;margin:0 0 4px}h2{font-size:17px;margin:20px 0 6px;border-bottom:2px solid #000;padding-bottom:2px}h3{font-size:14px;margin:12px 0 4px}
.sub{font-size:14px;margin-bottom:8px}.tg{font-weight:400;color:#444}
table{width:100%;border-collapse:collapse;margin:4px 0}td,th{border-bottom:1px solid #bbb;padding:4px 5px;text-align:${align}}th{border-bottom:2px solid #000;font-size:12px}
td.q,th.q{text-align:${en ? "right" : "left"};white-space:nowrap;font-weight:700}
tr.gh td{background:#eee;font-weight:700}
.alg{border:2px solid #000;padding:6px 10px;margin:8px 0}.alg ul{margin:4px 0;padding-${en ? "left" : "right"}:18px}
.rec,.ord{page-break-inside:avoid}.m{white-space:pre-wrap;margin:6px 0 10px}.note{font-size:12px;color:#444}
</style></head><body>
<h1>${esc(doc.title || tr("מסמך אירוע"))}</h1>
<div class="sub">${doc.date ? `${T("תאריך")}: ${esc(dateText(doc.date))} &nbsp; ` : ""}${doc.guests ? `${T("סועדים")}: ${esc(doc.guests)}` : ""}</div>
${alg}
<h2>${T("תפריט")}</h2>
<table><thead><tr><th>${T("פריט")}</th><th class="q">${T("לסועד")}</th><th class="q">${T("סך הכול")}</th></tr></thead><tbody>${menu}</tbody></table>
${doc.prep.length ? `<h2>${T("כמויות להכנה")}</h2><div class="note">${T("הכמויות כוללות ניצולת ומרווח ביטחון")}: ${esc(doc.margin)}%</div><table><tbody>${doc.prep.map((p) => `<tr><td>${esc(p.name)}</td><td class="q">${esc(p.qty)}</td></tr>`).join("")}</tbody></table>` : ""}
${recipes ? `<h2>${T("מתכונים")}</h2>${recipes}` : ""}
${orders ? `<h2>${T("הזמנות לפי ספק")}</h2>${orders}` : ""}
<script>window.onload=function(){setTimeout(function(){window.print()},300)}</script>
</body></html>`;
}
