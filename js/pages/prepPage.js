// תכנון אירוע: שם, תאריך, סועדים ואלרגנים. תפריט של מנות, מתכונים וחומרי גלם מהמערכת, או פריטים ידניים.
// לכל רכיב קובעים כמה גרם מקבל סועד באירוע (בלי קשר לגודל המנה בתמחור). המערכת מחשבת כמויות להכנה, רשימת הזמנות לפי ספק
// ורשימת הכנות, עם סימון "בוצע". התוכניות נשמרות (prepPlansRepo.js). החישוב ב-prepPlan.js (טהור).
import { toast, escapeHtml, info, confirmDialog, openModal, closeModal } from "../ui.js";
import { enhanceSelect } from "../picker.js";
import { dbGetAll, dbGet } from "../db.js";
import { openIngredientPicker } from "./ingredientPicker.js";
import { addPantryItem } from "../repo/pantryRepo.js";
import { loadSalesCtx } from "../repo/salesRepo.js";
import { planPrep, groupBySupplier, entryQuantity, allergenCheck, parseQty, DEFAULT_MARGIN_PCT } from "../prepPlan.js";
import { ALLERGENS } from "../allergens.js";
import { addonOn } from "../addons.js";
import { serviceRow, seatsTotal, weekdayHe } from "../serviceCalc.js";
import { serviceSummary, serviceText, serviceFileName, serviceMonthFolder, historyPoints, pointFromSummary } from "../serviceDoc.js";
import { compareService, changeText, SAME_DAY_COUNT } from "../serviceCompare.js";
import { renderServicePdf } from "../servicePdf.js";
import { chartSvg } from "../serviceCharts.js";
import { renderForecast } from "./forecastPage.js";
import { qtyText, orderText, whatsappUrl, mailtoUrl } from "../shareText.js";
import { checklistText, checklistHtml } from "../prepChecklist.js";
import { buildEventDoc, eventDocHtml } from "../eventDoc.js";
import { makeTranslator } from "../i18nCore.js";
import { listPlans, savePlans, upsertPlan, removePlan, normalizePlan, progress } from "../repo/prepPlansRepo.js";

const fmt = (n) => +Number(n).toFixed(2);
const shortDate = (d) => { const [y, m, day] = String(d || "").split("-"); return day ? `${parseInt(day, 10)}.${parseInt(m, 10)}` : ""; };
const planLabel = (p) => `${p.name || "אירוע"} · ${shortDate(p.date)}`;
let currentId = null; // התוכנית הפתוחה (נשמר בין מעברי מסכים)

let prepView = "forecast"; // התצוגה האחרונה בטאב, כשהתוסף סרוויסים פעיל
export async function renderPrepTab(container) {
    if (!addonOn("service")) return renderEvent(container);
    container.innerHTML = `<div class="seg" id="pv-seg"><button type="button" data-v="forecast">תחזית סועדים</button><button type="button" data-v="event">אירוע</button></div><div id="pv-body"></div>`;
    const body = container.querySelector("#pv-body");
    const show = async (v) => {
        prepView = v;
        container.querySelectorAll("#pv-seg button").forEach((b) => b.classList.toggle("active", b.dataset.v === v));
        body.innerHTML = "";
        await (v === "event" ? renderEvent(body) : renderForecast(body));
    };
    container.querySelectorAll("#pv-seg button").forEach((b) => { b.onclick = () => show(b.dataset.v); });
    await show(prepView);
}

