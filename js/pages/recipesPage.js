import { listRecipesWithItems, saveRecipe, deleteRecipe } from "../repo/recipesRepo.js";
import { listAllPantryItems } from "../repo/pantryRepo.js";
import { RECIPE_CATEGORIES, NON_FOOD_CATEGORIES } from "../constants.js";
import { pricePerGram, itemCost as calcItemCost, recipeCostPerGram } from "../formulas.js";
import { h, openModal, closeModal, confirmDialog, toast, escapeHtml, money } from "../ui.js";
import { openImagePicker } from "../imagePicker.js";
import { scanRecipeImage } from "../repo/scanRepo.js";
import { getSetting } from "../repo/settingsRepo.js";

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

export async function renderRecipesPage(container) {
    const recipes = await listRecipesWithItems();
    recipes.sort((a, b) => a.category.localeCompare(b.category, "he") || a.name.localeCompare(b.name, "he"));

    container.innerHTML = `<div class="subtitle">מתכוני בסיס (רטבים, מרקים וכו') שמשמשים כמרכיבים במנות.</div>
        <div class="btn-row"><button class="btn btn-accent" id="btn-scan-recipe">📷 סרוק מתכון (תמונה / קובץ)</button></div>
        <div id="recipes-list"></div><button class="fab-add" id="btn-add">+</button>`;
    const list = container.querySelector("#recipes-list");
    if (recipes.length === 0) {
        list.innerHTML = '<div class="empty-state">אין עדיין מתכונים - לחץ על + כדי להוסיף.</div>';
    } else {
        for (const r of recipes) list.appendChild(renderRecipeCard(r, container));
    }
    container.querySelector("#btn-add").onclick = () => openRecipeModal(null, container);
    container.querySelector("#btn-scan-recipe").onclick = () => openImagePicker({
        title: "סריקת מתכון",
        hint: "צלם או העלה תמונה/PDF של מתכון - נזהה שם, מרכיבים וכמויות, ותוכל לבדוק ולתקן לפני שמירה.",
        onFile: async (file) => {
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
        },
    });
}

function renderRecipeCard(r, container) {
    const card = h(`
        <div class="card">
            <div class="card-title">${escapeHtml(r.name)}</div>
            <div class="card-row">
                <span class="tag">${escapeHtml(r.category)}</span>
                <span>${r.final_weight.toFixed(0)} גרם ${r.is_auto_weight ? "(אוטומטי)" : "(ידני)"}</span>
            </div>
            <div class="card-row"><span class="muted">${r.items.length} מרכיבים</span><span class="price-real">${money(r.cost_per_gram)} / גרם</span></div>
            <div class="card-actions">
                <button class="btn btn-secondary btn-small" data-edit>עריכה</button>
                <button class="btn btn-danger btn-small" data-delete>מחיקה</button>
            </div>
        </div>
    `);
    card.querySelector("[data-edit]").onclick = () => openRecipeModal(r, container);
    card.querySelector("[data-delete]").onclick = async () => {
        if (!(await confirmDialog("למחוק את המתכון?"))) return;
        await deleteRecipe(r.id);
        toast("נמחק");
        renderRecipesPage(container);
    };
    return card;
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
    if (unmatched.length) html += `<div><b>לא נמצאו במזווה (בחר ידנית, או הוסף קודם למזווה - אחרת לא ישמרו):</b> ${unmatched.map(escapeHtml).join(", ")}</div>`;
    if (fuzzy.length) html += `<div style="margin-top:6px;"><b>התאמות משוערות - בדוק:</b> ${fuzzy.map(escapeHtml).join(", ")}</div>`;
    if (noQty.length) html += `<div style="margin-top:6px;"><b>חסרה כמות:</b> ${noQty.map(escapeHtml).join(", ")}</div>`;
    return `<div class="hint-warn">${html || "כל המרכיבים זוהו. בדוק את הכמויות לפני שמירה."}</div>`;
}

