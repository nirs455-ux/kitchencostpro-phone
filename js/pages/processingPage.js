import { applyEggTemplate, listAllPantryItems, updatePantryItemYield, addBreakdownProduct, deletePantryItem, deleteAllChildren, getDeleteInfo, deleteConfirmText } from "../repo/pantryRepo.js";
import { CATEGORY_GROUPS } from "../constants.js";
import { effectivePrice } from "../formulas.js";
import { EGG_SIZES, isEggName, guessEggSize, eggsNeeded, partPrice } from "../eggs.js";
import { h, openModal, closeModal, confirmDialog, toast, escapeHtml, info, busy, attemptClose, cur } from "../ui.js";
import { getFilter, applyFilter, mountFilterBar, groupBySection, groupTitleEl } from "../filters.js";

export async function renderProcessingPage(container) {
    const all = await listAllPantryItems();
    const topLevel = all.filter((it) => !it.parent_id).sort((a, b) => a.category.localeCompare(b.category, "he") || a.name.localeCompare(b.name, "he"));
    for (const p of topLevel) p.children = all.filter((it) => it.parent_id === p.id);

    container.innerHTML = `
        <div id="processing-filter"></div>
        <div id="processing-list"></div>
    `;
    const list = container.querySelector("#processing-list");
    if (topLevel.length === 0) {
        list.innerHTML = '<div class="empty-state">אין עדיין מוצרים במזווה.</div>';
        return;
    }

    const filter = getFilter("processing");
    function renderList() {
        list.innerHTML = "";
        for (const g of groupBySection(applyFilter(topLevel, filter))) {
            list.appendChild(groupTitleEl(g.title, g.items.length));
            for (const p of g.items) {
                list.appendChild(renderParentCard(p, container));
                for (const c of p.children) {
                    list.appendChild(renderChildCard(c, p, container));
                }
            }
        }
    }
    mountFilterBar(container.querySelector("#processing-filter"), topLevel, filter, renderList);
    renderList();
}

function priceLine(it) {
    const eff = effectivePrice(it.price, it.yield_pct, it.is_frozen);
    return `<span class="price-raw">${cur()}${Number(it.price).toFixed(2)}</span> ← <span class="price-real">${cur()}${eff.toFixed(2)}</span> (${Number(it.yield_pct).toFixed(1)}%)`;
}

function renderParentCard(it, container) {
    const card = h(`
        <div class="card">
            <div class="card-title">${escapeHtml(it.name)} ${it.is_frozen ? '<span class="tag tag-frozen">❄</span>' : ""}</div>
            <div class="card-row"><span class="tag">${escapeHtml(it.category)}</span> ${priceLine(it)}</div>
            <div class="card-actions">
                <button class="btn btn-secondary btn-small" data-process>עיבוד</button>
                <button class="btn btn-primary btn-small" data-breakdown>+ תוצר</button>
                ${isEgg(it) ? `<button class="btn btn-accent btn-small" data-egg>🥚 ${hasEggParts(it) ? "עדכן חלבון/חלמון" : "חלבון וחלמון"}</button>` : ""}
                ${hasEggParts(it) ? '<button class="btn btn-secondary btn-small" data-egg-calc>🧮 כמה ביצים</button>' : ""}
                ${it.children && it.children.length ? '<button class="btn btn-secondary btn-small" data-delete-children>מחק את כל התוצרים</button>' : ""}
                ${isProcessed(it) ? '<button class="btn btn-secondary btn-small" data-reset>אפס עיבוד</button>' : ""}
                <button class="btn btn-danger btn-small" data-delete>מחק מהמזווה</button>
            </div>
        </div>
    `);
    card.querySelector("[data-process]").onclick = () => openYieldModal(it, container);
    wireReset(card, it, container);
    card.querySelector("[data-breakdown]").onclick = () => openBreakdownModal(it, container);
    card.querySelector("[data-delete]").onclick = () => confirmAndDelete(it, container);
    const eggBtn = card.querySelector("[data-egg]");
    if (eggBtn) eggBtn.onclick = () => openEggModal(it, container);
    const eggCalc = card.querySelector("[data-egg-calc]");
    if (eggCalc) eggCalc.onclick = () => openEggCalcModal(it, container);
    const delKids = card.querySelector("[data-delete-children]");
    if (delKids) {
        delKids.onclick = async () => {
            if (!(await confirmDialog(`למחוק את כל ${it.children.length} התוצרים המפורקים של "${escapeHtml(it.name)}"?<br><br>חומר הגלם עצמו יישאר במזווה.`))) return;
            await deleteAllChildren(it.id);
            toast("נמחק");
            renderProcessingPage(container);
        };
    }
    return card;
}

