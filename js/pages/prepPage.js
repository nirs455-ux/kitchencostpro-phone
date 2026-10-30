// מיז אן פלאס ומשימות: תפריט (מנות או מתכונים) x כמות ממוצעת לסועד x מספר סועדים
// -> רשימת משימות הכנה ורשימת הזמנות לפי ספק, עם סימון "בוצע". התוכניות נשמרות (prepPlansRepo.js). החישוב ב-prepPlan.js (טהור).
import { toast, escapeHtml, info, confirmDialog } from "../ui.js";
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
    const dishes = [...ctx.dishes.values()].sort((a, b) => a.name.localeCompare(b.name, "he"));
    const recipes = [...ctx.recipes.values()].filter((r) => r.status !== "draft").sort((a, b) => a.name.localeCompare(b.name, "he"));
    if (!dishes.length && !recipes.length) { container.innerHTML = '<div class="empty-state">כדי לתכנן צריך קודם להוסיף מנות בלשונית "מנות".</div>'; return; }

    let plan = plans.find((p) => p.id === currentId) || plans[0] || normalizePlan({ margin: String(DEFAULT_MARGIN_PCT) });
    currentId = plan.id;
    const isBlank = (p) => !p.rows.length && !p.guests && !p.name;
    const persist = async () => {
        if (isBlank(plan)) return;
        plans = upsertPlan(plans, plan);
        plan = plans[0];
        await savePlans(plans);
    };

    container.innerHTML = `
        <div class="hint" style="margin-bottom:8px;">בוחרים מנות מהתפריט, כמה מכל מנה בממוצע לסועד, וכמה סועדים. האפליקציה אומרת מה להכין ומה להזמין מכל ספק (כולל ניצולת ומרווח ביטחון), ואפשר לסמן ✓ כל משימה שבוצעה. הכול נשמר.</div>
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
            <div class="field"><label>פריט מהתפריט</label><select id="pp-item"><option value="">בחר מנה...</option>
                ${dishes.length ? `<optgroup label="מנות">${dishes.map((d) => `<option value="dish:${d.id}">${escapeHtml(d.name)}</option>`).join("")}</optgroup>` : ""}
                ${recipes.length ? `<optgroup label="מתכון (בגרם)">${recipes.map((r) => `<option value="recipe:${r.id}">${escapeHtml(r.name)}</option>`).join("")}</optgroup>` : ""}</select></div>
            <div class="form-row">
                <div class="field"><label id="pp-per-label">מנות לסועד</label><input type="text" inputmode="decimal" id="pp-per" value="1"></div>
                <div class="field"><label>% מהסועדים שבוחרים</label><input type="text" inputmode="decimal" id="pp-share" value="100"></div>
            </div>
            <button type="button" class="btn btn-secondary btn-block" id="pp-add">＋ הוסף לתפריט</button>
            <div class="error-msg" id="pp-err"></div>
        </div>
        <div id="pp-menu"></div>
        <div id="pp-result"></div>`;

    const q = (s) => container.querySelector(s);
    const itemEl = q("#pp-item");

    function loadFields() {
        q("#pp-name").value = plan.name; q("#pp-date").value = plan.date; q("#pp-guests").value = plan.guests; q("#pp-margin").value = plan.margin;
        const sel = q("#pp-plan");
        const list = plans.some((p) => p.id === plan.id) ? plans : [plan, ...plans];
        sel.innerHTML = list.map((p) => `<option value="${escapeHtml(p.id)}"${p.id === plan.id ? " selected" : ""}>${escapeHtml(plans.some((x) => x.id === p.id) ? planLabel(p) : "תוכנית חדשה")}</option>`).join("");
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
    itemEl.onchange = () => { const isR = itemEl.value.startsWith("recipe:"); q("#pp-per-label").textContent = isR ? "גרם לסועד" : "מנות לסועד"; q("#pp-per").value = isR ? "100" : "1"; };
    q("#pp-add").onclick = async () => {
        const err = q("#pp-err"); err.style.display = "none";
        const [type, idStr] = String(itemEl.value).split(":");
        const src = type === "dish" ? ctx.dishes.get(Number(idStr)) : ctx.recipes.get(Number(idStr));
        if (!src) { err.textContent = "בחר פריט מהתפריט."; err.style.display = "block"; return; }
        if (!(entryQuantity(1, q("#pp-per").value, q("#pp-share").value) > 0)) { err.textContent = "הזן כמות לסועד ואחוז גדולים מ-0."; err.style.display = "block"; return; }
        plan.rows.push({ source_type: type, source_id: Number(idStr), name: src.name, per: q("#pp-per").value, share: q("#pp-share").value });
        itemEl.value = ""; itemEl.onchange();
        draw(); await persist(); loadFields();
    };

    const check = (key, label, right) => `<label class="card-row pp-task" style="gap:8px;align-items:center;${plan.done[key] ? "opacity:.55;text-decoration:line-through;" : ""}"><input type="checkbox" data-k="${key}"${plan.done[key] ? " checked" : ""} style="width:22px;height:22px;flex:none;"><span style="flex:1;">${label}</span><b>${right}</b></label>`;

    function draw() {
        const menuEl = q("#pp-menu"), resEl = q("#pp-result");
        menuEl.innerHTML = plan.rows.length ? `<div class="card-title" style="margin:10px 4px 4px;">התפריט</div>` + plan.rows.map((r, i) => {
            const qty = entryQuantity(plan.guests, r.per, r.share);
            return `<div class="card-row" style="padding:6px 4px;border-bottom:1px solid var(--border,#0001);"><span><b>${escapeHtml(r.name)}</b><br><span class="muted">${escapeHtml(String(r.per))} ${r.source_type === "recipe" ? "גרם" : "מנות"} לסועד · ${escapeHtml(String(r.share))}% · ${qty ? `סה"כ ${r.source_type === "recipe" ? qtyText(qty) : fmt(qty) + " מנות"}` : "הזן סועדים"}</span></span><button type="button" class="btn btn-secondary btn-small" data-rm="${i}">✕</button></div>`;
        }).join("") : "";
        menuEl.querySelectorAll("[data-rm]").forEach((b) => { b.onclick = async () => { plan.rows.splice(Number(b.dataset.rm), 1); draw(); await persist(); }; });

        const entries = plan.rows.map((r) => ({ source_type: r.source_type, source_id: r.source_id, quantity: entryQuantity(plan.guests, r.per, r.share) })).filter((e) => e.quantity > 0);
        if (!entries.length) { resEl.innerHTML = plan.rows.length ? '<div class="empty-state">הזן מספר סועדים כדי לראות מה להכין ולהזמין.</div>' : ""; return; }
        const result = planPrep(entries, ctx, plan.margin);
        const groups = groupBySupplier(result.pantry, ctx.pantry, suppliers);
        const prepRecipes = Object.entries(result.recipes).map(([id, g]) => ({ id, name: (ctx.recipes.get(Number(id)) || {}).name || "?", g })).sort((a, b) => a.name.localeCompare(b.name, "he"));
        const perGuest = Number(plan.guests) > 0 ? Math.round(result.foodGrams / Number(plan.guests)) : 0;
        const prepKeys = [...result.dishes.map((d) => `d${d.id}`), ...prepRecipes.map((r) => `r${r.id}`)];
        const orderKeys = groups.flatMap((g) => g.lines.map((l) => `o${l.id}`));
        const pp = progress(prepKeys, plan.done), po = progress(orderKeys, plan.done);

        resEl.innerHTML = `
            <div class="card-title" style="margin:14px 4px 4px;">מה להכין <span class="muted">· בוצעו ${pp.finished} מתוך ${pp.total}</span> ${info("כמויות כולל מרווח הביטחון. מתכון שמשמש כמה מנות מוצג פעם אחת, מחושב מסך הצריכה.")}</div>
            <div class="card">
                ${result.dishes.map((d) => check(`d${d.id}`, `🍽️ ${escapeHtml(d.name)}`, `${d.portions} מנות`)).join("")}
                ${prepRecipes.map((r) => check(`r${r.id}`, `📖 ${escapeHtml(r.name)}`, qtyText(r.g))).join("")}
                <div class="btn-row" style="margin-top:8px;"><button type="button" class="btn btn-secondary btn-small" id="pp-print">🖨️ הדפס צ'ק ליסט</button><button type="button" class="btn btn-secondary btn-small" id="pp-wa">📤 שלח בוואטסאפ</button></div>
                <div class="muted" style="margin-top:6px;">כמות מזון מוגשת (בלי מרווח): ${qtyText(result.foodGrams)}${perGuest ? ` · כ-${perGuest} גרם לסועד` : ""}</div>
            </div>
            <div class="card-title" style="margin:14px 4px 4px;">מה להזמין <span class="muted">· הוזמנו ${po.finished} מתוך ${po.total}</span> ${info("מחולק לפי רשימת ההזמנה הקבועה של כל ספק. מוצר שלא ברשימה של אף ספק מופיע בנפרד. כמויות מעוגלות כלפי מעלה, ואריזות שלמות כשהספק מוכר בארגז.")}</div>
            ${groups.map((g, gi) => `<div class="card">
                <div class="card-row"><b>${g.supplier ? escapeHtml(g.supplier.name) : "ללא ספק קבוע"}</b>${g.supplier ? `<button type="button" class="btn btn-secondary btn-small" data-copy="${gi}">העתק</button>` : ""}</div>
                ${g.lines.map((l) => check(`o${l.id}`, escapeHtml(l.name), lineQty(l))).join("")}
            </div>`).join("")}`;
        resEl.querySelectorAll("input[data-k]").forEach((c) => { c.onchange = async () => { if (c.checked) plan.done[c.dataset.k] = true; else delete plan.done[c.dataset.k]; draw(); await persist(); }; });
        const taskLines = [...result.dishes.map((d) => ({ label: d.name, qty: d.portions + " מנות", done: !!plan.done["d" + d.id] })), ...prepRecipes.map((r) => ({ label: r.name, qty: qtyText(r.g), done: !!plan.done["r" + r.id] }))];
        const head = { title: plan.name || "מיז אן פלאס", date: plan.date, guests: plan.guests };
        resEl.querySelector("#pp-print").onclick = () => {
            const url = URL.createObjectURL(new Blob([checklistHtml(head, taskLines)], { type: "text/html;charset=utf-8" }));
            if (!window.open(url, "_blank")) toast("הדפדפן חסם את פתיחת הדף. אפשר חלונות קופצים לאתר ונסה שוב.");
            setTimeout(() => URL.revokeObjectURL(url), 120000);
        };
        resEl.querySelector("#pp-wa").onclick = () => { if (!window.open(whatsappUrl(checklistText(head, taskLines)), "_blank")) toast("הדפדפן חסם את פתיחת הדף. אפשר חלונות קופצים לאתר ונסה שוב."); };
        resEl.querySelectorAll("[data-copy]").forEach((b) => {
            b.onclick = async () => {
                const g = groups[Number(b.dataset.copy)];
                const text = orderText(g.supplier.name, new Date().toLocaleDateString("he-IL"), g.lines.map((l) => ({ name: l.name, qty: lineQty(l, true) })));
                try { await navigator.clipboard.writeText(text); toast("ההזמנה הועתקה"); } catch (e) { toast("לא הצלחתי להעתיק"); }
            };
        });
    }
    loadFields();
    draw();
}

function lineQty(l, plain = false) {
    const base = `${fmt(l.units)} ${l.unit}`;
    return l.pack ? `${l.pack.count} ארגזים/אריזות${plain ? ` (${base})` : `<br><span class="muted">${base}</span>`}` : base;
}
