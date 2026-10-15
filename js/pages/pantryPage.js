import { listTopLevelPantryItems, addPantryItem, updatePantryItem, deletePantryItem, getDeleteInfo, deleteConfirmText } from "../repo/pantryRepo.js";
import { CATEGORY_GROUPS, UNIT_TYPES, UNIT_TYPE_LABELS } from "../constants.js";
import { h, openModal, closeModal, confirmDialog, toast, escapeHtml, busy, attemptClose, info } from "../ui.js";
import { ALLERGENS, suggestAllergens, allergenLabels } from "../allergens.js";
import { openScanModal } from "./scanModal.js";
import { dbGetAll } from "../db.js";
import { getSetting, setSetting } from "../repo/settingsRepo.js";
import { renderProcessingPage } from "./processingPage.js";
import { renderInventoryPage } from "./inventoryPage.js";
import { isStaffMode } from "../staff.js";
import { getFilter, applyFilter, mountFilterBar, groupBySection, groupTitleEl } from "../filters.js";

// מזווה = שלוש לשוניות: מוצרים | ספירת מלאי | עיבוד וניצולת. מצב עובד רואה רק ספירת מלאי.
const TABS = [["products", "מוצרים"], ["inventory", "ספירת מלאי"], ["processing", "עיבוד וניצולת"]];
let currentTab = "products";
export function setPantryTab(t) { currentTab = TABS.some((x) => x[0] === t) ? t : "products"; }

export async function renderPantryPage(container) {
    if (isStaffMode()) currentTab = "inventory";
    const seg = isStaffMode() ? "" : `<div class="seg" id="pantry-seg">${TABS.map(([k, l]) => `<button type="button" data-tab="${k}" class="${k === currentTab ? "active" : ""}">${l}</button>`).join("")}</div>`;
    container.innerHTML = `${seg}<div id="pantry-tab"></div>`;
    const sub = container.querySelector("#pantry-tab");
    container.querySelectorAll("#pantry-seg [data-tab]").forEach((b) => { b.onclick = () => { currentTab = b.dataset.tab; renderPantryPage(container); }; });
    if (currentTab === "inventory") await renderInventoryPage(sub);
    else if (currentTab === "processing") await renderProcessingPage(sub);
    else await renderPantryProducts(sub);
}

export async function renderPantryProducts(container) {
    const items = await listTopLevelPantryItems();
    // תאריך קנייה אחרונה לכל מוצר (לפי חשבוניות; זיכויים לא נספרים) - לאפשרות המיון "קנייה אחרונה"
    const lastBought = new Map();
    const invoiceDate = Object.fromEntries((await dbGetAll("invoices")).filter((i) => i.document_type !== "credit" && !i.deleted_at).map((i) => [i.id, i.invoice_date || ""]));
    for (const it of await dbGetAll("invoiceItems")) {
        const d = invoiceDate[it.invoice_id];
        if (it.pantry_item_id && d && d > (lastBought.get(it.pantry_item_id) || "")) lastBought.set(it.pantry_item_id, d);
    }
    const sortMode = (await getSetting("pantry_sort")) || "name";
    const sortItems = (mode) => items.sort((a, b) => a.category.localeCompare(b.category, "he") ||
        (mode === "recent" ? (lastBought.get(b.id) || "").localeCompare(lastBought.get(a.id) || "") : 0) ||
        a.name.localeCompare(b.name, "he"));
    sortItems(sortMode);

    container.innerHTML = `
        <div class="btn-row">
            <button class="btn btn-accent" id="btn-scan">📷 סרוק חשבונית</button>
        </div>
        <div class="field"><select id="pantry-sort">
            <option value="name">מיון: לפי שם</option><option value="recent">מיון: נקנה לאחרונה קודם</option>
        </select></div>
        <div id="pantry-filter"></div>
        <div id="pantry-list"></div>
        <button class="fab-add" id="btn-add">+</button>
    `;

    const list = container.querySelector("#pantry-list");
    const filter = getFilter("pantry");

    function renderList() {
        list.innerHTML = "";
        if (items.length === 0) {
            list.innerHTML = '<div class="empty-state">אין עדיין מוצרים במזווה - לחץ על + כדי להוסיף.</div>';
            return;
        }
        for (const g of groupBySection(applyFilter(items, filter))) {
            list.appendChild(groupTitleEl(g.title, g.items.length));
            for (const it of g.items) list.appendChild(renderPantryCard(it));
        }
        list.querySelectorAll("[data-edit]").forEach((btn) => {
            btn.onclick = () => openPantryModal(items.find((i) => i.id === Number(btn.dataset.edit)), container);
        });
        list.querySelectorAll("[data-delete]").forEach((btn) => {
            btn.onclick = async () => {
                try {
                    const id = Number(btn.dataset.delete);
                    if (!(await confirmDialog(deleteConfirmText(await getDeleteInfo(id))))) return;
                    await deletePantryItem(id);
                    toast("נמחק");
                    renderPantryProducts(container);
                } catch (e) {
                    toast(e.message);
                }
            };
        });
    }

    const sortSel = container.querySelector("#pantry-sort");
    sortSel.value = sortMode;
    sortSel.addEventListener("change", async () => {
        await setSetting("pantry_sort", sortSel.value);
        sortItems(sortSel.value);
        renderList();
    });
    mountFilterBar(container.querySelector("#pantry-filter"), items, filter, renderList);
    renderList();

    container.querySelector("#btn-add").onclick = () => openPantryModal(null, container);
    container.querySelector("#btn-scan").onclick = () => openScanModal({ supplierAware: false, onDone: () => renderPantryProducts(container) });
}

