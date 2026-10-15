// ספר מתכונים: מתכון נשמר גם כשחסרים רכיבים (טיוטה שאפשר להשלים אחר כך), המסמך המקורי נשמר איתו,
// ויש תצוגת פרטים עם רשימת רכיבים לתווית והצהרת אלרגנים.
import { listRecipesWithItems, saveRecipe, deleteRecipe, setRecipeBase } from "../repo/recipesRepo.js";
import { listAllPantryItems, addPantryItem } from "../repo/pantryRepo.js";
import { RECIPE_CATEGORIES, NON_FOOD_CATEGORIES, CATEGORY_GROUPS, UNIT_TYPES, UNIT_TYPE_LABELS } from "../constants.js";
import { pricePerGram, itemCost as calcItemCost } from "../formulas.js";
import { h, openModal, closeModal, confirmDialog, toast, escapeHtml, money, busy, attemptClose, info } from "../ui.js";
import { openImagePicker } from "../imagePicker.js";
import { scanRecipeImage, suggestRecipeBase } from "../repo/scanRepo.js";
import { getSetting } from "../repo/settingsRepo.js";
import { dbGetAll, dbGet } from "../db.js";
import { buildLabel } from "../recipeLabel.js";
import { suggestBaseHeuristic, computePercentages, scaleToBase, fmtPct } from "../bakers.js";
import { RECIPE_UNIT_GRAMS } from "../recipeParse.js";
import { showImageFullscreen } from "../imageUtil.js";

let recipeFilter = "all"; // all | ready | draft

async function ingredientSources() {
    const all = (await listAllPantryItems()).filter((it) => !NON_FOOD_CATEGORIES.has(it.category));
    const topLevel = all.filter((it) => !it.parent_id).sort((a, b) => a.category.localeCompare(b.category, "he") || a.name.localeCompare(b.name, "he"));
    const out = [];
    for (const p of topLevel) {
        out.push({ id: p.id, name: p.name, indent: false, item: p });
        for (const c of all.filter((it) => it.parent_id === p.id)) {
            out.push({ id: c.id, name: c.name, indent: true, item: c });
        }
    }
    return out;
}

const UNIT_HE = { g: "גרם", kg: 'ק"ג', ml: 'מ"ל', l: "ליטר", tbsp: "כף", tsp: "כפית", cup: "כוס", unit: "יחידות" };
// כמה גרם זה הכמות שכתובה במסמך (אם אפשר לדעת): יחידות מידה קבועות, או "יחידות" x משקל ליחידה של המוצר שנבחר
function gramsFromOriginal(um, item) {
    if (!um || !(Number(um.quantity) > 0)) return null;
    if (um.unit in RECIPE_UNIT_GRAMS) return Math.round(um.quantity * RECIPE_UNIT_GRAMS[um.unit] * 100) / 100;
    if (um.unit === "unit" && item && item.unit_type === "unit" && item.unit_amount) return Math.round(um.quantity * item.unit_amount * 100) / 100;
    return null;
}

const originalText = (d) => `${d.quantity != null ? d.quantity + " " : ""}${d.unit ? UNIT_HE[d.unit] || d.unit : ""}`.trim();

