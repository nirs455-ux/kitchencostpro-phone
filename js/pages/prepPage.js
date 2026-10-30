// מיז אן פלאס ומשימות: תפריט (מנות מהמערכת + פריטים ידניים) x כמה מנות לסועד x מספר סועדים
// -> רשימת משימות הכנה ורשימת הזמנות לפי ספק, עם סימון "בוצע". התוכניות נשמרות (prepPlansRepo.js). החישוב ב-prepPlan.js (טהור).
import { toast, escapeHtml, info, confirmDialog, openModal, closeModal } from "../ui.js";
import { enhanceSelect } from "../picker.js";
import { dbGetAll } from "../db.js";
import { loadSalesCtx } from "../repo/salesRepo.js";
import { planPrep, groupBySupplier, entryQuantity, DEFAULT_MARGIN_PCT } from "../prepPlan.js";
import { qtyText, orderText, whatsappUrl } from "../shareText.js";
import { checklistText, checklistHtml } from "../prepChecklist.js";
import { listPlans, savePlans, upsertPlan, removePlan, normalizePlan, progress, todayIso } from "../repo/prepPlansRepo.js";

const fmt = (n) => +Number(n).toFixed(2);
const shortDate = (d) => { const [y, m, day] = String(d || "").split("-"); return day ? `${parseInt(day, 10)}.${parseInt(m, 10)}` : ""; };
const planLabel = (p) => `${p.name || "תוכנית"} · ${shortDate(p.date)}`;
let currentId = null; // התוכנית הפתוחה (נשמר בין מעברי מסכים)