const isEgg = (it) => !it.parent_id && it.unit_type === "unit" && isEggName(it.name);
const hasEggParts = (it) => (it.children || []).some((c) => c.egg_part);

function openEggModal(it, container) {
    const parts = (it.children || []).filter((c) => c.egg_part);
    const w0 = parts.find((c) => c.egg_part === "white"), y0 = parts.find((c) => c.egg_part === "yolk");
    const match = w0 && y0 ? Object.keys(EGG_SIZES).find((k) => EGG_SIZES[k].white === w0.unit_amount && EGG_SIZES[k].yolk === y0.unit_amount) : null;
    const size0 = w0 && y0 ? (match || "") : guessEggSize(it.name);
    const overlay = openModal(`
        <h2>🥚 חלבון וחלמון - ${escapeHtml(it.name)}</h2>
        <div class="field"><label>גודל הביצה ${info("ממלא את המשקלים הקבועים (ללא קליפה). אפשר לתקן את המספרים ידנית, למשל אחרי שקילה אצלך. העלות של הביצה מתחלקת בין החלבון לחלמון לפי משקל, כך שאם משתמשים בשניהם לא סופרים אותה פעמיים.")}</label>
            <select id="eg-size">${Object.keys(EGG_SIZES).map((k) => `<option value="${k}" ${k === size0 ? "selected" : ""}>${k}</option>`).join("")}<option value="" ${!size0 ? "selected" : ""}>מותאם אישית</option></select></div>
        <div class="form-row">
            <div class="field"><label>חלבון (גרם)</label><input type="number" step="any" id="eg-white" value="${w0 ? w0.unit_amount : ""}"></div>
            <div class="field"><label>חלמון (גרם)</label><input type="number" step="any" id="eg-yolk" value="${y0 ? y0.unit_amount : ""}"></div>
        </div>
        <div class="hint" id="eg-preview"></div>
        <div class="error-msg"></div>
        <div class="modal-actions"><button class="btn btn-secondary" id="btn-cancel">ביטול</button><button class="btn btn-primary" id="btn-save">שמירה</button></div>`);
    const sel = overlay.querySelector("#eg-size"), wEl = overlay.querySelector("#eg-white"), yEl = overlay.querySelector("#eg-yolk");
    const preview = () => {
        const w = parseFloat(wEl.value), y = parseFloat(yEl.value);
        overlay.querySelector("#eg-preview").innerHTML = w > 0 && y > 0
            ? `משקל ביצה ללא קליפה: ${+(w + y).toFixed(2)} גרם. עלות לפי מחיר הביצה (${cur()}${Number(it.price).toFixed(2)}): חלבון ${cur()}${partPrice(it.price, w + y, w).toFixed(2)} · חלמון ${cur()}${partPrice(it.price, w + y, y).toFixed(2)}. משקל הביצה ביחידה במזווה יעודכן ל-${+(w + y).toFixed(2)} גרם.`
            : "";
    };
    const fill = () => { const e = EGG_SIZES[sel.value]; if (e) { wEl.value = e.white; yEl.value = e.yolk; } preview(); };
    sel.onchange = fill;
    wEl.oninput = yEl.oninput = () => { sel.value = ""; preview(); };
    if (size0) fill(); else preview();
    overlay.querySelector("#btn-cancel").onclick = () => attemptClose(overlay);
    overlay.querySelector("#btn-save").onclick = busy(async () => {
        try {
            await applyEggTemplate(it.id, { white: wEl.value, yolk: yEl.value });
            closeModal();
            toast("נשמר");
            renderProcessingPage(container);
        } catch (e) {
            const el = overlay.querySelector(".error-msg");
            el.textContent = e.message;
            el.style.display = "block";
        }
    });
}

