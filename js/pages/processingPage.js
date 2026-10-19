import { listAllPantryItems, updatePantryItemYield, addBreakdownProduct, deletePantryItem, deleteAllChildren, getDeleteInfo, deleteConfirmText } from "../repo/pantryRepo.js";
import { CATEGORY_GROUPS } from "../constants.js";
import { effectivePrice } from "../formulas.js";
import { h, openModal, closeModal, confirmDialog, toast, escapeHtml, info, busy, attemptClose, cur } from "../ui.js";
import { getFilter, applyFilter, mountFilterBar, groupBySection, groupTitleEl } from "../filters.js";

// אילו מוצרים פתוחים כרגע (תוצרים מפורקים מוצגים רק אחרי לחיצה). מתאפס בכל כניסה ללשונית.
const expanded = new Set();
export function collapseAll() { expanded.clear(); }
export function expandProduct(id) { expanded.add(id); }

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
                const open = expanded.has(p.id);
                list.appendChild(renderParentCard(p, container, open, () => { if (open) expanded.delete(p.id); else expanded.add(p.id); renderList(); }));
                if (open) for (const c of p.children) list.appendChild(renderChildCard(c, p, container));
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

function renderParentCard(it, container, open = false, onToggle = () => {}) {
    const card = h(`
        <div class="card">
            <div class="card-title">${escapeHtml(it.name)} ${it.is_frozen ? '<span class="tag tag-frozen">❄</span>' : ""}</div>
            <div class="card-row"><span class="tag">${escapeHtml(it.category)}</span> ${priceLine(it)}</div>
            ${it.children && it.children.length ? `<button type="button" class="tree-toggle" data-toggle>${open ? "▾" : "◂"} ${it.children.length} תוצרים מפורקים</button>` : ""}
            <div class="card-actions">
                <button class="btn btn-secondary btn-small" data-process>עיבוד</button>
                <button class="btn btn-primary btn-small" data-breakdown>+ תוצר</button>
                ${it.children && it.children.length ? '<button class="btn btn-secondary btn-small" data-delete-children>מחק את כל התוצרים</button>' : ""}
                ${isProcessed(it) ? '<button class="btn btn-secondary btn-small" data-reset>אפס עיבוד</button>' : ""}
                <button class="btn btn-danger btn-small" data-delete>מחק מהמזווה</button>
            </div>
        </div>
    `);
    const tg = card.querySelector("[data-toggle]");
    if (tg) tg.onclick = onToggle;
    card.querySelector("[data-process]").onclick = () => openYieldModal(it, container);
    wireReset(card, it, container);
    card.querySelector("[data-breakdown]").onclick = () => openBreakdownModal(it, container);
    card.querySelector("[data-delete]").onclick = () => confirmAndDelete(it, container);
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
                <button class="btn btn-secondary btn-small" data-process>עיבוד</button>
                ${isProcessed(it) ? '<button class="btn btn-secondary btn-small" data-reset>אפס עיבוד</button>' : ""}
                <button class="btn btn-danger btn-small" data-delete>מחק תוצר</button>
            </div>
        </div>
    `);
    card.querySelector("[data-process]").onclick = () => openYieldModal(it, container);
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