export async function renderPrepTab(container) {
    const [ctx, suppliers] = await Promise.all([loadSalesCtx(), dbGetAll("suppliers")]);
    let plans = await listPlans();
    const supplierOptions = (sel) => [...suppliers].sort((a, b) => a.name.localeCompare(b.name, "he")).map((s) => `<option value="${s.id}"${s.id === sel ? " selected" : ""}>${escapeHtml(s.name)}</option>`).join("");
    const dishes = [...ctx.dishes.values()].sort((a, b) => a.name.localeCompare(b.name, "he"));
    if (!dishes.length) { container.innerHTML = '<div class="empty-state">כדי לתכנן צריך קודם להוסיף מנות בלשונית "מנות".</div>'; return; }

    let plan = plans.find((p) => p.id === currentId) || plans[0] || normalizePlan({ margin: String(DEFAULT_MARGIN_PCT) });
    currentId = plan.id;
    const isBlank = (p) => !p.rows.length && !p.custom.length && !p.guests && !p.name;
    const persist = async () => {
        if (isBlank(plan)) return;
        plans = upsertPlan(plans, plan);
        plan = plans[0];
        await savePlans(plans);
    };

    container.innerHTML = `
        <div class="hint" style="margin-bottom:8px;">בונים תפריט ממנות המערכת, קובעים כמה מנות מקבל כל סועד, ומזינים כמה סועדים. גודל המנה נלקח מהתמחור. האפליקציה אומרת מה להכין ומה להזמין מכל ספק, כולל ניצולת ומרווח ביטחון. אפשר לסמן ✓ כל משימה שבוצעה. הכול נשמר.</div>
        <div class="card">
            <div class="form-row">
                <div class="field"><label>תוכנית</label><select id="pp-plan"></select></div>
                <div class="field" style="align-self:end;"><div class="btn-row"><button type="button" class="btn btn-secondary btn-small" id="pp-new">＋ חדשה</button><button type="button" class="btn btn-secondary btn-small" id="pp-del">מחק</button></div></div>
            </div>
            <div class="form-row">
                <div class="field"><label>שם</label><input type="text" id="pp-name" placeholder="למשל: אירוע שישי"></div>
                <div class="field"><label>תאריך</label><input type="date" id="pp-date"></div>
            </div>
            <div class="form-row">
                <div class="field"><label>מספר סועדים</label><input type="text" inputmode="numeric" id="pp-guests" placeholder="80"></div>
                <div class="field"><label>מרווח ביטחון % ${info("תוספת על הכמות המחושבת, כדי לא להישאר בלי. בבופה כדאי 10-15. תבלינים לא תמיד גדלים ביחס ישר, לכן אפשר להוריד.")}</label><input type="text" inputmode="decimal" id="pp-margin"></div>
            </div>
        </div>
        <div class="card">
            <div class="field"><label>מנה</label><select id="pp-item"><option value="">בחר מנה...</option>${dishes.map((d) => `<option value="dish:${d.id}">${escapeHtml(d.name)}</option>`).join("")}</select></div>
            <div class="field"><label>כמה מנות לכל סועד ${info("ברירת המחדל היא מנה אחת, לפי גודל המנה בתמחור. אפשר לכתוב חצי מנה או מנה וחצי.")}</label><input type="text" inputmode="decimal" id="pp-per" value="1"></div>
            <button type="button" class="btn btn-secondary btn-block" id="pp-add">＋ הוסף לתפריט</button>
            <div class="error-msg" id="pp-err"></div>
        </div>
        <div class="card">
            <div class="card-title" style="margin:0 0 6px;">פריט ידני ${info("מנה שאין במערכת, או משימה לאותו אירוע. הכמות היא טקסט חופשי. הפריט מופיע בצ'ק ליסט, בהדפסה ובוואטסאפ.")}</div>
            <div class="form-row">
                <div class="field"><label>שם</label><input type="text" id="pc-label" placeholder="למשל: סלט קינואה"></div>
                <div class="field"><label>כמות</label><input type="text" id="pc-qty" placeholder="למשל: 3 מגשים"></div>
            </div>
            <div class="field"><label>סוג</label><select id="pc-kind"><option value="prep">להכין</option><option value="order">להזמין</option></select></div>
            <div class="field" id="pc-sup-wrap" style="display:none;"><label>ספק</label><select id="pc-sup"><option value="">ללא ספק קבוע</option>${supplierOptions()}</select></div>
            <button type="button" class="btn btn-secondary btn-block" id="pc-add">＋ הוסף פריט ידני</button>
            <div class="error-msg" id="pc-err"></div>
        </div>
        <div id="pp-menu"></div>
        <div id="pp-result"></div>`;

    const q = (s) => container.querySelector(s);
    const itemEl = q("#pp-item");
    for (const id of ["#pp-plan", "#pp-item", "#pc-kind", "#pc-sup"]) enhanceSelect(q(id));

    function loadFields() {
        q("#pp-name").value = plan.name; q("#pp-date").value = plan.date; q("#pp-guests").value = plan.guests; q("#pp-margin").value = plan.margin;
        const sel = q("#pp-plan");
        const list = plans.some((p) => p.id === plan.id) ? plans : [plan, ...plans];
        sel.innerHTML = list.map((p) => `<option value="${escapeHtml(p.id)}"${p.id === plan.id ? " selected" : ""}>${escapeHtml(plans.some((x) => x.id === p.id) ? planLabel(p) : "תוכנית חדשה")}</option>`).join("");
        if (sel.refreshPicker) sel.refreshPicker();
    }
    const bind = (sel, key) => { q(sel).oninput = async (e) => { plan[key] = e.target.value; draw(); await persist(); }; };
    bind("#pp-name", "name"); bind("#pp-date", "date"); bind("#pp-guests", "guests"); bind("#pp-margin", "margin");
    q("#pp-date").onchange = q("#pp-date").oninput;
    q("#pp-plan").onchange = (e) => { plan = plans.find((p) => p.id === e.target.value) || plan; currentId = plan.id; loadFields(); draw(); };
    q("#pp-new").onclick = () => { plan = normalizePlan({ margin: plan.margin }); currentId = plan.id; loadFields(); draw(); };
    q("#pp-del").onclick = async () => {
        if (!plans.some((p) => p.id === plan.id)) { plan = normalizePlan({ margin: plan.margin }); currentId = plan.id; loadFields(); draw(); return; }
        if (!(await confirmDialog(`למחוק את התוכנית "${escapeHtml(plan.name || "ללא שם")}"?`))) return;
        plans = removePlan(plans, plan.id);
        await savePlans(plans);
        plan = plans[0] || normalizePlan({ margin: plan.margin });
        currentId = plan.id; loadFields(); draw();
    };
    q("#pp-add").onclick = async () => {
        const err = q("#pp-err"); err.style.display = "none";
        const [type, idStr] = String(itemEl.value).split(":");
        const src = type === "dish" ? ctx.dishes.get(Number(idStr)) : ctx.recipes.get(Number(idStr));
        if (!src) { err.textContent = "בחר פריט מהתפריט."; err.style.display = "block"; return; }
        if (!(entryQuantity(1, q("#pp-per").value, "100") > 0)) { err.textContent = "הזן כמה מנות לכל סועד, יותר מאפס."; err.style.display = "block"; return; }
        plan.rows.push({ source_type: type, source_id: Number(idStr), name: src.name, per: q("#pp-per").value, share: "100" });
        itemEl.value = ""; q("#pp-per").value = "1"; itemEl.refreshPicker();
        draw(); await persist(); loadFields();
    };

    q("#pc-kind").onchange = () => { q("#pc-sup-wrap").style.display = q("#pc-kind").value === "order" ? "" : "none"; };
    q("#pc-add").onclick = async () => {
        const err = q("#pc-err"); err.style.display = "none";
        const label = q("#pc-label").value.trim();
        if (!label) { err.textContent = "הזן שם לפריט."; err.style.display = "block"; return; }
        const kind = q("#pc-kind").value === "order" ? "order" : "prep";
        const sid = Number(q("#pc-sup").value);
        plan.custom.push({ id: `c${Date.now().toString(36)}${plan.custom.length}`, kind, label, qty: q("#pc-qty").value.trim(), supplier_id: kind === "order" && Number.isFinite(sid) && sid > 0 ? sid : null });
        q("#pc-label").value = ""; q("#pc-qty").value = "";
        draw(); await persist(); loadFields();
    };

    // שורת משימה: תיבת סימון, שם, כמות, וכפתור ✎ (שינוי כמות מחושבת, או עריכת פריט ידני)
    const check = (key, label, right, o = {}) => `<div class="card-row pp-task" style="gap:6px;align-items:center;${plan.done[key] ? "opacity:.55;text-decoration:line-through;" : ""}"><label style="display:flex;gap:8px;align-items:center;flex:1;min-width:0;cursor:pointer;"><input type="checkbox" data-k="${key}"${plan.done[key] ? " checked" : ""} style="width:22px;height:22px;flex:none;"><span style="flex:1;">${label}</span><b>${right}</b></label>${o.cidx != null && o.cidx >= 0 ? `<button type="button" class="btn btn-secondary btn-small" data-cedit="${o.cidx}">✎</button>` : o.name ? `<button type="button" class="btn btn-secondary btn-small" data-qedit="${key}" data-name="${escapeHtml(o.name)}" data-cur="${escapeHtml(o.cur)}">✎</button>` : ""}</div>`;

    function draw() {
        const menuEl = q("#pp-menu"), resEl = q("#pp-result");
        const supName = (id) => (suppliers.find((s) => s.id === id) || {}).name || "";
        menuEl.innerHTML = (plan.rows.length ? `<div class="card-title" style="margin:10px 4px 4px;">התפריט</div>` + plan.rows.map((r, i) => {
            const qty = entryQuantity(plan.guests, r.per, r.share);
            return `<div class="card-row" style="padding:6px 4px;border-bottom:1px solid var(--border,#0001);"><span><b>${escapeHtml(r.name)}</b><br><span class="muted">${escapeHtml(String(r.per))} ${r.source_type === "recipe" ? "גרם" : "מנות"} לסועד${String(r.share) !== "100" ? ` · ${escapeHtml(String(r.share))}%` : ""} · ${qty ? `סה"כ ${r.source_type === "recipe" ? qtyText(qty) : fmt(qty) + " מנות"}` : "הזן סועדים"}</span></span><button type="button" class="btn btn-secondary btn-small" data-rm="${i}">✕</button></div>`;
        }).join("") : "") + (plan.custom.length ? `<div class="card-title" style="margin:10px 4px 4px;">פריטים ידניים</div>` + plan.custom.map((c, i) => `<div class="card-row" style="padding:6px 4px;border-bottom:1px solid var(--border,#0001);"><span><b>${escapeHtml(c.label)}</b><br><span class="muted">${c.kind === "order" ? "להזמין" + (c.supplier_id && supName(c.supplier_id) ? " · " + escapeHtml(supName(c.supplier_id)) : "") : "להכין"}${c.qty ? " · " + escapeHtml(c.qty) : ""}</span></span><span><button type="button" class="btn btn-secondary btn-small" data-cedit="${i}">✎</button> <button type="button" class="btn btn-secondary btn-small" data-crm="${i}">✕</button></span></div>`).join("") : "");
        menuEl.querySelectorAll("[data-rm]").forEach((b) => { b.onclick = async () => { plan.rows.splice(Number(b.dataset.rm), 1); draw(); await persist(); }; });
        menuEl.querySelectorAll("[data-crm]").forEach((b) => { b.onclick = async () => { const [gone] = plan.custom.splice(Number(b.dataset.crm), 1); if (gone) { delete plan.done["c" + gone.id]; } draw(); await persist(); }; });
        menuEl.querySelectorAll("[data-cedit]").forEach((b) => { b.onclick = () => editCustom(Number(b.dataset.cedit)); });

        const entries = plan.rows.map((r) => ({ source_type: r.source_type, source_id: r.source_id, quantity: entryQuantity(plan.guests, r.per, r.share) })).filter((e) => e.quantity > 0);
        const customPrep = plan.custom.filter((c) => c.kind === "prep"), customOrder = plan.custom.filter((c) => c.kind === "order");
        if (!entries.length && !plan.custom.length) { resEl.innerHTML = plan.rows.length ? '<div class="empty-state">הזן מספר סועדים כדי לראות מה להכין ולהזמין.</div>' : ""; return; }
        const result = entries.length ? planPrep(entries, ctx, plan.margin) : { dishes: [], recipes: {}, pantry: {}, foodGrams: 0 };
        const prepRecipes = Object.entries(result.recipes).map(([id, g]) => ({ id, name: (ctx.recipes.get(Number(id)) || {}).name || "?", g })).sort((a, b) => a.name.localeCompare(b.name, "he"));

        // הזמנות: חישוב לפי ספק + פריטים ידניים שנבחר להם ספק (מצטרפים להזמנה של אותו ספק); בלי ספק -> כרטיס "הוספות ידניות"
        const groups = groupBySupplier(result.pantry, ctx.pantry, suppliers).map((g) => ({ ...g, extras: [] }));
        const loose = [];
        for (const c of customOrder) {
            const sup = c.supplier_id ? suppliers.find((s) => s.id === c.supplier_id) : null;
            if (!sup) { loose.push(c); continue; }
            let g = groups.find((x) => x.supplier && x.supplier.id === sup.id);
            if (!g) { g = { supplier: sup, lines: [], extras: [] }; groups.push(g); }
            g.extras.push(c);
        }
        groups.sort((a, b) => (a.supplier ? 0 : 1) - (b.supplier ? 0 : 1) || String(a.supplier && a.supplier.name).localeCompare(String(b.supplier && b.supplier.name), "he"));

        const prepKeys = [...result.dishes.map((d) => `d${d.id}`), ...prepRecipes.map((r) => `r${r.id}`), ...customPrep.map((c) => `c${c.id}`)];
        const orderKeys = [...groups.flatMap((g) => [...g.lines.map((l) => `o${l.id}`), ...g.extras.map((c) => `c${c.id}`)]), ...loose.map((c) => `c${c.id}`)];
        const pp = progress(prepKeys, plan.done), po = progress(orderKeys, plan.done);
        const cell = (key, html) => (plan.overrides[key] ? `${escapeHtml(plan.overrides[key])} <span class="muted">· שונתה</span>` : html);
        const customRow = (c) => check(`c${c.id}`, `✏️ ${escapeHtml(c.label)}`, escapeHtml(c.qty), { cidx: plan.custom.indexOf(c) });

        resEl.innerHTML = `
            ${prepKeys.length ? `<div class="card-title" style="margin:14px 4px 4px;">מה להכין <span class="muted">· בוצעו ${pp.finished} מתוך ${pp.total}</span> ${info("כמויות כולל מרווח הביטחון. מתכון שמשמש כמה מנות מוצג פעם אחת, מחושב מסך הצריכה. ✎ משנה כמות.")}</div>
            <div class="card">
                ${result.dishes.map((d) => check(`d${d.id}`, `🍽️ ${escapeHtml(d.name)}`, cell(`d${d.id}`, `${d.portions} מנות`), { name: d.name, cur: `${d.portions} מנות` })).join("")}
                ${prepRecipes.map((r) => check(`r${r.id}`, `📖 ${escapeHtml(r.name)}`, cell(`r${r.id}`, qtyText(r.g)), { name: r.name, cur: qtyText(r.g) })).join("")}
                ${customPrep.map(customRow).join("")}
                <div class="btn-row" style="margin-top:8px;"><button type="button" class="btn btn-secondary btn-small" id="pp-print">🖨️ הדפס צ'ק ליסט</button><button type="button" class="btn btn-secondary btn-small" id="pp-wa">📤 שלח בוואטסאפ</button></div>
            </div>` : ""}
            ${orderKeys.length ? `<div class="card-title" style="margin:14px 4px 4px;">מה להזמין <span class="muted">· הוזמנו ${po.finished} מתוך ${po.total}</span> ${info("מחולק לפי רשימת ההזמנה הקבועה של כל ספק, ופריטים ידניים שנבחר להם ספק מצטרפים אליו. כמויות מעוגלות כלפי מעלה, ואריזות שלמות כשהספק מוכר בארגז. ✎ משנה כמות.")}</div>` : ""}
            ${groups.map((g, gi) => `<div class="card">
                <div class="card-row"><b>${g.supplier ? escapeHtml(g.supplier.name) : "ללא ספק קבוע"}</b>${g.supplier ? `<button type="button" class="btn btn-secondary btn-small" data-copy="${gi}">העתק</button>` : ""}</div>
                ${g.lines.map((l) => check(`o${l.id}`, escapeHtml(l.name), cell(`o${l.id}`, lineQty(l)), { name: l.name, cur: lineQty(l, true) })).join("")}
                ${g.extras.map(customRow).join("")}
            </div>`).join("")}
            ${loose.length ? `<div class="card"><div class="card-row"><b>הוספות ידניות</b></div>${loose.map(customRow).join("")}</div>` : ""}`;

        resEl.querySelectorAll("input[data-k]").forEach((c) => { c.onchange = async () => { if (c.checked) plan.done[c.dataset.k] = true; else delete plan.done[c.dataset.k]; draw(); await persist(); }; });
        resEl.querySelectorAll("[data-qedit]").forEach((b) => { b.onclick = () => editQty(b.dataset.qedit, b.dataset.name, b.dataset.cur); });
        resEl.querySelectorAll("[data-cedit]").forEach((b) => { b.onclick = () => editCustom(Number(b.dataset.cedit)); });
        const ov = (key, fallback) => plan.overrides[key] || fallback;
        const taskLines = [...result.dishes.map((d) => ({ label: d.name, qty: ov("d" + d.id, d.portions + " מנות"), done: !!plan.done["d" + d.id] })), ...prepRecipes.map((r) => ({ label: r.name, qty: ov("r" + r.id, qtyText(r.g)), done: !!plan.done["r" + r.id] })), ...customPrep.map((c) => ({ label: c.label, qty: c.qty, done: !!plan.done["c" + c.id] }))];
        const head = { title: plan.name || "מיז אן פלאס", date: plan.date, guests: plan.guests };
        const printBtn = resEl.querySelector("#pp-print"), waBtn = resEl.querySelector("#pp-wa");
        if (printBtn) printBtn.onclick = () => {
            const url = URL.createObjectURL(new Blob([checklistHtml(head, taskLines)], { type: "text/html;charset=utf-8" }));
            if (!window.open(url, "_blank")) toast("הדפדפן חסם את פתיחת הדף. אפשר חלונות קופצים לאתר ונסה שוב.");
            setTimeout(() => URL.revokeObjectURL(url), 120000);
        };
        if (waBtn) waBtn.onclick = () => { if (!window.open(whatsappUrl(checklistText(head, taskLines)), "_blank")) toast("הדפדפן חסם את פתיחת הדף. אפשר חלונות קופצים לאתר ונסה שוב."); };
        resEl.querySelectorAll("[data-copy]").forEach((b) => {
            b.onclick = async () => {
                const g = groups[Number(b.dataset.copy)];
                const lines = [...g.lines.map((l) => ({ name: l.name, qty: ov("o" + l.id, lineQty(l, true)) })), ...g.extras.map((c) => ({ name: c.label, qty: c.qty }))];
                const text = orderText(g.supplier.name, new Date().toLocaleDateString("he-IL"), lines);
                try { await navigator.clipboard.writeText(text); toast("ההזמנה הועתקה"); } catch (e) { toast("לא הצלחתי להעתיק"); }
            };
        });
    }

    // שינוי כמות של משימה/שורת הזמנה שחושבה: טקסט חופשי שמחליף את החישוב (בהדפסה, בוואטסאפ ובהעתקה). אפשר לחזור לחישוב
    function editQty(key, name, cur) {
        const ovl = openModal(`<h2>${escapeHtml(name)}</h2>
            <div class="hint" style="margin-bottom:6px;">הכמות שחושבה: <b>${escapeHtml(cur)}</b>. אפשר לכתוב כמות אחרת, והיא תופיע בצ'ק ליסט, בהדפסה ובהעתקה.</div>
            <div class="field"><input type="text" id="eq-val" value="${escapeHtml(plan.overrides[key] || cur)}"></div>
            <div class="modal-actions"><button type="button" class="btn btn-secondary" id="eq-cancel">ביטול</button>${plan.overrides[key] ? '<button type="button" class="btn btn-secondary" id="eq-reset">חזור לחישוב</button>' : ""}<button type="button" class="btn btn-primary" id="eq-save">שמירה</button></div>`);
        const done = async () => { closeModal(); draw(); await persist(); };
        ovl.querySelector("#eq-cancel").onclick = closeModal;
        const rs = ovl.querySelector("#eq-reset");
        if (rs) rs.onclick = () => { delete plan.overrides[key]; done(); };
        ovl.querySelector("#eq-save").onclick = () => { const v = ovl.querySelector("#eq-val").value.trim(); if (!v || v === cur) delete plan.overrides[key]; else plan.overrides[key] = v; done(); };
    }

    // עריכת פריט ידני: שם, כמות, סוג וספק
    function editCustom(i) {
        const c = plan.custom[i];
        if (!c) return;
        const ovl = openModal(`<h2>עריכת פריט ידני</h2>
            <div class="field"><label>שם</label><input type="text" id="ec-label" value="${escapeHtml(c.label)}"></div>
            <div class="field"><label>כמות</label><input type="text" id="ec-qty" value="${escapeHtml(c.qty)}"></div>
            <div class="field"><label>סוג</label><select id="ec-kind"><option value="prep"${c.kind === "prep" ? " selected" : ""}>להכין</option><option value="order"${c.kind === "order" ? " selected" : ""}>להזמין</option></select></div>
            <div class="field" id="ec-sup-wrap"><label>ספק</label><select id="ec-sup"><option value="">ללא ספק קבוע</option>${supplierOptions(c.supplier_id)}</select></div>
            <div class="error-msg" id="ec-err"></div>
            <div class="modal-actions"><button type="button" class="btn btn-secondary" id="ec-cancel">ביטול</button><button type="button" class="btn btn-danger" id="ec-del">מחיקה</button><button type="button" class="btn btn-primary" id="ec-save">שמירה</button></div>`);
        enhanceSelect(ovl.querySelector("#ec-kind")); enhanceSelect(ovl.querySelector("#ec-sup"));
        const sync = () => { ovl.querySelector("#ec-sup-wrap").style.display = ovl.querySelector("#ec-kind").value === "order" ? "" : "none"; };
        ovl.querySelector("#ec-kind").onchange = sync; sync();
        const done = async () => { closeModal(); draw(); await persist(); };
        ovl.querySelector("#ec-cancel").onclick = closeModal;
        ovl.querySelector("#ec-del").onclick = () => { plan.custom.splice(i, 1); delete plan.done["c" + c.id]; done(); };
        ovl.querySelector("#ec-save").onclick = () => {
            const label = ovl.querySelector("#ec-label").value.trim();
            if (!label) { const e = ovl.querySelector("#ec-err"); e.textContent = "הזן שם לפריט."; e.style.display = "block"; return; }
            const kind = ovl.querySelector("#ec-kind").value === "order" ? "order" : "prep";
            const sid = Number(ovl.querySelector("#ec-sup").value);
            Object.assign(c, { label, qty: ovl.querySelector("#ec-qty").value.trim(), kind, supplier_id: kind === "order" && Number.isFinite(sid) && sid > 0 ? sid : null });
            done();
        };
    }
    loadFields();
    draw();
}

function lineQty(l, plain = false) {
    const base = `${fmt(l.units)} ${l.unit}`;
    return l.pack ? `${l.pack.count} ארגזים/אריזות${plain ? ` (${base})` : `<br><span class="muted">${base}</span>`}` : base;
}
