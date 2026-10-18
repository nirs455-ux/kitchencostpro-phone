import { listTopLevelPantryItems, addPantryItem, updatePantryItem, deletePantryItem, getDeleteInfo, deleteConfirmText } from "../repo/pantryRepo.js";
import { CATEGORY_GROUPS, UNIT_TYPES, UNIT_TYPE_LABELS } from "../constants.js";
import { h, openModal, closeModal, confirmDialog, toast, escapeHtml, busy, attemptClose, info, cur, curLabel } from "../ui.js";
import { openScanModal } from "./scanModal.js";
import { dbGetAll } from "../db.js";
import { getSetting, setSetting } from "../repo/settingsRepo.js";
import { renderProcessingPage } from "./processingPage.js";
import { renderInventoryPage } from "./inventoryPage.js";
import { renderWastePage } from "./wastePage.js";
import { isStaffMode } from "../staff.js";
import { EGG_SIZES, isEggName, guessEggSize } from "../eggs.js";
import { textToGrams, gramsToKgText, describeQty, qtyWarning } from "../qty.js";
import { getFilter, applyFilter, mountFilterBar, groupBySection, groupTitleEl } from "../filters.js";

// מזווה = שלוש לשוניות: מוצרים | ספירת מלאי | עיבוד וניצולת. מצב עובד רואה רק ספירת מלאי.
const TABS = [["products", "מוצרים"], ["inventory", "ספירה"], ["processing", "עיבוד"], ["waste", "פחת"]];
const STAFF_TABS = ["inventory", "waste"]; // מצב עובד: ספירת מלאי ורישום פחת בלבד
let currentTab = "products";
export function setPantryTab(t) { currentTab = TABS.some((x) => x[0] === t) ? t : "products"; }

