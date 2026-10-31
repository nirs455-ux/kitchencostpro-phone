// תכנון אירוע: שם, תאריך, סועדים ואלרגנים. תפריט של מנות, מתכונים וחומרי גלם מהמערכת, או פריטים ידניים.
// לכל רכיב קובעים כמה גרם מקבל סועד באירוע (בלי קשר לגודל המנה בתמחור). המערכת מחשבת כמויות להכנה, רשימת הזמנות לפי ספק
// ורשימת הכנות, עם סימון "בוצע". התוכניות נשמרות (prepPlansRepo.js). החישוב ב-prepPlan.js (טהור).
import { toast, escapeHtml, info, confirmDialog, openModal, closeModal } from "../ui.js";
import { enhanceSelect } from "../picker.js";
import { dbGetAll } from "../db.js";
import { loadSalesCtx } from "../repo/salesRepo.js";
import { planPrep, groupBySupplier, entryQuantity, allergenCheck, DEFAULT_MARGIN_PCT } from "../prepPlan.js";
import { ALLERGENS } from "../allergens.js";
import { qtyText, orderText, whatsappUrl } from "../shareText.js";
import { checklistText, checklistHtml } from "../prepChecklist.js";
import { listPlans, savePlans, upsertPlan, removePlan, normalizePlan, progress } from "../repo/prepPlansRepo.js";

const fmt = (n) => +Number(n).toFixed(2);
const shortDate = (d) => { const [y, m, day] = String(d || "").split("-"); return day ? `${parseInt(day, 10)}.${parseInt(m, 10)}` : ""; };
const planLabel = (p) => `${p.name || "אירוע"} · ${shortDate(p.date)}`;
let currentId = null; // התוכנית הפתוחה (נשמר בין מעברי מסכים)

