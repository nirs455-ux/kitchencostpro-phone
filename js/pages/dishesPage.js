import { listDishesWithItems, saveDish, deleteDish } from "../repo/dishesRepo.js";
import { listAllPantryItems } from "../repo/pantryRepo.js";
import { dbGetAll } from "../db.js";
import { NON_FOOD_CATEGORIES } from "../constants.js";
import { pricePerGram, itemCost as calcItemCost, computeDishPricing, isCountItem } from "../formulas.js";
import { textToGrams, gramsToKgText, describeQty, qtyWarning, textToCount, countToText, describeCount, countWarning, isGramMode } from "../qty.js";
import { bindPickerButton, refreshPickerButton, resetPickerMemory } from "./ingredientPicker.js";
import { listRow, matchesDeep } from "./listKit.js";
import { renderSalesTab, renderGapTab } from "./salesPage.js";
import { assignAutoSubs, subOf } from "../autoGroups.js";
import { h, openModal, closeModal, confirmDialog, toast, escapeHtml, money, info, busy, attemptClose, cur, curLabel } from "../ui.js";

async function allSources() {
    const pantry = (await listAllPantryItems()).filter((it) => !NON_FOOD_CATEGORIES.has(it.category));
    const topLevel = pantry.filter((it) => !it.parent_id).sort((a, b) => a.category.localeCompare(b.category, "he") || a.name.localeCompare(b.name, "he"));
    const out = [];
    for (const p of topLevel) {
        out.push({ source_type: "pantry", source_id: p.id, name: p.name, indent: false, ppgSource: p, category: p.category, subcategory: p.subcategory || "" });
        for (const c of pantry.filter((it) => it.parent_id === p.id)) {
            out.push({ source_type: "pantry", source_id: c.id, name: c.name, indent: true, ppgSource: c, category: p.category, subcategory: p.subcategory || "" });
        }
    }
    const recipes = await dbGetAll("recipes");
    for (const r of recipes.filter((x) => x.status !== "draft").sort((a, b) => a.name.localeCompare(b.name, "he"))) {
        out.push({ source_type: "recipe", source_id: r.id, name: `📖 ${r.name}`, plainName: r.name, indent: false, ppgSource: null, recipeCostPerGram: r.cost_per_gram, category: r.category || "מתכונים", subcategory: "" });
    }
    return out;
}

// מוצר מזווה ביחידות בלי משקל: הכמות במנה היא מספר יחידות
const isCountSrc = (src) => !!src && src.source_type === "pantry" && isCountItem(src.ppgSource);
function ppgFor(src) {
    return src.source_type === "recipe" ? src.recipeCostPerGram : pricePerGram(src.ppgSource);
}

// לשוניות הדף: מנות | מכירות | דוח פער
let dishTab = "dishes";
const DISH_TABS = [["dishes", "מנות"], ["sales", "מכירות"], ["gap", "דוח פער"]];
const segHtml = () => `<div class="seg" id="ds-seg">${DISH_TABS.map(([k, l]) => `<button type="button" data-tab="${k}" class="${k === dishTab ? "active" : ""}">${l}</button>`).join("")}</div>`;
function wireSeg(container) { container.querySelectorAll("#ds-seg [data-tab]").forEach((b) => { b.onclick = () => { dishTab = b.dataset.tab; renderDishesPage(container); }; }); }

export async function renderDishesPage(container) {
    if (dishTab !== "dishes") {
        container.innerHTML = `${segHtml()}<div id="ds-sub"></div>`;
        wireSeg(container);
        const sub = container.querySelector("#ds-sub");
        if (dishTab === "sales") await renderSalesTab(sub); else await renderGapTab(sub);
        return;
    }
    const dishes = await listDishesWithItems();
    dishes.sort((a, b) => a.name.localeCompare(b.name, "he"));
    let q = "";
    container.innerHTML = `${segHtml()}${dishes.length ? `<div class="px-top"><input type="search" id="ds-q" placeholder="חיפוש מנה..." autocomplete="off"></div>` : ""}<div id="dishes-list"></div><button class="fab-add" id="btn-add">+</button>`;
    wireSeg(container);
    const list = container.querySelector("#dishes-list");
    const draw = () => {
        list.innerHTML = "";
        if (!dishes.length) { list.innerHTML = '<div class="empty-state">אין עדיין מנות - לחץ על + כדי להוסיף.</div>'; return; }
        const shown = dishes.filter((d) => matchesDeep({ name: d.name }, q));
        if (!shown.length) { list.innerHTML = '<div class="empty-state">לא נמצאה מנה תואמת.</div>'; return; }
        for (const d of shown) {
            const fc = Number(d.food_cost_pct) || 0;
            const tone = fc > 33 ? "danger" : fc > 30 ? "warn" : "ok";
            const tint = tone === "danger" ? "var(--danger-soft)" : tone === "warn" ? "var(--warn-soft)" : "var(--ok-soft)";
            list.appendChild(listRow({
                ic: "🍽️", tint, name: d.name,
                meta: `מחיר ${money(d.selling_price)} · עלות ${money(d.total_cost)} · רווח ${Number(d.profit_pct).toFixed(0)}%`,
                end: `<span class="tag ${tone === "danger" ? "tag-danger" : tone === "warn" ? "tag-warn" : ""}">${fc.toFixed(1)}%</span><small>עלות מזון</small>`,
                onClick: () => openDishModal(d, container),
            }));
        }
    };
    const qEl = container.querySelector("#ds-q");
    if (qEl) qEl.oninput = () => { q = qEl.value; draw(); };
    draw();
    container.querySelector("#btn-add").onclick = () => openDishModal(null, container);
}

