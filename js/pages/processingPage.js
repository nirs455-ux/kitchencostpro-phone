import { listAllPantryItems, updatePantryItemYield, addBreakdownProduct, deletePantryItem, deleteAllChildren, getDeleteInfo, deleteConfirmText } from "../repo/pantryRepo.js";
import { CATEGORY_GROUPS } from "../constants.js";
import { effectivePrice } from "../formulas.js";
import { h, openModal, closeModal, confirmDialog, toast, escapeHtml, info, busy, attemptClose, cur } from "../ui.js";
import { listRow, groupsEl, orderCategories, matchesDeep, normalize } from "./listKit.js";
import { assignAutoSubs, subOf } from "../autoGroups.js";

// מה פתוח כרגע: מוצרים עם תוצרים מפורקים (expanded) וקבוצות (procOpen). מתאפס בכל כניסה ללשונית.
const expanded = new Set();
const procOpen = new Set();
export function collapseAll() { expanded.clear(); procOpen.clear(); }
export function expandProduct(id) { expanded.add(id); }

const CAT_ICON = { "מהים": ["🐟", "var(--accent-soft)"], "קצביה": ["🥩", "var(--danger-soft)"], "ירקניה": ["🥬", "var(--ok-soft)"], "יבשים": ["📦", "var(--warn-soft)"], "מחלבה": ["🥛", "var(--brand-soft)"], "בר": ["🍷", "var(--brand-soft)"], "מחסן": ["🧰", "var(--surface-2)"] };
const catIcon = (c) => CAT_ICON[c] || ["📦", "var(--surface-2)"];

export async function renderProcessingPage(container) {
    const all = await listAllPantryItems();
    const topLevel = assignAutoSubs(all.filter((it) => !it.parent_id)).sort((a, b) => a.category.localeCompare(b.category, "he") || a.name.localeCompare(b.name, "he"));
    for (const p of topLevel) p.children = all.filter((it) => it.parent_id === p.id);
    let q = "";

    container.innerHTML = `<div class="px-top"><input type="search" id="pr-q" placeholder="חיפוש מוצר..." autocomplete="off"></div><div id="processing-list"></div>`;
    const list = container.querySelector("#processing-list");
    if (topLevel.length === 0) { list.innerHTML = '<div class="empty-state">אין עדיין מוצרים בחומרי הגלם.</div>'; return; }

    const rowFor = (it, indent) => {
        const eff = effectivePrice(it.price, it.yield_pct, it.is_frozen);
        const processed = isProcessed(it);
        const kids = it.children ? it.children.length : 0;
        const [ic, tint] = catIcon(it.category);
        const meta = `${processed ? `ניצולת ${Number(it.yield_pct).toFixed(0)}%` : "ללא עיבוד"}${it.is_frozen ? " · ❄" : ""}${kids ? ` · <span class="px-kids" data-kids="${it.id}">${expanded.has(it.id) ? "▾" : "◂"} ${kids} תוצרים</span>` : ""}`;
        const end = `${cur()}${eff.toFixed(2)}<small>${processed || it.is_frozen ? `מ-${cur()}${Number(it.price).toFixed(2)}` : "/ ק\"ג"}</small>`;
        const row = listRow({ ic: indent ? "↳" : ic, tint: indent ? "var(--surface-2)" : tint, name: it.name, meta, end, onClick: () => openProcSheet(it, container) });
        if (indent) row.classList.add("px-indent");
        const kb = row.querySelector("[data-kids]");
        if (kb) kb.onclick = (e) => { e.stopPropagation(); if (expanded.has(it.id)) expanded.delete(it.id); else expanded.add(it.id); draw(); };
        return row;
    };

    function draw() {
        list.innerHTML = "";
        const searching = !!normalize(q);
        const shown = topLevel.filter((it) => matchesDeep({ name: it.name, category: it.category, subcategory: subOf(it), children: it.children.map((c) => ({ name: c.name })) }, q));
        if (!shown.length) { list.innerHTML = '<div class="empty-state">לא נמצא מוצר תואם.</div>'; return; }
        const groups = orderCategories(shown.map((x) => x.category)).map((cat) => {
            const inCat = shown.filter((x) => x.category === cat);
            const [ic, tint] = catIcon(cat);
            const rows = [];
            const subs = [...new Set(inCat.map((x) => subOf(x)))].sort((a, b) => a.localeCompare(b, "he"));
            const hasSubs = subs.some(Boolean);
            for (const sub of subs) {
                const inSub = inCat.filter((x) => subOf(x) === sub);
                const forceOpen = inSub.some((x) => expanded.has(x.id));
                if (hasSubs && sub) {
                    const key = `ps:${cat}:${sub}`;
                    const subOpen = searching || forceOpen || procOpen.has(key);
                    const sh = h(`<div class="px-sh px-sh2"><b>${escapeHtml(sub)}</b><span class="px-cnt">${inSub.length}</span><span class="px-chev">${subOpen ? "▾" : "◂"}</span></div>`);
                    sh.onclick = () => { if (procOpen.has(key)) procOpen.delete(key); else procOpen.add(key); draw(); };
                    rows.push(sh);
                    if (!subOpen) continue;
                }
                for (const it of inSub) {
                    rows.push(rowFor(it, false));
                    if (expanded.has(it.id)) for (const c of it.children) rows.push(rowFor(c, true));
                }
            }
            return { key: "pc:" + cat, title: cat, ic, tint, rows, count: inCat.length, forceOpen: inCat.some((x) => expanded.has(x.id)) };
        });
        const open = new Set([...procOpen, ...groups.filter((g) => g.forceOpen).map((g) => g.key)]);
        list.appendChild(groupsEl(groups, open, searching, (k) => { if (procOpen.has(k)) procOpen.delete(k); else procOpen.add(k); draw(); }));
    }
    const qEl = container.querySelector("#pr-q");
    qEl.oninput = () => { q = qEl.value; draw(); };
    draw();
}