async function renderEvent(container) {
    const [ctx, suppliers] = await Promise.all([loadSalesCtx(), dbGetAll("suppliers")]);
    let plans = await listPlans();
    const supplierOptions = (sel) => [...suppliers].sort((a, b) => a.name.localeCompare(b.name, "he")).map((s) => `<option value="${s.id}"${s.id === sel ? " selected" : ""}>${escapeHtml(s.name)}</option>`).join("");

    let plan = plans.find((p) => p.id === currentId) || plans[0] || normalizePlan({ margin: String(DEFAULT_MARGIN_PCT) });
    currentId = plan.id;
    const isBlank = (p) => !p.rows.length && !p.custom.length && !p.guests && !p.name;
    const persist = async () => {
        if (isBlank(plan)) return;
        plans = upsertPlan(plans, plan);
        plan.updated = plans[0].updated; // התוכנית החיה נשארת כפי שהוקלדה (שדה ריק לא הופך לברירת מחדל); רק הנשמר מנורמל
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
            <div class="field"><label>הערות לאירוע ${info("מקום חופשי לכל מה שלא קשור לאוכל: סידורים, הכרות, ארגון, שעות, ציוד. ההערות מופיעות במסמך האירוע.")}</label><textarea id="pp-note" rows="3" style="width:100%;" placeholder="סידורים, הכרות, ארגון, מה שצריך לזכור"></textarea></div>
        </div>
        <div class="card">
            <div class="card-title" style="margin:0 0 6px;">תפריט</div>
            <button type="button" class="btn btn-secondary btn-block" id="pp-pick">＋ הוספת פריטים מהמערכת</button>
            <div id="pp-menu"></div>
        </div>
        <div class="card" id="sv-card" style="display:none;">
            <div class="card-title" style="margin:0 0 6px;">דף סרוויס ${info("לכל נתח בתפריט מזינים בקילו כמה יצא לסרוויס, כמה חזר, כמה נזרק וכמה פחת. האפליקציה מחשבת את הצריכה בפועל ואת הגרם לסועד. בשר שבושל ושומש שוב נספר כחזר.")}</div>
            <div class="muted" id="sv-day" style="margin:0 0 6px;"></div>
            <div class="form-row">
                <div class="field"><label>סועדים בסיט ראשון</label><input type="text" inputmode="numeric" id="sv-s1"></div>
                <div class="field"><label>סועדים בסיט שני</label><input type="text" inputmode="numeric" id="sv-s2"></div>
            </div>
            <div class="muted" id="sv-total" style="margin:0 0 8px;"></div>
            <div class="field"><label>מחיר לסועד, בשקלים ${info("משמש לחישוב אחוז עלות מזון בדוח ובגרפים. אפשר להשאיר ריק.")}</label><input type="text" inputmode="decimal" id="sv-price"></div>
            <div id="sv-rows"></div>
            <div class="btn-row" style="margin-top:10px;flex-wrap:wrap;gap:6px;">
                <button type="button" class="btn btn-secondary btn-small" id="sv-doc">📄 מסמך סרוויס</button>
                <button type="button" class="btn btn-secondary btn-small" id="sv-file">📎 שלח כקובץ</button>
                <button type="button" class="btn btn-secondary btn-small" id="sv-wa">📤 וואטסאפ</button>
                <button type="button" class="btn btn-secondary btn-small" id="sv-mail">✉️ מייל</button>
                <button type="button" class="btn btn-secondary btn-small" id="sv-drive">☁️ שמור בדרייב</button>
                <button type="button" class="btn btn-secondary btn-small" id="sv-cmp">⚖️ השוואה</button>
                <button type="button" class="btn btn-secondary btn-small" id="sv-hist">📈 היסטוריה וגרפים</button>
            </div>
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
        q("#pp-note").value = plan.note || ""; q("#pp-name").value = plan.name; q("#pp-date").value = plan.date; q("#pp-guests").value = plan.guests; q("#pp-margin").value = plan.margin;
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
    const bind = (sel, key) => { q(sel).oninput = async (e) => { plan[key] = e.target.value; drawMenu(); drawResult(); updAll(); await persist(); }; };
    q("#pp-note").oninput = async (e) => { plan.note = e.target.value; await persist(); };
    bind("#pp-name", "name"); bind("#pp-date", "date"); bind("#pp-guests", "guests"); bind("#pp-margin", "margin");
    q("#pp-date").onchange = q("#pp-date").oninput;
    q("#pp-plan").onchange = (e) => { plan = plans.find((p) => p.id === e.target.value) || plan; currentId = plan.id; loadFields(); draw(); };
    q("#pp-new").onclick = () => { plan = normalizePlan({ margin: plan.margin, rows: addonOn("service") ? plan.rows.map((r) => ({ ...r })) : [] }); currentId = plan.id; loadFields(); draw(); }; // עם סרוויסים: התפריט נשמר מערב לערב
    q("#pp-del").onclick = async () => {
        if (!plans.some((p) => p.id === plan.id)) { plan = normalizePlan({ margin: plan.margin }); currentId = plan.id; loadFields(); draw(); return; }
        if (!(await confirmDialog(`למחוק את האירוע "${escapeHtml(plan.name || "ללא שם")}"?`))) return;
        plans = removePlan(plans, plan.id);
        await savePlans(plans);
        plan = plans[0] || normalizePlan({ margin: plan.margin });
        currentId = plan.id; loadFields(); draw();
    };

    // בחירת פריטים מהמערכת: אותו בורר של שאר האפליקציה (חיפוש וקטגוריות), עם סימון של כמה פריטים יחד ואפשרות להקים חומר גלם חדש בלי מחיר.
    // מנה נפתחת לרכיביה, ולכל רכיב כמות משלו
    q("#pp-pick").onclick = () => {
        const mkItems = (type, list) => list.map((it) => ({ key: `${type}:${it.id}`, id: it.id, tab: type, name: it.name, category: it.category || (type === "dish" ? "מנות" : type === "recipe" ? "מתכונים" : "אחר"), subcategory: "", hint: "" }));
        const items = [
            ...mkItems("dish", [...ctx.dishes.values()]),
            ...mkItems("recipe", [...ctx.recipes.values()]),
            ...mkItems("pantry", [...ctx.pantry.values()].filter((p) => !p.parent_id)),
        ];
        openIngredientPicker({
            title: "הוספת פריטים", items, multi: true,
            tabs: [{ key: "dish", label: "מנות" }, { key: "recipe", label: "מתכונים" }, { key: "pantry", label: "חומרי גלם" }],
            onCreate: async (d) => {
                const newId = await addPantryItem({ name: d.name, category: d.category, unit_type: d.unit_type, unit_amount: d.unit_amount || "", price: d.price, allow_no_price: true, yield_pct: d.yield_pct, no_yield_est: d.no_yield_est, free: d.free });
                const item = await dbGet("pantryItems", newId);
                ctx.pantry.set(newId, item);
                return { key: `pantry:${newId}`, id: newId, tab: "pantry", name: item.name, category: item.category, subcategory: "", hint: "" };
            },
            onPick: async (picked) => {
                const has = (t, id, g) => plan.rows.some((r) => r.source_type === t && r.source_id === id && (r.group || "") === g);
                const add = (t, id, name, g) => { if (name && !has(t, id, g)) plan.rows.push({ source_type: t, source_id: id, name, per: "", share: "100", group: g }); };
                let empty = 0;
                for (const it of picked) {
                    const type = it.tab, id = it.id;
                    if (type === "dish") {
                        const d = ctx.dishes.get(id);
                        const parts = ctx.dishItems.get(id) || [];
                        if (!parts.length) empty++;
                        for (const part of parts) {
                            const src = part.source_type === "recipe" ? ctx.recipes.get(part.source_id) : ctx.pantry.get(part.source_id);
                            add(part.source_type === "recipe" ? "recipe" : "pantry", part.source_id, src ? src.name : "", d ? d.name : "");
                        }
                    } else if (type === "recipe") { const r = ctx.recipes.get(id); add("recipe", id, r ? r.name : "", ""); }
                    else { const pr = ctx.pantry.get(id); add("pantry", id, pr ? pr.name : "", ""); }
                }
                if (empty) toast("מנה בלי רכיבים לא נוספה. אפשר להוסיף רכיבים ידנית.");
                draw(); await persist();
            },
        });
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
    const isCount = (r) => r.source_type === "pantry" && (ctx.pantry.get(r.source_id) || {}).unit_type === "unit";
    const rowNote = (r) => {
        const legacy = r.source_type === "dish";
        const cnt = isCount(r);
        const qty = entryQuantity(plan.guests, r.per, r.share);
        if (!(parseQty(r.per) > 0)) return escapeHtml(legacy ? "הזן כמה מנות לסועד" : cnt ? "הזן יחידות לסועד" : "הזן גרם לסועד");
        if (!qty) return escapeHtml("הזן כמות סועדים");
        // הכמות הסופית כוללת את מרווח הביטחון, והתג מראה מאיפה היא באה: הכמות הנקייה ואחוז התוספת
        const mg = Math.max(0, parseQty(plan.margin));
        const withM = qty * (1 + mg / 100);
        const clean = legacy ? `${fmt(qty)}` : cnt ? `${fmt(qty)}` : qtyText(qty);
        const final = legacy ? `${Math.ceil(Math.round(withM * 1e6) / 1e6)} מנות` : cnt ? `${Math.ceil(Math.round(withM * 1e6) / 1e6)} יחידות` : qtyText(Math.ceil(Math.round(withM * 1e6) / 1e6));
        const badge = mg > 0 ? ` <span style="display:inline-block;padding:0 7px;border-radius:999px;background:var(--accent-soft,#0001);font-size:.85em;white-space:nowrap;">${escapeHtml(clean)} + ${escapeHtml(fmt(mg) + "%")}</span>` : "";
        const total = `<b>${escapeHtml('סה"כ ' + (mg > 0 ? final : legacy ? `${fmt(qty)} מנות` : cnt ? `${fmt(qty)} יחידות` : qtyText(qty)))}</b>${badge}`;
        const rec = r.source_type === "recipe" ? ctx.recipes.get(r.source_id) : null;
        const noWeight = rec && !(Number(rec.final_weight) > 0);
        return noWeight ? `${total} · ${escapeHtml("אין משקל סופי במתכון, יש להזין במתכון")}` : total;
    };

    function drawMenu() {
        const menuEl = q("#pp-menu");
        const supName = (id) => (suppliers.find((s) => s.id === id) || {}).name || "";
        let lastGroup = null;
        const rowsHtml = plan.rows.map((r, i) => {
            const legacy = r.source_type === "dish";
            const head = (r.group || "") !== lastGroup && (r.group || lastGroup) ? `<div class="muted" style="margin:10px 4px 2px;">${r.group ? "🍽️ " + escapeHtml(r.group) : "📦 פריטים נוספים"}</div>` : "";
            lastGroup = r.group || "";
            return head + `<div class="card-row" style="padding:6px 4px;gap:8px;align-items:center;border-bottom:1px solid var(--border,#0001);"><span style="flex:1;min-width:0;"><b>${escapeHtml(r.name)}</b><br><span class="muted" data-note="${i}">${rowNote(r)}</span></span><input type="text" inputmode="decimal" data-per="${i}" value="${escapeHtml(String(r.per))}" placeholder="${legacy ? "מנות" : isCount(r) ? "יחידות" : "גרם"}" style="width:76px;text-align:center;flex:none;"><span class="muted" style="flex:none;">${legacy ? "מנות לסועד" : isCount(r) ? "יחידות לסועד" : "גרם לסועד"}</span><button type="button" class="btn btn-secondary btn-small" data-rm="${i}">✕</button></div>`;
        }).join("");
        menuEl.innerHTML = (plan.rows.length ? `<div class="hint" style="margin:8px 4px 0;">בכל שורה כותבים כמה גרם מקבל סועד באירוע.</div>${rowsHtml}` : "") + (plan.custom.length ? `<div class="card-title" style="margin:12px 4px 4px;">פריטים ידניים</div>` + plan.custom.map((c, i) => `<div class="card-row" style="padding:6px 4px;border-bottom:1px solid var(--border,#0001);"><span><b>${escapeHtml(c.label)}</b><br><span class="muted">${c.kind === "order" ? "להזמין" + (c.supplier_id && supName(c.supplier_id) ? " · " + escapeHtml(supName(c.supplier_id)) : "") : "להכין"}${c.qty ? " · " + escapeHtml(c.qty) : ""}</span></span><span><button type="button" class="btn btn-secondary btn-small" data-cedit="${i}">✎</button> <button type="button" class="btn btn-secondary btn-small" data-crm="${i}">✕</button></span></div>`).join("") : "");
        menuEl.querySelectorAll("[data-per]").forEach((inp) => {
            inp.oninput = async () => {
                const i = Number(inp.dataset.per);
                plan.rows[i].per = inp.value;
                const note = menuEl.querySelector(`[data-note="${i}"]`);
                if (note) note.innerHTML = rowNote(plan.rows[i]);
                drawResult(); updAll(); await persist();
            };
        });
        menuEl.querySelectorAll("[data-rm]").forEach((b) => { b.onclick = async () => { plan.rows.splice(Number(b.dataset.rm), 1); draw(); await persist(); }; });
        menuEl.querySelectorAll("[data-crm]").forEach((b) => { b.onclick = async () => { const [gone] = plan.custom.splice(Number(b.dataset.crm), 1); if (gone) { delete plan.done["c" + gone.id]; } draw(); await persist(); }; });
        menuEl.querySelectorAll("[data-cedit]").forEach((b) => { b.onclick = () => editCustom(Number(b.dataset.cedit)); });
    }

    function drawResult() {
        const resEl = q("#pp-result");
        const entries = plan.rows.map((r) => ({ source_type: r.source_type, source_id: r.source_id, quantity: entryQuantity(plan.guests, r.per, r.share) })).filter((e) => e.quantity > 0);
        const customPrep0 = plan.custom.filter((c) => c.kind === "prep"), customOrder = plan.custom.filter((c) => c.kind === "order");
        if (!entries.length && !plan.custom.length) { resEl.innerHTML = plan.rows.length ? '<div class="empty-state">הזן כמות סועדים וגרם לכל רכיב כדי לראות מה להכין ולהזמין.</div>' : ""; return; }
        // מוצר גלם שנוסף ישירות לתפריט (נקניקייה, לחם): מופיע גם ב"מה להכין", עם אותה כמות כולל המרווח כמו בהזמנה
        const fct = 1 + Math.max(0, parseQty(plan.margin)) / 100;
        const directTot = new Map();
        for (const e of entries) if (e.source_type === "pantry") directTot.set(e.source_id, (directTot.get(e.source_id) || 0) + e.quantity);
        const directPrep = [...directTot].map(([id, q]) => {
            const row = ctx.pantry.get(id);
            if (!row) return null;
            const n = Math.ceil(Math.round(q * fct * 1e6) / 1e6);
            return { id: "p" + id, kind: "prep", label: row.name, qty: row.unit_type === "unit" ? `${n} יחידות` : qtyText(n) };
        }).filter(Boolean);
        const customPrep = [...customPrep0, ...directPrep];
        const result = entries.length ? planPrep(entries, ctx, plan.margin) : { dishes: [], recipes: {}, subRecipes: {}, pantry: {}, foodGrams: 0 };
        const allRecipes = { ...result.recipes };
        for (const [id, g] of Object.entries(result.subRecipes || {})) allRecipes[id] = (allRecipes[id] || 0) + g; // תת-מתכון שגם משמש ישירות מוכן פעם אחת
        const prepRecipes = Object.entries(allRecipes).map(([id, g]) => ({ id, name: (ctx.recipes.get(Number(id)) || {}).name || "?", g })).sort((a, b) => a.name.localeCompare(b.name, "he"));

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
        // שינוי ידני שהחישוב מאחוריו זז (סועדים השתנו) כבר לא נכון: מוחקים אותו
        {
            const calc = {};
            for (const d of result.dishes) calc["d" + d.id] = `${d.portions} מנות`;
            for (const r of prepRecipes) calc["r" + r.id] = qtyText(r.g);
            for (const g of groups) for (const l of g.lines) calc["o" + l.id] = lineQty(l, true);
            plan.overrideBase = plan.overrideBase || {};
            let dropped = false;
            for (const k of Object.keys(plan.overrides)) {
                if (plan.overrideBase[k] != null && calc[k] != null && plan.overrideBase[k] !== calc[k]) { delete plan.overrides[k]; delete plan.overrideBase[k]; dropped = true; }
            }
            if (dropped) persist();
        }
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
            <div class="card"><button type="button" class="btn btn-primary btn-block" id="pp-doc">📄 מסמך אירוע להדפסה ושליחה</button><div class="hint" style="margin-top:6px;">תפריט, כמויות, מתכונים מלאים והזמנות לפי ספק, בלי מחירים. בחלון ההדפסה בוחרים שמירה כ PDF ואז שולחים.</div></div>
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
        resEl.querySelector("#pp-doc").onclick = () => {
            const ovl = openModal(`<h2>מסמך אירוע</h2><div class="hint" style="margin-bottom:8px;">באיזו שפה להכין את המסמך?</div><div class="modal-actions"><button type="button" class="btn btn-secondary" id="ed-cancel">ביטול</button><button type="button" class="btn btn-primary" id="ed-he">עברית</button><button type="button" class="btn btn-primary" id="ed-en">English</button></div>`);
            ovl.querySelector("#ed-cancel").onclick = closeModal;
            const make = async (en) => {
                closeModal();
                let tr = (s) => s;
                if (en) { try { tr = makeTranslator((await import("../i18n/ui-en.js")).default); } catch (e) { /* בלי תרגום */ } }
                const doc = buildEventDoc({ plan, ctx, result, groups, loose, prepRecipes, customPrep }, en);
                const url = URL.createObjectURL(new Blob([eventDocHtml(doc, tr, en)], { type: "text/html;charset=utf-8" }));
                if (!window.open(url, "_blank")) toast("הדפדפן חסם את פתיחת הדף. אפשר חלונות קופצים לאתר ונסה שוב.");
                setTimeout(() => URL.revokeObjectURL(url), 120000);
            };
            ovl.querySelector("#ed-he").onclick = () => make(false);
            ovl.querySelector("#ed-en").onclick = () => make(true);
        };
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
    // ---------- דף סרוויס: שורה לכל נתח (חומר גלם בתפריט) ----------
    const svcRows = () => plan.rows.filter((r) => r.source_type === "pantry" && ctx.pantry.get(r.source_id));
    const svcKey = (r) => `pantry:${r.source_id}`;
    function svcResultText(r) {
        const row = ctx.pantry.get(r.source_id), cnt = row && row.unit_type === "unit";
        const res = serviceRow(plan.svc[svcKey(r)], plan.guests, cnt);
        if (!res) return "";
        if (res.invalid) return "הכמויות לא מסתדרות: חזר, נזרק ופחת גדולים מהכמות שיצאה.";
        const eaten = cnt ? `${fmt(res.eaten)} יחידות` : `${fmt(res.eaten)} ק"ג`;
        const per = res.perGuest == null ? "" : cnt ? ` · ${fmt(Math.round(res.perGuest * 10) / 10)} יחידות לסועד` : ` · ${Math.round(res.perGuest)} גרם לסועד`;
        return `צריכה בפועל ${eaten}${per}`;
    }
    function drawService() {
        const card = q("#sv-card");
        if (!addonOn("service")) { card.style.display = "none"; return; }
        card.style.display = "";
        q("#sv-s1").value = plan.seat1 || ""; q("#sv-s2").value = plan.seat2 || "";
        q("#sv-day").textContent = [weekdayHe(plan.date), shortDate(plan.date)].filter(Boolean).join(" · ");
        const updTotal = () => { const t = seatsTotal(plan.seat1, plan.seat2); q("#sv-total").textContent = t > 0 ? `סה"כ ${t} סועדים` : ""; };
        updTotal();
        const onSeat = async () => {
            plan.seat1 = q("#sv-s1").value; plan.seat2 = q("#sv-s2").value;
            const t = seatsTotal(plan.seat1, plan.seat2);
            if (t > 0) { plan.guests = String(t); q("#pp-guests").value = plan.guests; }
            updTotal(); drawMenu(); drawResult(); updAll(); await persist();
        };
        q("#sv-s1").oninput = onSeat; q("#sv-s2").oninput = onSeat;
        q("#sv-price").value = plan.price || "";
        q("#sv-price").oninput = async () => { plan.price = q("#sv-price").value; await persist(); };
        const summary = () => serviceSummary(plan, ctx.pantry);
        const needData = (s) => { if (s.hasData) return true; toast("הזן נתונים לפחות בנתח אחד"); return false; };
        const makePdf = async (s) => { try { return await renderServicePdf(s); } catch (e) { toast("יצירת הקובץ נכשלה"); return null; } };
        q("#sv-doc").onclick = async () => {
            const s = summary(); if (!needData(s)) return;
            const pdf = await makePdf(s); if (!pdf) return;
            const url = URL.createObjectURL(pdf);
            if (!window.open(url, "_blank")) toast("הדפדפן חסם את פתיחת הדף. אפשר חלונות קופצים לאתר ונסה שוב.");
            setTimeout(() => URL.revokeObjectURL(url), 120000);
        };
        q("#sv-file").onclick = async () => { // תפריט השיתוף של הטלפון: וואטסאפ, מייל, דרייב ועוד, עם הקובץ עצמו
            const s = summary(); if (!needData(s)) return;
            const pdf = await makePdf(s); if (!pdf) return;
            const file = new File([pdf], serviceFileName(s), { type: "application/pdf" });
            try {
                if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: s.title || "סרוויס" }); return; }
            } catch (e) { if (e && e.name === "AbortError") return; }
            const url = URL.createObjectURL(pdf);
            const a = document.createElement("a"); a.href = url; a.download = file.name; document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 60000);
            toast("הקובץ נשמר במכשיר");
        };
        q("#sv-wa").onclick = () => { const s = summary(); if (!needData(s)) return; if (!window.open(whatsappUrl(serviceText(s)), "_blank")) toast("הדפדפן חסם את פתיחת הדף. אפשר חלונות קופצים לאתר ונסה שוב."); };
        q("#sv-mail").onclick = () => { const s = summary(); if (!needData(s)) return; window.location.href = mailtoUrl("", `${s.title || "סרוויס"} ${s.date || ""}`.trim(), serviceText(s)); };
        q("#sv-drive").onclick = async () => {
            const s = summary(); if (!needData(s)) return;
            try {
                const { saveReportToDrive } = await import("../cloud/cloudGlue.js");
                const pdf = await makePdf(s); if (!pdf) return;
                await saveReportToDrive({ folder: "סרוויסים", sub: [serviceMonthFolder(s)], name: serviceFileName(s), blob: pdf, mime: "application/pdf" });
                toast(`נשמר בדרייב בתיקיית סרוויסים, ${serviceMonthFolder(s)}`);
            } catch (e) { toast(e && e.message ? e.message : "השמירה בדרייב נכשלה"); }
        };
        q("#sv-hist").onclick = () => openHistory();
        q("#sv-cmp").onclick = () => openCompare();
        const rows = svcRows();
        const FIELDS = [["out", "יצא לסרוויס"], ["back", "חזר מסרוויס"], ["shrink", "פחת"], ["thrown", "נזרק"]];
        q("#sv-rows").innerHTML = rows.length ? rows.map((r) => {
            const row = ctx.pantry.get(r.source_id), unit = row.unit_type === "unit" ? "יחידות" : 'ק"ג', k = svcKey(r), v = plan.svc[k] || {};
            return `<div style="padding:8px 0;border-top:1px solid var(--border,#0001);"><div style="display:flex;justify-content:space-between;gap:8px;"><b>${escapeHtml(r.name || row.name)}</b></div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:6px 0;">${FIELDS.map(([f, label]) => `<div class="field" style="margin:0;"><label>${escapeHtml(label)}</label><input type="text" inputmode="decimal" placeholder="${escapeHtml(unit)}" data-svk="${escapeHtml(k)}" data-svf="${f}" value="${escapeHtml(v[f] || "")}"></div>`).join("")}</div>
                <div data-svr="${escapeHtml(k)}" style="font-weight:600;">${escapeHtml(svcResultText(r))}</div></div>`;
        }).join("") : `<div class="muted">הוסף נתחים לתפריט, והם יופיעו כאן.</div>`;
        q("#sv-rows").querySelectorAll("[data-svk]").forEach((inp) => {
            inp.oninput = async () => {
                const k = inp.dataset.svk;
                plan.svc[k] = { out: "", back: "", thrown: "", shrink: "", ...(plan.svc[k] || {}), [inp.dataset.svf]: inp.value };
                updAll(); await persist();
            };
        });
    }
    // השוואה: הערב מול הערב האחרון, ממוצע שבועי, וממוצע של אותו יום בשבוע
    function openCompare() {
        const cur = pointFromSummary(serviceSummary(plan, ctx.pantry));
        if (!cur) { toast("הזן נתונים וסועדים כדי להשוות"); return; }
        const others = historyPoints(plans.filter((p) => p.id !== plan.id), ctx.pantry);
        const st = { mode: "last" };
        const ovl = openModal(`<h2>השוואה</h2><div id="cp-body"></div><div class="modal-actions"><button type="button" class="btn btn-secondary" id="cp-close">סגור</button></div>`);
        ovl.querySelector("#cp-close").onclick = closeModal;
        const body = ovl.querySelector("#cp-body");
        const row = (name, r, bold) => `<div class="card-row" style="padding:6px 0;border-top:1px solid var(--border,#0001);gap:8px;${bold ? "font-weight:700;" : ""}"><span>${escapeHtml(name)}</span><span style="text-align:left;">${escapeHtml(r.base == null ? `${Math.round(r.now)} גרם לסועד` : `${Math.round(r.now)} גרם לסועד, ${changeText(r.d)}`)}</span></div>`;
        const paint = () => {
            const res = compareService(st.mode, cur, others);
            const modes = [["last", "הערב האחרון"], ["week", "ממוצע שבועי"], ["same", `אותו יום בשבוע`]];
            const chips = modes.map(([k, l]) => `<button type="button" class="btn btn-small ${st.mode === k ? "btn-primary" : "btn-secondary"}" data-md="${k}">${escapeHtml(l)}</button>`).join("");
            let inner;
            if (!res.available) {
                inner = `<div class="muted">${st.mode === "same" ? `צריך לפחות ${res.need} ערבים קודמים באותו יום בשבוע. יש ${res.n}.` : "אין עדיין ערבים קודמים להשוואה."}</div>`;
            } else {
                const basis = st.mode === "last" ? "מול הערב האחרון" : st.mode === "week" ? (res.n === 1 ? "מול ערב אחד בשבוע האחרון" : `מול הממוצע של ${res.n} ערבים בשבוע האחרון`) : `מול הממוצע של ${res.n} ערבים קודמים באותו יום בשבוע`;
                inner = `<div class="muted" style="margin:6px 0;">${escapeHtml(basis)}</div>${row("סה\"כ", res.total, true)}${res.cuts.map((c) => row(c.name, c, false)).join("")}`;
            }
            body.innerHTML = `<div class="btn-row" style="flex-wrap:wrap;gap:6px;margin-bottom:8px;">${chips}</div>${inner}`;
            body.querySelectorAll("[data-md]").forEach((b) => { b.onclick = () => { st.mode = b.dataset.md; paint(); }; });
        };
        paint();
    }
    // היסטוריית סרוויסים: גרף לפי נתח, נזרק ועלות, ורשימה
    function openHistory() {
        const all = [plan, ...plans.filter((p) => p.id !== plan.id)];
        const pts = historyPoints(all, ctx.pantry);
        const cuts = [...new Set(pts.flatMap((p) => p.perCut.map((c) => c.name)))];
        const st = { metric: "g", cut: "" };
        const ovl = openModal(`<h2>היסטוריית סרוויסים</h2><div id="hs-body"></div><div class="modal-actions"><button type="button" class="btn btn-secondary" id="hs-close">סגור</button></div>`);
        ovl.querySelector("#hs-close").onclick = closeModal;
        const body = ovl.querySelector("#hs-body");
        const chip = (on, attr, label) => `<button type="button" class="btn btn-small ${on ? "btn-primary" : "btn-secondary"}" ${attr}>${escapeHtml(label)}</button>`;
        const paint = () => {
            if (!pts.length) { body.innerHTML = `<div class="muted">אין עדיין סרוויסים עם נתונים.</div>`; return; }
            const metrics = [["g", "גרם לסועד"], ["thrown", "נזרק"], ["cost", "עלות בשר לסועד"]];
            const series = pts.map((p) => ({
                x: shortDate(p.date),
                y: st.metric === "g" ? (st.cut ? ((p.perCut.find((c) => c.name === st.cut) || {}).g ?? null) : p.perGuestG) : st.metric === "thrown" ? p.thrown : p.costPerDiner,
            }));
            const fmtY = st.metric === "g" ? (v) => String(Math.round(v)) : (v) => String(+v.toFixed(st.metric === "cost" ? 1 : 2));
            const title = st.metric === "g" ? "גרם לסועד" : st.metric === "thrown" ? 'נזרק בק"ג' : "עלות בשר לסועד, בשקלים";
            const chart = chartSvg(series, { fmt: fmtY });
            body.innerHTML = `<div class="btn-row" style="flex-wrap:wrap;gap:6px;margin-bottom:8px;">${metrics.map(([k, l]) => chip(st.metric === k, `data-m="${k}"`, l)).join("")}</div>
                ${st.metric === "g" && cuts.length ? `<div class="btn-row" style="flex-wrap:wrap;gap:6px;margin-bottom:8px;">${chip(!st.cut, 'data-c=""', "כל הנתחים")}${cuts.map((c) => chip(st.cut === c, `data-c="${escapeHtml(c)}"`, c)).join("")}</div>` : ""}
                <div style="font-weight:700;margin:4px 0;">${escapeHtml(title)}</div>
                ${chart || `<div class="muted">אין נתונים לתצוגה הזו.</div>`}
                <div style="margin-top:10px;">${[...pts].reverse().map((p) => `<div class="card-row" style="padding:5px 0;border-top:1px solid var(--border,#0001);gap:8px;"><span>${escapeHtml(shortDate(p.date))}${p.title ? ` · ${escapeHtml(p.title)}` : ""}</span><span class="muted">${escapeHtml(`${p.guests} סועדים · ${p.perGuestG ? Math.round(p.perGuestG) : "-"} גרם לסועד · נזרק ${fmt(p.thrown)} ק"ג`)}</span></div>`).join("")}</div>`;
            body.querySelectorAll("[data-m]").forEach((b) => { b.onclick = () => { st.metric = b.dataset.m; paint(); }; });
            body.querySelectorAll("[data-c]").forEach((b) => { b.onclick = () => { st.cut = b.dataset.c; paint(); }; });
        };
        paint();
    }
    function updAll() {
        q("#sv-rows").querySelectorAll("[data-svr]").forEach((el) => {
            const r = svcRows().find((x) => svcKey(x) === el.dataset.svr);
            if (r) el.textContent = svcResultText(r);
        });
    }
    function draw() { drawMenu(); drawResult(); drawService(); }

    // שינוי כמות של משימה/שורת הזמנה שחושבה: טקסט חופשי שמחליף את החישוב (בהדפסה, בוואטסאפ ובהעתקה). אפשר לחזור לחישוב
    function editQty(key, name, cur) {
        const ovl = openModal(`<h2>${escapeHtml(name)}</h2>
            <div class="hint" style="margin-bottom:6px;">הכמות שחושבה: <b>${escapeHtml(cur)}</b>. אפשר לכתוב כמות אחרת, והיא תופיע בצ'ק ליסט, בהדפסה ובהעתקה.</div>
            <div class="field"><input type="text" id="eq-val" value="${escapeHtml(plan.overrides[key] || cur)}"></div>
            <div class="modal-actions"><button type="button" class="btn btn-secondary" id="eq-cancel">ביטול</button>${plan.overrides[key] ? '<button type="button" class="btn btn-secondary" id="eq-reset">חזור לחישוב</button>' : ""}<button type="button" class="btn btn-primary" id="eq-save">שמירה</button></div>`);
        const done = async () => { closeModal(); drawResult(); await persist(); };
        ovl.querySelector("#eq-cancel").onclick = closeModal;
        const rs = ovl.querySelector("#eq-reset");
        if (rs) rs.onclick = () => { delete plan.overrides[key]; if (plan.overrideBase) delete plan.overrideBase[key]; done(); };
        ovl.querySelector("#eq-save").onclick = () => { const v = ovl.querySelector("#eq-val").value.trim(); plan.overrideBase = plan.overrideBase || {}; if (!v || v === cur) { delete plan.overrides[key]; delete plan.overrideBase[key]; } else { plan.overrides[key] = v; plan.overrideBase[key] = cur; } done(); };
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