export async function renderRecipesPage(container) {
    const recipes = await listRecipesWithItems();
    recipes.sort((a, b) => a.category.localeCompare(b.category, "he") || a.name.localeCompare(b.name, "he"));
    const draftCount = recipes.filter((r) => r.status === "draft").length;

    container.innerHTML = `<div class="btn-row"><button class="btn btn-accent" id="btn-scan-recipe">📷 סרוק מתכון (תמונה / קובץ)</button></div>
        ${recipes.length ? `<div class="fchips">
            <button type="button" class="chip ${recipeFilter === "all" ? "active" : ""}" data-rf="all">הכול (${recipes.length})</button>
            <button type="button" class="chip ${recipeFilter === "ready" ? "active" : ""}" data-rf="ready">מוכנים (${recipes.length - draftCount})</button>
            <button type="button" class="chip ${recipeFilter === "draft" ? "active" : ""}" data-rf="draft">טיוטות (${draftCount})</button></div>` : ""}
        <div id="recipes-list"></div><button class="fab-add" id="btn-add">+</button>`;
    container.querySelectorAll("[data-rf]").forEach((b) => { b.onclick = () => { recipeFilter = b.dataset.rf; renderRecipesPage(container); }; });
    const list = container.querySelector("#recipes-list");
    const shown = recipes.filter((r) => recipeFilter === "all" || (recipeFilter === "draft" ? r.status === "draft" : r.status !== "draft"));
    if (recipes.length === 0) {
        list.innerHTML = '<div class="empty-state">אין עדיין מתכונים - לחץ על + או סרוק מתכון מקובץ.</div>';
    } else if (shown.length === 0) {
        list.innerHTML = '<div class="empty-state">אין מתכונים בקטגוריה הזו.</div>';
    } else {
        for (const r of shown) list.appendChild(renderRecipeCard(r, container));
    }
    container.querySelector("#btn-add").onclick = () => openRecipeModal(null, container);
    container.querySelector("#btn-scan-recipe").onclick = () => openImagePicker({
        title: "סריקת מתכון",
        hint: "צלם או העלה מתכון בכל פורמט: תמונה, PDF, Word, Excel, טקסט ועוד. נזהה שם, מרכיבים וכמויות, ותוכל לבדוק ולתקן לפני שמירה. המסמך המקורי נשמר עם המתכון.",
        onFile: (file) => scanRecipeFile(file, container),
    });
}

// סורק קובץ מתכון מכל סוג (תמונה / PDF / Word / Excel / טקסט...) ופותח טיוטה לבדיקה. משמש גם ל"שתף".
export async function scanRecipeFile(file, container) {
    const apiKey = await getSetting("gemini_api_key");
    openModal('<div style="text-align:center;padding:24px;color:#666;">קורא את המתכון...</div>');
    try {
        const draft = await scanRecipeImage(apiKey, file);
        closeModal();
        openRecipeModal(null, container, draft);
    } catch (e) {
        const overlay = openModal(`<h2>שגיאה בסריקה</h2><div class="error-msg" style="display:block;">${escapeHtml(e.message)}</div><div class="modal-actions"><button class="btn btn-secondary" id="err-close">סגור</button></div>`);
        overlay.querySelector("#err-close").onclick = closeModal;
    }
}

function renderRecipeCard(r, container) {
    const missing = (r.draft_ingredients || []).length;
    const isDraft = r.status === "draft";
    const card = h(`
        <div class="card">
            <div class="card-title" data-details style="cursor:pointer;">${escapeHtml(r.name)}
                ${isDraft ? `<span class="tag tag-warn">טיוטה · חסרים ${missing}</span>` : ""}${r.source_file ? ' <span title="המסמך המקורי נשמר">📎</span>' : ""}</div>
            <div class="card-row">
                <span class="tag">${escapeHtml(r.category)}</span>
                <span>${r.final_weight > 0 ? r.final_weight.toFixed(0) + " גרם " + (r.is_auto_weight ? "(אוטומטי)" : "(ידני)") : "משקל טרם נקבע"}</span>
            </div>
            <div class="card-row"><span class="muted">${r.items.length} מרכיבים${missing ? " + " + missing + " חסרים" : ""}</span>
                <span class="price-real">${isDraft ? "עלות חלקית " + money(r.total_cost) : money(r.cost_per_gram) + " / גרם"}</span></div>
            <div class="card-actions">
                <button class="btn btn-accent btn-small" data-details>פרטים</button>
                <button class="btn ${isDraft ? "btn-primary" : "btn-secondary"} btn-small" data-edit>${isDraft ? "השלם" : "עריכה"}</button>
                <button class="btn btn-danger btn-small" data-delete>מחיקה</button>
            </div>
        </div>
    `);
    card.querySelectorAll("[data-details]").forEach((el) => { el.onclick = () => openRecipeDetails(r, container); });
    card.querySelector("[data-edit]").onclick = () => openRecipeModal(r, container);
    card.querySelector("[data-delete]").onclick = async () => {
        if (!(await confirmDialog("למחוק את המתכון?"))) return;
        await deleteRecipe(r.id);
        toast("נמחק");
        renderRecipesPage(container);
    };
    return card;
}