async function openDishModal(existing, container) {
    resetPickerMemory();
    const sources = await allSources();
    let rowCounter = 0;

    const overlay = openModal(`
        <div class="pg-top"><button type="button" class="pg-back" id="btn-cancel" aria-label="חזרה">→</button>
            <div class="pg-title">${existing ? "עריכת מנה" : "מנה חדשה"}</div>
            ${existing ? '<button type="button" class="pg-del" id="btn-del-dish">מחיקה</button>' : ""}</div>
        <div class="pg-body">
            <div class="field"><label>שם המנה</label><input type="text" id="f-name" value="${existing ? escapeHtml(existing.name) : ""}"></div>
            <div class="pg-sec">מרכיבים</div>
            <div id="ingredients-box"></div>
            <button type="button" class="pg-add" id="btn-add-row">＋ הוסף מרכיב או מתכון</button>
            <div class="pg-sec">מחיר ורווחיות</div>
            <div class="card-pg">
                <div class="field"><label>מחיר מכירה (${curLabel()}, לפני מע"מ)</label><input type="number" step="any" id="f-price" value="${existing ? existing.price_before_vat : ""}"></div>
                <div id="pricing-preview"></div>
                <details class="pg-more"><summary>מכפיל, יעד עלות מזון ומע"מ</summary>
                    <div class="form-row">
                        <div class="field"><label>מכפיל עלות</label><input type="number" step="any" id="f-multiplier" placeholder="לדוגמה: 3.5" value="${existing && existing.multiplier ? existing.multiplier : ""}"></div>
                        <div class="field"><label>יעד עלות מזון % ${info("יעד 25% = מכפיל ×4. המחיר למעלה מתמלא אוטומטית ברגע שמזינים מכפיל או יעד, ועדיין אפשר לערוך אותו ידנית.")}</label><input type="number" step="any" id="f-target" placeholder="לדוגמה: 25" value="${existing && existing.target_profit_pct ? existing.target_profit_pct : ""}"></div>
                    </div>
                    <div class="field"><label>מע"מ (%)</label><input type="number" step="any" id="f-vat" value="${existing ? existing.vat_pct : 18}"></div>
                </details>
            </div>
            <div class="error-msg"></div>
        </div>
        <div class="pg-foot"><div class="pg-sum"><span>עלות המנה</span><b id="cost-display">${cur()}0.00</b></div>
            <div class="pg-sum"><span>מחיר כולל מע"מ</span><b id="sell-display">—</b></div>
            <button type="button" class="btn btn-primary btn-block" id="btn-save">שמירת מנה</button></div>
    `, { page: true });
    const delBtn = overlay.querySelector("#btn-del-dish");
    if (delBtn) delBtn.onclick = async () => {
        closeModal();
        if (!(await confirmDialog("למחוק את המנה?"))) return;
        await deleteDish(existing.id);
        toast("נמחק");
        renderDishesPage(container);
    };

    const box = overlay.querySelector("#ingredients-box");

    function addRow(prefill) {
        const id = rowCounter++;
        const selected = prefill ? sources.find((s) => s.source_type === prefill.source_type && s.source_id === prefill.source_id) : null;
        const row = h(`
            <div class="item-row-inputs" id="dish-row-${id}">
                <div class="top-line">
                    <button type="button" class="pick-btn" id="dish-pick-${id}" style="flex:2;">בחר מרכיב...</button>
                    <select id="dish-source-${id}" style="display:none;">
                        <option value="">בחר מרכיב/מתכון...</option>
                        ${sources.map((s, i) => `<option value="${i}" ${selected && sources[i] === selected ? "selected" : ""}>${s.indent ? "↳ " : ""}${escapeHtml(s.name)}</option>`).join("")}
                    </select>
                    <input type="text" inputmode="decimal" id="dish-qty-${id}" placeholder="${isGramMode() ? "גרם" : 'ק"ג'}" style="width:80px;" value="${prefill ? (selected && isCountSrc(selected) ? countToText(prefill.quantity_g) : gramsToKgText(prefill.quantity_g)) : ""}">
                    <button type="button" class="remove-row-btn" data-remove="${id}">✕</button>
                </div>
                <div class="line-total" id="dish-line-${id}"></div>
                <div class="hint" id="dish-echo-${id}" style="margin:2px 0;"></div>
            </div>
        `);
        box.appendChild(row);
        bindPickerButton({
            button: row.querySelector(`#dish-pick-${id}`), select: row.querySelector(`#dish-source-${id}`), title: "בחר מרכיב או מתכון", keyOf: (it) => String(it.id),
            tabs: [{ key: "pantry", label: "מוצרים" }, { key: "recipe", label: "מתכונים" }],
            getItems: () => {
                const hintOf = (s) => (s.source_type === "recipe" ? `${money(s.recipeCostPerGram * 1000)} / ק"ג` : `${money(s.ppgSource.price)} / ${s.ppgSource.unit_type === "unit" ? "יחידה" : s.ppgSource.unit_type === "liter" ? "ליטר" : 'ק"ג'}`);
                const out = [];
                assignAutoSubs(sources.filter((s) => s.source_type === "pantry" && !s.indent).map((s) => s.ppgSource));
                const subFor = (s) => (s.source_type === "pantry" && s.ppgSource ? subOf(s.indent ? sources.find((p) => p.source_type === "pantry" && !p.indent && p.ppgSource.id === s.ppgSource.parent_id)?.ppgSource : s.ppgSource) : s.subcategory);
                sources.forEach((s, i) => {
                    const node = { key: `d${i}`, id: i, tab: s.source_type, name: s.plainName || s.name, category: s.category, subcategory: subFor(s), hint: hintOf(s) };
                    if (s.indent && out.length) { (out[out.length - 1].children = out[out.length - 1].children || []).push(node); } else out.push(node);
                });
                return out;
            },
        });
        row.querySelector(`#dish-source-${id}`).addEventListener("change", recalc);
        row.querySelector(`#dish-qty-${id}`).addEventListener("input", recalc);
        row.querySelector("[data-remove]").onclick = () => { row.remove(); recalc(); };
    }

    function recalc() {
        let total = 0;
        box.querySelectorAll(".item-row-inputs").forEach((row) => {
            const id = row.id.replace("dish-row-", "");
            const idx = overlay.querySelector(`#dish-source-${id}`).value;
            const rawText = overlay.querySelector(`#dish-qty-${id}`).value;
            const countSrc = idx !== "" && isCountSrc(sources[idx]);
            overlay.querySelector(`#dish-qty-${id}`).placeholder = countSrc ? "יחידות" : isGramMode() ? "גרם" : 'ק"ג';
            const qty = (countSrc ? textToCount(rawText) : textToGrams(rawText)) || 0;
            const lineEl = overlay.querySelector(`#dish-line-${id}`);
            refreshPickerButton(overlay.querySelector(`#dish-pick-${id}`), overlay.querySelector(`#dish-source-${id}`));
            const echoEl = overlay.querySelector(`#dish-echo-${id}`);
            const warn = countSrc ? countWarning(rawText) : qtyWarning(rawText);
            echoEl.innerHTML = warn ? `<span style="color:var(--danger);">${escapeHtml(warn)}</span>` : escapeHtml(countSrc ? describeCount(rawText) : describeQty(rawText));
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
            const tone = r.food_cost_pct > 33 ? "var(--danger)" : r.food_cost_pct > 30 ? "var(--warn-border)" : "var(--ok)";
            preview.innerHTML = `
                <div class="pr-box">
                    <div class="pr-row"><span>מחיר לפני מע"מ</span><b>${money(priceBeforeVat)}</b></div>
                    <div class="pr-row"><span>מע"מ (${+vatPct.toFixed(1)}%)</span><b>${money(sellingPrice - priceBeforeVat)}</b></div>
                    <div class="pr-row pr-big"><span>מחיר מכירה כולל מע"מ</span><b>${money(sellingPrice)}</b></div>
                    <div class="pr-row"><span>עלות המנה</span><b>${money(total)}</b></div>
                    <div class="pr-row"><span>רווח (לפני מע"מ)</span><b>${money(r.profit_amount)} · ${r.profit_pct.toFixed(1)}%</b></div>
                    <div class="gauge"><i style="width:${Math.min(100, Math.max(2, r.food_cost_pct)).toFixed(0)}%;background:${tone};"></i></div>
                    <div class="pr-row"><span>עלות מזון</span><b style="color:${tone};">${r.food_cost_pct.toFixed(1)}%</b></div>
                </div>
            `;
            const sd = overlay.querySelector("#sell-display");
            if (sd) sd.textContent = money(sellingPrice);
        } else {
            preview.innerHTML = `<div class="card-row"><span class="muted">הזן מחיר (ידנית או דרך מכפיל/יעד למעלה) כדי לראות רווחיות</span></div>`;
            const sd = overlay.querySelector("#sell-display");
            if (sd) sd.textContent = "—";
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

    overlay.querySelector("#btn-cancel").onclick = () => attemptClose(overlay);
    overlay.querySelector("#btn-save").onclick = busy(async () => {
        const items = [];
        box.querySelectorAll(".item-row-inputs").forEach((row) => {
            const id = row.id.replace("dish-row-", "");
            const idx = overlay.querySelector(`#dish-source-${id}`).value;
            const rawQ = overlay.querySelector(`#dish-qty-${id}`).value;
            const qty = (idx !== "" && isCountSrc(sources[idx]) ? textToCount(rawQ) : textToGrams(rawQ)) || "";
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
    });
}
