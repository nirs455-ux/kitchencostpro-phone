// היסטוריית מחירים של מוצר: גרף וטבלה לפי קניות מחשבוניות (מחיר ליחידת חומרי גלם), כולל השוואה בין ספקים.
import { openModal, closeModal, escapeHtml, cur } from "../ui.js";
import { priceHistory } from "../repo/suppliersRepo.js";
import { buildPriceChartSvg, summarizePrices } from "../priceChart.js";

const unitWord = (it) => (it.unit_type === "unit" ? "יחידה" : it.unit_type === "liter" ? "ליטר" : 'ק"ג');
const shortDate = (d) => { const [y, m, day] = String(d || "").split("-"); return day ? `${parseInt(day, 10)}.${parseInt(m, 10)}.${y.slice(2)}` : String(d || ""); };
const pct = (n) => `${n > 0 ? "+" : ""}${n.toFixed(1)}%`;

export async function openPriceHistory(item) {
    const hist = await priceHistory(item.id);
    if (!hist.length) {
        const ov = openModal(`<h2>היסטוריית מחירים: ${escapeHtml(item.name)}</h2><div class="empty-state">אין עדיין קניות של המוצר הזה בחשבוניות, לכן אין מה להציג. המחיר הנוכחי: ${cur()}${Number(item.price).toFixed(2)} ל${unitWord(item)}.</div><div class="modal-actions"><button type="button" class="btn btn-secondary" id="ph-close">סגור</button></div>`);
        ov.querySelector("#ph-close").onclick = closeModal;
        return;
    }
    const s = summarizePrices(hist);
    const money = (v) => `${cur()}${Number(v).toFixed(2)}`;
    const word = unitWord(item);
    // השוואת ספקים: המחיר האחרון אצל כל ספק
    const lastBySupplier = new Map();
    for (const p of hist) if (p.supplier) lastBySupplier.set(p.supplier, p);
    const supRows = [...lastBySupplier.entries()].sort((a, b) => a[1].price - b[1].price);
    const rows = [...hist].reverse().map((p, idx, arr) => {
        const prev = arr[idx + 1];
        const ch = prev && prev.price > 0 ? ((p.price - prev.price) / prev.price) * 100 : null;
        const color = ch == null ? "" : ch > 0.05 ? "color:var(--danger);" : ch < -0.05 ? "color:var(--ok);" : "";
        return `<tr><td>${escapeHtml(shortDate(p.date))}</td><td>${escapeHtml(p.supplier || "")}</td><td>${money(p.price)}</td><td style="${color}">${ch == null ? "" : escapeHtml(pct(ch))}</td></tr>`;
    }).join("");
    const ov = openModal(`
        <h2>היסטוריית מחירים: ${escapeHtml(item.name)}</h2>
        <div class="hint" style="margin-bottom:6px;">מחיר ל${word} לפי החשבוניות (${hist.length} קניות).</div>
        ${buildPriceChartSvg(hist, { currency: cur() })}
        <div class="card-row" style="margin-top:8px;"><span>אחרון</span><b>${money(s.last)}</b></div>
        <div class="card-row"><span>הכי נמוך / הכי גבוה</span><span>${money(s.min)} / ${money(s.max)}</span></div>
        <div class="card-row"><span>ממוצע</span><span>${money(s.avg)}</span></div>
        ${s.changePct != null && s.count > 1 ? `<div class="card-row"><span>שינוי מהקנייה הראשונה</span><b style="${s.changePct > 0.05 ? "color:var(--danger);" : s.changePct < -0.05 ? "color:var(--ok);" : ""}">${escapeHtml(pct(s.changePct))}</b></div>` : ""}
        ${supRows.length > 1 ? `<div class="card-title" style="margin:12px 0 4px;">לפי ספק (המחיר האחרון)</div>${supRows.map(([name, p], i) => `<div class="card-row"><span>${i === 0 ? "✅ " : ""}${escapeHtml(name)}</span><span>${money(p.price)}</span></div>`).join("")}` : ""}
        <div class="card-title" style="margin:12px 0 4px;">כל הקניות</div>
        <table class="simple"><thead><tr><th>תאריך</th><th>ספק</th><th>מחיר</th><th>שינוי</th></tr></thead><tbody>${rows}</tbody></table>
        <div class="modal-actions"><button type="button" class="btn btn-secondary" id="ph-close">סגור</button></div>`);
    ov.querySelector("#ph-close").onclick = closeModal;
}