function renderPantryCard(it) {
    return h(`
        <div class="card">
            <div class="card-title">${escapeHtml(it.name)} ${it.is_frozen ? '<span class="tag tag-frozen">❄ קפוא</span>' : ""}${it.unit_type === "unit" && !it.unit_amount ? '<span class="tag tag-danger">חסר משקל ליחידה</span>' : ""}</div>
            <div class="muted" style="margin-top:2px;">${Array.isArray(it.allergens) ? (it.allergens.length ? "אלרגנים: " + escapeHtml(allergenLabels(it.allergens).join(", ")) : "ללא אלרגנים מסומנים") : "אלרגנים: לא הוגדרו"}</div>
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
            <label>אלרגנים ${info("מסמנים אילו אלרגנים קיימים במוצר. הם נכנסים אוטומטית להצהרת האלרגנים של מתכונים שמשתמשים בו. ההצעה לפי השם היא רק עזר - בדוק בתווית היצרן.")}</label>
            <div class="chips" id="f-allergens"></div>
            <div class="hint" id="f-allergens-note"></div>
        </div>
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
    // ---- אלרגנים: צ'יפים לבחירה + הצעה אוטומטית לפי השם (עד שהמשתמש נוגע ידנית) ----
    let allergenSel = new Set(existing ? (Array.isArray(existing.allergens) ? existing.allergens : []) : []);
    let allergenTouched = !!existing && Array.isArray(existing.allergens) && !existing.allergens_auto;
    const allergenBox = overlay.querySelector("#f-allergens");
    const allergenNote = overlay.querySelector("#f-allergens-note");
    const drawAllergens = () => {
        allergenBox.innerHTML = ALLERGENS.map((a) => `<button type="button" class="chip ${allergenSel.has(a.key) ? "active" : ""}" data-al="${a.key}">${a.label}</button>`).join("");
        allergenBox.querySelectorAll("[data-al]").forEach((b) => {
            b.onclick = () => {
                allergenTouched = true;
                if (allergenSel.has(b.dataset.al)) allergenSel.delete(b.dataset.al); else allergenSel.add(b.dataset.al);
                drawAllergens();
            };
        });
        allergenNote.textContent = allergenTouched ? (allergenSel.size ? "" : "סומן: ללא אלרגנים") : (isEdit && !Array.isArray(existing.allergens) ? "עדיין לא הוגדרו אלרגנים למוצר הזה" : "הוצע אוטומטית לפי השם - בדוק ואשר");
    };
    const nameInput = overlay.querySelector("#f-name");
    const autoSuggest = () => { if (!allergenTouched) { allergenSel = new Set(suggestAllergens(nameInput.value)); drawAllergens(); } };
    nameInput.addEventListener("input", autoSuggest);
    if (!isEdit) autoSuggest(); else drawAllergens();

    catSelect.onchange = syncSubcategory;
    unitTypeSelect.onchange = syncUnitAmount;
    syncSubcategory();
    syncUnitAmount();

    overlay.querySelector("#btn-cancel").onclick = () => attemptClose(overlay);
    overlay.querySelector("#btn-save").onclick = busy(async () => {
        const data = {
            name: overlay.querySelector("#f-name").value,
            category: catSelect.value,
            subcategory: overlay.querySelector("#f-subcategory").value,
            unit_type: unitTypeSelect.value,
            unit_amount: overlay.querySelector("#f-unit-amount").value,
            price: overlay.querySelector("#f-price").value,
            is_frozen: overlay.querySelector("#f-frozen").checked,
        };
        // אלרגנים נשמרים כשהמשתמש נגע בהם, או במוצר חדש (ההצעה); במוצר קיים שלא הוגדר ולא נגעו - נשאר "לא הוגדר"
        if (allergenTouched || !isEdit) data.allergens = [...allergenSel];
        try {
            if (isEdit) {
                await updatePantryItem(existing.id, data);
            } else {
                await addPantryItem(data);
            }
            closeModal();
            toast("נשמר");
            renderPantryProducts(container);
        } catch (e) {
            const el = overlay.querySelector(".error-msg");
            el.textContent = e.message;
            el.style.display = "block";
        }
    });
}
