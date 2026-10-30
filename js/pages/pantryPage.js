import { listTopLevelPantryItems, addPantryItem, updatePantryItem, deletePantryItem, getDeleteInfo, deleteConfirmText } from "../repo/pantryRepo.js";
import { CATEGORY_GROUPS, UNIT_TYPES, UNIT_TYPE_LABELS } from "../constants.js";
import { h, openModal, closeModal, confirmDialog, toast, escapeHtml, busy, attemptClose, info, cur, curLabel } from "../ui.js";
import { openScanModal } from "./scanModal.js";
import { dbGetAll } from "../db.js";
import { getSetting, setSetting } from "../repo/settingsRepo.js";
import { renderProcessingPage, collapseAll, expandProduct } from "./processingPage.js";
import { renderInventoryPage } from "./inventoryPage.js";
import { renderWastePage } from "./wastePage.js";
import { isStaffMode } from "../staff.js";
import { EGG_SIZES, isEggName, guessEggSize } from "../eggs.js";
import { textToGrams, gramsToKgText, describeQty, qtyWarning, isGramMode } from "../qty.js";
import { matchesDeep, normalize, orderCategories } from "./ingredientPicker.js";
import { getFilter } from "../filters.js";
import { assignAutoSubs, subOf } from "../autoGroups.js";
import { effectivePrice } from "../formulas.js";
import { buildInventoryView } from "../repo/inventoryRepo.js";
import { openPriceHistory } from "./priceHistoryModal.js";
import { openLabelScan } from "./labelModal.js";
import { getLabelInfo } from "../repo/nutritionRepo.js";
import { allergenLabels } from "../allergens.js";
import { addonOn } from "../addons.js";

// חומרי גלם = שלוש לשוניות: מוצרים | ספירת מלאי | עיבוד וניצולת. מצב עובד רואה רק ספירת מלאי.
const TABS = [["products", "מוצרים"], ["inventory", "ספירת מלאי"], ["processing", "עיבוד"], ["waste", "פחת"]];
const STAFF_TABS = ["inventory", "waste"]; // מצב עובד: ספירת מלאי ורישום פחת בלבד
let currentTab = "products";
export function setPantryTab(t) { collapseAll(); collapsePantryList(); currentTab = TABS.some((x) => x[0] === t) ? t : "products"; }

const UNIT_FORM_LABELS = { weight: 'לפי משקל (מחיר לק"ג)', liter: "לפי נפח (מחיר לליטר)", unit: "לפי יחידה (בקבוק, ביצה, חבילה)" };

export async function renderPantryPage(container) {
    if (isStaffMode() && !STAFF_TABS.includes(currentTab)) currentTab = "inventory";
    if (currentTab === "inventory" && !addonOn("count")) currentTab = isStaffMode() ? "waste" : "products"; // תוספת כבויה
    const tabs = (isStaffMode() ? TABS.filter(([k]) => STAFF_TABS.includes(k)) : TABS).filter(([k]) => k !== "inventory" || addonOn("count"));
    const seg = `<div class="seg" id="pantry-seg">${tabs.map(([k, l]) => `<button type="button" data-tab="${k}" class="${k === currentTab ? "active" : ""}">${l}</button>`).join("")}</div>`;
    container.innerHTML = `${seg}<div id="pantry-tab"></div>`;
    const sub = container.querySelector("#pantry-tab");
    container.querySelectorAll("#pantry-seg [data-tab]").forEach((b) => { b.onclick = () => { collapseAll(); collapsePantryList(); currentTab = b.dataset.tab; renderPantryPage(container); }; });
    if (currentTab === "waste") await renderWastePage(sub);
    else if (currentTab === "inventory") await renderInventoryPage(sub);
    else if (currentTab === "processing") await renderProcessingPage(sub);
    else await renderPantryProducts(sub);
}

// ---- דף המוצרים: קטגוריות סגורות (ברירת מחדל) או רשימה עם חיפוש וסינון. לחיצה על מוצר פותחת כרטיס עם פרטים ופעולות ----
const pxOpen = new Set(); // קטגוריות/תתי-קטגוריות פתוחות כרגע (מתאפס בכל כניסה ללשונית)
export function collapsePantryList() { pxOpen.clear(); }

