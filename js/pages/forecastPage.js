// תחזית סועדים והכנות: סועדים צפויים לכל יום קדימה, וכמה להכין מכל פריט בתפריט. התפריט הוא התפריט של תוכנית מיז אן פלאס.
// גרם לסועד לכל פריט הוא אותו שדה כמו בתפריט, כך שהכול מקושר. סועדים צפויים נשמרים בהגדרות (נכללים בגיבוי).
import { dbGetAll } from "../db.js";
import { getSetting, setSetting } from "../repo/settingsRepo.js";
import { listPlans, savePlans, upsertPlan, todayIso } from "../repo/prepPlansRepo.js";
import { historyPoints } from "../serviceDoc.js";
import { buildForecast, addDays, thawFor, thawDaysOf } from "../forecast.js";
import { qtyText } from "../shareText.js";
import { escapeHtml, info } from "../ui.js";

const RANGES = [["week", "שבוע", 7], ["two", "שבועיים", 14], ["month", "חודש", 30]];
const K_THAW = "forecast_thaw";
const K_DAYS = "forecast_days", K_MARGIN = "forecast_margin", K_RANGE = "forecast_range", K_PLAN = "forecast_plan";
const shortDate = (d) => { const [, m, day] = String(d || "").split("-"); return day ? `${parseInt(day, 10)}.${parseInt(m, 10)}` : ""; };
const fmt = (n) => +Number(n).toFixed(2);

