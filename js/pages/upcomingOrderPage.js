// הזמנה לימים הקרובים: כמה להזמין מכל נתח בתפריט לטווח ימים, לכל ספק טווח משלו. קורא מהתחזית, מפחית מלאי ומעגל לאריזות.
import { dbGetAll } from "../db.js";
import { getSetting, setSetting } from "../repo/settingsRepo.js";
import { todayIso } from "../repo/prepPlansRepo.js";
import { addDays, buildForecast } from "../forecast.js";
import { loadForecastInputs } from "../forecastData.js";
import { buildInventoryView } from "../repo/inventoryRepo.js";
import { recordOrder } from "../repo/ordersRepo.js";
import { orderGroups, overlappingOrders, rangeNote, lineText, RANGE_OPTIONS } from "../upcomingOrder.js";
import { orderText, whatsappUrl, mailtoUrl } from "../shareText.js";
import { escapeHtml, info, toast, confirmDialog } from "../ui.js";

const K_MARGIN = "order_margin", K_DAYS = "order_days_default", K_STOCK = "order_use_stock";
const sd = (iso) => { const [, m, d] = String(iso).split("-"); return `${parseInt(d, 10)}.${parseInt(m, 10)}`; };

export async function renderUpcomingOrder(container) {
    const inp = await loadForecastInputs();
    const suppliers = await dbGetAll("suppliers");
    let inventory = [];
    try { inventory = await buildInventoryView(); } catch (e) { inventory = []; }

    let from = addDays(todayIso(), 1);
    let margin = String((await getSetting(K_MARGIN, "15")) ?? "15");
    let defCount = Number(await getSetting(K_DAYS, 7)) || 7;
    let useStock = (await getSetting(K_STOCK, true)) !== false;
    const counts = {}; // טווח ייעודי לספק: { מפתח ספק: ימים }

    container.innerHTML = `
        <div class="card">
            <div class="card-title" style="margin:0 0 6px;">הזמנה לימים הקרובים ${info("כמה להזמין מכל נתח בתפריט לטווח ימים. הכמות מחושבת מהתחזית, מופחת ממנה המלאי שיש, ומעוגלת כלפי מעלה לאריזות שלמות. לכל ספק אפשר לבחור טווח משלו.")}</div>
            <div class="form-row">
                <div class="field"><label>מתאריך</label><input type="date" id="uo-from"></div>
                <div class="field"><label>מרווח ביטחון באחוזים</label><input type="text" inputmode="decimal" id="uo-margin"></div>
            </div>
            <div class="field"><label>ימים לכל הספקים</label><div class="seg" id="uo-days">${RANGE_OPTIONS.map(([n, l]) => `<button type="button" data-n="${n}">${escapeHtml(l)}</button>`).join("")}</div></div>
            <label class="checkbox-field"><input type="checkbox" id="uo-stock"><span>${escapeHtml("הפחת מלאי")}</span></label>
            <div class="hint">${escapeHtml("מלאי מופחת רק למוצר שנספר.")}</div>
        </div>
        <div id="uo-result"></div>`;
    const q = (s) => container.querySelector(s);
    q("#uo-from").value = from; q("#uo-margin").value = margin; q("#uo-stock").checked = useStock;

    const stockMap = () => {
        const m = new Map();
        if (useStock) for (const v of inventory) if (v.last_count_date) m.set(v.id, Math.max(0, Number(v.theoretical_quantity) || 0));
        return m;
    };
    const model = () => buildForecast({ startIso: from, days: 30, entered: inp.entered, points: inp.points, items: inp.items.map((i) => ({ ...i, cnt: inp.pantry.get(i.id) && inp.pantry.get(i.id).unit_type === "unit" })), marginPct: margin });
    const groups = () => orderGroups({ model: model(), defaultCount: defCount, counts, pantry: inp.pantry, suppliers, stock: stockMap() });

    const linesPayload = (g) => g.lines.map((l) => ({ name: l.name, qty: l.pack ? String(l.pack.count) : String(+Number(l.units).toFixed(2)), unit: l.pack ? "אריזות" : l.unit }));
    const dateText = (g) => (g.count === 1 ? sd(g.from) : `${sd(g.from)} עד ${sd(g.to)}`);
    const textOf = (g) => orderText(g.supplier ? g.supplier.name : "", dateText(g), g.lines.map((l) => ({ name: l.name, qty: lineText(l) })));

    async function send(g, via) {
        const text = textOf(g);
        if (g.supplier) {
            const fresh = (await dbGetAll("suppliers")).find((s) => s.id === g.supplier.id) || g.supplier;
            const over = overlappingOrders(fresh.order_history, g.from, g.to);
            if (over.length && !(await confirmDialog(`${escapeHtml("כבר הוזמן לטווח חופף ב")}${escapeHtml(sd(over[0].date))}. ${escapeHtml("להמשיך?")}`))) return;
        }
        if (via === "whatsapp") { if (!window.open(whatsappUrl(text, g.supplier ? g.supplier.phone : ""), "_blank")) toast("הדפדפן חסם את פתיחת הדף. אפשר חלונות קופצים לאתר ונסה שוב."); }
        else if (via === "email") window.location.href = mailtoUrl(g.supplier ? g.supplier.email : "", `${"הזמנה"} ${dateText(g)}`, text);
        else { try { await navigator.clipboard.writeText(text); toast("ההזמנה הועתקה"); } catch (e) { toast("לא הצלחתי להעתיק"); } }
        if (g.supplier) {
            try { await recordOrder(g.supplier.id, { lines: linesPayload(g), note: rangeNote(g.from, g.to), via }); toast("ההזמנה נשמרה בהיסטוריה של הספק"); } catch (e) { toast("לא הצלחתי לשמור בהיסטוריה"); }
        }
    }

    function paint() {
        const gs = groups();
        const missing = inp.items.filter((i) => !(parseFloat(String(i.per).replace(",", ".")) > 0) && !inp.points.some((p) => (p.perItem || []).some((x) => x.id === i.id)));
        q("#uo-result").innerHTML = !inp.items.length ? `<div class="card"><div class="muted">${escapeHtml("אין תפריט. הוסף פריטים בתפריט של אירוע.")}</div></div>`
            : (gs.length ? gs.map((g, i) => `<div class="card">
                <div class="card-row"><b>${escapeHtml(g.supplier ? g.supplier.name : "ללא ספק קבוע")}</b><span class="muted">${escapeHtml(g.count === 1 ? sd(g.from) : `${sd(g.from)} - ${sd(g.to)}`)}</span></div>
                <div class="seg" data-rg="${i}">${RANGE_OPTIONS.map(([n, l]) => `<button type="button" data-n="${n}" class="${g.count === n ? "active" : ""}">${escapeHtml(l)}</button>`).join("")}</div>
                ${g.lines.map((l) => `<div class="card-row" style="padding:4px 0;"><span>${escapeHtml(l.name)}</span><b>${escapeHtml(lineText(l))}</b></div>`).join("")}
                ${g.supplier ? "" : `<div class="muted" style="margin-top:4px;">${escapeHtml("אין ספק קבוע לחומרי הגלם האלה. יש להוסיף אותם לרשימת ההזמנה של ספק.")}</div>`}
                <div class="btn-row" style="margin-top:8px;flex-wrap:wrap;gap:6px;">
                    <button type="button" class="btn btn-secondary btn-small" data-send="${i}|copy">${escapeHtml("העתק")}</button>
                    <button type="button" class="btn btn-secondary btn-small" data-send="${i}|whatsapp">📤 ${escapeHtml("וואטסאפ")}</button>
                    <button type="button" class="btn btn-secondary btn-small" data-send="${i}|email">✉️ ${escapeHtml("מייל")}</button>
                </div></div>`).join("") : `<div class="card"><div class="muted">${escapeHtml("אין כמויות להזמנה. הזן סועדים בתחזית וגרם לסועד לכל נתח.")}</div></div>`)
            + (missing.length ? `<div class="muted" style="margin:6px 4px;">${escapeHtml("חסר גרם לסועד:")} ${escapeHtml(missing.map((m) => m.name).join(", "))}</div>` : "");
        q("#uo-result").querySelectorAll("[data-rg]").forEach((seg) => {
            const g = gs[Number(seg.dataset.rg)];
            seg.querySelectorAll("button").forEach((b) => { b.onclick = () => { counts[g.key] = Number(b.dataset.n); paint(); }; });
        });
        q("#uo-result").querySelectorAll("[data-send]").forEach((b) => { b.onclick = () => { const [i, via] = b.dataset.send.split("|"); send(gs[Number(i)], via); }; });
    }

    q("#uo-from").onchange = (e) => { if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) { from = e.target.value; paint(); } };
    q("#uo-margin").oninput = async (e) => { margin = e.target.value; await setSetting(K_MARGIN, margin); paint(); };
    q("#uo-stock").onchange = async (e) => { useStock = e.target.checked; await setSetting(K_STOCK, useStock); paint(); };
    q("#uo-days").querySelectorAll("button").forEach((b) => {
        b.classList.toggle("active", Number(b.dataset.n) === defCount);
        b.onclick = async () => {
            defCount = Number(b.dataset.n); await setSetting(K_DAYS, defCount);
            for (const k of Object.keys(counts)) delete counts[k];
            q("#uo-days").querySelectorAll("button").forEach((x) => x.classList.toggle("active", Number(x.dataset.n) === defCount));
            paint();
        };
    });
    paint();
}