const CAT_STYLE = {
    "מהים": ["🐟", "var(--accent-soft)"], "קצביה": ["🥩", "var(--danger-soft)"], "ירקניה": ["🥬", "var(--ok-soft)"],
    "יבשים": ["📦", "var(--warn-soft)"], "מחלבה": ["🥛", "var(--brand-soft)"], "בר": ["🍷", "var(--brand-soft)"], "מחסן": ["🧰", "var(--surface-2)"],
};
const catStyle = (c) => CAT_STYLE[c] || ["📦", "var(--surface-2)"];
const unitWord = (it) => (it.unit_type === "unit" ? "יחידה" : it.unit_type === "liter" ? "ליטר" : 'ק"ג');

function pxRow(it) {
    const [ic, tint] = catStyle(it.category);
    const tags = [it.is_frozen ? '<span class="tag tag-frozen">❄ קפוא</span>' : "", it.price_missing ? '<span class="tag tag-danger">חסר מחיר</span>' : ""].filter(Boolean).join(" ");
    return h(`<div class="px-row" data-id="${it.id}"><span class="px-ic" style="background:${tint};">${ic}</span>
        <div class="px-main"><div class="px-name">${escapeHtml(it.name)}</div><div class="px-meta">${escapeHtml(subOf(it) || it.category)}${tags ? " · " : ""}${tags}</div></div>
        <div class="px-price">${cur()}${Number(it.price).toFixed(2)}<small>/ ${unitWord(it)}</small></div></div>`);
}

