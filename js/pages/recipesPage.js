// ספר מתכונים: מתכון נשמר גם כשחסרים רכיבים (טיוטה שאפשר להשלים אחר כך), המסמך המקורי נשמר איתו,
// ויש תצוגת פרטים עם רשימת רכיבים לתווית והצהרת אלרגנים.
import { listRecipesWithItems, saveRecipe, deleteRecipe, setRecipeBase } from "../repo/recipesRepo.js";
import { listAllPantryItems, addPantryItem, setItemAllergens, setEggSize } from "../repo/pantryRepo.js";
import { ALLERGENS, allergenLabels } from "../allergens.js";
import { RECIPE_CATEGORIES, NON_FOOD_CATEGORIES, CATEGORY_GROUPS, UNIT_TYPES, UNIT_TYPE_LABELS } from "../constants.js";
import { pricePerGram, itemCost as calcItemCost, effectivePrice } from "../formulas.js";
import { h, openModal, closeModal, confirmDialog, toast, escapeHtml, money, busy, attemptClose, info, cur, curLabel } from "../ui.js";
import { openImagePicker } from "../imagePicker.js";
import { scanRecipeImage, suggestRecipeBase } from "../repo/scanRepo.js";
import { getSetting } from "../repo/settingsRepo.js";
import { dbGetAll, dbGet } from "../db.js";
import { buildLabel } from "../recipeLabel.js";
import { suggestBaseHeuristic, computePercentages, scaleToBase, fmtPct } from "../bakers.js";
import { RECIPE_UNIT_GRAMS } from "../recipeParse.js";
import { textToGrams, gramsToKgText, describeQty, qtyWarning } from "../qty.js";
import { bindPickerButton, refreshPickerButton } from "./ingredientPicker.js";
import { UNITS, convertToGrams, factorFor, scaleRecipe, fmtQty } from "../generator.js";
import { recipeEggSummary, eggSummaryText, allocateEggCosts, isEggProduct, eggSizeOf, partGrams, eggBreakdown, EGG_SIZES, EGG_PARTS, EGG_PART_LABEL } from "../eggs.js";
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
    let tab = r.status === "draft" && startTab === "gen" ? "recipe" : startTab;
    let showPercent = false;
    let lastDrawnTab = null; // כדי לשמור את מיקום הגלילה כשמציירים מחדש באותה לשונית
    let scaleGrams = null; // כמות בסיס מבוקשת (להגדלה)
    let gen = { mode: "factor", value: 2, round: true }; // מחולל: הגדלה/הקטנה
    let conv = { qty: "", unit: "cup", name: "" }; // מחולל: המרת יחידות
    let eggc = { pid: "", part: "white", qty: "", unit: "g" }; // מחולל: המרת ביצים
    const nameOf = (i) => (byId.get(i.pantry_item_id) || {}).name || i.ingredient_name;
    const eggNotes = recipeEggSummary(r.items, rows);
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

    // שורות לעריכת אלרגנים: מוצר ברמה העליונה לכל רכיב (תוצר מפורק יורש מחומר הגלם)
    const allergenRows = () => {
        const seen = new Set();
        const out = [];
        for (const i of r.items) {
            const row = byId.get(i.pantry_item_id);
            if (!row) continue;
            const src = row.parent_id ? byId.get(row.parent_id) || row : row;
            if (seen.has(src.id)) continue;
            seen.add(src.id);
            const text = !Array.isArray(src.allergens) ? "לא הוגדרו" : src.allergens.length ? escapeHtml(allergenLabels(src.allergens).join(", ")) : "ללא אלרגנים" + (src.allergens_auto ? " (הצעה)" : "");
            out.push({ id: src.id, name: src.name, text: Array.isArray(src.allergens) && src.allergens.length && src.allergens_auto ? text + " (הצעה)" : text });
        }
        return out;
    };
    const draw = () => {
        // ציור מחדש לא מקפיץ למעלה: שומרים את מיקום הגלילה כשנשארים באותה לשונית
        const prevModal = document.querySelector("#modal-root .modal");
        const keepTop = prevModal && lastDrawnTab === tab ? prevModal.scrollTop : 0;
        lastDrawnTab = tab;
        const label = buildLabel({ items: r.items, pantryById: byId, showPercent });
        const labelText = label.text + (missing.length ? `\n(הרשימה כוללת רק רכיבים שכבר במזווה. חסרים ${missing.length} רכיבים: ${missing.map((m) => m.name).join(", ")})` : "");

        let body = "";
        if (tab === "recipe") {
            body = `
            <table class="simple"><thead><tr><th>רכיב</th><th>גרם</th><th>עלות</th></tr></thead><tbody>
                ${[...r.items].sort((a, b) => b.quantity_g - a.quantity_g).map((i) => `<tr><td>${escapeHtml(nameOf(i))}${i.egg_part && i.egg_part !== "whole" ? " (" + EGG_PART_LABEL[i.egg_part] + ")" : ""}</td><td>${+Number(i.quantity_g).toFixed(1)}</td><td>${money(i.item_cost)}</td></tr>`).join("")}
                ${missing.map((m) => `<tr style="color:var(--danger);"><td>⚠ ${escapeHtml(m.name)}</td><td colspan="2">${escapeHtml(originalText(m) || "—")} · לא במזווה</td></tr>`).join("")}
            </tbody></table>
            ${r.status === "draft" ? `<div class="hint-warn">העלות חלקית - מחושבת רק מהרכיבים שבמזווה. לחץ "השלם" כדי להוסיף את החסרים.</div>`
                : `<div class="card-row" style="font-weight:700;margin:8px 0;"><span>עלות כוללת ${money(r.total_cost)}</span><span>${money(r.cost_per_gram)} / גרם</span></div>`}
            ${eggNotes.map((e) => `<div class="hint-warn" style="background:var(--brand-soft);color:var(--text);">${escapeHtml(eggSummaryText(e))}</div>`).join("")}
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
            <div class="field"><label>כמות הבסיס (ק"ג) - לשינוי כמות המתכון</label><input type="text" inputmode="decimal" id="p-scale" value="${gramsToKgText(target)}"><div class="hint">${describeQty(gramsToKgText(target))}</div></div>
            <table class="simple"><thead><tr><th>רכיב</th><th>אחוז</th><th>גרם</th></tr></thead><tbody>
                ${scaled.map((x) => `<tr style="${x.isBase ? "font-weight:700;" : ""}"><td>${escapeHtml(x.name)}${x.isBase ? " (בסיס)" : ""}</td><td>${fmtPct(x.pct)}%</td><td>${x.scaledGrams}</td></tr>`).join("")}
            </tbody></table>
            <div class="card-row" style="margin:8px 0;"><span>סך כל האחוזים</span><b>${fmtPct(P.totalPct)}%</b></div>
            <div class="btn-row"><button type="button" class="btn btn-secondary btn-small" id="p-copy">📋 העתק</button><button type="button" class="btn btn-secondary btn-small" id="p-print">🖨 הדפס</button></div>`
            : '<div class="hint-warn">בחר לפחות רכיב אחד כבסיס כדי לראות אחוזים.</div>'}`;
        } else if (tab === "gen") {
            const curWeight = r.items.reduce((n, i) => n + (Number(i.quantity_g) || 0), 0);
            const f = factorFor({ mode: gen.mode, value: gen.value, currentWeight: curWeight });
            const sc = f ? scaleRecipe(r.items, f, rows, { round: gen.round }) : null;
            const cv = convertToGrams({ qty: conv.qty, unit: conv.unit, name: conv.name });
            const names = [...new Set(r.items.map((i) => nameOf(i)))];
            const eggProducts = rows.filter(isEggProduct);
            const eggSel = eggProducts.find((e) => String(e.id) === String(eggc.pid)) || eggProducts.find((e) => r.items.some((i) => i.pantry_item_id === e.id)) || eggProducts[0] || null;
            const eggSize = eggSel ? eggSizeOf(eggSel) : "M";
            const eggG = eggc.unit === "unit" ? (parseFloat(String(eggc.qty).replace(",", ".")) || 0) * partGrams(eggSize, eggc.part) : textToGrams(eggc.qty) || 0;
            const eggQty = eggc.unit === "unit" ? parseFloat(String(eggc.qty).replace(",", ".")) || 0 : eggG;
            const eggRes = eggQty > 0 ? eggBreakdown({ size: eggSize, wholeG: eggc.part === "whole" ? eggG : 0, whiteG: eggc.part === "white" ? eggG : 0, yolkG: eggc.part === "yolk" ? eggG : 0, eggPrice: eggSel ? effectivePrice(eggSel.price, eggSel.yield_pct, eggSel.is_frozen) : 0 }) : null;
            body = `
            <div class="card">
                <div class="card-title">הגדלה / הקטנה ${info("מכפילים את כל המתכון. עיגול נוח מעגל כמויות קטנות לערכים שקל לשקול (ביצים לא מעוגלות, כי הן נספרות בנפרד). העלות מחושבת מחדש, כולל מספר הביצים לשבירה.")}</div>
                <div class="chips" id="g-quick">${[[0.25, "÷4"], [1 / 3, "÷3"], [0.5, "÷2"], [1, "×1"], [2, "×2"], [3, "×3"], [4, "×4"], [5, "×5"]].map(([v, l]) => `<button type="button" class="chip ${gen.mode === "factor" && Math.abs(Number(gen.value) - v) < 1e-6 ? "active" : ""}" data-q="${v}">${l}</button>`).join("")}</div>
                <div class="form-row">
                    <div class="field"><label>לפי</label><select id="g-mode"><option value="factor" ${gen.mode === "factor" ? "selected" : ""}>פי כמה</option><option value="weight" ${gen.mode === "weight" ? "selected" : ""}>משקל סופי (ק"ג)</option></select></div>
                    <div class="field"><label>${gen.mode === "weight" ? `ק"ג (עכשיו ${gramsToKgText(curWeight)})` : "מקדם"}</label><input type="text" id="g-val" value="${gen.mode === "weight" ? gramsToKgText(gen.value) : +Number(gen.value).toFixed(4)}" inputmode="decimal"></div>
                </div>
                <div class="checkbox-field"><input type="checkbox" id="g-round" ${gen.round ? "checked" : ""}><label for="g-round">עיגול נוח</label></div>
            </div>
            ${sc ? `
            <table class="simple"><thead><tr><th>רכיב</th><th>כמות</th><th>עלות</th></tr></thead><tbody>
                ${[...sc.rows].sort((a, b) => b.grams - a.grams).map((o) => `<tr><td>${escapeHtml(nameOf(o))}${o.egg_part && o.egg_part !== "whole" ? " (" + o.eggLabel + ")" : ""}</td><td>${fmtQty(o.grams)}${o.egg_part ? `<br><span class="muted">= ${o.eggUnits} ${o.egg_part === "white" ? "חלבונים" : o.egg_part === "yolk" ? "חלמונים" : "ביצים"}</span>` : ""}</td><td>${money(o.cost)}</td></tr>`).join("")}
            </tbody></table>
            <div class="card-row" style="font-weight:700;margin:8px 0;"><span>סה"כ ${fmtQty(sc.totalGrams)}</span><span>${money(sc.totalCost)}</span></div>
            ${sc.eggs.map((e) => `<div class="hint-warn" style="background:var(--brand-soft);color:var(--text);">${escapeHtml(eggSummaryText(e))}</div>`).join("")}
            <div class="btn-row">
                <button type="button" class="btn btn-secondary btn-small" id="g-copy">📋 העתק</button>
                <button type="button" class="btn btn-secondary btn-small" id="g-print">🖨 הדפס</button>
                <button type="button" class="btn btn-primary btn-small" id="g-save">💾 שמור כמתכון חדש</button>
            </div>` : '<div class="hint-warn">הזן מקדם או משקל גדולים מ-0.</div>'}
            <div class="card" style="margin-top:14px;">
                <div class="card-title">המרת ביצים ${info("כותבים כמה חלבון, חלמון או ביצה שלמה צריך, והמערכת אומרת כמה ביצים לשבור, כמה זה עולה וכמה נשאר. גודל הביצה לפי מה שהוגדר במזווה.")}</div>
                ${eggSel ? `
                <div class="form-row">
                    <div class="field"><label>ביצים</label><select id="e-prod">${eggProducts.map((e) => `<option value="${e.id}" ${e.id === eggSel.id ? "selected" : ""}>${escapeHtml(e.name)} (${eggSizeOf(e)})</option>`).join("")}</select></div>
                    <div class="field"><label>חלק</label><select id="e-part">${EGG_PARTS.map(([k, l]) => `<option value="${k}" ${k === eggc.part ? "selected" : ""}>${l}</option>`).join("")}</select></div>
                </div>
                <div class="form-row">
                    <div class="field"><label>כמות</label><input type="text" id="e-qty" value="${escapeHtml(eggc.qty)}" inputmode="decimal"></div>
                    <div class="field"><label>ב-</label><select id="e-unit"><option value="g" ${eggc.unit === "g" ? "selected" : ""}>ק"ג</option><option value="unit" ${eggc.unit === "unit" ? "selected" : ""}>יחידות</option></select></div>
                </div>
                ${eggc.unit === "g" && eggc.qty ? `<div class="hint">${describeQty(eggc.qty)}</div>` : ""}
                ${eggRes ? `<div class="card-row" style="font-weight:700;"><span>לשבור ${eggRes.eggs} ביצים</span><span>${money(eggRes.eggsCost)}</span></div>
                    ${eggc.unit === "unit" ? `<div class="hint">${eggQty} ${EGG_PART_LABEL[eggc.part]} = ${Math.round(eggG * 100) / 100} גרם</div>` : ""}
                    ${eggRes.leftWhiteCount > 0 ? `<div class="hint">נשארים ${eggRes.leftWhiteCount} חלבונים (${eggRes.leftWhiteG} גרם)</div>` : ""}
                    ${eggRes.leftYolkCount > 0 ? `<div class="hint">נשארים ${eggRes.leftYolkCount} חלמונים (${eggRes.leftYolkG} גרם)</div>` : ""}` : ""}`
                : '<div class="hint">אין עדיין ביצים ביחידות במזווה.</div>'}
            </div>
            <div class="card" style="margin-top:14px;">
                <div class="card-title">המרת יחידות ${info("ממיר כוסות, כפות, אונקיות וליברות לגרמים. כוס קמח שונה מכוס סוכר, לכן ההמרה היא הערכה לפי צפיפות ממוצעת. עדיף לשקול את הכמות פעם אחת ולעדכן.")}</div>
                <div class="form-row">
                    <div class="field"><label>כמות</label><input type="number" step="any" id="c-qty" value="${escapeHtml(conv.qty)}" inputmode="decimal"></div>
                    <div class="field"><label>יחידה</label><select id="c-unit">${UNITS.map((u) => `<option value="${u.key}" ${u.key === conv.unit ? "selected" : ""}>${u.label}</option>`).join("")}</select></div>
                </div>
                <div class="field"><label>חומר</label><input type="text" id="c-name" list="c-names" value="${escapeHtml(conv.name)}" placeholder="למשל קמח, סוכר, חמאה"><datalist id="c-names">${names.map((n) => `<option value="${escapeHtml(n)}">`).join("")}</datalist></div>
                ${cv ? `<div class="card-row" style="font-weight:700;"><span>= ${fmtQty(cv.grams)}</span></div>${cv.note ? `<div class="hint">${escapeHtml(cv.note)}</div>` : ""}` : ""}
            </div>`;
        } else {
            body = `
            <div class="card-title" style="margin:6px 0 4px;">רשימת רכיבים לתווית ${info("רכיבים לפי משקל יורד, והצהרת אלרגנים מצטברת מהרכיבים. זו טיוטה לעזר - האחריות לתיוג ולתקנות היא של בעל העסק. רכיב שלא הוגדרו לו אלרגנים מסומן כ'לא הוגדר' ולא כ'ללא אלרגנים'.")}</div>
            <div class="card" style="white-space:pre-wrap;font-size:14px;line-height:1.6;">${escapeHtml(labelText)}</div>
            <div class="card-title" style="margin:10px 0 4px;">אלרגנים לפי רכיב ${info("כאן מאשרים או מתקנים אילו אלרגנים יש בכל רכיב. השינוי נשמר במוצר ומשפיע על כל המתכונים שמשתמשים בו. ההצעה האוטומטית לפי שם המוצר היא רק עזר.")}</div>
            ${allergenRows().map((x) => `<div class="card-row" style="padding:6px 0;border-bottom:1px solid var(--border,#0001);"><span><b>${escapeHtml(x.name)}</b><br><span class="muted">${x.text}</span></span><button type="button" class="btn btn-secondary btn-small" data-al-edit="${x.id}">ערוך</button></div>`).join("")}
            <div class="checkbox-field" style="margin:10px 0 8px;"><input type="checkbox" id="d-pct" ${showPercent ? "checked" : ""}><label for="d-pct">הצג אחוזים</label></div>
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
                <button type="button" data-t="percent" class="${tab === "percent" ? "active" : ""}">אחוזים</button>
                <button type="button" data-t="label" class="${tab === "label" ? "active" : ""}">אלרגנים</button>
                ${r.status === "draft" ? "" : `<button type="button" data-t="gen" class="${tab === "gen" ? "active" : ""}">מחולל</button>`}
            </div>
            ${body}
            <div class="modal-actions"><button type="button" class="btn btn-secondary" id="d-close">סגור</button>
                <button type="button" class="btn btn-primary" id="d-edit">${r.status === "draft" ? "השלם" : "עריכה"}</button></div>
        `);
        if (keepTop) overlay.querySelector(".modal").scrollTop = keepTop;
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
        if (scaleEl) scaleEl.onchange = () => { scaleGrams = textToGrams(scaleEl.value) || null; draw(); };
        const bakersText = () => {
            const b = currentBase();
            const sc = scaleToBase(items(), b.ids, scaleGrams && scaleGrams > 0 ? scaleGrams : computePercentages(items(), b.ids).baseGrams);
            return [`${r.name} - מתכון באחוזים`, ...sc.map((x) => `${x.name}${x.isBase ? " (בסיס)" : ""}: ${fmtPct(x.pct)}% - ${x.scaledGrams} גרם`)].join("\n");
        };
        const pCopy = overlay.querySelector("#p-copy");
        if (pCopy) pCopy.onclick = async () => { try { await navigator.clipboard.writeText(bakersText()); toast("הועתק"); } catch (e) { toast("לא הצלחתי להעתיק"); } };
        const pPrint = overlay.querySelector("#p-print");
        if (pPrint) pPrint.onclick = () => printLabel(r.name + " - באחוזים", bakersText());

        // ---- לשונית מחולל ----
        const bind = (sel, ev, fn) => { const el = overlay.querySelector(sel); if (el) el[ev] = fn; };
        overlay.querySelectorAll("#g-quick [data-q]").forEach((b) => { b.onclick = () => { gen.mode = "factor"; gen.value = Number(b.dataset.q); draw(); }; });
        bind("#g-mode", "onchange", (e) => { gen.mode = e.target.value; gen.value = gen.mode === "weight" ? Math.round(r.items.reduce((n, i) => n + (Number(i.quantity_g) || 0), 0) * 2) : 2; draw(); });
        bind("#g-val", "onchange", (e) => { gen.value = gen.mode === "weight" ? textToGrams(e.target.value) : parseFloat(String(e.target.value).replace(",", ".")); draw(); });
        bind("#g-round", "onchange", (e) => { gen.round = e.target.checked; draw(); });
        bind("#e-prod", "onchange", (e) => { eggc.pid = e.target.value; draw(); });
        bind("#e-part", "onchange", (e) => { eggc.part = e.target.value; draw(); });
        bind("#e-qty", "onchange", (e) => { eggc.qty = e.target.value; draw(); });
        bind("#e-unit", "onchange", (e) => { eggc.unit = e.target.value; draw(); });
        bind("#c-qty", "onchange", (e) => { conv.qty = e.target.value; draw(); });
        bind("#c-unit", "onchange", (e) => { conv.unit = e.target.value; draw(); });
        bind("#c-name", "onchange", (e) => { conv.name = e.target.value; draw(); });
        if (tab === "gen") {
            const f = factorFor({ mode: gen.mode, value: gen.value, currentWeight: r.items.reduce((n, i) => n + (Number(i.quantity_g) || 0), 0) });
            const sc = f ? scaleRecipe(r.items, f, rows, { round: gen.round }) : null;
            const genText = () => [`${r.name} (פי ${+f.toFixed(3)})`, ...[...sc.rows].sort((a, b) => b.grams - a.grams).map((o) => `${nameOf(o)}${o.egg_part && o.egg_part !== "whole" ? " (" + o.eggLabel + ")" : ""}: ${fmtQty(o.grams)}`), `סה"כ: ${fmtQty(sc.totalGrams)}`, ...sc.eggs.map(eggSummaryText)].join("\n");
            bind("#g-copy", "onclick", async () => { try { await navigator.clipboard.writeText(genText()); toast("הועתק"); } catch (e) { toast("לא הצלחתי להעתיק"); } });
            bind("#g-print", "onclick", () => printLabel(r.name + " - מוגדל", genText()));
            bind("#g-save", "onclick", busy(async () => {
                const name = window.prompt("שם המתכון החדש:", `${r.name} (פי ${+f.toFixed(2)})`);
                if (!name || !name.trim()) return;
                await saveRecipe(null, {
                    name: name.trim(), category: r.category,
                    items: sc.rows.map((o) => ({ pantry_item_id: o.pantry_item_id, quantity_g: o.grams, ...(o.egg_part ? { egg_part: o.egg_part } : {}) })),
                    draft_ingredients: r.draft_ingredients || [], method: r.method || "",
                });
                closeModal();
                toast("נשמר כמתכון חדש");
                renderRecipesPage(container);
            }));
        }

        // ---- לשונית רכיבים ואלרגנים ----
        overlay.querySelectorAll("[data-al-edit]").forEach((b) => {
            b.onclick = () => openAllergenModal(byId.get(Number(b.dataset.alEdit)), (updated) => { byId.set(updated.id, updated); draw(); });
        });
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

// עריכת אלרגנים של מוצר (נפתח מתוך המתכון). onSaved מקבל את שורת המוצר המעודכנת.
function openAllergenModal(row, onSaved) {
    let sel = new Set(Array.isArray(row.allergens) ? row.allergens : []);
    const overlay = openModal(`
        <h2>אלרגנים - ${escapeHtml(row.name)}</h2>
        <div class="chips" id="al-chips"></div>
        <div class="hint">${Array.isArray(row.allergens) && !row.allergens_auto ? "" : "הוצע אוטומטית לפי השם - בדוק בתווית היצרן ואשר"}</div>
        <div class="modal-actions"><button type="button" class="btn btn-secondary" id="al-cancel">ביטול</button><button type="button" class="btn btn-primary" id="al-save">שמירה</button></div>`);
    const box = overlay.querySelector("#al-chips");
    const draw = () => {
        box.innerHTML = ALLERGENS.map((a) => `<button type="button" class="chip ${sel.has(a.key) ? "active" : ""}" data-al="${a.key}">${a.label}</button>`).join("");
        box.querySelectorAll("[data-al]").forEach((b) => { b.onclick = () => { if (sel.has(b.dataset.al)) sel.delete(b.dataset.al); else sel.add(b.dataset.al); draw(); }; });
    };
    draw();
    overlay.querySelector("#al-cancel").onclick = closeModal;
    overlay.querySelector("#al-save").onclick = busy(async () => {
        const updated = await setItemAllergens(row.id, [...sel]);
        closeModal();
        toast("נשמר");
        onSaved(updated);
    });
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
        <div class="field" style="margin-top:12px;"><label>משקל סופי ידני (ק"ג, אופציונלי - ריק = סכום המרכיבים)</label><input type="text" inputmode="decimal" id="f-manual-weight" value="${existing && !existing.is_auto_weight ? gramsToKgText(existing.final_weight) : ""}"></div>
        ${(existing && existing.source_file) || (draft && draft.source_file) ? '<div class="hint">📎 המסמך המקורי יישמר עם המתכון.</div>' : ""}
        <div class="card-row" style="font-weight:700;"><span>עלות כוללת:</span><span id="total-cost-display">${cur()}0.00</span></div>
        <div class="hint" id="egg-note"></div>
        <div class="hint" id="partial-note" style="display:none;color:var(--danger);">העלות חלקית - יש רכיבים שעדיין לא במזווה.</div>
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
        rowMeta.set(id, { um, eggPart: (prefill && prefill.egg_part) || "whole", eggSize: null, eggUnit: "g" });
        const row = h(`
            <div class="item-row-inputs" id="ing-row-${id}">
                ${um ? `<div class="hint-warn" style="margin-top:0;">מהמסמך: <b>${escapeHtml(um.name)}</b> ${escapeHtml(originalText(um))}</div>` : ""}
                <div class="top-line">
                    <button type="button" class="pick-btn" id="ing-pick-${id}" style="flex:2;">בחר מרכיב...</button>
                    <select id="ing-source-${id}" style="display:none;">
                        <option value="">${um ? "בחר מוצר מהמזווה..." : "בחר מרכיב..."}</option>
                        ${selectOptions(prefill ? prefill.pantry_item_id : null)}
                    </select>
                    <input type="text" inputmode="decimal" id="ing-qty-${id}" placeholder='ק"ג' style="width:80px;" value="${prefill && prefill.quantity_g != null ? gramsToKgText(prefill.quantity_g) : (um && gramsFromOriginal(um, null) != null ? gramsToKgText(gramsFromOriginal(um, null)) : "")}">
                    <button type="button" class="remove-row-btn" data-remove="${id}">✕</button>
                </div>
                <div class="line-total" id="ing-line-${id}"></div>
                <div class="hint" id="ing-echo-${id}" style="margin:2px 0;"></div>
                <div id="ing-egg-${id}" style="display:none;margin:6px 0;">
                    <div class="seg" id="ing-part-${id}">${EGG_PARTS.map(([k, l]) => `<button type="button" data-part="${k}">${l}</button>`).join("")}</div>
                    <div class="form-row">
                        <div class="field"><label>גודל ${info("הגודל קובע כמה גרם חלבון וחלמון יש בביצה (ללא קליפה). נשמר במוצר הביצים.")}</label><select id="ing-size-${id}">${Object.keys(EGG_SIZES).map((k) => `<option value="${k}">${k}</option>`).join("")}</select></div>
                        <div class="field"><label>הכמות ב-</label><select id="ing-eunit-${id}"><option value="g">ק"ג</option><option value="unit">יחידות</option></select></div>
                    </div>
                    <div class="hint" id="ing-egg-hint-${id}"></div>
                </div>
                ${um ? `<button type="button" class="btn btn-secondary btn-small" id="ing-qa-btn-${id}" style="margin-top:6px;">➕ הוסף "${escapeHtml(um.name)}" למזווה</button>
                <div id="ing-qa-${id}" style="display:none;background:var(--accent-soft);color:var(--text);border-radius:8px;padding:8px;margin-top:6px;">
                    <div class="form-row">
                        <div class="field"><label>קטגוריה</label><select id="qa-cat-${id}"><option value="">בחר...</option>${Object.keys(CATEGORY_GROUPS).map((c) => `<option value="${c}">${c}</option>`).join("")}</select></div>
                        <div class="field"><label>נמדד ב-</label><select id="qa-ut-${id}">${UNIT_TYPES.map((u) => `<option value="${u}">${UNIT_TYPE_LABELS[u]}</option>`).join("")}</select></div>
                    </div>
                    <div class="form-row">
                        <div class="field"><label id="qa-price-label-${id}">מחיר לק"ג (${curLabel()})</label><input type="number" step="any" id="qa-price-${id}"></div>
                        <div class="field" id="qa-ua-wrap-${id}" style="display:none;"><label>משקל ליחידה (גרם)</label><input type="number" step="any" id="qa-ua-${id}"></div>
                    </div>
                    <button type="button" class="btn btn-primary btn-small" id="qa-add-${id}">הוסף למזווה</button>
                    <div class="error-msg" id="qa-err-${id}"></div>
                </div>` : ""}
            </div>
        `);
        box.appendChild(row);
        bindPickerButton({
            button: row.querySelector(`#ing-pick-${id}`), select: row.querySelector(`#ing-source-${id}`), title: "בחר מרכיב", keyOf: (it) => String(it.id),
            getItems: () => {
                const unitWord = (it) => (it.unit_type === "unit" ? "יחידה" : it.unit_type === "liter" ? "ליטר" : 'ק"ג');
                return sources.filter((x) => !x.item.parent_id).map((x) => ({
                    key: `p${x.id}`, id: x.id, name: x.name, category: x.item.category, subcategory: x.item.subcategory || "", hint: `${money(x.item.price)} / ${unitWord(x.item)}`,
                    children: sources.filter((c) => c.item.parent_id === x.id).map((c) => ({ key: `p${c.id}`, id: c.id, name: c.name, category: x.item.category, subcategory: x.item.subcategory || "", hint: `${money(c.item.price)} / ${unitWord(c.item)}` })),
                }));
            },
        });
        row.querySelector(`#ing-source-${id}`).addEventListener("change", () => {
            // שורה מהמסמך שנבחר לה מוצר: אם אין כמות בגרם - מחשבים מהכמות שכתובה במסמך
            const qtyEl = row.querySelector(`#ing-qty-${id}`);
            if (um && !qtyEl.value) {
                const s = sources.find((x) => String(x.id) === row.querySelector(`#ing-source-${id}`).value);
                const g = gramsFromOriginal(um, s && s.item);
                if (g != null) qtyEl.value = gramsToKgText(g);
            }
            recalc();
        });
        row.querySelectorAll(`#ing-part-${id} [data-part]`).forEach((b) => { b.onclick = () => { rowMeta.get(id).eggPart = b.dataset.part; recalc(); }; });
        row.querySelector(`#ing-size-${id}`).addEventListener("change", (e) => {
            const pid = overlay.querySelector(`#ing-source-${id}`).value;
            box.querySelectorAll(".item-row-inputs").forEach((r2) => {
                const id2 = r2.id.replace("ing-row-", "");
                if (overlay.querySelector(`#ing-source-${id2}`).value === pid) rowMeta.get(Number(id2)).eggSize = e.target.value;
            });
            recalc();
        });
        row.querySelector(`#ing-eunit-${id}`).addEventListener("change", (e) => { rowMeta.get(id).eggUnit = e.target.value; recalc(); });
        row.querySelector(`#ing-qty-${id}`).addEventListener("input", recalc);
        row.querySelector("[data-remove]").onclick = () => { row.remove(); rowMeta.delete(id); recalc(); };

        if (um) {
            const qa = row.querySelector(`#ing-qa-${id}`);
            row.querySelector(`#ing-qa-btn-${id}`).onclick = () => { qa.style.display = qa.style.display === "none" ? "block" : "none"; };
            const ut = row.querySelector(`#qa-ut-${id}`);
            const syncQa = () => {
                row.querySelector(`#qa-price-label-${id}`).textContent = ut.value === "liter" ? `מחיר לליטר (${curLabel()})` : ut.value === "unit" ? `מחיר ליחידה (${curLabel()})` : `מחיר לק"ג (${curLabel()})`;
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
                    if (!qtyEl.value) { const g = gramsFromOriginal(um, item); if (g != null) qtyEl.value = gramsToKgText(g); }
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

    // שורת ביצים: מציגה בחירת חלק/גודל/יחידות, ומחזירה כמה גרם השורה (בהמרה מיחידות) ופרטי הביצה. אחרת null.
    function eggRow(id) {
        const sourceId = parseInt(overlay.querySelector(`#ing-source-${id}`).value, 10);
        const s = sources.find((x) => x.id === sourceId);
        const wrap = overlay.querySelector(`#ing-egg-${id}`);
        const meta = rowMeta.get(Number(id));
        if (!s || !isEggProduct(s.item) || !meta) { if (wrap) wrap.style.display = "none"; return null; }
        const size = meta.eggSize || eggSizeOf(s.item);
        wrap.style.display = "";
        overlay.querySelector(`#ing-size-${id}`).value = size;
        overlay.querySelector(`#ing-eunit-${id}`).value = meta.eggUnit;
        overlay.querySelectorAll(`#ing-part-${id} [data-part]`).forEach((b) => b.classList.toggle("active", b.dataset.part === meta.eggPart));
        const rawText = overlay.querySelector(`#ing-qty-${id}`).value;
        const pg = partGrams(size, meta.eggPart);
        const qty = meta.eggUnit === "unit" ? parseFloat(String(rawText).replace(",", ".")) || 0 : 0;
        const grams = meta.eggUnit === "unit" ? Math.round(qty * pg * 100) / 100 : textToGrams(rawText) || 0;
        const hint = overlay.querySelector(`#ing-egg-hint-${id}`);
        const liquid = EGG_SIZES[size].liquid;
        let text = meta.eggUnit === "unit" && qty > 0 ? `${qty} ${EGG_PART_LABEL[meta.eggPart]} = ${grams} גרם. ` : "";
        const mismatch = s.item.unit_amount > 0 && s.item.unit_amount !== liquid;
        hint.innerHTML = escapeHtml(text) + (mismatch ? `משקל הביצה במזווה: ${s.item.unit_amount} גרם, ללא קליפה: ${liquid} גרם. <button type="button" class="btn btn-secondary btn-small" data-fix="${id}">עדכן במזווה ל-${liquid}</button>` : "");
        const fix = hint.querySelector("[data-fix]");
        if (fix) fix.onclick = async () => { await setEggSize(s.id, size, { force: true }); s.item.unit_amount = liquid; s.item.egg_size = size; recalc(); };
        return { s, size, part: meta.eggPart, grams };
    }

    function recalc() {
        let total = 0;
        let hasUnmatched = false;
        const eggGroups = new Map(); // מזהה ביצה -> שורות. עלות ביצים = כל הביצים ששוברים, מחולקת בין השורות לפי גרמים
        box.querySelectorAll(".item-row-inputs").forEach((row) => {
            const id = row.id.replace("ing-row-", "");
            const sourceId = parseInt(overlay.querySelector(`#ing-source-${id}`).value, 10);
            const meta = rowMeta.get(Number(id));
            const s = sources.find((x) => x.id === sourceId);
            const lineEl = overlay.querySelector(`#ing-line-${id}`);
            refreshPickerButton(overlay.querySelector(`#ing-pick-${id}`), overlay.querySelector(`#ing-source-${id}`));
            const egg = eggRow(id);
            const rawText = overlay.querySelector(`#ing-qty-${id}`).value;
            const qty = egg ? egg.grams : textToGrams(rawText) || 0;
            const echoEl = overlay.querySelector(`#ing-echo-${id}`);
            if (echoEl) {
                const liquid = !!(s && s.item.unit_type === "liter");
                const warn = egg && meta.eggUnit === "unit" ? null : qtyWarning(rawText, { liquid });
                echoEl.innerHTML = warn ? `<span style="color:var(--danger);">${escapeHtml(warn)}</span>` : egg && meta.eggUnit === "unit" ? "" : escapeHtml(describeQty(rawText, { liquid }));
            }
            if (s && qty > 0) {
                if (egg) {
                    const g = eggGroups.get(s.id) || { s, size: egg.size, rows: [] };
                    g.rows.push({ lineEl, egg_part: egg.part, grams: egg.grams });
                    eggGroups.set(s.id, g);
                    lineEl.textContent = "";
                } else {
                    const cost = calcItemCost(pricePerGram(s.item), qty);
                    lineEl.textContent = money(cost);
                    total += cost;
                }
            } else {
                lineEl.textContent = "";
                if (meta && meta.um) hasUnmatched = true;
            }
        });
        for (const g of eggGroups.values()) {
            const price = effectivePrice(g.s.item.price, g.s.item.yield_pct, g.s.item.is_frozen);
            const { costs } = allocateEggCosts(g.rows, g.size, price);
            g.rows.forEach((r, i) => { r.lineEl.textContent = money(costs[i]); total += costs[i]; });
        }
        overlay.querySelector("#total-cost-display").textContent = money(total);
        const eggLines = [];
        box.querySelectorAll(".item-row-inputs").forEach((row) => {
            const id = row.id.replace("ing-row-", "");
            const egg = eggRow(id);
            if (egg) eggLines.push({ pantry_item_id: egg.s.id, quantity_g: egg.grams, egg_part: egg.part, egg_size: egg.size });
        });
        overlay.querySelector("#egg-note").innerHTML = recipeEggSummary(eggLines, sources.map((x) => x.item)).map((e) => escapeHtml(eggSummaryText(e))).join("<br>");
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
        const eggSizeChanges = new Map(); // מזהה ביצה -> גודל שנבחר בשורה
        box.querySelectorAll(".item-row-inputs").forEach((row) => {
            const id = row.id.replace("ing-row-", "");
            const pantry_item_id = overlay.querySelector(`#ing-source-${id}`).value;
            const egg = eggRow(id);
            const quantity_g = egg ? (egg.grams > 0 ? egg.grams : "") : (textToGrams(overlay.querySelector(`#ing-qty-${id}`).value) || "");
            const meta = rowMeta.get(Number(id));
            if (egg && meta.eggSize) eggSizeChanges.set(egg.s.id, meta.eggSize);
            if (pantry_item_id && quantity_g) items.push({ pantry_item_id, quantity_g, ...(egg ? { egg_part: egg.part } : {}) });
            else if (meta && meta.um) draftIngredients.push({ name: meta.um.name, quantity: meta.um.quantity, unit: meta.um.unit });
        });
        const el = overlay.querySelector(".error-msg");
        const data = {
            name: overlay.querySelector("#f-name").value,
            category: overlay.querySelector("#f-category").value,
            items,
            draft_ingredients: draftIngredients,
            method: overlay.querySelector("#f-method").value,
            final_weight: String(textToGrams(overlay.querySelector("#f-manual-weight").value) ?? ""),
        };
        if (!isEdit && draft && draft.source_file) data.source_file = draft.source_file;
        if (draftIngredients.length && !window.confirm(`${draftIngredients.length} רכיבים עדיין לא במזווה:\n${draftIngredients.map((d) => d.name).join(", ")}\n\nלשמור כטיוטה ולהשלים אותם אחר כך?`)) return;
        try {
            for (const [eggId, size] of eggSizeChanges) await setEggSize(eggId, size);
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