async function openRecipeModal(existing, container, draft = null) {
    const sources = await ingredientSources();
    const isEdit = !!existing;
    const src = existing || draft;
    let rowCounter = 0;

    const overlay = openModal(`
        <h2>${isEdit ? "עריכת מתכון" : draft ? "מתכון חדש (מסריקה - בדוק לפני שמירה)" : "מתכון חדש"}</h2>
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
        <div class="field" style="margin-top:12px;"><label>משקל סופי ידני (גרם, אופציונלי - ריק = סכום המרכיבים)</label><input type="number" step="any" id="f-manual-weight" value="${existing ? (!existing.is_auto_weight ? existing.final_weight : "") : (draft && draft.final_weight ? draft.final_weight : "")}"></div>
        <div class="card-row" style="font-weight:700;"><span>עלות כוללת:</span><span id="total-cost-display">₪0.00</span></div>
        <div class="error-msg"></div>
        <div class="modal-actions">
            <button class="btn btn-secondary" id="btn-cancel">ביטול</button>
            <button class="btn btn-primary" id="btn-save">שמירה</button>
        </div>
    `);

    const box = overlay.querySelector("#ingredients-box");

    function addRow(prefill) {
        const id = rowCounter++;
        const row = h(`
            <div class="item-row-inputs" id="ing-row-${id}">
                <div class="top-line">
                    <select id="ing-source-${id}" style="flex:2;">
                        <option value="">בחר מרכיב...</option>
                        ${sources.map((s) => `<option value="${s.id}" ${prefill && prefill.pantry_item_id === s.id ? "selected" : ""}>${s.indent ? "↳ " : ""}${escapeHtml(s.name)}</option>`).join("")}
                    </select>
                    <input type="number" step="any" id="ing-qty-${id}" placeholder="גרם" style="width:80px;" value="${prefill && prefill.quantity_g != null ? prefill.quantity_g : ""}">
                    <button type="button" class="remove-row-btn" data-remove="${id}">✕</button>
                </div>
                <div class="line-total" id="ing-line-${id}"></div>
            </div>
        `);
        box.appendChild(row);
        row.querySelector(`#ing-source-${id}`).addEventListener("change", recalc);
        row.querySelector(`#ing-qty-${id}`).addEventListener("input", recalc);
        row.querySelector("[data-remove]").onclick = () => { row.remove(); recalc(); };
    }

    function recalc() {
        let total = 0;
        box.querySelectorAll(".item-row-inputs").forEach((row) => {
            const id = row.id.replace("ing-row-", "");
            const sourceId = parseInt(overlay.querySelector(`#ing-source-${id}`).value, 10);
            const qty = parseFloat(overlay.querySelector(`#ing-qty-${id}`).value) || 0;
            const src = sources.find((s) => s.id === sourceId);
            const lineEl = overlay.querySelector(`#ing-line-${id}`);
            if (src && qty > 0) {
                const ppg = pricePerGram(src.item);
                const cost = calcItemCost(ppg, qty);
                lineEl.textContent = money(cost);
                total += cost;
            } else {
                lineEl.textContent = "";
            }
        });
        overlay.querySelector("#total-cost-display").textContent = money(total);
        return total;
    }

    if (existing) {
        for (const it of existing.items) addRow(it);
    } else if (draft && draft.ingredients.length) {
        for (const ing of draft.ingredients) addRow({ pantry_item_id: ing.pantry_item_id, quantity_g: ing.quantity_g });
    } else {
        addRow();
    }
    recalc();
    overlay.querySelector("#btn-add-row").onclick = () => addRow();

    overlay.querySelector("#btn-cancel").onclick = closeModal;
    overlay.querySelector("#btn-save").onclick = async () => {
        const items = [];
        box.querySelectorAll(".item-row-inputs").forEach((row) => {
            const id = row.id.replace("ing-row-", "");
            const pantry_item_id = overlay.querySelector(`#ing-source-${id}`).value;
            const quantity_g = overlay.querySelector(`#ing-qty-${id}`).value;
            if (pantry_item_id && quantity_g) items.push({ pantry_item_id, quantity_g });
        });
        const data = {
            name: overlay.querySelector("#f-name").value,
            category: overlay.querySelector("#f-category").value,
            items,
            final_weight: overlay.querySelector("#f-manual-weight").value,
        };
        try {
            await saveRecipe(existing ? existing.id : null, data);
            closeModal();
            toast("נשמר");
            renderRecipesPage(container);
        } catch (e) {
            const el = overlay.querySelector(".error-msg");
            el.textContent = e.message;
            el.style.display = "block";
        }
    };
}
