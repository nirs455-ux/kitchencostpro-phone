import { listDishesWithItems, saveDish, deleteDish } from "../repo/dishesRepo.js";
import { listAllPantryItems } from "../repo/pantryRepo.js";
import { dbGetAll } from "../db.js";
import { NON_FOOD_CATEGORIES } from "../constants.js";
import { pricePerGram, itemCost as calcItemCost, computeDishPricing } from "../formulas.js";
import { h, openModal, closeModal, confirmDialog, toast, escapeHtml, money, info } from "../ui.js";

async function allSources() {
    const pantry = (await listAllPantryItems()).filter((it) => !NON_FOOD_CATEGORIES.has(it.category));
    const topLevel = pantry.filter((it) => !it.parent_id).sort((a, b) => a.category.localeCompare(b.category, "he") || a.name.localeCompare(b.name, "he"));
    const out = [];
    for (const p of topLevel) {
        out.push({ source_type: "pantry", source_id: p.id, name: p.name, indent: false, ppgSource: p });
        for (const c of pantry.filter((it) => it.parent_id === p.id)) {
            out.push({ source_type: "pantry", source_id: c.id, name: c.name, indent: true, ppgSource: c });
        }
    }
    const recipes = await dbGetAll("recipes");
    for (const r of recipes.sort((a, b) => a.name.localeCompare(b.name, "he"))) {
        out.push({ source_type: "recipe", source_id: r.id, name: `📖 ${r.name}`, indent: false, ppgSource: null, recipeCostPerGram: r.cost_per_gram });
    }
    return out;
}

function ppgFor(src) {
    return src.source_type === "recipe" ? src.recipeCostPerGram : pricePerGram(src.ppgSource);
}

export async function renderDishesPage(container) {
    const dishes = await listDishesWithItems();
    dishes.sort((a, b) => a.name.localeCompare(b.name, "he"));

    container.innerHTML = `<div id="dishes-list"></div><button class="fab-add" id="btn-add">+</button>`;
    const list = container.querySelector("#dishes-list");
    if (dishes.length === 0) {
        list.innerHTML = '<div class="empty-state">אין עדיין מנות - לחץ על + כדי להוסיף.</div>';
    } else {
        for (const d of dishes) list.appendChild(renderDishCard(d, container));
    }
    container.querySelector("#btn-add").onclick = () => openDishModal(null, container);
}

function renderDishCard(d, container) {
    const fcHigh = d.food_cost_pct > 33;
    const card = h(`
        <div class="card">
            <div class="card-title">${escapeHtml(d.name)}</div>
            <div class="card-row"><span class="muted">מחיר מכירה</span><span>${money(d.selling_price)}</span></div>
            <div class="card-row"><span class="muted">עלות</span><span>${money(d.total_cost)}</span></div>
            <div class="card-row">
                <span class="tag ${fcHigh ? "tag-danger" : ""}">Food Cost: ${d.food_cost_pct.toFixed(1)}%</span>
                <span class="price-real">רווח: ${d.profit_pct.toFixed(1)}%</span>
            </div>
            <div class="card-actions">
                <button class="btn btn-secondary btn-small" data-edit>עריכה</button>
                <button class="btn btn-danger btn-small" data-delete>מחיקה</button>
            </div>
        </div>
    `);
    card.querySelector("[data-edit]").onclick = () => openDishModal(d, container);
    card.querySelector("[data-delete]").onclick = async () => {
        if (!(await confirmDialog("למחוק את המנה?"))) return;
        await deleteDish(d.id);
        toast("נמחק");
        renderDishesPage(container);
    };
    return card;
}

