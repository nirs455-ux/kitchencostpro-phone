// מכירות ודוח פער (בתוך דף המנות): מזינים מה נמכר, והאפליקציה מפרקת לחומרי גלם ומשווה לספירת המלאי: עלות מזון בפועל מול תיאורטית.
import { openModal, closeModal, confirmDialog, toast, escapeHtml, money, info, busy } from "../ui.js";
import { dbGetAll } from "../db.js";
import { addSalesReport, listSalesLines, deleteSalesLine, parseCsvForDishes, importSalesLines, buildGapReport, todayIso, SALES_LINE_TYPES, SALES_LINE_LABELS } from "../repo/salesRepo.js";
import { listRow, groupsEl } from "./listKit.js";

const shortDate = (d) => { const [y, m, day] = String(d || "").split("-"); return day ? `${parseInt(day, 10)}.${parseInt(m, 10)}.${y}` : String(d || ""); };
const addDays = (iso, n) => { const [y, m, d] = iso.split("-").map(Number); const dt = new Date(y, m - 1, d + n); return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`; };
const unitWord = (t) => (t === "unit" ? "יח'" : t === "liter" ? "ל'" : 'ק"ג');
const open = new Set(); // תאריכים פתוחים ברשימת ההיסטוריה

// ---------------- לשונית מכירות ----------------
export async function renderSalesTab(container) {
    const dishes = (await dbGetAll("dishes")).sort((a, b) => a.name.localeCompare(b.name, "he"));
    const recipes = (await dbGetAll("recipes")).filter((r) => r.status !== "draft").sort((a, b) => a.name.localeCompare(b.name, "he"));
    const pending = [];
    container.innerHTML = `
        <div class="hint" style="margin-bottom:8px;">מזינים מה נמכר באותו יום. האפליקציה מפרקת כל מנה לחומרי הגלם שלה, ומורידה אותם מהמלאי התיאורטי. בדוח הפער היא משווה לספירה האמיתית.</div>
        ${dishes.length || recipes.length ? `
        <div class="card">
            <div class="field"><label>תאריך</label><input type="date" id="sl-date" value="${todayIso()}"></div>
            <div class="field"><label>מנה</label><select id="sl-item"><option value="">בחר מנה...</option>
                ${dishes.length ? `<optgroup label="מנות">${dishes.map((d) => `<option value="dish:${d.id}">${escapeHtml(d.name)}</option>`).join("")}</optgroup>` : ""}
                ${recipes.length ? `<optgroup label="מתכון שנמכר ישירות (בגרם)">${recipes.map((r) => `<option value="recipe:${r.id}">${escapeHtml(r.name)}</option>`).join("")}</optgroup>` : ""}</select></div>
            <div class="form-row">
                <div class="field"><label id="sl-qty-label">כמות מנות</label><input type="text" inputmode="decimal" id="sl-qty" placeholder="1"></div>
                <div class="field"><label>סוג</label><select id="sl-type">${SALES_LINE_TYPES.map((t) => `<option value="${t}">${SALES_LINE_LABELS[t]}</option>`).join("")}</select></div>
            </div>
            <button type="button" class="btn btn-secondary btn-block" id="sl-add">＋ הוסף שורה</button>
            <div class="error-msg" id="sl-err"></div>
        </div>
        <div id="sl-pending"></div>
        <div class="btn-row"><button type="button" class="btn btn-primary" id="sl-save" disabled>שמירת דוח מכירות</button><button type="button" class="btn btn-secondary" id="sl-csv">ייבוא מקובץ CSV</button></div>
        ` : '<div class="empty-state">כדי לדווח מכירות צריך קודם להוסיף מנות בלשונית "מנות".</div>'}
        <div class="card-title" style="margin:14px 4px 6px;">היסטוריה ${info("שורות שדווחו. מחיקה של שורה מחזירה את הצריכה שלה למלאי התיאורטי. 'בוטל - חזר למלאי' לא צורך חומר גלם.")}</div>
        <div id="sl-history"></div>`;

    const pendEl = container.querySelector("#sl-pending");
    const saveBtn = container.querySelector("#sl-save");
    const drawPending = () => {
        if (!pendEl) return;
        pendEl.innerHTML = pending.map((l, i) => `<div class="card-row" style="padding:6px 4px;border-bottom:1px solid var(--border,#0001);"><span><b>${escapeHtml(l.name)}</b><br><span class="muted">${l.quantity} ${l.source_type === "recipe" ? "גרם" : "מנות"} · ${SALES_LINE_LABELS[l.line_type]}</span></span><button type="button" class="btn btn-secondary btn-small" data-rm="${i}">✕</button></div>`).join("");
        pendEl.querySelectorAll("[data-rm]").forEach((b) => { b.onclick = () => { pending.splice(Number(b.dataset.rm), 1); drawPending(); }; });
        saveBtn.disabled = !pending.length;
        saveBtn.textContent = pending.length ? `שמירת דוח מכירות (${pending.length})` : "שמירת דוח מכירות";
    };
    const itemEl = container.querySelector("#sl-item");
    if (itemEl) {
        itemEl.onchange = () => { container.querySelector("#sl-qty-label").textContent = itemEl.value.startsWith("recipe:") ? "כמות בגרם" : "כמות מנות"; };
        const err = container.querySelector("#sl-err");
        container.querySelector("#sl-add").onclick = () => {
            err.style.display = "none";
            const [type, idStr] = String(itemEl.value).split(":");
            const qty = parseFloat(String(container.querySelector("#sl-qty").value).replace(",", "."));
            if (!idStr) { err.textContent = "בחר מנה."; err.style.display = "block"; return; }
            if (!(qty > 0)) { err.textContent = "הזן כמות גדולה מ-0."; err.style.display = "block"; return; }
            const src = (type === "dish" ? dishes : recipes).find((x) => String(x.id) === idStr);
            pending.push({ source_type: type, source_id: Number(idStr), name: src ? src.name : "", quantity: qty, line_type: container.querySelector("#sl-type").value });
            container.querySelector("#sl-qty").value = "";
            itemEl.value = ""; itemEl.onchange();
            drawPending();
        };
        saveBtn.onclick = busy(async () => {
            const err2 = container.querySelector("#sl-err");
            try {
                const n = await addSalesReport(container.querySelector("#sl-date").value, pending);
                toast(`נשמרו ${n} שורות`);
                renderSalesTab(container);
            } catch (e) { err2.textContent = e.message; err2.style.display = "block"; }
        });
        container.querySelector("#sl-csv").onclick = () => openCsvModal(() => renderSalesTab(container));
    }
    drawPending();

    // היסטוריה: קבוצות סגורות לפי תאריך
    const lines = await listSalesLines();
    const histEl = container.querySelector("#sl-history");
    if (!lines.length) { histEl.innerHTML = '<div class="empty-state">עדיין לא דווחו מכירות.</div>'; return; }
    const dates = [...new Set(lines.map((l) => l.report_date))];
    const groups = dates.slice(0, 60).map((d) => ({
        key: "sl:" + d, title: shortDate(d), ic: "🧾", tint: "var(--brand-soft)",
        rows: lines.filter((l) => l.report_date === d).map((l) => listRow({
            ic: l.line_type === "sold" ? "🍽️" : l.line_type === "staff_meal" ? "👨‍🍳" : "↩", tint: "var(--surface-2)", name: l.source_name,
            meta: `${l.quantity} ${l.source_type === "recipe" ? "גרם" : "מנות"} · ${SALES_LINE_LABELS[l.line_type] || ""}`, end: "מחק",
            onClick: async () => {
                if (!(await confirmDialog(`למחוק את השורה "${escapeHtml(l.source_name)}" (${l.quantity})?`))) return;
                await deleteSalesLine(l.id);
                toast("השורה נמחקה");
                renderSalesTab(container);
            },
        })),
    }));
    const drawHist = () => { histEl.innerHTML = ""; histEl.appendChild(groupsEl(groups, open, false, (k) => { if (open.has(k)) open.delete(k); else open.add(k); drawHist(); })); };
    drawHist();
}

function openCsvModal(onDone) {
    const ov = openModal(`
        <h2>ייבוא מכירות מקובץ</h2>
        <div class="hint" style="margin-bottom:6px;">שורה לכל מכירה: <b>תאריך, שם מנה, כמות, סוג</b> (סוג לא חובה: נמכר, צוות, בוטל נצרך, בוטל חזר). שם המנה חייב להיות כמו במנות שלך. אפשר להדביק מ-Excel, או לבחור קובץ.</div>
        <input type="file" id="csv-file" accept=".csv,.txt,text/csv,text/plain">
        <div class="field" style="margin-top:8px;"><textarea id="csv-text" rows="6" style="width:100%;" placeholder="2026-10-24,Pizza,12&#10;2026-10-24,Pizza,2,staff"></textarea></div>
        <button type="button" class="btn btn-secondary btn-small" id="csv-check">בדוק</button>
        <div id="csv-result" style="margin-top:8px;"></div>
        <div class="modal-actions"><button type="button" class="btn btn-secondary" id="csv-close">סגור</button><button type="button" class="btn btn-primary" id="csv-import" disabled>ייבוא</button></div>`);
    let parsed = null;
    const imp = ov.querySelector("#csv-import");
    ov.querySelector("#csv-file").addEventListener("change", async (e) => { const f = e.target.files[0]; if (f) ov.querySelector("#csv-text").value = await f.text(); });
    ov.querySelector("#csv-check").onclick = busy(async () => {
        parsed = await parseCsvForDishes(ov.querySelector("#csv-text").value);
        const box = ov.querySelector("#csv-result");
        box.innerHTML = `<div class="card-row"><span>שורות תקינות</span><b>${parsed.lines.length}</b></div>
            ${parsed.unmatched.length ? `<div class="hint-warn">מנות שלא נמצאו (לא ייובאו): ${parsed.unmatched.map(escapeHtml).join(", ")}</div>` : ""}
            ${parsed.bad.length ? `<div class="hint-warn">${parsed.bad.slice(0, 5).map(escapeHtml).join("<br>")}${parsed.bad.length > 5 ? `<br>ועוד ${parsed.bad.length - 5}` : ""}</div>` : ""}`;
        imp.disabled = !parsed.lines.length;
    });
    imp.onclick = busy(async () => {
        try { const n = await importSalesLines(parsed.lines); closeModal(); toast(`יובאו ${n} שורות`); onDone(); }
        catch (e) { const box = ov.querySelector("#csv-result"); box.innerHTML = `<div class="error-msg" style="display:block;">${escapeHtml(e.message)}</div>`; }
    });
    ov.querySelector("#csv-close").onclick = closeModal;
}

// ---------------- לשונית דוח פער ----------------
export async function renderGapTab(container) {
    const counts = await dbGetAll("inventoryCounts");
    const dates = [...new Set(counts.map((c) => c.count_date))].sort();
    const to0 = dates.length ? dates[dates.length - 1] : todayIso();
    const from0 = dates.length > 1 ? dates[dates.length - 2] : addDays(to0, -7);
    container.innerHTML = `
        <div class="hint" style="margin-bottom:8px;">משווה את מה שירד בפועל מהמלאי (ספירה בתחילת התקופה + קניות - ספירה בסופה) למה שהמכירות והפחת מסבירים. פער חיובי = ירד יותר ממה שמוסבר (בזבוז, מנות גדולות, טעות בספירה או גניבה). כדי שהדוח יעבוד צריך ספירה בתחילת התקופה ובסופה.</div>
        <div class="card">
            <div class="form-row"><div class="field"><label>מתאריך (ספירה)</label><input type="date" id="gp-from" value="${from0}"></div>
            <div class="field"><label>עד תאריך (ספירה)</label><input type="date" id="gp-to" value="${to0}"></div></div>
            <button type="button" class="btn btn-primary btn-block" id="gp-go">חשב דוח פער</button>
            <div class="error-msg" id="gp-err"></div>
        </div>
        <div id="gp-out"></div>`;
    const out = container.querySelector("#gp-out");
    container.querySelector("#gp-go").onclick = busy(async () => {
        const err = container.querySelector("#gp-err");
        err.style.display = "none";
        out.innerHTML = "";
        try {
            const r = await buildGapReport(container.querySelector("#gp-from").value, container.querySelector("#gp-to").value);
            const t = r.totals;
            const pct = (v) => (v == null ? "—" : `${v}%`);
            out.innerHTML = `
                <div class="card">
                    <div class="card-row"><span>הכנסה ממכירות (לפני מע"מ)</span><b>${money(t.revenue)}</b></div>
                    <div class="card-row"><span>עלות מזון תיאורטית</span><b>${money(t.theoreticalCost)} · ${pct(t.theoreticalPct)}</b></div>
                    <div class="card-row"><span>עלות מזון בפועל</span><b>${money(t.actualCost)} · ${pct(t.actualPct)}</b></div>
                    <div class="card-row"><span>פער (בפועל פחות תיאורטי)</span><b style="color:${t.gapValue > 0.5 ? "var(--danger)" : t.gapValue < -0.5 ? "var(--ok)" : "inherit"};">${t.gapValue > 0 ? "+" : ""}${money(t.gapValue)}</b></div>
                </div>
                ${!r.salesCount ? '<div class="hint-warn">לא דווחו מכירות בתקופה הזאת, ולכן העלות התיאורטית היא אפס. הזן מכירות בלשונית "מכירות".</div>' : ""}
                ${t.unpricedLines ? `<div class="hint-warn">${t.unpricedLines} שורות מכירה בלי מחיר ידוע (מתכון שנמכר ישירות או מנה שנמחקה) לא נכללו בהכנסה.</div>` : ""}
                ${r.missing.length ? `<div class="hint">${r.missing.length} מוצרים בלי ספירה בתחילת התקופה ובסופה לא נכללו בדוח.</div>` : ""}
                ${r.rows.length ? `<div class="card-title" style="margin:12px 4px 4px;">הפערים הגדולים ${info("לכל מוצר: כמה ירד בפועל, כמה מוסבר במכירות ובפחת, והפער בכסף לפי מחיר הקנייה.")}</div>
                <div class="tablewrap" style="overflow-x:auto;"><table class="simple"><thead><tr><th>מוצר</th><th>בפועל</th><th>מוסבר</th><th>פער</th><th>שווי</th></tr></thead><tbody>
                ${r.rows.slice(0, 25).map((x) => `<tr><td>${escapeHtml(x.name)}</td><td>${x.actual} ${unitWord(x.unit_type)}</td><td>${x.theoretical}</td><td>${x.gap > 0 ? "+" : ""}${x.gap}</td><td style="color:${x.gapValue > 0.5 ? "var(--danger)" : x.gapValue < -0.5 ? "var(--ok)" : "inherit"};">${x.gapValue > 0 ? "+" : ""}${money(x.gapValue)}</td></tr>`).join("")}
                </tbody></table></div>` : '<div class="empty-state">אין מוצרים עם שתי ספירות בתקופה. ספור מלאי בתחילת התקופה ובסופה (מזווה, לשונית "ספירה").</div>'}`;
        } catch (e) { err.textContent = e.message; err.style.display = "block"; }
    });
}