function openEggCalcModal(it, container) {
    const w = it.children.find((c) => c.egg_part === "white"), y = it.children.find((c) => c.egg_part === "yolk");
    const overlay = openModal(`
        <h2>🧮 כמה ביצים לשבור</h2>
        <div class="hint">${escapeHtml(it.name)}: חלבון ${w.unit_amount} גרם, חלמון ${y.unit_amount} גרם. ממלאים כמה צריך (אחד מהם או שניהם):</div>
        <div class="form-row">
            <div class="field"><label>חלבון (גרם)</label><input type="number" step="any" id="ec-w"></div>
            <div class="field"><label>חלמון (גרם)</label><input type="number" step="any" id="ec-y"></div>
        </div>
        <div id="ec-out" class="card" style="display:none;"></div>
        <div class="modal-actions"><button class="btn btn-secondary" id="btn-cancel">סגור</button></div>`);
    const calc = () => {
        const r = eggsNeeded({ whiteG: overlay.querySelector("#ec-w").value, yolkG: overlay.querySelector("#ec-y").value, white: w.unit_amount, yolk: y.unit_amount, eggPrice: it.price });
        const out = overlay.querySelector("#ec-out");
        if (!r) { out.style.display = "none"; return; }
        out.style.display = "";
        out.innerHTML = `<div class="card-title">לשבור ${r.eggs} ביצים</div>
            <div>עלות הביצים ששוברים: ${cur()}${r.eggsCost.toFixed(2)}</div>
            <div>עלות מה שבשימוש (לפי משקל): ${cur()}${r.usedCost.toFixed(2)}</div>
            ${r.leftWhiteG > 0 ? `<div>נשארים ${r.leftWhiteCount} חלבונים (${r.leftWhiteG} גרם)</div>` : ""}
            ${r.leftYolkG > 0 ? `<div>נשארים ${r.leftYolkCount} חלמונים (${r.leftYolkG} גרם)</div>` : ""}`;
    };
    overlay.querySelector("#ec-w").oninput = calc;
    overlay.querySelector("#ec-y").oninput = calc;
    overlay.querySelector("#btn-cancel").onclick = closeModal;
}

function isProcessed(it) {
    return Number(it.yield_pct) !== 100 || it.weight_before != null;
}

// מחזיר ניצולת ל-100% ומנקה משקלי לפני/אחרי. המוצר (והקפוא) נשארים.
function wireReset(card, it, container) {
    const btn = card.querySelector("[data-reset]");
    if (!btn) return;
    btn.onclick = async () => {
        if (!(await confirmDialog("לאפס את העיבוד? הניצולת תחזור ל-100% והמחיר האמיתי יהיה שווה למחיר הקנייה.<br><br>המוצר יישאר במזווה."))) return;
        try {
            await updatePantryItemYield(it.id, { name: it.name, yield_pct: 100, weight_before: "", weight_after: "", is_frozen: !!it.is_frozen });
            toast("העיבוד אופס");
            renderProcessingPage(container);
        } catch (e) {
            toast(e.message);
        }
    };
}

async function confirmAndDelete(it, container) {
    try {
        if (!(await confirmDialog(deleteConfirmText(await getDeleteInfo(it.id))))) return;
        await deletePantryItem(it.id);
        toast("נמחק");
        renderProcessingPage(container);
    } catch (e) {
        toast(e.message);
    }
}

function renderChildCard(it, parent, container) {
    const card = h(`
        <div class="card" style="margin-right:18px;border-right:3px solid #a8541b;">
            <div class="card-title">↳ ${escapeHtml(it.name)} ${it.is_frozen ? '<span class="tag tag-frozen">❄</span>' : ""}</div>
            <div class="card-row"><span class="muted">מתוך: ${escapeHtml(parent.name)}</span> ${priceLine(it)}</div>
            <div class="card-actions">
                ${it.egg_part ? "" : '<button class="btn btn-secondary btn-small" data-process>עיבוד</button>'}
                ${isProcessed(it) ? '<button class="btn btn-secondary btn-small" data-reset>אפס עיבוד</button>' : ""}
                <button class="btn btn-danger btn-small" data-delete>מחק תוצר</button>
            </div>
        </div>
    `);
    const proc = card.querySelector("[data-process]");
    if (proc) proc.onclick = () => openYieldModal(it, container);
    wireReset(card, it, container);
    card.querySelector("[data-delete]").onclick = () => confirmAndDelete(it, container);
    return card;
}