// ---------- פרטי מתכון: רכיבים, עלות, הוראות, מסמך מקורי, ורשימת רכיבים לתווית ----------
function printLabel(name, text) {
    const w = window.open("", "_blank");
    if (!w) { toast("הדפדפן חסם את חלון ההדפסה"); return; }
    w.document.write(`<html dir="rtl" lang="he"><head><meta charset="utf-8"><title>${escapeHtml(name)}</title>
        <style>body{font-family:Arial,sans-serif;padding:24px;font-size:16px;line-height:1.7}h1{font-size:22px;margin:0 0 12px}.t{white-space:pre-wrap;border:1px solid #999;padding:14px;border-radius:6px}</style></head>
        <body><h1>${escapeHtml(name)}</h1><div class="t">${escapeHtml(text)}</div></body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
}

async function openRecipeDetails(r, container, startTab = "recipe") {
    const rows = await dbGetAll("pantryItems");
    const byId = new Map(rows.map((p) => [p.id, p]));
    const missing = r.draft_ingredients || [];
    let tab = startTab;
    let showPercent = false;
    let scaleGrams = null; // כמות בסיס מבוקשת (להגדלה)
    const nameOf = (i) => (byId.get(i.pantry_item_id) || {}).name || i.ingredient_name;
    const items = () => r.items.map((i) => ({ id: i.pantry_item_id, name: nameOf(i), quantity_g: i.quantity_g }));

    // בסיס: שמור (ידני/אושר) או הצעה אוטומטית שעוד לא אושרה
    const currentBase = () => {
        if (Array.isArray(r.base_ids) && r.base_ids.length) return { ids: r.base_ids, source: r.base_source || "manual", reason: r.base_reason || "" };
        const s = suggestBaseHeuristic(r.name, items());
        return { ids: s.ids, source: "pending", reason: s.reason };
    };
    const saveBase = async (ids, source, reason) => {
        await setRecipeBase(r.id, { base_ids: ids, base_source: source, base_reason: reason });
        r.base_ids = ids; r.base_source = source; r.base_reason = reason;
    };

    const draw = () => {
        const label = buildLabel({ items: r.items, pantryById: byId, showPercent });
        const labelText = label.text + (missing.length ? `\n(הרשימה כוללת רק רכיבים שכבר במזווה. חסרים ${missing.length} רכיבים: ${missing.map((m) => m.name).join(", ")})` : "");

        let body = "";
        if (tab === "recipe") {
            body = `
            <table class="simple"><thead><tr><th>רכיב</th><th>גרם</th><th>עלות</th></tr></thead><tbody>
                ${[...r.items].sort((a, b) => b.quantity_g - a.quantity_g).map((i) => `<tr><td>${escapeHtml(nameOf(i))}</td><td>${+Number(i.quantity_g).toFixed(1)}</td><td>${money(i.item_cost)}</td></tr>`).join("")}
                ${missing.map((m) => `<tr style="color:#c0392b;"><td>⚠ ${escapeHtml(m.name)}</td><td colspan="2">${escapeHtml(originalText(m) || "—")} · לא במזווה</td></tr>`).join("")}
            </tbody></table>
            ${r.status === "draft" ? `<div class="hint-warn">העלות חלקית - מחושבת רק מהרכיבים שבמזווה. לחץ "השלם" כדי להוסיף את החסרים.</div>`
                : `<div class="card-row" style="font-weight:700;margin:8px 0;"><span>עלות כוללת ${money(r.total_cost)}</span><span>${money(r.cost_per_gram)} / גרם</span></div>`}
            ${r.method ? `<div class="card-title" style="margin:12px 0 4px;">הוראות הכנה</div><div style="white-space:pre-wrap;font-size:14px;">${escapeHtml(r.method)}</div>` : ""}
            ${r.source_file ? '<div class="btn-row"><button type="button" class="btn btn-accent btn-small" id="d-source">📎 המסמך המקורי</button></div>' : ""}`;
        } else if (tab === "percent") {
            const base = currentBase();
            const P = computePercentages(items(), base.ids);
            const target = scaleGrams && scaleGrams > 0 ? scaleGrams : P.baseGrams;
            const scaled = scaleToBase(items(), base.ids, target);
            const sourceNote = { ai: "הוצע על ידי בינה מלאכותית", auto: "הוצע אוטומטית", manual: "נבחר על ידך", pending: "הצעה אוטומטית - עוד לא אושרה" }[base.source] || "";
            body = `
            <div class="card">
                <div class="card-title">בסיס (100%) ${info("הרכיבים המרכזיים של המתכון. כל האחוזים מחושבים ביחס אליהם. הבסיס הוא לא תמיד הרכיב הגדול ביותר - במאפים הוא הקמח (כל הקמחים יחד), ברוטב עגבניות - עגבניות. אפשר לבחור כמה רכיבים.")}</div>
                <div class="chips" id="p-base-chips">${items().map((i) => `<button type="button" class="chip ${base.ids.includes(i.id) ? "active" : ""}" data-base="${i.id}">${escapeHtml(i.name)}</button>`).join("")}</div>
                <div class="hint">${escapeHtml(sourceNote)}${base.reason ? ": " + escapeHtml(base.reason) : ""}</div>
                <div class="btn-row">
                    ${base.source === "pending" ? '<button type="button" class="btn btn-primary btn-small" id="p-confirm">✓ אשר בסיס</button>' : ""}
                    <button type="button" class="btn btn-secondary btn-small" id="p-ai">🤖 הצע בבינה מלאכותית</button>
                    <button type="button" class="btn btn-secondary btn-small" id="p-auto">↺ הצעה אוטומטית</button>
                </div>
            </div>
            ${P.rows.length ? `
            <div class="field"><label>כמות הבסיס (גרם) - לשינוי כמות המתכון</label><input type="number" step="any" id="p-scale" value="${target}"></div>
            <table class="simple"><thead><tr><th>רכיב</th><th>אחוז</th><th>גרם</th></tr></thead><tbody>
                ${scaled.map((x) => `<tr style="${x.isBase ? "font-weight:700;" : ""}"><td>${escapeHtml(x.name)}${x.isBase ? " (בסיס)" : ""}</td><td>${fmtPct(x.pct)}%</td><td>${x.scaledGrams}</td></tr>`).join("")}
            </tbody></table>
            <div class="card-row" style="margin:8px 0;"><span>סך כל האחוזים</span><b>${fmtPct(P.totalPct)}%</b></div>
            <div class="btn-row"><button type="button" class="btn btn-secondary btn-small" id="p-copy">📋 העתק</button><button type="button" class="btn btn-secondary btn-small" id="p-print">🖨 הדפס</button></div>`
            : '<div class="hint-warn">בחר לפחות רכיב אחד כבסיס כדי לראות אחוזים.</div>'}`;
        } else {
            body = `
            <div class="card-title" style="margin:6px 0 4px;">רשימת רכיבים לתווית ${info("רכיבים לפי משקל יורד, והצהרת אלרגנים מצטברת מהרכיבים. זו טיוטה לעזר - האחריות לתיוג ולתקנות היא של בעל העסק. רכיב שלא הוגדרו לו אלרגנים מסומן כ'לא הוגדר' ולא כ'ללא אלרגנים'.")}</div>
            <div class="card" style="white-space:pre-wrap;font-size:14px;line-height:1.6;">${escapeHtml(labelText)}</div>
            <div class="checkbox-field" style="margin-bottom:8px;"><input type="checkbox" id="d-pct" ${showPercent ? "checked" : ""}><label for="d-pct">הצג אחוזים</label></div>
            <div class="btn-row">
                <button type="button" class="btn btn-secondary btn-small" id="d-copy">📋 העתק</button>
                <button type="button" class="btn btn-secondary btn-small" id="d-share">📤 שתף</button>
                <button type="button" class="btn btn-secondary btn-small" id="d-print">🖨 הדפס</button>
            </div>`;
        }

        const overlay = openModal(`
            <h2>${escapeHtml(r.name)}</h2>
            <div class="card-row" style="margin:-8px 0 8px;"><span class="tag">${escapeHtml(r.category)}</span>
                ${r.status === "draft" ? `<span class="tag tag-warn">טיוטה · חסרים ${missing.length}</span>` : ""}</div>
            <div class="seg" id="d-seg">
                <button type="button" data-t="recipe" class="${tab === "recipe" ? "active" : ""}">מתכון</button>
                <button type="button" data-t="percent" class="${tab === "percent" ? "active" : ""}">באחוזים</button>
                <button type="button" data-t="label" class="${tab === "label" ? "active" : ""}">רכיבים ואלרגנים</button>
            </div>
            ${body}
            <div class="modal-actions"><button type="button" class="btn btn-secondary" id="d-close">סגור</button>
                <button type="button" class="btn btn-primary" id="d-edit">${r.status === "draft" ? "השלם" : "עריכה"}</button></div>
        `);
        overlay.querySelector("#d-close").onclick = closeModal;
        overlay.querySelector("#d-edit").onclick = () => { closeModal(); openRecipeModal(r, container); };
        overlay.querySelectorAll("#d-seg [data-t]").forEach((b) => { b.onclick = () => { tab = b.dataset.t; draw(); }; });
        const src = overlay.querySelector("#d-source");
        if (src) src.onclick = () => showImageFullscreen(r.source_file, r.name);

        // ---- לשונית אחוזים ----
        overlay.querySelectorAll("[data-base]").forEach((b) => {
            b.onclick = async () => {
                const cur = currentBase().ids.slice();
                const id = Number(b.dataset.base);
                const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
                await saveBase(next, "manual", "");
                draw();
            };
        });
        const confirmBtn = overlay.querySelector("#p-confirm");
        if (confirmBtn) confirmBtn.onclick = async () => { const b = currentBase(); await saveBase(b.ids, "auto", b.reason); draw(); };
        const autoBtn = overlay.querySelector("#p-auto");
        if (autoBtn) autoBtn.onclick = async () => { const s = suggestBaseHeuristic(r.name, items()); await saveBase(s.ids, "auto", s.reason); draw(); };
        const aiBtn = overlay.querySelector("#p-ai");
        if (aiBtn) aiBtn.onclick = async () => {
            aiBtn.disabled = true;
            aiBtn.textContent = "חושב...";
            const apiKey = await getSetting("gemini_api_key");
            const ans = await suggestRecipeBase(apiKey, r.name, items());
            if (ans) { await saveBase(ans.ids, "ai", ans.reason); toast("הבסיס עודכן"); }
            else toast("לא הצלחתי לקבל הצעה מהבינה המלאכותית - נשארת ההצעה האוטומטית");
            draw();
        };
        const scaleEl = overlay.querySelector("#p-scale");
        if (scaleEl) scaleEl.onchange = () => { scaleGrams = parseFloat(scaleEl.value) || null; draw(); };
        const bakersText = () => {
            const b = currentBase();
            const sc = scaleToBase(items(), b.ids, scaleGrams && scaleGrams > 0 ? scaleGrams : computePercentages(items(), b.ids).baseGrams);
            return [`${r.name} - מתכון באחוזים`, ...sc.map((x) => `${x.name}${x.isBase ? " (בסיס)" : ""}: ${fmtPct(x.pct)}% - ${x.scaledGrams} גרם`)].join("\n");
        };
        const pCopy = overlay.querySelector("#p-copy");
        if (pCopy) pCopy.onclick = async () => { try { await navigator.clipboard.writeText(bakersText()); toast("הועתק"); } catch (e) { toast("לא הצלחתי להעתיק"); } };
        const pPrint = overlay.querySelector("#p-print");
        if (pPrint) pPrint.onclick = () => printLabel(r.name + " - באחוזים", bakersText());

        // ---- לשונית רכיבים ואלרגנים ----
        const dPct = overlay.querySelector("#d-pct");
        if (dPct) dPct.onchange = (e) => { showPercent = e.target.checked; draw(); };
        const dCopy = overlay.querySelector("#d-copy");
        if (dCopy) dCopy.onclick = async () => { try { await navigator.clipboard.writeText(labelText); toast("הועתק"); } catch (e) { toast("לא הצלחתי להעתיק"); } };
        const dShare = overlay.querySelector("#d-share");
        if (dShare) dShare.onclick = async () => {
            try { if (navigator.share) await navigator.share({ title: r.name, text: labelText }); else toast("השיתוף לא נתמך בדפדפן הזה - השתמש בהעתק"); } catch (e) { /* בוטל */ }
        };
        const dPrint = overlay.querySelector("#d-print");
        if (dPrint) dPrint.onclick = () => printLabel(r.name, labelText);
    };
    draw();
}

function scanNoticeHtml(draft) {
    const unmatched = [], fuzzy = [], noQty = [];
    for (const ing of draft.ingredients) {
        if (!ing.pantry_item_id) {
            unmatched.push(`${ing.original_name}${ing.original_quantity ? ` (${ing.original_quantity} ${ing.original_unit || ""})` : ""}`);
        } else if (ing.fuzzy) {
            fuzzy.push(`"${ing.original_name}" ← "${ing.matched_name}"`);
        }
        if (ing.pantry_item_id && !ing.quantity_g) noQty.push(ing.original_name);
    }
    let html = "";
    if (unmatched.length) html += `<div><b>לא נמצאו במזווה:</b> ${unmatched.map(escapeHtml).join(", ")}<br>אפשר להוסיף אותם למזווה (➕ בכל שורה), לבחור מוצר קיים, או לשמור כטיוטה ולהשלים אחר כך.</div>`;
    if (fuzzy.length) html += `<div style="margin-top:6px;"><b>התאמות משוערות - בדוק:</b> ${fuzzy.map(escapeHtml).join(", ")}</div>`;
    if (noQty.length) html += `<div style="margin-top:6px;"><b>חסרה כמות:</b> ${noQty.map(escapeHtml).join(", ")}</div>`;
    return `<div class="hint-warn">${html || "כל המרכיבים זוהו. בדוק את הכמויות לפני שמירה."}</div>`;
}

async function openRecipeModal(existing, container, draft = null) {
    const sources = await ingredientSources();
    const isEdit = !!existing;
    const src = existing || draft;
    let rowCounter = 0;
    const rowMeta = new Map(); // id -> { um: {name, quantity, unit} | null }

    const overlay = openModal(`
        <h2>${isEdit ? (existing.status === "draft" ? "השלמת מתכון (טיוטה)" : "עריכת מתכון") : draft ? "מתכון חדש (מסריקה - בדוק לפני שמירה)" : "מתכון חדש"}</h2>
        ${draft ? scanNoticeHtml(draft) : ""}
        <div class="field"><label>שם מתכון</label><input type="text" id="f-name" value="${src ? escapeHtml(src.name) : ""}"></div>
        <div class="field">
            <label>קטגוריה</label>
            <select id="f-category">
                <option value="">בחר...</option>
                ${RECIPE_CATEGORIES.map((c) => `<option value="${c}" ${src && src.category === c ? "selected" : ""}>${c}</option>`).join("")}
            </select>
        </div>
        <div id="ingredients-box"></div>
        <button type="button" class="btn btn-secondary btn-small" id="btn-add-row">+ הוסף מרכיב</button>
        <div class="field" style="margin-top:12px;"><label>הוראות הכנה (אופציונלי)</label><textarea id="f-method" rows="4" style="width:100%;">${src && src.method ? escapeHtml(src.method) : ""}</textarea></div>
        <div class="field" style="margin-top:12px;"><label>משקל סופי ידני (גרם, אופציונלי - ריק = סכום המרכיבים)</label><input type="number" step="any" id="f-manual-weight" value="${existing && !existing.is_auto_weight ? existing.final_weight : ""}"></div>
        ${(existing && existing.source_file) || (draft && draft.source_file) ? '<div class="hint">📎 המסמך המקורי יישמר עם המתכון.</div>' : ""}
        <div class="card-row" style="font-weight:700;"><span>עלות כוללת:</span><span id="total-cost-display">₪0.00</span></div>
        <div class="hint" id="partial-note" style="display:none;color:#c0392b;">העלות חלקית - יש רכיבים שעדיין לא במזווה.</div>
        <div class="error-msg"></div>
        <div class="modal-actions">
            <button class="btn btn-secondary" id="btn-cancel">ביטול</button>
            <button class="btn btn-primary" id="btn-save">שמירה</button>
        </div>
    `);

    const box = overlay.querySelector("#ingredients-box");
    const selectOptions = (selectedId) => sources.map((s) => `<option value="${s.id}" ${selectedId === s.id ? "selected" : ""}>${s.indent ? "↳ " : ""}${escapeHtml(s.name)}</option>`).join("");

    function addRow(prefill) {
        const id = rowCounter++;
        const um = prefill && prefill.um ? prefill.um : null;
        rowMeta.set(id, { um });
        const row = h(`
            <div class="item-row-inputs" id="ing-row-${id}">
                ${um ? `<div class="hint-warn" style="margin-top:0;">מהמסמך: <b>${escapeHtml(um.name)}</b> ${escapeHtml(originalText(um))}</div>` : ""}
                <div class="top-line">
                    <select id="ing-source-${id}" style="flex:2;">
                        <option value="">${um ? "בחר מוצר מהמזווה..." : "בחר מרכיב..."}</option>
                        ${selectOptions(prefill ? prefill.pantry_item_id : null)}
                    </select>
                    <input type="number" step="any" id="ing-qty-${id}" placeholder="גרם" style="width:80px;" value="${prefill && prefill.quantity_g != null ? prefill.quantity_g : (um && gramsFromOriginal(um, null) != null ? gramsFromOriginal(um, null) : "")}">
                    <button type="button" class="remove-row-btn" data-remove="${id}">✕</button>
                </div>
                <div class="line-total" id="ing-line-${id}"></div>
                ${um ? `<button type="button" class="btn btn-secondary btn-small" id="ing-qa-btn-${id}" style="margin-top:6px;">➕ הוסף "${escapeHtml(um.name)}" למזווה</button>
                <div id="ing-qa-${id}" style="display:none;background:#eef6fb;border-radius:8px;padding:8px;margin-top:6px;">
                    <div class="form-row">
                        <div class="field"><label>קטגוריה</label><select id="qa-cat-${id}"><option value="">בחר...</option>${Object.keys(CATEGORY_GROUPS).map((c) => `<option value="${c}">${c}</option>`).join("")}</select></div>
                        <div class="field"><label>נמדד ב-</label><select id="qa-ut-${id}">${UNIT_TYPES.map((u) => `<option value="${u}">${UNIT_TYPE_LABELS[u]}</option>`).join("")}</select></div>
                    </div>
                    <div class="form-row">
                        <div class="field"><label id="qa-price-label-${id}">מחיר לק"ג (₪)</label><input type="number" step="any" id="qa-price-${id}"></div>
                        <div class="field" id="qa-ua-wrap-${id}" style="display:none;"><label>משקל ליחידה (גרם)</label><input type="number" step="any" id="qa-ua-${id}"></div>
                    </div>
                    <button type="button" class="btn btn-primary btn-small" id="qa-add-${id}">הוסף למזווה</button>
                    <div class="error-msg" id="qa-err-${id}"></div>
                </div>` : ""}
            </div>
        `);
        box.appendChild(row);
        row.querySelector(`#ing-source-${id}`).addEventListener("change", () => {
            // שורה מהמסמך שנבחר לה מוצר: אם אין כמות בגרם - מחשבים מהכמות שכתובה במסמך
            const qtyEl = row.querySelector(`#ing-qty-${id}`);
            if (um && !qtyEl.value) {
                const s = sources.find((x) => String(x.id) === row.querySelector(`#ing-source-${id}`).value);
                const g = gramsFromOriginal(um, s && s.item);
                if (g != null) qtyEl.value = g;
            }
            recalc();
        });
        row.querySelector(`#ing-qty-${id}`).addEventListener("input", recalc);
        row.querySelector("[data-remove]").onclick = () => { row.remove(); rowMeta.delete(id); recalc(); };

        if (um) {
            const qa = row.querySelector(`#ing-qa-${id}`);
            row.querySelector(`#ing-qa-btn-${id}`).onclick = () => { qa.style.display = qa.style.display === "none" ? "block" : "none"; };
            const ut = row.querySelector(`#qa-ut-${id}`);
            const syncQa = () => {
                row.querySelector(`#qa-price-label-${id}`).textContent = ut.value === "liter" ? 'מחיר לליטר (₪)' : ut.value === "unit" ? "מחיר ליחידה (₪)" : 'מחיר לק"ג (₪)';
                row.querySelector(`#qa-ua-wrap-${id}`).style.display = ut.value === "unit" ? "block" : "none";
            };
            ut.addEventListener("change", syncQa);
            syncQa();
            row.querySelector(`#qa-add-${id}`).onclick = busy(async () => {
                const err = row.querySelector(`#qa-err-${id}`);
                try {
                    const newId = await addPantryItem({
                        name: um.name, category: row.querySelector(`#qa-cat-${id}`).value, unit_type: ut.value,
                        unit_amount: row.querySelector(`#qa-ua-${id}`).value, price: row.querySelector(`#qa-price-${id}`).value,
                    });
                    const item = await dbGet("pantryItems", newId);
                    sources.push({ id: newId, name: item.name, indent: false, item });
                    // מוסיפים את המוצר החדש לכל רשימות הבחירה, ובוחרים אותו בשורה הזו
                    overlay.querySelectorAll('[id^="ing-source-"]').forEach((sel) => {
                        const opt = document.createElement("option");
                        opt.value = String(newId);
                        opt.textContent = item.name;
                        sel.appendChild(opt);
                    });
                    row.querySelector(`#ing-source-${id}`).value = String(newId);
                    const qtyEl = row.querySelector(`#ing-qty-${id}`);
                    if (!qtyEl.value) { const g = gramsFromOriginal(um, item); if (g != null) qtyEl.value = g; }
                    qa.style.display = "none";
                    row.querySelector(`#ing-qa-btn-${id}`).style.display = "none";
                    recalc();
                    toast(`"${item.name}" נוסף למזווה`);
                } catch (e) {
                    err.textContent = e.message;
                    err.style.display = "block";
                }
            });
        }
    }

    function recalc() {
        let total = 0;
        let hasUnmatched = false;
        box.querySelectorAll(".item-row-inputs").forEach((row) => {
            const id = row.id.replace("ing-row-", "");
            const sourceId = parseInt(overlay.querySelector(`#ing-source-${id}`).value, 10);
            const qty = parseFloat(overlay.querySelector(`#ing-qty-${id}`).value) || 0;
            const meta = rowMeta.get(Number(id));
            const s = sources.find((x) => x.id === sourceId);
            const lineEl = overlay.querySelector(`#ing-line-${id}`);
            if (s && qty > 0) {
                const cost = calcItemCost(pricePerGram(s.item), qty);
                lineEl.textContent = money(cost);
                total += cost;
            } else {
                lineEl.textContent = "";
                if (meta && meta.um) hasUnmatched = true;
            }
        });
        overlay.querySelector("#total-cost-display").textContent = money(total);
        overlay.querySelector("#partial-note").style.display = hasUnmatched ? "block" : "none";
        return total;
    }

    if (existing) {
        for (const it of existing.items) addRow(it);
        for (const d of existing.draft_ingredients || []) addRow({ pantry_item_id: null, quantity_g: null, um: d });
    } else if (draft && draft.ingredients.length) {
        for (const ing of draft.ingredients) {
            addRow({
                pantry_item_id: ing.pantry_item_id, quantity_g: ing.quantity_g,
                um: ing.pantry_item_id ? null : { name: ing.original_name, quantity: ing.original_quantity, unit: ing.original_unit },
            });
        }
    } else {
        addRow();
    }
    recalc();
    overlay.querySelector("#btn-add-row").onclick = () => addRow();

    overlay.querySelector("#btn-cancel").onclick = () => attemptClose(overlay);
    overlay.querySelector("#btn-save").onclick = busy(async () => {
        const items = [];
        const draftIngredients = [];
        box.querySelectorAll(".item-row-inputs").forEach((row) => {
            const id = row.id.replace("ing-row-", "");
            const pantry_item_id = overlay.querySelector(`#ing-source-${id}`).value;
            const quantity_g = overlay.querySelector(`#ing-qty-${id}`).value;
            const meta = rowMeta.get(Number(id));
            if (pantry_item_id && quantity_g) items.push({ pantry_item_id, quantity_g });
            else if (meta && meta.um) draftIngredients.push({ name: meta.um.name, quantity: meta.um.quantity, unit: meta.um.unit });
        });
        const el = overlay.querySelector(".error-msg");
        const data = {
            name: overlay.querySelector("#f-name").value,
            category: overlay.querySelector("#f-category").value,
            items,
            draft_ingredients: draftIngredients,
            method: overlay.querySelector("#f-method").value,
            final_weight: overlay.querySelector("#f-manual-weight").value,
        };
        if (!isEdit && draft && draft.source_file) data.source_file = draft.source_file;
        if (draftIngredients.length && !window.confirm(`${draftIngredients.length} רכיבים עדיין לא במזווה:\n${draftIngredients.map((d) => d.name).join(", ")}\n\nלשמור כטיוטה ולהשלים אותם אחר כך?`)) return;
        try {
            await saveRecipe(existing ? existing.id : null, data);
            closeModal();
            toast(draftIngredients.length ? "נשמר כטיוטה - אפשר להשלים בכל שלב" : "נשמר");
            renderRecipesPage(container);
        } catch (e) {
            el.textContent = e.message;
            el.style.display = "block";
        }
    });
}