export async function renderPrepTab(container) {
    const [ctx, suppliers] = await Promise.all([loadSalesCtx(), dbGetAll("suppliers")]);
    let plans = await listPlans();
    const supplierOptions = (sel) => [...suppliers].sort((a, b) => a.name.localeCompare(b.name, "he")).map((s) => `<option value="${s.id}"${s.id === sel ? " selected" : ""}>${escapeHtml(s.name)}</option>`).join("");

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
        <div class="card">
            <div class="card-title" style="margin:0 0 6px;">תכנון אירוע ${info("בוחרים פריטים מהמערכת או מוסיפים ידנית, וקובעים לכל רכיב כמה גרם מקבל סועד באירוע. האפליקציה מחשבת מה להכין ומה להזמין מכל ספק, כולל ניצולת ומרווח ביטחון. מה שחסר בו מידע מסומן להזנה ידנית. הכול נשמר.")}</div>
            <div class="form-row">
                <div class="field"><label>אירוע</label><select id="pp-plan"></select></div>
                <div class="field" style="align-self:end;"><div class="btn-row"><button type="button" class="btn btn-secondary btn-small" id="pp-new">＋ חדש</button><button type="button" class="btn btn-secondary btn-small" id="pp-del">מחק</button></div></div>
            </div>
            <div class="form-row">
                <div class="field"><label>שם האירוע</label><input type="text" id="pp-name" placeholder="למשל: חתונה של דנה"></div>
                <div class="field"><label>תאריך</label><input type="date" id="pp-date"></div>
            </div>
            <div class="form-row">
                <div class="field"><label>כמות סועדים</label><input type="text" inputmode="numeric" id="pp-guests" placeholder="80"></div>
                <div class="field"><label>מרווח ביטחון באחוזים ${info("תוספת על הכמות המחושבת, כדי לא להישאר בלי. בבופה כדאי עשרה עד חמישה עשר. תבלינים לא תמיד גדלים ביחס ישר, לכן אפשר להוריד.")}</label><input type="text" inputmode="decimal" id="pp-margin"></div>
            </div>
            <div class="field"><label>אלרגנים של הסועדים ${info("מסמנים אלרגנים שיש בין הסועדים. האפליקציה רושמת אותם בתכנון ומזהירה על פריטים בתפריט שמכילים אותם, לפי הגדרות האלרגנים במערכת. פריט ידני ופריט בלי הגדרות לא נבדקים.")}</label><div id="pp-alg" class="btn-row" style="flex-wrap:wrap;"></div></div>
        </div>
        <div class="card">
            <div class="card-title" style="margin:0 0 6px;">תפריט</div>
            <button type="button" class="btn btn-secondary btn-block" id="pp-pick">＋ הוספת פריטים מהמערכת</button>
            <div id="pp-menu"></div>
        </div>
        <div class="card">
            <div class="card-title" style="margin:0 0 6px;">פריט ידני ${info("מנה או משימה שאין במערכת. הכמות היא טקסט חופשי. הפריט מופיע בצ'ק ליסט, בהדפסה ובוואטסאפ.")}</div>
            <div class="form-row">
                <div class="field"><label>שם</label><input type="text" id="pc-label" placeholder="למשל: סלט קינואה"></div>
                <div class="field"><label>כמות</label><input type="text" id="pc-qty" placeholder="למשל: שלושה מגשים"></div>
            </div>
            <div class="field"><label>סוג</label><select id="pc-kind"><option value="prep">להכין</option><option value="order">להזמין</option></select></div>
            <div class="field" id="pc-sup-wrap" style="display:none;"><label>ספק</label><select id="pc-sup"><option value="">ללא ספק קבוע</option>${supplierOptions()}</select></div>
            <button type="button" class="btn btn-secondary btn-block" id="pc-add">＋ הוסף פריט ידני</button>
            <div class="error-msg" id="pc-err"></div>
        </div>
        <div id="pp-result"></div>`;

    const q = (s) => container.querySelector(s);
    for (const id of ["#pp-plan", "#pc-kind", "#pc-sup"]) enhanceSelect(q(id));

    function loadFields() {
        q("#pp-name").value = plan.name; q("#pp-date").value = plan.date; q("#pp-guests").value = plan.guests; q("#pp-margin").value = plan.margin;
        const sel = q("#pp-plan");
        const list = plans.some((p) => p.id === plan.id) ? plans : [plan, ...plans];
        sel.innerHTML = list.map((p) => `<option value="${escapeHtml(p.id)}"${p.id === plan.id ? " selected" : ""}>${escapeHtml(plans.some((x) => x.id === p.id) ? planLabel(p) : "אירוע חדש")}</option>`).join("");
        if (sel.refreshPicker) sel.refreshPicker();
        drawAllergenChips();
    }
    function drawAllergenChips() {
        const box = q("#pp-alg");
        box.innerHTML = ALLERGENS.map((a) => `<button type="button" class="btn btn-small ${plan.allergens.includes(a.key) ? "btn-primary" : "btn-secondary"}" data-ak="${a.key}">${escapeHtml(a.label)}</button>`).join("");
        box.querySelectorAll("[data-ak]").forEach((b) => {
            b.onclick = async () => {
                const k = b.dataset.ak;
                plan.allergens = plan.allergens.includes(k) ? plan.allergens.filter((x) => x !== k) : [...plan.allergens, k];
                drawAllergenChips(); drawResult(); await persist();
            };
        });
    }
    const bind = (sel, key) => { q(sel).oninput = async (e) => { plan[key] = e.target.value; drawMenu(); drawResult(); await persist(); }; };
    bind("#pp-name", "name"); bind("#pp-date", "date"); bind("#pp-guests", "guests"); bind("#pp-margin", "margin");
    q("#pp-date").onchange = q("#pp-date").oninput;
    q("#pp-plan").onchange = (e) => { plan = plans.find((p) => p.id === e.target.value) || plan; currentId = plan.id; loadFields(); draw(); };
    q("#pp-new").onclick = () => { plan = normalizePlan({ margin: plan.margin }); currentId = plan.id; loadFields(); draw(); };
    q("#pp-del").onclick = async () => {
        if (!plans.some((p) => p.id === plan.id)) { plan = normalizePlan({ margin: plan.margin }); currentId = plan.id; loadFields(); draw(); return; }
        if (!(await confirmDialog(`למחוק את האירוע "${escapeHtml(plan.name || "ללא שם")}"?`))) return;
        plans = removePlan(plans, plan.id);
        await savePlans(plans);
        plan = plans[0] || normalizePlan({ margin: plan.margin });
        currentId = plan.id; loadFields(); draw();
    };

    // בחירת פריטים מהמערכת: חלון אחד עם חיפוש וסימון של כמה פריטים יחד. מנה נפתחת לרכיביה, ולכל רכיב כמות משלו
    q("#pp-pick").onclick = () => {
        const byName = (a, b) => a.name.localeCompare(b.name, "he");
        const dishes = [...ctx.dishes.values()].sort(byName);
        const recipes = [...ctx.recipes.values()].sort(byName);
        const products = [...ctx.pantry.values()].filter((p) => !p.parent_id).sort(byName);
        const sections = [["מנות", "dish", dishes], ["מתכונים", "recipe", recipes], ["חומרי גלם", "pantry", products]].filter((s) => s[2].length);
        const picked = new Set();
        const ovl = openModal(`<h2>הוספת פריטים</h2>
            <div class="field"><input type="search" id="pk2-q" placeholder="חיפוש"></div>
            <div id="pk2-list" style="max-height:52vh;overflow:auto;">${sections.map(([title, type, list]) => `<div class="pk2-sec"><div class="card-title" style="margin:10px 4px 4px;">${title}</div>${list.map((it) => `<label class="card-row pk2-row" data-n="${escapeHtml(it.name.toLowerCase())}" style="gap:8px;align-items:center;padding:8px 4px;cursor:pointer;"><input type="checkbox" data-k="${type}:${it.id}" style="width:22px;height:22px;flex:none;"><span style="flex:1;">${escapeHtml(it.name)}</span></label>`).join("")}</div>`).join("") || '<div class="empty-state">אין עדיין מנות, מתכונים או חומרי גלם במערכת. אפשר להוסיף פריט ידני.</div>'}</div>
            <div class="modal-actions"><button type="button" class="btn btn-secondary" id="pk2-cancel">ביטול</button><button type="button" class="btn btn-primary" id="pk2-ok" disabled>הוסף</button></div>`);
        const okBtn = ovl.querySelector("#pk2-ok");
        const sync = () => { okBtn.disabled = !picked.size; okBtn.textContent = picked.size ? `הוסף ${picked.size}` : "הוסף"; };
        ovl.querySelectorAll("input[data-k]").forEach((c) => { c.onchange = () => { if (c.checked) picked.add(c.dataset.k); else picked.delete(c.dataset.k); sync(); }; });
        ovl.querySelector("#pk2-q").oninput = (e) => {
            const t = e.target.value.trim().toLowerCase();
            ovl.querySelectorAll(".pk2-row").forEach((r) => { r.style.display = !t || r.dataset.n.includes(t) ? "" : "none"; });
            ovl.querySelectorAll(".pk2-sec").forEach((s) => { s.style.display = [...s.querySelectorAll(".pk2-row")].some((r) => r.style.display !== "none") ? "" : "none"; });
        };
        ovl.querySelector("#pk2-cancel").onclick = closeModal;
        okBtn.onclick = async () => {
            const has = (t, id, g) => plan.rows.some((r) => r.source_type === t && r.source_id === id && (r.group || "") === g);
            const add = (t, id, name, g) => { if (name && !has(t, id, g)) plan.rows.push({ source_type: t, source_id: id, name, per: "", share: "100", group: g }); };
            let empty = 0;
            for (const key of picked) {
                const [type, idStr] = key.split(":"); const id = Number(idStr);
                if (type === "dish") {
                    const d = ctx.dishes.get(id);
                    const parts = ctx.dishItems.get(id) || [];
                    if (!parts.length) empty++;
                    for (const it of parts) {
                        const src = it.source_type === "recipe" ? ctx.recipes.get(it.source_id) : ctx.pantry.get(it.source_id);
                        add(it.source_type === "recipe" ? "recipe" : "pantry", it.source_id, src ? src.name : "", d ? d.name : "");
                    }
                } else if (type === "recipe") { const r = ctx.recipes.get(id); add("recipe", id, r ? r.name : "", ""); }
                else { const p = ctx.pantry.get(id); add("pantry", id, p ? p.name : "", ""); }
            }
            closeModal();
            if (empty) toast("מנה בלי רכיבים לא נוספה. אפשר להוסיף רכיבים ידנית.");
            draw(); await persist();
        };
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

    // טקסט הסיכום של שורת תפריט: כמה בסך הכול, או מה חסר
    const rowNote = (r) => {
        const legacy = r.source_type === "dish";
        const qty = entryQuantity(plan.guests, r.per, r.share);
        if (!(Number(String(r.per).replace(",", ".")) > 0)) return legacy ? "הזן כמה מנות לסועד" : "הזן גרם לסועד";
        if (!qty) return "הזן כמות סועדים";
        const total = legacy ? `סה"כ ${fmt(qty)} מנות` : `סה"כ ${qtyText(qty)}`;
        const rec = r.source_type === "recipe" ? ctx.recipes.get(r.source_id) : null;
        const noWeight = rec && !(Number(rec.final_weight) > 0);
        return noWeight ? `${total} · אין משקל סופי במתכון, יש להזין במתכון` : total;
    };

    function drawMenu() {
        const menuEl = q("#pp-menu");
        const supName = (id) => (suppliers.find((s) => s.id === id) || {}).name || "";
        let lastGroup = null;
        const rowsHtml = plan.rows.map((r, i) => {
            const legacy = r.source_type === "dish";
            const head = (r.group || "") !== lastGroup && (r.group || lastGroup) ? `<div class="muted" style="margin:10px 4px 2px;">${r.group ? "🍽️ " + escapeHtml(r.group) : "📦 פריטים נוספים"}</div>` : "";
            lastGroup = r.group || "";
            return head + `<div class="card-row" style="padding:6px 4px;gap:8px;align-items:center;border-bottom:1px solid var(--border,#0001);"><span style="flex:1;min-width:0;"><b>${escapeHtml(r.name)}</b><br><span class="muted" data-note="${i}">${escapeHtml(rowNote(r))}</span></span><input type="text" inputmode="decimal" data-per="${i}" value="${escapeHtml(String(r.per))}" placeholder="${legacy ? "מנות" : "גרם"}" style="width:76px;text-align:center;flex:none;"><span class="muted" style="flex:none;">${legacy ? "מנות לסועד" : "גרם לסועד"}</span><button type="button" class="btn btn-secondary btn-small" data-rm="${i}">✕</button></div>`;
        }).join("");
        menuEl.innerHTML = (plan.rows.length ? `<div class="hint" style="margin:8px 4px 0;">בכל שורה כותבים כמה גרם מקבל סועד באירוע.</div>${rowsHtml}` : "") + (plan.custom.length ? `<div class="card-title" style="margin:12px 4px 4px;">פריטים ידניים</div>` + plan.custom.map((c, i) => `<div class="card-row" style="padding:6px 4px;border-bottom:1px solid var(--border,#0001);"><span><b>${escapeHtml(c.label)}</b><br><span class="muted">${c.kind === "order" ? "להזמין" + (c.supplier_id && supName(c.supplier_id) ? " · " + escapeHtml(supName(c.supplier_id)) : "") : "להכין"}${c.qty ? " · " + escapeHtml(c.qty) : ""}</span></span><span><button type="button" class="btn btn-secondary btn-small" data-cedit="${i}">✎</button> <button type="button" class="btn btn-secondary btn-small" data-crm="${i}">✕</button></span></div>`).join("") : "");
        menuEl.querySelectorAll("[data-per]").forEach((inp) => {
            inp.oninput = async () => {
                const i = Number(inp.dataset.per);
                plan.rows[i].per = inp.value;
                const note = menuEl.querySelector(`[data-note="${i}"]`);
                if (note) note.textContent = rowNote(plan.rows[i]);
                drawResult(); await persist();
            };
        });
        menuEl.querySelectorAll("[data-rm]").forEach((b) => { b.onclick = async () => { plan.rows.splice(Number(b.dataset.rm), 1); draw(); await persist(); }; });
        menuEl.querySelectorAll("[data-crm]").forEach((b) => { b.onclick = async () => { const [gone] = plan.custom.splice(Number(b.dataset.crm), 1); if (gone) { delete plan.done["c" + gone.id]; } draw(); await persist(); }; });
        menuEl.querySelectorAll("[data-cedit]").forEach((b) => { b.onclick = () => editCustom(Number(b.dataset.cedit)); });
    }

    function drawResult() {
        const resEl = q("#pp-result");
        const entries = plan.rows.map((r) => ({ source_type: r.source_type, source_id: r.source_id, quantity: entryQuantity(plan.guests, r.per, r.share) })).filter((e) => e.quantity > 0);
        const customPrep = plan.custom.filter((c) => c.kind === "prep"), customOrder = plan.custom.filter((c) => c.kind === "order");
        if (!entries.length && !plan.custom.length) { resEl.innerHTML = plan.rows.length ? '<div class="empty-state">הזן כמות סועדים וגרם לכל רכיב כדי לראות מה להכין ולהזמין.</div>' : ""; return; }
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

        // אלרגנים של הסועדים מול התפריט
        let allergenHtml = "";
        if (plan.allergens.length) {
            const chk = allergenCheck(plan.rows.map((r) => ({ source_type: r.source_type, source_id: r.source_id, name: r.name })), ctx, plan.allergens);
            const labels = ALLERGENS.filter((a) => plan.allergens.includes(a.key)).map((a) => a.label).join(", ");
            allergenHtml = `<div class="card"><div class="card-title" style="margin:0 0 6px;">אלרגנים של הסועדים</div><div class="muted" style="margin-bottom:6px;">${escapeHtml(labels)}</div>
                ${chk.hits.length ? chk.hits.map((h) => `<div class="card-row" style="padding:4px 0;"><span>⚠️ <b>${escapeHtml(h.name)}</b></span><span>מכיל ${escapeHtml(h.labels.join(", "))}</span></div>`).join("") : '<div class="muted">לא נמצאו בתפריט פריטים עם האלרגנים האלה, לפי ההגדרות במערכת.</div>'}
                ${chk.unknown.length ? `<div class="muted" style="margin-top:6px;">לא הוגדרו אלרגנים ב: ${escapeHtml([...new Set(chk.unknown)].join(", "))}. יש לבדוק ידנית.</div>` : ""}
                ${plan.custom.length ? '<div class="muted" style="margin-top:6px;">פריטים ידניים לא נבדקים.</div>' : ""}</div>`;
        }

        resEl.innerHTML = `
            ${allergenHtml}
            ${prepKeys.length ? `<div class="card-title" style="margin:14px 4px 4px;">מה להכין <span class="muted">· בוצעו ${pp.finished} מתוך ${pp.total}</span> ${info("כמויות כולל מרווח הביטחון. מתכון שמשמש כמה רכיבים מוצג פעם אחת, מחושב מסך הצריכה. ✎ משנה כמות.")}</div>
            <div class="card">
                ${result.dishes.map((d) => check(`d${d.id}`, `🍽️ ${escapeHtml(d.name)}`, cell(`d${d.id}`, `${d.portions} מנות`), { name: d.name, cur: `${d.portions} מנות` })).join("")}
                ${prepRecipes.map((r) => check(`r${r.id}`, `📖 ${escapeHtml(r.name)}`, cell(`r${r.id}`, qtyText(r.g)), { name: r.name, cur: qtyText(r.g) })).join("")}
                ${customPrep.map(customRow).join("")}
                <div class="btn-row" style="margin-top:8px;"><button type="button" class="btn btn-secondary btn-small" id="pp-print">🖨️ הדפס צ'ק ליסט</button><button type="button" class="btn btn-secondary btn-small" id="pp-wa">📤 שלח בוואטסאפ</button></div>
            </div>` : ""}
            ${orderKeys.length ? `<div class="card-title" style="margin:14px 4px 4px;">מה להזמין <span class="muted">· הוזמנו ${po.finished} מתוך ${po.total}</span> ${info("מחולק לפי רשימת ההזמנה הקבועה של כל ספק, ופריטים ידניים שנבחר להם ספק מצטרפים אליו. כמויות מעוגלות כלפי מעלה, ואריזות שלמות כשהספק מוכר בארגז. ✎ משנה כמות.")}</div>` : ""}
            ${groups.map((g, gi) => `<div class="card">
                <div class="card-row"><b>${g.supplier ? escapeHtml(g.supplier.name) : "ללא ספק קבוע"}</b>${g.supplier ? `<button type="button" class="btn btn-secondary btn-small" data-copy="${gi}">העתק</button>` : ""}</div>
                ${g.supplier ? "" : '<div class="muted" style="margin:0 0 4px;">אין ספק קבוע לחומרי הגלם האלה. יש להוסיף אותם לרשימת ההזמנה של ספק.</div>'}
                ${g.lines.map((l) => check(`o${l.id}`, escapeHtml(l.name), cell(`o${l.id}`, lineQty(l)), { name: l.name, cur: lineQty(l, true) })).join("")}
                ${g.extras.map(customRow).join("")}
            </div>`).join("")}
            ${loose.length ? `<div class="card"><div class="card-row"><b>הוספות ידניות</b></div>${loose.map(customRow).join("")}</div>` : ""}`;

        resEl.querySelectorAll("input[data-k]").forEach((c) => { c.onchange = async () => { if (c.checked) plan.done[c.dataset.k] = true; else delete plan.done[c.dataset.k]; drawResult(); await persist(); }; });
        resEl.querySelectorAll("[data-qedit]").forEach((b) => { b.onclick = () => editQty(b.dataset.qedit, b.dataset.name, b.dataset.cur); });
        resEl.querySelectorAll("[data-cedit]").forEach((b) => { b.onclick = () => editCustom(Number(b.dataset.cedit)); });
        const ov = (key, fallback) => plan.overrides[key] || fallback;
        const taskLines = [...result.dishes.map((d) => ({ label: d.name, qty: ov("d" + d.id, d.portions + " מנות"), done: !!plan.done["d" + d.id] })), ...prepRecipes.map((r) => ({ label: r.name, qty: ov("r" + r.id, qtyText(r.g)), done: !!plan.done["r" + r.id] })), ...customPrep.map((c) => ({ label: c.label, qty: c.qty, done: !!plan.done["c" + c.id] }))];
        const head = { title: plan.name || "תכנון אירוע", date: plan.date, guests: plan.guests };
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
    function draw() { drawMenu(); drawResult(); }

    // שינוי כמות של משימה/שורת הזמנה שחושבה: טקסט חופשי שמחליף את החישוב (בהדפסה, בוואטסאפ ובהעתקה). אפשר לחזור לחישוב
    function editQty(key, name, cur) {
        const ovl = openModal(`<h2>${escapeHtml(name)}</h2>
            <div class="hint" style="margin-bottom:6px;">הכמות שחושבה: <b>${escapeHtml(cur)}</b>. אפשר לכתוב כמות אחרת, והיא תופיע בצ'ק ליסט, בהדפסה ובהעתקה.</div>
            <div class="field"><input type="text" id="eq-val" value="${escapeHtml(plan.overrides[key] || cur)}"></div>
            <div class="modal-actions"><button type="button" class="btn btn-secondary" id="eq-cancel">ביטול</button>${plan.overrides[key] ? '<button type="button" class="btn btn-secondary" id="eq-reset">חזור לחישוב</button>' : ""}<button type="button" class="btn btn-primary" id="eq-save">שמירה</button></div>`);
        const done = async () => { closeModal(); drawResult(); await persist(); };
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
