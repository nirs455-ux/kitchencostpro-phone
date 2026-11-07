// בחירת מסעדה: רשימה עם חיפוש ומועדפות, מסעדה חדשה (אפשר להעתיק ממסעדה קיימת), שינוי שם, מחיקה, ושחזור מדרייב.
import { openModal, closeModal, escapeHtml, toast, confirmDialog, toastAction } from "../ui.js";
import { ADDONS, enabledAddons } from "../addons.js";
import { ACTIVE_DB_NAME, deleteDBByName } from "../db.js";
import {
    readRegistry, displayName, sortedList, addRestaurant, renameRestaurant, setFavorite, setActiveRestaurant, removeRestaurant, activeRestaurant, FIRST_ID,
} from "../restaurants.js";
import { prepareNewDb } from "../restaurantDb.js";

const PENDING = "kcp_restore_pending";
const switchTo = (id) => { setActiveRestaurant(id); location.reload(); };

export const restaurantTitle = () => {
    const { list, activeId } = readRegistry();
    return list.length > 1 ? displayName(list.find((r) => r.id === activeId)) : "";
};

export function restaurantChipHtml() {
    const r = activeRestaurant();
    return `<button type="button" class="btn btn-secondary btn-small" id="rest-chip" style="margin:0 0 8px;">🏪 ${escapeHtml(displayName(r))} ▾</button>`;
}