function openYieldModal(it, container) {
    const allowedSubs = CATEGORY_GROUPS[it.category] || [];
    const overlay = openModal(`
        <h2>עיבוד - ${escapeHtml(it.name)}</h2>
        ${!it.parent_id && allowedSubs.length ? `
        <div class="field">
            <label>תת-קטגוריה</label>
            <select id="f-subcategory">
                <option value="">ללא</option>
                ${allowedSubs.map((s) => `<option value="${s}" ${s === it.subcategory ? "selected" : ""}>${s}</option>`).join("")}
            </select>
        </div>` : ""}
        <div class="form-row">
            <div class="field"><label>משקל לפני (גרם, אופציונלי)</label><input type="number" step="any" id="f-wb" value="${it.weight_before ?? ""}"></div>
            <div class="field"><label>משקל אחרי (גרם, אופציונלי)</label><input type="number" step="any" id="f-wa" value="${it.weight_after ?? ""}"></div>
        </div>
        <div class="field"><label>או: ניצולת ידנית (%) ${info("אם ממלאים משקל לפני ואחרי, הניצולת מחושבת אוטומטית מהם ומתעלמת מהשדה הידני.")}</label><input type="number" step="any" id="f-yield" value="${it.yield_pct}"></div>
        <div class="checkbox-field field" style="margin-top:10px;">
            <input type="checkbox" id="f-frozen" ${it.is_frozen ? "checked" : ""}>
            <label for="f-frozen">❄ מוצר קפוא</label>
        </div>
        <div class="error-msg"></div>
        <div class="modal-actions">
            <button class="btn btn-secondary" id="btn-cancel">ביטול</button>
            <button class="btn btn-primary" id="btn-save">שמירה</button>
        </div>
    `);
    overlay.querySelector("#btn-cancel").onclick = () => attemptClose(overlay);
    overlay.querySelector("#btn-save").onclick = busy(async () => {
        const subField = overlay.querySelector("#f-subcategory");
        const data = {
            name: it.name,
            weight_before: overlay.querySelector("#f-wb").value,
            weight_after: overlay.querySelector("#f-wa").value,
            yield_pct: overlay.querySelector("#f-yield").value,
            is_frozen: overlay.querySelector("#f-frozen").checked,
        };
        if (subField) data.subcategory = subField.value;
        try {
            await updatePantryItemYield(it.id, data);
            closeModal();
            toast("נשמר");
            renderProcessingPage(container);
        } catch (e) {
            const el = overlay.querySelector(".error-msg");
            el.textContent = e.message;
            el.style.display = "block";
        }
    });
}

function openBreakdownModal(parent, container) {
    const overlay = openModal(`
        <h2>תוצר חדש מתוך ${escapeHtml(parent.name)}</h2>
        <div class="field"><label>שם התוצר ${info("התוצר יורש קטגוריה, יחידה ומחיר מחומר הגלם. כאן קובעים רק שם וניצולת משלו.")}</label><input type="text" id="f-name" placeholder="לדוגמה: פילה"></div>
        <div class="form-row">
            <div class="field"><label>משקל לפני (גרם)</label><input type="number" step="any" id="f-wb"></div>
            <div class="field"><label>משקל אחרי (גרם)</label><input type="number" step="any" id="f-wa"></div>
        </div>
        <div class="field"><label>או: ניצולת ידנית (%)</label><input type="number" step="any" id="f-yield" value="100"></div>
        <div class="checkbox-field field">
            <input type="checkbox" id="f-frozen">
            <label for="f-frozen">❄ מוצר קפוא</label>
        </div>
        <div class="error-msg"></div>
        <div class="modal-actions">
            <button class="btn btn-secondary" id="btn-cancel">ביטול</button>
            <button class="btn btn-primary" id="btn-save">שמירה</button>
        </div>
    `);
    overlay.querySelector("#btn-cancel").onclick = () => attemptClose(overlay);
    overlay.querySelector("#btn-save").onclick = busy(async () => {
        const data = {
            name: overlay.querySelector("#f-name").value,
            weight_before: overlay.querySelector("#f-wb").value,
            weight_after: overlay.querySelector("#f-wa").value,
            yield_pct: overlay.querySelector("#f-yield").value,
            is_frozen: overlay.querySelector("#f-frozen").checked,
        };
        try {
            await addBreakdownProduct(parent.id, data);
            closeModal();
            toast("נשמר");
            renderProcessingPage(container);
        } catch (e) {
            const el = overlay.querySelector(".error-msg");
            el.textContent = e.message;
            el.style.display = "block";
        }
    });
}