export async function renderPantryPage(container) {
    if (isStaffMode() && !STAFF_TABS.includes(currentTab)) currentTab = "inventory";
    const tabs = isStaffMode() ? TABS.filter(([k]) => STAFF_TABS.includes(k)) : TABS;
    const seg = `<div class="seg" id="pantry-seg">${tabs.map(([k, l]) => `<button type="button" data-tab="${k}" class="${k === currentTab ? "active" : ""}">${l}</button>`).join("")}</div>`;
    container.innerHTML = `${seg}<div id="pantry-tab"></div>`;
    const sub = container.querySelector("#pantry-tab");
    container.querySelectorAll("#pantry-seg [data-tab]").forEach((b) => { b.onclick = () => { currentTab = b.dataset.tab; renderPantryPage(container); }; });
    if (currentTab === "waste") await renderWastePage(sub);
    else if (currentTab === "inventory") await renderInventoryPage(sub);
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
            <div class="card-row">
                <span class="tag">${escapeHtml(it.category)}${it.subcategory ? " / " + escapeHtml(it.subcategory) : ""}</span>
                <span class="price-raw">${cur()}${Number(it.price).toFixed(2)} / ${UNIT_TYPE_LABELS[it.unit_type]}</span>
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
            <div class="field" id="f-egg-size-wrap" style="display:none;">
                <label>גודל הביצה ${info("קובע את משקל הביצה ללא קליפה ואת כמות החלבון והחלמון, כדי שהמתכונים יחשבו כמה ביצים לשבור ומה העלות.")}</label>
                <select id="f-egg-size">${Object.keys(EGG_SIZES).map((k) => `<option value="${k}">${k}</option>`).join("")}</select>
            </div>
            <div class="field" id="f-unit-amount-wrap">
                <label>משקל ליחידה (ק"ג) ${info('כמה שוקלת יחידה אחת, בק"ג עם נקודה עשרונית: ביצה 0.061, לימון 0.100, בקבוק שמן ליטר 1. נדרש כדי שמתכון יוכל להשתמש במוצר בגרמים.')}</label>
                <input type="text" inputmode="decimal" id="f-unit-amount" value="${existing && existing.unit_amount != null ? gramsToKgText(existing.unit_amount) : ""}">
                <div class="hint" id="f-unit-echo"></div>
            </div>
        </div>
        <div class="field" id="f-pack-wrap" style="display:none;">
            <label>כמה יחידות באריזה / מגש ${info("אם קונים באריזה (מגש ביצים של 30, חבילה של 10), הזן כאן את הכמות ובשדה המחיר את מחיר האריזה. המערכת תחשב מחיר ליחידה אחת. אם קונים ביחידה בודדת, השאר ריק או 1.")}</label>
            <input type="text" inputmode="numeric" id="f-pack" value="">
        </div>
        <div class="field"><label id="f-price-label">מחיר קנייה (${curLabel()})</label><input type="number" step="any" id="f-price" value="${existing ? existing.price : ""}"><div class="hint" id="f-price-echo"></div></div>
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
    // ביצים (ביחידות): מוצג גודל, והמשקל ליחידה מתמלא אוטומטית (ללא קליפה) אם ריק או שהיה ערך מהטבלה
    const eggWrap = overlay.querySelector("#f-egg-size-wrap");
    const eggSizeSel = overlay.querySelector("#f-egg-size");
    const amountInput = overlay.querySelector("#f-unit-amount");
    const nameEl = overlay.querySelector("#f-name");
    let lastAutoAmount = null;
    const isEggForm = () => unitTypeSelect.value === "unit" && isEggName(nameEl.value);
    function syncEgg(fromName = false) {
        const egg = isEggForm();
        eggWrap.style.display = egg ? "block" : "none";
        if (!egg) return;
        if (fromName && !eggSizeSel.dataset.touched && !(existing && existing.egg_size)) eggSizeSel.value = guessEggSize(nameEl.value);
        const liquid = EGG_SIZES[eggSizeSel.value].liquid;
        const cur = textToGrams(amountInput.value);
        const isTable = Object.values(EGG_SIZES).some((e) => e.liquid === cur);
        if (!(cur > 0) || isTable || cur === lastAutoAmount) { amountInput.value = gramsToKgText(liquid); lastAutoAmount = liquid; }
        // ביצים נקנות במגש: מציעים 30 ביצים באריזה למוצר חדש
        if (!existing && !packInput.dataset.touched && !packInput.value) packInput.value = "30";
        syncPrice();
    }
    if (existing) eggSizeSel.value = existing.egg_size && EGG_SIZES[existing.egg_size] ? existing.egg_size : guessEggSize(existing.name);
    else eggSizeSel.value = "M";
    nameEl.addEventListener("input", () => syncEgg(true));
    eggSizeSel.addEventListener("change", () => { eggSizeSel.dataset.touched = "1"; syncEgg(); });
    // אריזה/מגש (ליחידות): תווית המחיר, חישוב מחיר ליחידה אחת, ושורת אישור למשקל
    const packWrap = overlay.querySelector("#f-pack-wrap");
    const packInput = overlay.querySelector("#f-pack");
    const priceInput = overlay.querySelector("#f-price");
    const priceLabel = overlay.querySelector("#f-price-label");
    const priceEcho = overlay.querySelector("#f-price-echo");
    const unitEcho = overlay.querySelector("#f-unit-echo");
    const packCount = () => { const n = parseInt(String(packInput.value).trim(), 10); return n > 1 ? n : 1; };
    function syncPrice() {
        const ut = unitTypeSelect.value;
        packWrap.style.display = ut === "unit" ? "block" : "none";
        const pack = ut === "unit" ? packCount() : 1;
        priceLabel.textContent = ut === "unit" ? (pack > 1 ? `מחיר לאריזה של ${pack} (${curLabel()})` : `מחיר ליחידה אחת (${curLabel()})`) : ut === "liter" ? `מחיר לליטר (${curLabel()})` : `מחיר לק"ג (${curLabel()})`;
        const price = parseFloat(priceInput.value);
        priceEcho.textContent = ut === "unit" && pack > 1 && price > 0 ? `= ${(price / pack).toFixed(2)} ${curLabel()} ליחידה אחת` : "";
        const w = unitAmountInput.value;
        const warn = unitTypeSelect.value === "unit" && w ? qtyWarning(w) : null;
        unitEcho.innerHTML = warn ? `<span style="color:var(--danger);">${warn}</span>` : unitTypeSelect.value === "unit" ? describeQty(w) : "";
    }
    const unitAmountInput = overlay.querySelector("#f-unit-amount");
    packInput.addEventListener("input", syncPrice);
    priceInput.addEventListener("input", syncPrice);
    unitAmountInput.addEventListener("input", syncPrice);
    function syncUnitAmount() {
        unitAmountWrap.style.display = unitTypeSelect.value === "unit" ? "block" : "none";
    }
    catSelect.onchange = syncSubcategory;
    packInput.addEventListener("input", () => { packInput.dataset.touched = "1"; });
    unitTypeSelect.onchange = () => { syncUnitAmount(); syncEgg(true); syncPrice(); };
    syncSubcategory();
    syncUnitAmount();
    syncEgg(!existing);
    syncPrice();

    overlay.querySelector("#btn-cancel").onclick = () => attemptClose(overlay);
    overlay.querySelector("#btn-save").onclick = busy(async () => {
        const data = {
            name: overlay.querySelector("#f-name").value,
            category: catSelect.value,
            subcategory: overlay.querySelector("#f-subcategory").value,
            unit_type: unitTypeSelect.value,
            unit_amount: String(textToGrams(overlay.querySelector("#f-unit-amount").value) ?? ""),
            price: unitTypeSelect.value === "unit" && packCount() > 1 && parseFloat(overlay.querySelector("#f-price").value) > 0
                ? String(Math.round((parseFloat(overlay.querySelector("#f-price").value) / packCount()) * 10000) / 10000) : overlay.querySelector("#f-price").value,
            is_frozen: existing ? !!existing.is_frozen : false, // קפוא נקבע בעיבוד וניצולת
        };
        if (isEggForm()) data.egg_size = eggSizeSel.value;
        // אלרגנים לא מוצגים כאן: מוצר חדש מקבל הצעה אוטומטית לפי השם, ועריכה/אישור נעשים במתכון
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