async function openDishModal(existing, container) {
    const sources = await allSources();
    let rowCounter = 0;

    const overlay = openModal(`
        <h2>${existing ? "עריכת מנה" : "מנה חדשה"}</h2>
        <div class="field"><label>שם מנה</label><input type="text" id="f-name" value="${existing ? escapeHtml(existing.name) : ""}"></div>
        <div id="ingredients-box"></div>
        <button type="button" class="btn btn-secondary btn-small" id="btn-add-row">+ הוסף מרכיב</button>
        <div class="card-row" style="font-weight:700;margin-top:10px;"><span>עלות כוללת:</span><span id="cost-display">₪0.00</span></div>
        <div class="form-row" style="margin-top:12px;">
            <div class="field"><label>מכפיל עלות (ידני, אופציונלי)</label><input type="number" step="any" id="f-multiplier" placeholder="לדוגמה: 3.5" value="${existing && existing.multiplier ? existing.multiplier : ""}"></div>
            <div class="field"><label>יעד אחוז עלות מזון % (אופציונלי) ${info("יעד 25% = מכפיל ×4. המחיר למטה מתמלא אוטומטית ברגע שמזינים מכפיל או יעד, ועדיין אפשר לערוך אותו ידנית.")}</label><input type="number" step="any" id="f-target" placeholder="לדוגמה: 25" value="${existing && existing.target_profit_pct ? existing.target_profit_pct : ""}"></div>
        </div>
        <div class="field"><label>מחיר (₪, לפני מע"מ)</label><input type="number" step="any" id="f-price" value="${existing ? existing.price_before_vat : ""}"></div>
        <div class="field"><label>מע"מ (%)</label><input type="number" step="any" id="f-vat" value="${existing ? existing.vat_pct : 18}"></div>
        <div class="card" id="pricing-preview" style="background:#f4f5f7;"></div>
        <div class="error-msg"></div>
        <div class="modal-actions">
            <button class="btn btn-secondary" id="btn-cancel">ביטול</button>
            <button class="btn btn-primary" id="btn-save">שמירה</button>
        </div>
    `);

    const box = overlay.querySelector("#ingredients-box");

    function addRow(prefill) {
        const id = rowCounter++;
        const selected = prefill ? sources.find((s) => s.source_type === prefill.source_type && s.source_id === prefill.source_id) : null;
        const row = h(`
            <div class="item-row-inputs" id="dish-row-${id}">
                <div class="top-line">
                    <select id="dish-source-${id}" style="flex:2;">
                        <option value="">בחר מרכיב/מתכון...</option>
                        ${sources.map((s, i) => `<option value="${i}" ${selected && sources[i] === selected ? "selected" : ""}>${s.indent ? "↳ " : ""}${escapeHtml(s.name)}</option>`).join("")}
                    </select>
                    <input type="number" step="any" id="dish-qty-${id}" placeholder="גרם" style="width:80px;" value="${prefill ? prefill.quantity_g : ""}">
                    <button type="button" class="remove-row-btn" data-remove="${id}">✕</button>
                </div>
                <div class="line-total" id="dish-line-${id}"></div>
            </div>
        `);
        box.appendChild(row);
        row.querySelector(`#dish-source-${id}`).addEventListener("change", recalc);
        row.querySelector(`#dish-qty-${id}`).addEventListener("input", recalc);
        row.querySelector("[data-remove]").onclick = () => { row.remove(); recalc(); };
    }

    function recalc() {
        let total = 0;
        box.querySelectorAll(".item-row-inputs").forEach((row) => {
            const id = row.id.replace("dish-row-", "");
            const idx = overlay.querySelector(`#dish-source-${id}`).value;
            const qty = parseFloat(overlay.querySelector(`#dish-qty-${id}`).value) || 0;
            const lineEl = overlay.querySelector(`#dish-line-${id}`);
            if (idx !== "" && qty > 0) {
                const src = sources[idx];
                const cost = calcItemCost(ppgFor(src), qty);
                lineEl.textContent = money(cost);
                total += cost;
            } else {
                lineEl.textContent = "";
            }
        });
        overlay.querySelector("#cost-display").textContent = money(total);

        const multiplier = parseFloat(overlay.querySelector("#f-multiplier").value) || 0;
        const target = parseFloat(overlay.querySelector("#f-target").value) || 0;
        // מחיר לפני מע"מ מתמלא אוטומטית מהמכפיל או מהיעד (עדיפות למכפיל), ועדיין ניתן לעריכה ידנית
        if (multiplier > 0 && total > 0) {
            overlay.querySelector("#f-price").value = (total * multiplier).toFixed(2);
        } else if (target > 0 && target < 100 && total > 0) {
            overlay.querySelector("#f-price").value = (total / (target / 100)).toFixed(2);
        }

        const priceBeforeVat = parseFloat(overlay.querySelector("#f-price").value) || 0;
        const vatPct = parseFloat(overlay.querySelector("#f-vat").value) || 0;
        const sellingPrice = priceBeforeVat * (1 + vatPct / 100);
        const preview = overlay.querySelector("#pricing-preview");
        if (priceBeforeVat > 0) {
            const r = computeDishPricing(total, sellingPrice, vatPct);
            preview.innerHTML = `
                <div class="card-row"><span>מחיר מכירה (כולל מע"מ)</span><span>${money(sellingPrice)}</span></div>
                <div class="card-row"><span>רווח</span><span>${money(r.profit_amount)} (${r.profit_pct.toFixed(1)}%)</span></div>
                <div class="card-row"><span>Food Cost %</span><span>${r.food_cost_pct.toFixed(1)}%</span></div>
            `;
        } else {
            preview.innerHTML = `<div class="card-row"><span class="muted">הזן מחיר (ידנית או דרך מכפיל/יעד למעלה) כדי לראות רווחיות</span></div>`;
        }
        return total;
    }

    if (existing) {
        for (const it of existing.items) addRow(it);
    } else {
        addRow();
    }
    recalc();
    overlay.querySelector("#btn-add-row").onclick = () => addRow();
    overlay.querySelector("#f-price").addEventListener("input", recalc);
    overlay.querySelector("#f-vat").addEventListener("input", recalc);
    overlay.querySelector("#f-multiplier").addEventListener("input", recalc);
    overlay.querySelector("#f-target").addEventListener("input", recalc);

    overlay.querySelector("#btn-cancel").onclick = closeModal;
    overlay.querySelector("#btn-save").onclick = async () => {
        const items = [];
        box.querySelectorAll(".item-row-inputs").forEach((row) => {
            const id = row.id.replace("dish-row-", "");
            const idx = overlay.querySelector(`#dish-source-${id}`).value;
            const qty = overlay.querySelector(`#dish-qty-${id}`).value;
            if (idx !== "" && qty) {
                const src = sources[idx];
                items.push({ source_type: src.source_type, source_id: src.source_id, quantity_g: qty });
            }
        });
        const priceBeforeVat = parseFloat(overlay.querySelector("#f-price").value) || 0;
        const vatPct = parseFloat(overlay.querySelector("#f-vat").value) || 0;
        const data = {
            name: overlay.querySelector("#f-name").value,
            items,
            // הבקאנד מצפה למחיר כולל מע"מ - מחשבים אותו כאן מהמחיר לפני מע"מ שהוזן, כמו בגרסת המחשב
            selling_price: priceBeforeVat * (1 + vatPct / 100),
            vat_pct: vatPct,
            multiplier: overlay.querySelector("#f-multiplier").value,
            target_profit_pct: overlay.querySelector("#f-target").value,
        };
        try {
            await saveDish(existing ? existing.id : null, data);
            closeModal();
            toast("נשמר");
            renderDishesPage(container);
        } catch (e) {
            const el = overlay.querySelector(".error-msg");
            el.textContent = e.message;
            el.style.display = "block";
        }
    };
}
