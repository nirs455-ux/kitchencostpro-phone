// ניהול קטגוריות חומרי הגלם (הוספה, שינוי שם, מחיקה, העברת תת-קטגוריה) ובחירת יעד להעברת מוצרים.
import { openModal, closeModal, escapeHtml, confirmDialog, toast } from "../ui.js";
import { CATEGORY_GROUPS } from "../constants.js";
import {
    PROTECTED, FALLBACK, pantryCategoryCounts, addPantryCategory, addPantrySubcategory, renamePantryCategory, deletePantryCategory,
    renamePantrySubcategory, deletePantrySubcategory, movePantrySubcategory,
} from "../repo/pantryCategories.js";

// מחזיר את שם הקטגוריה שנבחרה, או null אם בוטל. except: קטגוריה שלא מוצעת (למשל זו שממנה מעבירים)
function pickCategory(title, except = null) {
    return new Promise((resolve) => {
        const cats = Object.keys(CATEGORY_GROUPS).filter((c) => c !== except);
        const ov = openModal(`<h2>${escapeHtml(title)}</h2>
            <div class="pk-chips" style="flex-wrap:wrap;">${cats.map((c) => `<button type="button" class="chip" data-pc="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join("")}</div>
            <div class="modal-actions"><button type="button" class="btn btn-secondary" id="pc-cancel">ביטול</button></div>`);
        const done = (v) => { closeModal(); resolve(v); };
        ov.querySelectorAll("[data-pc]").forEach((b) => { b.onclick = () => done(b.dataset.pc); });
        ov.querySelector("#pc-cancel").onclick = () => done(null);
    });
}

// יעד להעברת מוצרים: קטגוריה ואם יש לה תתי-קטגוריות גם תת-קטגוריה (או בלי). מחזיר { category, sub } או null
export async function pickPantryTarget() {
    const category = await pickCategory("העבר לקטגוריה");
    if (!category) return null;
    const subs = CATEGORY_GROUPS[category] || [];
    if (!subs.length) return { category, sub: null };
    return new Promise((resolve) => {
        const ov = openModal(`<h2>${escapeHtml(category)}</h2>
            <div class="pk-chips" style="flex-wrap:wrap;"><button type="button" class="chip" data-ps="">בלי תת-קטגוריה</button>${subs.map((s) => `<button type="button" class="chip" data-ps="${escapeHtml(s)}">${escapeHtml(s)}</button>`).join("")}</div>
            <div class="modal-actions"><button type="button" class="btn btn-secondary" id="ps-cancel">ביטול</button></div>`);
        const done = (v) => { closeModal(); resolve(v); };
        ov.querySelectorAll("[data-ps]").forEach((b) => { b.onclick = () => done({ category, sub: b.dataset.ps || null }); });
        ov.querySelector("#ps-cancel").onclick = () => done(null);
    });
}

export async function openPantryCategories(onChange) {
    const draw = async () => {
        const { counts, subCounts } = await pantryCategoryCounts();
        const cats = Object.keys(CATEGORY_GROUPS);
        const ov = openModal(`<h2>קטגוריות חומרי גלם</h2>
            <div class="hint" style="margin-bottom:8px;">מוסיפים, משנים שם, מוחקים או מעבירים תת-קטגוריה עם כל המוצרים שלה. מחיקה לא מוחקת מוצרים: הם עוברים ל"${FALLBACK}".</div>
            <div class="form-row"><div class="field"><input type="text" id="pcat-new" maxlength="30" placeholder="קטגוריה חדשה"></div><button type="button" class="btn btn-primary" id="pcat-add" style="align-self:flex-end;">הוסף</button></div>
            <div class="error-msg" id="pcat-err"></div>
            <div id="pcat-list">${cats.map((c) => `
                <div class="card" style="margin:0 0 6px;">
                    <div class="card-row" style="align-items:center;gap:6px;"><b style="flex:1;">${escapeHtml(c)}</b><span class="muted">${counts.get(c) || 0}</span>
                        <button type="button" class="btn btn-secondary btn-small" data-sub-add="${escapeHtml(c)}">+ תת</button>
                        ${PROTECTED.has(c) ? "" : `<button type="button" class="btn btn-secondary btn-small" data-ren="${escapeHtml(c)}">שם</button><button type="button" class="btn btn-danger btn-small" data-del="${escapeHtml(c)}">מחק</button>`}</div>
                    ${(CATEGORY_GROUPS[c] || []).map((s) => `<div class="card-row" style="align-items:center;gap:6px;padding:4px 12px 0 0;"><span style="flex:1;">${escapeHtml(s)}</span><span class="muted">${subCounts.get(`${c}|${s}`) || 0}</span>
                        <button type="button" class="btn btn-secondary btn-small" data-sren="${escapeHtml(c)}|${escapeHtml(s)}">שם</button><button type="button" class="btn btn-secondary btn-small" data-smove="${escapeHtml(c)}|${escapeHtml(s)}">העבר</button><button type="button" class="btn btn-danger btn-small" data-sdel="${escapeHtml(c)}|${escapeHtml(s)}">מחק</button></div>`).join("")}
                </div>`).join("")}</div>
            <div class="modal-actions"><button type="button" class="btn btn-secondary" id="pcat-close">סגור</button></div>`);
        const err = ov.querySelector("#pcat-err");
        const fail = (e) => { err.textContent = e.message; err.style.display = "block"; };
        const run = async (fn) => { try { await fn(); await draw(); if (onChange) onChange(); } catch (e) { fail(e); } };
        const split = (v) => { const i = v.indexOf("|"); return [v.slice(0, i), v.slice(i + 1)]; };
        ov.querySelector("#pcat-add").onclick = () => run(() => addPantryCategory(ov.querySelector("#pcat-new").value));
        ov.querySelectorAll("[data-sub-add]").forEach((b) => { b.onclick = () => { const n = window.prompt("שם תת-קטגוריה חדשה:", ""); if (n === null) return; run(() => addPantrySubcategory(b.dataset.subAdd, n)); }; });
        ov.querySelectorAll("[data-ren]").forEach((b) => { b.onclick = () => { const n = window.prompt("שם חדש לקטגוריה:", b.dataset.ren); if (n === null) return; run(() => renamePantryCategory(b.dataset.ren, n)); }; });
        ov.querySelectorAll("[data-del]").forEach((b) => { b.onclick = async () => {
            const c = b.dataset.del, n = counts.get(c) || 0;
            if (!(await confirmDialog(n ? `למחוק את "${escapeHtml(c)}"? ${n} מוצרים יעברו ל"${FALLBACK}". אף מוצר לא נמחק.` : `למחוק את "${escapeHtml(c)}"?`))) { await draw(); return; }
            run(async () => { const m = await deletePantryCategory(c); toast(m ? `${m} מוצרים עברו ל"${FALLBACK}"` : "הקטגוריה נמחקה"); });
        }; });
        ov.querySelectorAll("[data-sren]").forEach((b) => { b.onclick = () => { const [c, s] = split(b.dataset.sren); const n = window.prompt("שם חדש לתת-קטגוריה:", s); if (n === null) return; run(() => renamePantrySubcategory(c, s, n)); }; });
        ov.querySelectorAll("[data-sdel]").forEach((b) => { b.onclick = async () => {
            const [c, s] = split(b.dataset.sdel), n = subCounts.get(`${c}|${s}`) || 0;
            if (!(await confirmDialog(n ? `למחוק את "${escapeHtml(s)}"? ${n} מוצרים יישארו ב"${escapeHtml(c)}" בלי תת-קטגוריה.` : `למחוק את "${escapeHtml(s)}"?`))) { await draw(); return; }
            run(() => deletePantrySubcategory(c, s));
        }; });
        ov.querySelectorAll("[data-smove]").forEach((b) => { b.onclick = async () => {
            const [c, s] = split(b.dataset.smove);
            const to = await pickCategory(`העבר את "${s}" לקטגוריה`, c);
            if (!to) { await draw(); return; }
            run(async () => { const m = await movePantrySubcategory(c, s, to); toast(`הועברו ${m} מוצרים אל ${to}`); });
        }; });
        ov.querySelector("#pcat-close").onclick = () => { closeModal(); if (onChange) onChange(); };
    };
    await draw();
}
