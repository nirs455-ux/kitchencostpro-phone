import { listAllPantryItems, updatePantryItemYield, addBreakdownProduct } from "../repo/pantryRepo.js";
import { CATEGORY_GROUPS } from "../constants.js";
import { effectivePrice } from "../formulas.js";
import { h, openModal, closeModal, toast, escapeHtml } from "../ui.js";
import { getFilter, applyFilter, mountFilterBar, groupBySection, groupTitleEl } from "../filters.js";

export async function renderProcessingPage(container) {
    const all = await listAllPantryItems();
    const topLevel = all.filter((it) => !it.parent_id).sort((a, b) => a.category.localeCompare(b.category, "he") || a.name.localeCompare(b.name, "he"));
    for (const p of topLevel) p.children = all.filter((it) => it.parent_id === p.id);

    container.innerHTML = `
        <div class="subtitle">כאן קובעים ניצולת/קפוא לכל מוצר, או יוצרים ממנו תוצר מפורק (למשל: דג שלם → פילה). המחיר האמיתי מוצג רק כאן.</div>
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
    return `<span class="price-raw">₪${Number(it.price).toFixed(2)}</span> ← <span class="price-real">₪${eff.toFixed(2)}</span> (${Number(it.yield_pct).toFixed(1)}%)`;
}

function renderParentCard(it, container) {
    const card = h(`
        <div class="card">
            <div class="card-title">${escapeHtml(it.name)} ${it.is_frozen ? '<span class="tag tag-frozen">❄</span>' : ""}</div>
            <div class="card-row"><span class="tag">${escapeHtml(it.category)}</span> ${priceLine(it)}</div>
            <div class="card-actions">
                <button class="btn btn-secondary btn-small" data-process>עיבוד</button>
                <button class="btn btn-primary btn-small" data-breakdown>+ תוצר</button>
            </div>
        </div>
    `);
    card.querySelector("[data-process]").onclick = () => openYieldModal(it, container);
    card.querySelector("[data-breakdown]").onclick = () => openBreakdownModal(it, container);
    return card;
}

function renderChildCard(it, parent, container) {
    const card = h(`
        <div class="card" style="margin-right:18px;border-right:3px solid #a8541b;">
            <div class="card-title">↳ ${escapeHtml(it.name)} ${it.is_frozen ? '<span class="tag tag-frozen">❄</span>' : ""}</div>
            <div class="card-row"><span class="muted">מתוך: ${escapeHtml(parent.name)}</span> ${priceLine(it)}</div>
            <div class="card-actions">
                <button class="btn btn-secondary btn-small" data-process>עיבוד</button>
            </div>
        </div>
    `);
    card.querySelector("[data-process]").onclick = () => openYieldModal(it, container);
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
        <div class="field"><label>או: ניצולת ידנית (%)</label><input type="number" step="any" id="f-yield" value="${it.yield_pct}"></div>
        <div class="hint">אם ממלאים משקל לפני+אחרי, הניצולת מחושבת אוטומטית מהם ומתעלמת מהשדה הידני.</div>
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
    overlay.querySelector("#btn-cancel").onclick = closeModal;
    overlay.querySelector("#btn-save").onclick = async () => {
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
    };
}

function openBreakdownModal(parent, container) {
    const overlay = openModal(`
        <h2>תוצר חדש מתוך ${escapeHtml(parent.name)}</h2>
        <div class="hint">התוצר יורש קטגוריה/יחידה/מחיר מחומר הגלם - כאן קובעים רק שם וניצולת משלו.</div>
        <div class="field"><label>שם התוצר</label><input type="text" id="f-name" placeholder="לדוגמה: פילה"></div>
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
    overlay.querySelector("#btn-cancel").onclick = closeModal;
    overlay.querySelector("#btn-save").onclick = async () => {
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
    };
}