export function openRestaurantPicker() {
    const st = { q: "" };
    const ovl = openModal(`<h2>${escapeHtml("מסעדות")}</h2><div id="rp-body"></div><div class="modal-actions"><button type="button" class="btn btn-secondary" id="rp-close">${escapeHtml("סגור")}</button></div>`);
    ovl.querySelector("#rp-close").onclick = closeModal;
    const body = ovl.querySelector("#rp-body");

    function drawList() {
        const { list, activeId } = readRegistry();
        const q = st.q.trim().toLowerCase();
        const shown = sortedList(list).filter((r) => !q || displayName(r).toLowerCase().includes(q));
        body.innerHTML = `
            ${list.length > 6 ? `<div class="field"><input type="search" id="rp-q" placeholder="${escapeHtml("חיפוש מסעדה")}" value="${escapeHtml(st.q)}"></div>` : ""}
            <div>${shown.map((r) => `<div class="card-row" style="padding:7px 0;gap:6px;align-items:center;border-top:1px solid var(--border,#0001);">
                <button type="button" class="btn btn-small ${r.fav ? "btn-primary" : "btn-secondary"}" data-fav="${r.id}" aria-label="${escapeHtml("מועדפת")}">★</button>
                <span style="flex:1;min-width:0;cursor:pointer;${r.id === activeId ? "font-weight:700;" : ""}" data-go="${r.id}">${escapeHtml(displayName(r))}${r.id === activeId ? " ✓" : ""}</span>
                <button type="button" class="btn btn-secondary btn-small" data-ren="${r.id}">✎</button>
                ${r.id !== FIRST_ID && r.id !== activeId ? `<button type="button" class="btn btn-secondary btn-small" data-del="${r.id}">🗑</button>` : ""}</div>`).join("")}</div>
            <div class="btn-row" style="margin-top:10px;flex-wrap:wrap;gap:6px;">
                <button type="button" class="btn btn-primary btn-small" id="rp-new">＋ ${escapeHtml("מסעדה חדשה")}</button>
                <button type="button" class="btn btn-secondary btn-small" id="rp-drive">☁️ ${escapeHtml("שחזור מדרייב")}</button>
            </div>`;
        const qEl = body.querySelector("#rp-q");
        if (qEl) qEl.oninput = () => { st.q = qEl.value; drawList(); body.querySelector("#rp-q").focus(); };
        body.querySelectorAll("[data-go]").forEach((e) => { e.onclick = () => { if (e.dataset.go !== activeId) switchTo(e.dataset.go); else closeModal(); }; });
        body.querySelectorAll("[data-fav]").forEach((b) => { b.onclick = () => { const r = list.find((x) => x.id === b.dataset.fav); setFavorite(r.id, !r.fav); drawList(); }; });
        body.querySelectorAll("[data-ren]").forEach((b) => { b.onclick = () => drawRename(b.dataset.ren); });
        body.querySelectorAll("[data-del]").forEach((b) => { b.onclick = () => doDelete(b.dataset.del); });
        body.querySelector("#rp-new").onclick = drawNew;
        body.querySelector("#rp-drive").onclick = drawDrive;
    }

    function drawRename(id) {
        const r = readRegistry().list.find((x) => x.id === id);
        body.innerHTML = `<div class="field"><label>${escapeHtml("שם המסעדה")}</label><input type="text" id="rp-name" value="${escapeHtml(r.name)}" placeholder="${escapeHtml(displayName(r))}"></div>
            <div class="btn-row"><button type="button" class="btn btn-secondary" id="rp-back">${escapeHtml("חזרה")}</button><button type="button" class="btn btn-primary" id="rp-save">${escapeHtml("שמירה")}</button></div>`;
        body.querySelector("#rp-back").onclick = drawList;
        body.querySelector("#rp-save").onclick = () => { renameRestaurant(id, body.querySelector("#rp-name").value); if (id === readRegistry().activeId) location.reload(); else drawList(); };
    }

    async function doDelete(id) {
        const r = readRegistry().list.find((x) => x.id === id);
        if (!(await confirmDialog(`${escapeHtml("למחוק את המסעדה")} "${escapeHtml(displayName(r))}" ${escapeHtml("וכל הנתונים שלה מהטלפון? נתונים שנשמרו בדרייב לא נמחקים. אי אפשר לבטל.")}`))) { openRestaurantPicker(); return; }
        try { await deleteDBByName(r.dbName); removeRestaurant(id); toast("המסעדה נמחקה"); } catch (e) { toast(e.message || "המחיקה נכשלה"); }
        openRestaurantPicker();
    }

    function drawNew() {
        const { list, activeId } = readRegistry();
        const on = new Set(enabledAddons());
        body.innerHTML = `
            <div class="field"><label>${escapeHtml("שם המסעדה")}</label><input type="text" id="rn-name"></div>
            <div class="field"><label>${escapeHtml("להתחיל מ")}</label><select id="rn-copy"><option value="">${escapeHtml("ריק")}</option>${list.map((r) => `<option value="${r.id}"${r.id === activeId ? " selected" : ""}>${escapeHtml(displayName(r))}</option>`).join("")}</select>
                <div class="hint">${escapeHtml("העתקה כוללת חומרי גלם, מתכונים, מנות וספקים. חשבוניות, ספירות וסרוויסים לא מועתקים.")}</div></div>
            <div class="field"><label>${escapeHtml("תוספים")}</label>${ADDONS.map((a) => `<label class="checkbox-field" style="display:flex;gap:8px;align-items:flex-start;margin:6px 0;"><input type="checkbox" data-ad="${a.key}"${on.has(a.key) ? " checked" : ""}><span><b>${escapeHtml(a.label)}</b><br><span class="muted">${escapeHtml(a.desc)}</span></span></label>`).join("")}</div>
            <div class="error-msg" id="rn-err"></div>
            <div class="btn-row"><button type="button" class="btn btn-secondary" id="rn-back">${escapeHtml("חזרה")}</button><button type="button" class="btn btn-primary" id="rn-ok">${escapeHtml("יצירה")}</button></div>`;
        body.querySelector("#rn-back").onclick = drawList;
        body.querySelector("#rn-ok").onclick = async () => {
            const name = body.querySelector("#rn-name").value.trim();
            const err = body.querySelector("#rn-err");
            if (!name) { err.textContent = "הזן שם למסעדה"; err.style.display = "block"; return; }
            const btn = body.querySelector("#rn-ok"); btn.disabled = true;
            try {
                const copyId = body.querySelector("#rn-copy").value;
                const addons = [...body.querySelectorAll("[data-ad]")].filter((c) => c.checked).map((c) => c.dataset.ad);
                const r = addRestaurant(name);
                const src = copyId ? readRegistry().list.find((x) => x.id === copyId) : null;
                try { await prepareNewDb(r.dbName, { addons, copyFromDb: src ? (src.id === activeId ? ACTIVE_DB_NAME : src.dbName) : null }); }
                catch (e) { removeRestaurant(r.id); throw e; }
                switchTo(r.id);
            } catch (e) { err.textContent = e.message || "היצירה נכשלה"; err.style.display = "block"; btn.disabled = false; }
        };
    }

    async function drawDrive() {
        body.innerHTML = `<div class="muted">${escapeHtml("מתחבר לדרייב...")}</div>`;
        try {
            const { listCloudRestaurants } = await import("../cloud/cloudGlue.js");
            const found = await listCloudRestaurants();
            const local = new Set(readRegistry().list.map((r) => r.id));
            body.innerHTML = found.length ? `<div class="hint" style="margin-bottom:6px;">${escapeHtml("בחר מסעדה לשחזור. הנתונים יוחלפו בנתוני הדרייב.")}</div>${found.map((f) => `<div class="card-row" style="padding:7px 0;border-top:1px solid var(--border,#0001);"><span>${escapeHtml(f.name || (f.id === FIRST_ID ? "המסעדה שלי" : "מסעדה"))}${local.has(f.id) ? ` <span class="muted">${escapeHtml("קיימת בטלפון")}</span>` : ""}</span><button type="button" class="btn btn-secondary btn-small" data-pick="${f.id}" data-name="${escapeHtml(f.name)}">${escapeHtml("בחר")}</button></div>`).join("")}<div class="btn-row" style="margin-top:8px;"><button type="button" class="btn btn-secondary" id="rd-back">${escapeHtml("חזרה")}</button></div>`
                : `<div class="muted">${escapeHtml("לא נמצאו מסעדות בדרייב.")}</div><div class="btn-row" style="margin-top:8px;"><button type="button" class="btn btn-secondary" id="rd-back">${escapeHtml("חזרה")}</button></div>`;
            body.querySelector("#rd-back").onclick = drawList;
            body.querySelectorAll("[data-pick]").forEach((b) => {
                b.onclick = () => {
                    const id = b.dataset.pick;
                    try { addRestaurant(b.dataset.name, { id }); localStorage.setItem(PENDING, id); } catch (e) { toast(e.message); return; }
                    switchTo(id);
                };
            });
        } catch (e) { body.innerHTML = `<div class="error-msg" style="display:block;">${escapeHtml(e && e.message ? e.message : "החיבור לדרייב נכשל")}</div><div class="btn-row" style="margin-top:8px;"><button type="button" class="btn btn-secondary" id="rd-back">${escapeHtml("חזרה")}</button></div>`; body.querySelector("#rd-back").onclick = drawList; }
    }

    drawList();
}

// אחרי מעבר למסעדה שנבחרה לשחזור מדרייב: מציע לשחזר (דורש לחיצה, כי ההתחברות ל-Google נפתחת רק מפעולה של המשתמש)
export function offerPendingRestore() {
    try {
        const id = localStorage.getItem(PENDING);
        if (!id) return;
        localStorage.removeItem(PENDING);
        if (id !== activeRestaurant().id) return;
        toastAction("שחזר את נתוני המסעדה מהדרייב", "שחזר", async () => {
            try {
                const { connectCloud, restoreFromCloud } = await import("../cloud/cloudGlue.js");
                await connectCloud();
                await restoreFromCloud();
                location.reload();
            } catch (e) { toast(e && e.message ? e.message : "השחזור נכשל"); }
        }, 600000);
    } catch (e) { /* לא קריטי */ }
}