function priceLine(it) {
    const eff = effectivePrice(it.price, it.yield_pct, it.is_frozen);
    return `${cur()}${Number(it.price).toFixed(2)} ← ${cur()}${eff.toFixed(2)} (${Number(it.yield_pct).toFixed(1)}%)`;
}

// כרטיס פעולות למוצר/תוצר: עיבוד, + תוצר, איפוס, מחיקת תוצרים, מחיקה
function openProcSheet(it, container) {
    const [ic, tint] = catIcon(it.category);
    const kids = it.children ? it.children.length : 0;
    const row = (k, v) => `<div class="sh-row"><span class="muted">${k}</span><span>${v}</span></div>`;
    const ov = openModal(`
        <div class="sh-head"><span class="px-ic" style="background:${tint};">${it.parent_id ? "↳" : ic}</span><div><div class="sh-name">${escapeHtml(it.name)}</div><div class="muted">${escapeHtml(it.category)}${it.is_frozen ? " · ❄ קפוא" : ""}</div></div></div>
        ${row("מחיר קנייה ← מחיר אמיתי", priceLine(it))}
        ${isProcessed(it) ? row("עיבוד", `משקל ${it.weight_before ?? "-"} ← ${it.weight_after ?? "-"}`) : ""}
        <div class="sh-actions">
            <button type="button" class="btn btn-secondary" id="ps-yield">עיבוד</button>
            ${it.parent_id ? "" : '<button type="button" class="btn btn-secondary" id="ps-break">+ תוצר</button>'}
        </div>
        <div class="sh-actions" style="margin-top:8px;">
            ${isProcessed(it) ? '<button type="button" class="btn btn-secondary" id="ps-reset">אפס עיבוד</button>' : ""}
            ${kids ? '<button type="button" class="btn btn-secondary" id="ps-delkids">מחק תוצרים</button>' : ""}
            <button type="button" class="btn btn-danger" id="ps-del">${it.parent_id ? "מחק תוצר" : "מחק מחומרי הגלם"}</button>
        </div>
        <button type="button" class="btn btn-secondary btn-block" id="ps-close" style="margin-top:8px;">סגור</button>`);
    ov.querySelector("#ps-close").onclick = closeModal;
    ov.querySelector("#ps-yield").onclick = () => { closeModal(); openYieldModal(it, container); };
    const br = ov.querySelector("#ps-break");
    if (br) br.onclick = () => { closeModal(); openBreakdownModal(it, container); };
    const rs = ov.querySelector("#ps-reset");
    if (rs) rs.onclick = async () => {
        closeModal();
        if (!(await confirmDialog("לאפס את העיבוד? הניצולת תחזור ל-100% והמחיר האמיתי יהיה שווה למחיר הקנייה.<br><br>המוצר יישאר בחומרי הגלם."))) return;
        try {
            await updatePantryItemYield(it.id, { name: it.name, yield_pct: 100, weight_before: "", weight_after: "", is_frozen: !!it.is_frozen });
            toast("העיבוד אופס");
            renderProcessingPage(container);
        } catch (e) { toast(e.message); }
    };
    const dk = ov.querySelector("#ps-delkids");
    if (dk) dk.onclick = async () => {
        closeModal();
        if (!(await confirmDialog(`למחוק את כל ${kids} התוצרים המפורקים של "${escapeHtml(it.name)}"?<br><br>חומר הגלם עצמו יישאר בחומרי הגלם.`))) return;
        await deleteAllChildren(it.id);
        toast("נמחק");
        renderProcessingPage(container);
    };
    ov.querySelector("#ps-del").onclick = () => { closeModal(); confirmAndDelete(it, container); };
}

function isProcessed(it) {
    return Number(it.yield_pct) !== 100 || it.weight_before != null;
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
            <div class="field"><label>משקל לפני בגרם</label><input type="number" step="any" id="f-wb" value="${it.weight_before ?? ""}"></div>
            <div class="field"><label>משקל אחרי בגרם</label><input type="number" step="any" id="f-wa" value="${it.weight_after ?? ""}"></div>
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
            <div class="field"><label>משקל לפני בגרם</label><input type="number" step="any" id="f-wb"></div>
            <div class="field"><label>משקל אחרי בגרם</label><input type="number" step="any" id="f-wa"></div>
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