export async function renderPantryProducts(container) {
    const root = container.parentElement; // כל עמוד חומרי הגלם (לשוניות + תוכן), לרענון אחרי מעבר ללשונית אחרת
    const items = assignAutoSubs(await listTopLevelPantryItems()); // תתי-קטגוריות אוטומטיות לפי תחילת השם (צ'ילי, שום...)
    const all = await dbGetAll("pantryItems");
    const kids = new Map();
    for (const c of all) if (c.parent_id) kids.set(c.parent_id, [...(kids.get(c.parent_id) || []), c]);
    const lastBought = new Map();
    const invoiceDate = Object.fromEntries((await dbGetAll("invoices")).filter((i) => i.document_type !== "credit" && !i.deleted_at).map((i) => [i.id, i.invoice_date || ""]));
    for (const it of await dbGetAll("invoiceItems")) {
        const d = invoiceDate[it.invoice_id];
        if (it.pantry_item_id && d && d > (lastBought.get(it.pantry_item_id) || "")) lastBought.set(it.pantry_item_id, d);
    }
    let view = (await getSetting("pantry_view")) || "cats"; // cats | list
    let sortMode = (await getSetting("pantry_sort")) || "name";
    let q = "";
    let chip = ""; // קטגוריה נבחרת בתצוגת הרשימה
    const sorted = () => [...items].sort((a, b) => a.category.localeCompare(b.category, "he") || (sortMode === "recent" ? (lastBought.get(b.id) || "").localeCompare(lastBought.get(a.id) || "") : 0) || a.name.localeCompare(b.name, "he"));
    const visible = (it) => matchesDeep({ name: it.name, category: it.category, subcategory: subOf(it) }, q); // חיפוש רק במוצרים (העיבוד שייך ללשונית עיבוד)

    container.innerHTML = `
        <div class="px-top"><input type="search" id="px-q" placeholder="חיפוש מוצר..." autocomplete="off">
            <div class="seg px-view"><button type="button" data-v="cats" class="${view === "cats" ? "active" : ""}">קטגוריות</button><button type="button" data-v="list" class="${view === "list" ? "active" : ""}">רשימה</button></div></div>
        <div id="px-chips"></div>
        <div id="pantry-list"></div>
        <button class="fab-add" id="btn-add">+</button>`;
    const list = container.querySelector("#pantry-list");
    const chipsEl = container.querySelector("#px-chips");

    const openItem = (id) => openProductSheet(items.find((i) => i.id === id), kids.get(id) || [], container, root);
    const wireRows = () => list.querySelectorAll(".px-row").forEach((r) => { r.onclick = () => openItem(Number(r.dataset.id)); });

    function draw() {
        list.innerHTML = "";
        chipsEl.innerHTML = "";
        if (!items.length) { list.innerHTML = '<div class="empty-state">אין עדיין מוצרים בחומרי הגלם - לחץ על + כדי להוסיף.</div>'; return; }
        const rows = sorted().filter(visible);
        if (view === "list") {
            const cats = orderCategories(items.map((i) => i.category));
            chipsEl.innerHTML = `<div class="pk-chips"><button type="button" class="chip ${chip ? "" : "active"}" data-c="">הכול ${items.length}</button>${cats.map((c) => `<button type="button" class="chip ${chip === c ? "active" : ""}" data-c="${escapeHtml(c)}">${escapeHtml(c)} ${items.filter((i) => i.category === c).length}</button>`).join("")}
                <select id="px-sort" class="chip-select"><option value="name">לפי שם</option><option value="recent">נקנה לאחרונה</option></select></div>`;
            chipsEl.querySelectorAll("[data-c]").forEach((b) => { b.onclick = () => { chip = b.dataset.c; draw(); }; });
            const ss = chipsEl.querySelector("#px-sort"); ss.value = sortMode;
            ss.onchange = async () => { sortMode = ss.value; await setSetting("pantry_sort", sortMode); draw(); };
            const shown = rows.filter((it) => !chip || it.category === chip);
            if (!shown.length) list.innerHTML = `<div class="empty-state">${q ? "לא נמצא מוצר תואם." : "אין מוצרים בקטגוריה הזו."}</div>`;
            for (const it of shown) list.appendChild(pxRow(it));
        } else {
            const searching = !!normalize(q);
            if (!rows.length) { list.innerHTML = '<div class="empty-state">לא נמצא מוצר תואם.</div>'; return; }
            for (const cat of orderCategories(rows.map((r) => r.category))) {
                const inCat = rows.filter((r) => r.category === cat);
                const open = searching || pxOpen.has("c:" + cat);
                const [ic] = catStyle(cat);
                const sec = h(`<div class="px-sec"><div class="px-sh" data-k="c:${escapeHtml(cat)}"><span class="px-ic" style="background:${catStyle(cat)[1]};">${ic}</span><b>${escapeHtml(cat)}</b><span class="px-cnt">${inCat.length}</span><span class="px-chev">${open ? "▾" : "◂"}</span></div></div>`);
                if (open) {
                    const subs = [...new Set(inCat.map((r) => subOf(r)))];
                    const hasSubs = subs.some(Boolean);
                    for (const sub of subs.sort((a, b) => a.localeCompare(b, "he"))) {
                        const rowsSub = inCat.filter((r) => subOf(r) === sub);
                        let body = rowsSub;
                        if (hasSubs && sub) {
                            const subOpen = searching || pxOpen.has(`s:${cat}:${sub}`);
                            const sh = h(`<div class="px-sh px-sh2" data-k="s:${escapeHtml(cat)}:${escapeHtml(sub)}"><b>${escapeHtml(sub)}</b><span class="px-cnt">${rowsSub.length}</span><span class="px-chev">${subOpen ? "▾" : "◂"}</span></div>`);
                            sec.appendChild(sh);
                            if (!subOpen) continue;
                        }
                        for (const it of body) sec.appendChild(pxRow(it));
                    }
                }
                list.appendChild(sec);
            }
            list.querySelectorAll(".px-sh").forEach((hd) => { hd.onclick = () => { const k = hd.dataset.k; if (pxOpen.has(k)) pxOpen.delete(k); else pxOpen.add(k); draw(); }; });
        }
        wireRows();
    }

    const qEl = container.querySelector("#px-q");
    qEl.oninput = () => { q = qEl.value; draw(); };
    container.querySelectorAll(".px-view [data-v]").forEach((b) => { b.onclick = async () => { view = b.dataset.v; await setSetting("pantry_view", view); renderPantryProducts(container); }; });
    container.querySelector("#btn-add").onclick = () => openPantryModal(null, container);
    draw();
}

