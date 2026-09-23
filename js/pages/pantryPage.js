import { listTopLevelPantryItems, addPantryItem, updatePantryItem, deletePantryItem } from "../repo/pantryRepo.js";
import { CATEGORY_GROUPS, UNIT_TYPES, UNIT_TYPE_LABELS } from "../constants.js";
import { h, openModal, closeModal, confirmDialog, toast, escapeHtml } from "../ui.js";
import { openScanModal } from "./scanModal.js";

export async function renderPantryPage(container) {
    const items = await listTopLevelPantryItems();
    items.sort((a, b) => a.category.localeCompare(b.category, "he") || a.name.localeCompare(b.name, "he"));

    container.innerHTML = `
        <div class="subtitle">חומרי גלם, מחיר קנייה, ותוצרי סריקת חשבוניות. הניצולת/פירוק נעשים בעמוד "עיבוד".</div>
        <div class="btn-row">
            <button class="btn btn-accent" id="btn-scan">📷 סרוק חשבונית</button>
        </div>
        <div id="pantry-list"></div>
        <button class="fab-add" id="btn-add">+</button>
    `;

    const list = container.querySelector("#pantry-list");
    if (items.length === 0) {
        list.innerHTML = '<div class="empty-state">אין עדיין מוצרים במזווה - לחץ על + כדי להוסיף.</div>';
    } else {
        for (const it of items) {
            list.appendChild(renderPantryCard(it));
        }
    }

    container.querySelector("#btn-add").onclick = () => openPantryModal(null, container);
    container.querySelector("#btn-scan").onclick = () => openScanModal({ supplierAware: false, onDone: () => renderPantryPage(container) });

    list.querySelectorAll("[data-edit]").forEach((btn) => {
        btn.onclick = () => {
            const item = items.find((i) => i.id === Number(btn.dataset.edit));
            openPantryModal(item, container);
        };
    });
    list.querySelectorAll("[data-delete]").forEach((btn) => {
        btn.onclick = async () => {
            const ok = await confirmDialog("למחוק את המוצר?");
            if (!ok) return;
            try {
                await deletePantryItem(Number(btn.dataset.delete));
                toast("נמחק");
                renderPantryPage(container);
            } catch (e) {
                toast(e.message);
            }
        };
    });
}

function renderPantryCard(it) {
    return h(`
        <div class="card">
            <div class="card-title">${escapeHtml(it.name)} ${it.is_frozen ? '<span class="tag tag-frozen">❄ קפוא</span>' : ""}</div>
            <div class="card-row">
                <span class="tag">${escapeHtml(it.category)}${it.subcategory ? " / " + escapeHtml(it.subcategory) : ""}</span>
                <span class="price-raw">₪${Number(it.price).toFixed(2)} / ${UNIT_TYPE_LABELS[it.unit_type]}</span>
            </div>
            <div class="card-actions">
                <button class="btn btn-secondary btn-small" data-edit="${it.id}">עריכה</button>
                <button class="btn btn-danger btn-small" data-delete="${it.id}">מחיקה</button>
            </div>
        </div>
    `);
}

function subcategoryOptions(category, current) {
    const subs = CATEGORY_GROUPS[category] || [];
    if (!subs.length) return "";
    return `<option value="">ללא</option>` + subs.map((s) => `<option value="${s}" ${s === current ? "selected" : ""}>${s}</option>`).join("");
}

function openPantryModal(existing, container) {
    const isEdit = !!existing;
    const overlay = openModal(`
        <h2>${isEdit ? "עריכת מוצר" : "מוצר חדש"}</h2>
        <div class="field"><label>שם מוצר</label><input type="text" id="f-name" value="${existing ? escapeHtml(existing.name) : ""}"></div>
        <div class="field">
            <label>קטגוריה</label>
            <select id="f-category">
                <option value="">בחר קטגוריה...</option>
                ${Object.keys(CATEGORY_GROUPS).map((c) => `<option value="${c}" ${existing && existing.category === c ? "selected" : ""}>${c}</option>`).join("")}
            </select>
        </div>
        <div class="field" id="f-subcategory-wrap">
            <label>תת-קטגוריה</label>
            <select id="f-subcategory">${existing ? subcategoryOptions(existing.category, existing.subcategory) : ""}</select>
        </div>
        <div class="form-row">
            <div class="field">
                <label>יחידת מידה</label>
                <select id="f-unit-type">
                    ${UNIT_TYPES.map((u) => `<option value="${u}" ${existing && existing.unit_type === u ? "selected" : ""}>${UNIT_TYPE_LABELS[u]}</option>`).join("")}
                </select>
            </div>
            <div class="field" id="f-unit-amount-wrap">
                <label>משקל/נפח ליחידה (גרם/מ"ל)</label>
                <input type="number" step="any" id="f-unit-amount" value="${existing && existing.unit_amount != null ? existing.unit_amount : ""}">
            </div>
        </div>
        <div class="field"><label>מחיר קנייה (₪)</label><input type="number" step="any" id="f-price" value="${existing ? existing.price : ""}"></div>
        <div class="checkbox-field field">
            <input type="checkbox" id="f-frozen" ${existing && existing.is_frozen ? "checked" : ""}>
            <label for="f-frozen">❄ מוצר קפוא</label>
        </div>
        <div class="error-msg"></div>
        <div class="modal-actions">
            <button class="btn btn-secondary" id="btn-cancel">ביטול</button>
            <button class="btn btn-primary" id="btn-save">שמירה</button>
        </div>
    `);

    const catSelect = overlay.querySelector("#f-category");
    const subWrap = overlay.querySelector("#f-subcategory-wrap");
    const unitTypeSelect = overlay.querySelector("#f-unit-type");
    const unitAmountWrap = overlay.querySelector("#f-unit-amount-wrap");

    function syncSubcategory() {
        const subs = CATEGORY_GROUPS[catSelect.value] || [];
        subWrap.style.display = subs.length ? "block" : "none";
        overlay.querySelector("#f-subcategory").innerHTML = subcategoryOptions(catSelect.value, existing ? existing.subcategory : null);
    }
    function syncUnitAmount() {
        unitAmountWrap.style.display = unitTypeSelect.value === "unit" ? "block" : "none";
    }
    catSelect.onchange = syncSubcategory;
    unitTypeSelect.onchange = syncUnitAmount;
    syncSubcategory();
    syncUnitAmount();

    overlay.querySelector("#btn-cancel").onclick = closeModal;
    overlay.querySelector("#btn-save").onclick = async () => {
        const data = {
            name: overlay.querySelector("#f-name").value,
            category: catSelect.value,
            subcategory: overlay.querySelector("#f-subcategory").value,
            unit_type: unitTypeSelect.value,
            unit_amount: overlay.querySelector("#f-unit-amount").value,
            price: overlay.querySelector("#f-price").value,
            is_frozen: overlay.querySelector("#f-frozen").checked,
        };
        try {
            if (isEdit) {
                await updatePantryItem(existing.id, data);
            } else {
                await addPantryItem(data);
            }
            closeModal();
            toast("נשמר");
            renderPantryPage(container);
        } catch (e) {
            const el = overlay.querySelector(".error-msg");
            el.textContent = e.message;
            el.style.display = "block";
        }
    };
}