export async function renderForecast(container) {
    const pantry = new Map((await dbGetAll("pantryItems")).filter((p) => !p.parent_id).map((p) => [p.id, p]));
    let plans = await listPlans();
    const points = historyPoints(plans, pantry);
    const today = todayIso();

    let entered = (await getSetting(K_DAYS, {})) || {};
    let margin = String((await getSetting(K_MARGIN, "10")) ?? "10");
    let range = (await getSetting(K_RANGE, "two")) || "two";
    let thaw = (await getSetting(K_THAW, {})) || {}; // ימי הפשרה לכל נתח
    let planId = await getSetting(K_PLAN, "");
    let plan = plans.find((p) => p.id === planId) || plans[0] || null; // ברירת מחדל: התוכנית האחרונה שנערכה
    const open = new Set(); // ימים פתוחים לפירוט

    // פריטי התפריט שהם חומרי גלם (נתחים). מנות ומתכונים בתפריט לא נכנסים לתחזית הזו
    const menuRows = () => (plan ? plan.rows.filter((r) => r.source_type === "pantry" && pantry.has(r.source_id)) : []);
    const itemList = () => menuRows().map((r) => ({ id: r.source_id, name: pantry.get(r.source_id).name, per: r.per, cnt: pantry.get(r.source_id).unit_type === "unit" }));
    const savePlanRows = async () => { plans = upsertPlan(plans, plan); plan = plans[0]; await savePlans(plans); };
    const saveEntered = async () => {
        const keep = {};
        const cutoff = addDays(today, -14);
        for (const [d, v] of Object.entries(entered)) if (d >= cutoff && String(v).trim() !== "") keep[d] = String(v);
        entered = keep;
        await setSetting(K_DAYS, entered);
    };

    container.innerHTML = `
        <div class="card">
            <div class="card-title" style="margin:0 0 6px;">תחזית סועדים ${info("מזינים סועדים צפויים לכל יום. האפליקציה מחשבת כמה להכין מכל פריט בתפריט, כולל מרווח ביטחון. יום בלי הזנה מקבל הצעה לפי אותו יום בשבוע בערבים קודמים.")}</div>
            <div class="seg" id="fc-range">${RANGES.map(([k, l]) => `<button type="button" data-r="${k}">${l}</button>`).join("")}</div>
            <div class="field"><label>מרווח ביטחון באחוזים</label><input type="text" inputmode="decimal" id="fc-margin"></div>
        </div>
        <div class="card">
            <div class="card-title" style="margin:0 0 6px;">תפריט התחזית ${info("התפריט הוא התפריט של התוכנית שנבחרה. משנים אותו בלשונית אירוע. גרם לסועד כאן ובתפריט הוא אותו שדה. אם משאירים ריק, האפליקציה משתמשת בממוצע מהסרוויסים הקודמים.")}</div>
            <div class="field" id="fc-plan-wrap"><select id="fc-plan"></select></div>
            <div id="fc-items"></div>
        </div>
        <div class="card" id="fc-today-card"><div class="card-title" style="margin:0 0 6px;">היום</div><div id="fc-today"></div></div>
        <div class="card"><div class="card-title" style="margin:0 0 6px;">הימים הקרובים</div><div id="fc-days"></div></div>
        <div class="card"><div class="card-title" style="margin:0 0 6px;">סה"כ לתקופה</div><div id="fc-tot"></div></div>`;
    const q = (s) => container.querySelector(s);
    q("#fc-margin").value = margin;

    const daysCount = () => (RANGES.find((r) => r[0] === range) || RANGES[1])[2];
    const maxThaw = () => Math.max(0, ...itemList().map((i) => thawDaysOf(thaw, i.id)));
    const model = () => buildForecast({ startIso: today, days: daysCount(), extraDays: maxThaw(), entered, points, items: itemList(), marginPct: margin });
    const qtyOf = (l) => (l.qty > 0 ? (l.cnt ? `${l.qty} יחידות` : qtyText(l.qty)) : "");

    const linesHtml = (lines) => {
        const rows = lines.filter((l) => l.qty > 0);
        const missing = lines.filter((l) => !(l.per > 0));
        return `${rows.map((l) => `<div class="card-row" style="padding:4px 0;"><span>${escapeHtml(l.name)}</span><b>${escapeHtml(qtyOf(l))}</b></div>`).join("")}${missing.length ? `<div class="muted" style="margin-top:4px;">${escapeHtml("חסר גרם לסועד:")} ${escapeHtml(missing.map((l) => l.name).join(", "))}</div>` : ""}`;
    };
    const dayLabel = (d) => `${d.weekday} ${shortDate(d.date)}`;
    const thawHtml = (m, i) => {
        const rows = thawFor(m, i, thaw);
        if (!rows.length) return "";
        return `<div style="margin-top:8px;font-weight:700;">${escapeHtml("להוציא מהמקפיא")}</div>${rows.map((r) => `<div class="card-row" style="padding:4px 0;"><span>${escapeHtml(r.name)} <span class="muted">${escapeHtml(`ל${r.forWeekday} ${shortDate(r.forDate)}`)}</span></span><b>${escapeHtml(r.cnt ? `${r.qty} יחידות` : qtyText(r.qty))}</b></div>`).join("")}`;
    };

    function drawPlanSelect() {
        const sel = q("#fc-plan");
        sel.innerHTML = plans.map((p) => `<option value="${escapeHtml(p.id)}"${plan && p.id === plan.id ? " selected" : ""}>${escapeHtml(`${p.name || "אירוע"} · ${shortDate(p.date)}`)}</option>`).join("");
        q("#fc-plan-wrap").style.display = plans.length > 1 ? "" : "none";
        sel.onchange = async () => { plan = plans.find((p) => p.id === sel.value) || plan; await setSetting(K_PLAN, plan.id); drawItems(); drawDays(); paint(); };
    }

    function drawItems() {
        const box = q("#fc-items");
        const list = itemList();
        const m = model();
        box.innerHTML = list.length ? list.map((i) => {
            const line = m.days[0].lines.find((l) => l.id === i.id);
            const learned = line && line.source === "learned" ? `${fmt(line.per)}` : "";
            const unit = i.cnt ? "יחידות לסועד" : "גרם לסועד";
            return `<div class="card-row" style="padding:5px 0;gap:8px;align-items:center;"><span style="flex:1;min-width:0;"><b>${escapeHtml(i.name)}</b></span><input type="text" inputmode="decimal" data-per="${i.id}" value="${escapeHtml(i.per || "")}" placeholder="${escapeHtml(learned || unit)}" style="width:84px;text-align:center;flex:none;"><span class="muted" style="flex:none;">${escapeHtml(unit)}</span><input type="text" inputmode="numeric" data-th="${i.id}" value="${escapeHtml(thaw[i.id] || "")}" placeholder="0" style="width:44px;text-align:center;flex:none;" title="${escapeHtml("ימי הפשרה")}"><span class="muted" style="flex:none;">${escapeHtml("ימי הפשרה")}</span></div>`;
        }).join("") : `<div class="muted">${escapeHtml("אין תפריט. הוסף פריטים בתפריט של אירוע.")}</div>`;
        box.querySelectorAll("[data-th]").forEach((inp) => {
            inp.oninput = async () => { thaw[inp.dataset.th] = inp.value; await setSetting(K_THAW, thaw); drawDays(); paint(); };
        });
        box.querySelectorAll("[data-per]").forEach((inp) => {
            inp.oninput = async () => {
                const r = menuRows().find((x) => x.source_id === Number(inp.dataset.per));
                if (r) { r.per = inp.value; await savePlanRows(); paint(); }
            };
        });
    }

    function drawDays() {
        const m = model();
        q("#fc-days").innerHTML = m.days.filter((d) => !d.extra).map((d) => `<div style="padding:8px 0;border-top:1px solid var(--border,#0001);">
            <div style="display:flex;gap:8px;align-items:center;">
                <span style="flex:1;min-width:0;"><b>${escapeHtml(dayLabel(d))}</b><br><span class="muted" data-dt="${d.date}"></span></span>
                <input type="text" inputmode="numeric" data-dd="${d.date}" value="${escapeHtml(entered[d.date] != null ? entered[d.date] : "")}" placeholder="${d.suggested != null ? d.suggested : "סועדים"}" style="width:84px;text-align:center;flex:none;">
                <button type="button" class="btn btn-secondary btn-small" data-tg="${d.date}">פירוט</button>
            </div>
            <div data-dl="${d.date}" style="margin-top:6px;display:${open.has(d.date) ? "block" : "none"};"></div></div>`).join("");
        q("#fc-days").querySelectorAll("[data-dd]").forEach((inp) => {
            inp.oninput = async () => { entered[inp.dataset.dd] = inp.value; await saveEntered(); paint(); };
        });
        q("#fc-days").querySelectorAll("[data-tg]").forEach((b) => {
            b.onclick = () => { const d = b.dataset.tg; if (open.has(d)) open.delete(d); else open.add(d); q(`[data-dl="${d}"]`).style.display = open.has(d) ? "block" : "none"; };
        });
    }

    // מעדכן רק את תוצאות החישוב, בלי לצייר מחדש שדות הקלט (כדי שהמקלדת לא תיסגר)
    function paint() {
        const m = model();
        const t = m.days[0];
        q("#fc-today").innerHTML = (t.diners > 0 ? `<div class="muted" style="margin-bottom:4px;">${escapeHtml(dayLabel(t))} · ${t.diners} ${escapeHtml("סועדים")}${t.entered ? "" : ` · ${escapeHtml("הצעה")}`}</div>${linesHtml(t.lines)}` : `<div class="muted">${escapeHtml("הזן סועדים להיום.")}</div>`) + thawHtml(m, 0);
        m.days.forEach((d, i) => {
            if (d.extra) return;
            const dt = q(`[data-dt="${d.date}"]`), dl = q(`[data-dl="${d.date}"]`);
            if (dt) dt.textContent = d.diners > 0 ? `${d.diners} ${"סועדים"}${d.entered ? "" : ` · ${"הצעה"}`}` : "";
            if (dl) dl.innerHTML = (d.diners > 0 ? linesHtml(d.lines) : `<div class="muted">${escapeHtml("הזן סועדים.")}</div>`) + thawHtml(m, i);
        });
        const tot = m.totals.filter((x) => x.qty > 0);
        q("#fc-tot").innerHTML = tot.length ? tot.map((x) => `<div class="card-row" style="padding:4px 0;"><span>${escapeHtml(x.name)}</span><b>${escapeHtml(x.cnt ? `${x.qty} יחידות` : qtyText(x.qty))}</b></div>`).join("") : `<div class="muted">${escapeHtml("אין עדיין כמויות.")}</div>`;
    }

    container.querySelectorAll("#fc-range button").forEach((b) => {
        b.classList.toggle("active", b.dataset.r === range);
        b.onclick = async () => {
            range = b.dataset.r; await setSetting(K_RANGE, range);
            container.querySelectorAll("#fc-range button").forEach((x) => x.classList.toggle("active", x.dataset.r === range));
            drawDays(); paint();
        };
    });
    q("#fc-margin").oninput = async (e) => { margin = e.target.value; await setSetting(K_MARGIN, margin); paint(); };
    drawPlanSelect(); drawItems(); drawDays(); paint();
}