// כרטיס מוצר: פרטים ופעולות (עריכה, עיבוד, מחיקה) - במקום כפתורים בכל שורה
async function openProductSheet(it, children, container, root) {
    if (!it) return;
    const [ic, tint] = catStyle(it.category);
    const eff = effectivePrice(it.price, it.yield_pct, it.is_frozen);
    let stock = null;
    try { stock = (await buildInventoryView()).find((x) => x.id === it.id); } catch (e) { /* לא קריטי */ }
    let labelInfo = null;
    try { labelInfo = (await getLabelInfo())[it.id] || null; } catch (e) { /* לא קריטי */ }
    const row = (k, v) => `<div class="sh-row"><span class="muted">${k}</span><span>${v}</span></div>`;
    const overlay = openModal(`
        <div class="sh-head"><span class="px-ic" style="background:${tint};">${ic}</span><div><div class="sh-name">${escapeHtml(it.name)}</div><div class="muted">${escapeHtml(it.category)}${subOf(it) ? " / " + escapeHtml(subOf(it)) : ""}${it.is_frozen ? " · ❄ קפוא" : ""}</div></div></div>
        ${row("מחיר קנייה", `${cur()}${Number(it.price).toFixed(2)} / ${unitWord(it)}`)}
        ${Math.abs(eff - Number(it.price)) > 0.004 ? row("מחיר אמיתי (אחרי ניצולת)", `${cur()}${eff.toFixed(2)} (${Number(it.yield_pct).toFixed(0)}%)`) : ""}
        ${it.unit_type === "unit" ? row("משקל ליחידה", it.unit_amount ? `${gramsToKgText(it.unit_amount)} ${isGramMode() ? "גרם" : 'ק"ג'}` : '<span class="muted">לא הוגדר (בסדר, אפשר לעבוד ביחידות)</span>') : ""}
        ${stock ? row("מלאי תיאורטי", `${+Number(stock.theoretical_quantity).toFixed(3)} ${unitWord(it)}`) : ""}
        ${labelInfo && labelInfo.ingredients ? row("רכיבים (מהתווית)", escapeHtml(labelInfo.ingredients.length > 160 ? labelInfo.ingredients.slice(0, 160) + "…" : labelInfo.ingredients)) : ""}
        ${labelInfo && labelInfo.may_contain && labelInfo.may_contain.length ? row("עלול להכיל עקבות", escapeHtml(allergenLabels(labelInfo.may_contain).join(", "))) : ""}
        <div class="sh-actions" style="flex-wrap:wrap;">
            <button type="button" class="btn btn-secondary" id="sh-hist">📈 היסטוריית מחירים</button>
            <button type="button" class="btn btn-secondary" id="sh-label">📷 צלם תווית</button>
            <button type="button" class="btn btn-secondary" id="sh-edit">עריכה</button>
            <button type="button" class="btn btn-secondary" id="sh-proc">עיבוד</button>
            <button type="button" class="btn btn-danger" id="sh-del">מחיקה</button>
        </div>
        <button type="button" class="btn btn-secondary btn-block" id="sh-close" style="margin-top:8px;">סגור</button>`);
    overlay.querySelector("#sh-close").onclick = closeModal;
    overlay.querySelector("#sh-hist").onclick = () => { closeModal(); openPriceHistory(it); };
    overlay.querySelector("#sh-label").onclick = () => { closeModal(); openLabelScan({ item: it, onDone: () => renderPantryProducts(container) }); };
    overlay.querySelector("#sh-edit").onclick = () => { closeModal(); openPantryModal(it, container); };
    overlay.querySelector("#sh-proc").onclick = () => { closeModal(); collapseAll(); expandProduct(it.id); const f = getFilter("processing"); f.category = it.category; f.subcategory = ""; currentTab = "processing"; renderPantryPage(root); };
    overlay.querySelector("#sh-del").onclick = async () => {
        try {
            closeModal();
            if (!(await confirmDialog(deleteConfirmText(await getDeleteInfo(it.id))))) return;
            await deletePantryItem(it.id);
            toast("נמחק");
            renderPantryProducts(container);
        } catch (e) { toast(e.message); }
    };
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
                <label>איך המוצר נקנה ומתומחר? ${info('משקל: קמח, סוכר, ירקות, בשר (מחיר לק"ג). נפח: שמן, חלב, מיצים (מחיר לליטר). יחידה: מה שנספר בחתיכות, כמו ביצה, קופסה או בקבוק שרוצים לספור. במתכון תמיד כותבים ק"ג או ליטר והמערכת מחשבת עלות. אם האריזה היא לא קילו או ליטר (למשל בקבוק 370 מ"ל), אפשר להוסיף את גודל האריזה בשדה שמתחת.')}</label>
                <select id="f-unit-type">
                    ${UNIT_TYPES.map((u) => `<option value="${u}" ${existing && existing.unit_type === u ? "selected" : ""}>${UNIT_FORM_LABELS[u]}</option>`).join("")}
                </select>
            </div>
            <div class="field" id="f-egg-size-wrap" style="display:none;">
                <label>גודל הביצה ${info("קובע את משקל הביצה ללא קליפה ואת כמות החלבון והחלמון, כדי שהמתכונים יחשבו כמה ביצים לשבור ומה העלות.")}</label>
                <select id="f-egg-size">${Object.keys(EGG_SIZES).map((k) => `<option value="${k}">${k}</option>`).join("")}</select>
            </div>
            <div class="field" id="f-unit-amount-wrap">
                <label>${isGramMode() ? "משקל ליחידה (גרם, לא חובה)" : 'משקל ליחידה (ק"ג, לא חובה)'} ${info(isGramMode() ? 'כמה שוקלת יחידה אחת, בגרמים: ביצה 61, לימון 100. אפשר להשאיר ריק, למשל בלחמניה. במתכון כותבים כמה יחידות, והעלות מחושבת ממחיר היחידה. משקל נחוץ רק אם רוצים משקל ותזונה לרכיב הזה.' : 'כמה שוקלת יחידה אחת, בק"ג עם נקודה עשרונית: ביצה 0.061, לימון 0.100. אפשר להשאיר ריק, למשל בלחמניה. במתכון כותבים כמה יחידות, והעלות מחושבת ממחיר היחידה. משקל נחוץ רק אם רוצים משקל ותזונה לרכיב הזה.')}</label>
                <input type="text" inputmode="decimal" id="f-unit-amount" value="${existing && existing.unit_amount != null ? gramsToKgText(existing.unit_amount) : ""}">
                <div class="hint" id="f-unit-echo"></div>
            </div>
        </div>
        <div class="field" id="f-pack-wrap" style="display:none;">
            <label>כמה יחידות באריזה / מגש ${info("אם קונים באריזה (מגש ביצים של 30, חבילה של 10), הזן כאן את הכמות ובשדה המחיר את מחיר האריזה. המערכת תחשב מחיר ליחידה אחת. אם קונים ביחידה בודדת, השאר ריק או 1.")}</label>
            <input type="text" inputmode="numeric" id="f-pack" value="">
        </div>
        <div class="field" id="f-bulk-wrap" style="display:none;">
            <label>גודל האריזה (לא חובה) ${info('אם האריזה היא לא קילו או ליטר: בקבוק שמן 370 מ"ל, שקית קמח 800 גרם, ארגז 10 ק"ג. כותבים את הגודל ובשדה המחיר את מחיר האריזה, והמערכת מחשבת לבד מחיר לק"ג או לליטר. אם המחיר שלך כבר לק"ג או לליטר, משאירים ריק. כשמוגדר גודל אריזה, בספירת מלאי סופרים אריזות (בקבוקים, שקיות) והמערכת ממירה לבד לליטר או ק"ג.')}</label>
            <div class="cv-row"><input type="text" inputmode="decimal" id="f-buy-qty" value="" placeholder="למשל 370"><select id="f-buy-unit"></select></div>
            <input type="hidden" id="f-bulk" value="">
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
    const bulkWrap = overlay.querySelector("#f-bulk-wrap");
    const bulkInput = overlay.querySelector("#f-bulk");
    const bulkKg = () => { const n = parseFloat(String(bulkInput.value).replace(",", ".")); return n > 0 ? n : 0; };
    const packCount = () => { const n = parseInt(String(packInput.value).trim(), 10); return n > 1 ? n : 1; };
    function syncPrice() {
        const ut = unitTypeSelect.value;
        packWrap.style.display = ut === "unit" ? "block" : "none";
        bulkWrap.style.display = ut === "unit" ? "none" : "block";
        const pack = ut === "unit" ? packCount() : 1;
        const bulk = ut !== "unit" && !existing ? bulkKg() : 0;
        const unitName = ut === "unit" ? "ליחידה אחת" : ut === "liter" ? "לליטר" : 'לק"ג';
        priceLabel.textContent = ut === "unit" ? (pack > 1 ? `מחיר לאריזה של ${pack} (${curLabel()})` : `מחיר ליחידה אחת (${curLabel()})`) : bulk > 0 ? `מחיר האריזה (${curLabel()})` : `מחיר ${unitName} (${curLabel()})`;
        const price = parseFloat(priceInput.value);
        priceEcho.textContent = ut === "unit" && pack > 1 && price > 0 ? `= ${(price / pack).toFixed(2)} ${curLabel()} ליחידה אחת` : bulk > 0 && price > 0 ? `= ${(price / bulk).toFixed(2)} ${curLabel()} ${unitName}` : "";
        const w = unitAmountInput.value;
        const warn = unitTypeSelect.value === "unit" && w ? qtyWarning(w) : null;
        unitEcho.innerHTML = warn ? `<span style="color:var(--danger);">${warn}</span>` : unitTypeSelect.value === "unit" ? describeQty(w) : "";
    }
    const unitAmountInput = overlay.querySelector("#f-unit-amount");
    packInput.addEventListener("input", syncPrice);
    priceInput.addEventListener("input", syncPrice);
    bulkInput.addEventListener("input", syncPrice);
    unitAmountInput.addEventListener("input", syncPrice);
    function syncUnitAmount() {
        unitAmountWrap.style.display = unitTypeSelect.value === "unit" ? "block" : "none";
    }
    catSelect.onchange = syncSubcategory;
    packInput.addEventListener("input", () => { packInput.dataset.touched = "1"; });
    // גודל אריזה (לא חובה) למשקל/נפח: 370 מ"ל, 800 גרם. נשמר מחיר לק"ג/ליטר מחושב מתוך מחיר האריזה
    const buyQty = overlay.querySelector("#f-buy-qty");
    const buyUnit = overlay.querySelector("#f-buy-unit");
    const PKG_MULT = { g: 0.001, kg: 1, ml: 0.001, l: 1 };
    let pkgType = "";
    function syncBuy() {
        const type = unitTypeSelect.value;
        if (type !== "unit" && type !== pkgType) {
            pkgType = type;
            buyUnit.innerHTML = (type === "liter" ? [["ml", 'מ"ל'], ["l", "ליטר"]] : [["g", "גרם"], ["kg", 'ק"ג']]).map(([k, l]) => `<option value="${k}">${l}</option>`).join("");
        }
        const q = parseFloat(String(buyQty.value).replace(",", ".")) || 0;
        bulkInput.value = type !== "unit" && q > 0 ? String(Math.round(q * (PKG_MULT[buyUnit.value] || 1) * 10000) / 10000) : "";
        syncPrice();
    }
    buyQty.addEventListener("input", syncBuy);
    buyUnit.addEventListener("change", syncBuy);
    unitTypeSelect.onchange = () => { syncUnitAmount(); syncEgg(true); syncBuy(); };
    syncSubcategory();
    syncUnitAmount();
    syncEgg(!existing);
    syncBuy();
    if (existing && existing.pkg_size > 0 && existing.unit_type !== "unit") { // עריכה: מציג את גודל האריזה השמור (המחיר נשאר לק"ג/ליטר)
        const q = Number(existing.pkg_size);
        const u = existing.unit_type === "liter" ? (q < 1 ? "ml" : "l") : (q < 1 ? "g" : "kg");
        buyUnit.value = u;
        buyQty.value = String(Math.round((q / PKG_MULT[u]) * 1000) / 1000);
        syncBuy();
    }

    overlay.querySelector("#btn-cancel").onclick = () => attemptClose(overlay);
    overlay.querySelector("#btn-save").onclick = busy(async () => {
        const data = {
            name: overlay.querySelector("#f-name").value,
            category: catSelect.value,
            subcategory: overlay.querySelector("#f-subcategory").value,
            unit_type: unitTypeSelect.value,
            unit_amount: String(textToGrams(overlay.querySelector("#f-unit-amount").value) ?? ""),
            price: unitTypeSelect.value !== "unit" && !existing && bulkKg() > 0 && parseFloat(overlay.querySelector("#f-price").value) > 0
                ? String(Math.round((parseFloat(overlay.querySelector("#f-price").value) / bulkKg()) * 10000) / 10000)
                : unitTypeSelect.value === "unit" && packCount() > 1 && parseFloat(overlay.querySelector("#f-price").value) > 0
                ? String(Math.round((parseFloat(overlay.querySelector("#f-price").value) / packCount()) * 10000) / 10000) : overlay.querySelector("#f-price").value,
            pkg_size: unitTypeSelect.value !== "unit" ? String(bulkKg() || "") : "",
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
