// לשונית פחת (בחומרי הגלם): רישום מהיר של מה שנזרק, ודוח עלות. עובד רושם בלי לראות מחירים; מנהל רואה דוח ומוחק.
import { dbGetAll } from "../db.js";
import { addWaste, listWaste, deleteWaste, restoreWaste, purchasesSince, todayIso } from "../repo/wasteRepo.js";
import { WASTE_REASONS, REASON_LABEL, WASTE_UNITS, pantryWasteCost, recipeWasteCost, periodStart, summarizeWaste } from "../waste.js";
import { h, openModal, closeModal, toast, toastAction, escapeHtml, money, busy, attemptClose, info, takeFlag } from "../ui.js";
import { isStaffMode } from "../staff.js";
import { listRow } from "./listKit.js";

let period = "week";
const PERIODS = [["today", "היום"], ["week", "7 ימים"], ["month", "החודש"], ["all", "הכול"]];
const unitLabel = (u) => ({ g: "גרם", kg: 'ק"ג', ml: 'מ"ל', l: "ליטר", unit: "יח'" }[u] || u);
const fmtDate = (d) => (d || "").split("-").reverse().join("/");
const qtyText = (l) => `${+Number(l.qty).toFixed(3)} ${unitLabel(l.unit)}`;

export async function renderWastePage(container) {
    const staff = isStaffMode();
    if (staff) period = "today";
    const from = periodStart(period);
    const logs = await listWaste(from);
    const rerender = () => renderWastePage(container);

    let summaryHtml = "";
    if (!staff) {
        const s = summarizeWaste(logs, await purchasesSince(from));
        const maxR = Math.max(1, ...s.byReason.map((r) => r.cost));
        summaryHtml = `
        <div class="seg" id="w-period">${PERIODS.map(([k, l]) => `<button type="button" data-p="${k}" class="${k === period ? "active" : ""}">${l}</button>`).join("")}</div>
        <div class="card">
            <div class="card-row"><span class="card-title">סך הפסד ${info("עלות כל מה שנזרק בתקופה שנבחרה.")}</span><span style="font-size:20px;font-weight:700;color:var(--danger);">${money(s.total)}</span></div>
            <div class="card-row"><span class="muted">${s.count} רישומים</span>
                ${s.pctOfPurchases != null ? `<span>${s.pctOfPurchases}% מהקניות ${info("סך הפחת חלקי סך החשבוניות באותה תקופה. מדד פשוט לראות אם יש בעיה: ככל שהוא נמוך יותר, כך טוב יותר.")}</span>` : ""}</div>
            ${s.byReason.length ? `<div style="margin-top:8px;">${s.byReason.map((r) => `<div style="margin:5px 0;"><div class="card-row" style="font-size:13px;"><span>${escapeHtml(REASON_LABEL[r.reason] || r.reason)}</span><span>${money(r.cost)}</span></div>
                <div style="height:6px;border-radius:3px;background:var(--brand-soft);"><div style="height:6px;border-radius:3px;background:var(--danger);width:${Math.round((r.cost / maxR) * 100)}%;"></div></div></div>`).join("")}</div>` : ""}
            ${s.topItems.length ? `<div class="card-title" style="margin:12px 0 4px;font-size:13px;">הכי הרבה נזרק</div>${s.topItems.map((t) => `<div class="card-row" style="font-size:13px;"><span>${escapeHtml(t.name)} <span class="muted">· ${t.count === 1 ? "פעם אחת" : t.count + " פעמים"}</span></span><span>${money(t.cost)}</span></div>`).join("")}` : ""}
        </div>`;
    }

    container.innerHTML = `
        <button type="button" class="btn btn-primary btn-big btn-block" id="w-add" style="margin:4px 0 10px;">＋ רישום פחת</button>
        ${summaryHtml}
        <div class="card-title" style="margin:12px 2px 6px;">${staff ? "נרשם היום" : "רישומים"}</div>
        <div id="w-list"></div>`;

    container.querySelector("#w-add").onclick = () => openWasteModal(rerender);
    if (takeFlag("waste-new")) openWasteModal(rerender); // נלחץ "רישום פחת" בבית
    container.querySelectorAll("#w-period [data-p]").forEach((b) => { b.onclick = () => { period = b.dataset.p; rerender(); }; });

    const list = container.querySelector("#w-list");
    if (!logs.length) { list.innerHTML = `<div class="empty-state">${staff ? "עוד לא נרשם היום כלום." : "אין רישומי פחת בתקופה הזאת."}</div>`; return; }
    for (const l of logs) {
        const reasonTxt = escapeHtml(REASON_LABEL[l.reason] || l.reason);
        const meta = `${qtyText(l)} · ${reasonTxt} · ${fmtDate(l.date)}${l.by ? " · " + escapeHtml(l.by) : ""}${l.note ? " · " + escapeHtml(l.note) : ""}`;
        const row = listRow({ ic: "🗑", tint: "var(--danger-soft)", name: l.name, meta, end: staff ? "" : `${money(l.cost)} <button type="button" class="remove-row-btn" data-del="${l.id}" aria-label="מחק רישום">✕</button>` });
        row.style.cursor = "default";
        const del = row.querySelector("[data-del]");
        if (del) del.onclick = async () => {
            const old = await deleteWaste(l.id);
            toastAction("הרישום נמחק", "בטל", async () => { await restoreWaste(old); rerender(); });
            rerender();
        };
        list.appendChild(row);
    }
}

async function openWasteModal(onSaved) {
    const staff = isStaffMode();
    const pantry = (await dbGetAll("pantryItems")).sort((a, b) => a.name.localeCompare(b.name, "he"));
    const recipes = (await dbGetAll("recipes")).sort((a, b) => a.name.localeCompare(b.name, "he"));
    const tops = pantry.filter((p) => !p.parent_id);
    let source = "pantry";
    let reason = "";
    let lastBy = "";
    try { lastBy = localStorage.getItem("kcp_waste_by") || ""; } catch (e) { /* לא קריטי */ }

    const overlay = openModal(`
        <h2>רישום פחת</h2>
        <div class="seg" id="wm-src"><button type="button" data-s="pantry" class="active">מוצר</button><button type="button" data-s="recipe">מתכון שהוכן</button></div>
        <div class="field"><label>מה נזרק?</label><select id="wm-item"></select></div>
        <div class="form-row">
            <div class="field"><label>כמות</label><input type="number" step="any" id="wm-qty" inputmode="decimal"></div>
            <div class="field"><label>יחידה</label><select id="wm-unit"></select></div>
        </div>
        <div class="field"><label>סיבה</label><div class="chips" id="wm-reasons">${WASTE_REASONS.map((r) => `<button type="button" class="chip" data-r="${r.key}">${r.label}</button>`).join("")}</div></div>
        <div class="field"><label>הערה</label><input type="text" id="wm-note"></div>
        <div class="form-row">
            <div class="field"><label>נרשם על ידי</label><input type="text" id="wm-by" value="${escapeHtml(lastBy)}" placeholder="שם"></div>
            <div class="field"><label>תאריך</label><input type="date" id="wm-date" value="${todayIso()}"></div>
        </div>
        ${staff ? "" : '<div class="hint" id="wm-cost"></div>'}
        <div class="error-msg"></div>
        <div class="modal-actions"><button type="button" class="btn btn-secondary" id="wm-cancel">ביטול</button><button type="button" class="btn btn-primary" id="wm-save">שמירה</button></div>`);

    const q = (s) => overlay.querySelector(s);
    const itemSel = q("#wm-item"), unitSel = q("#wm-unit"), qtyEl = q("#wm-qty");
    const current = () => {
        const id = Number(itemSel.value);
        return source === "recipe" ? recipes.find((r) => r.id === id) : pantry.find((p) => p.id === id);
    };
    const fillItems = () => {
        if (source === "recipe") itemSel.innerHTML = `<option value="">בחר מתכון...</option>` + recipes.map((r) => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join("");
        else itemSel.innerHTML = `<option value="">בחר מוצר...</option>` + tops.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>` + pantry.filter((c) => c.parent_id === p.id).map((c) => `<option value="${c.id}">↳ ${escapeHtml(c.name)}</option>`).join("")).join("");
        fillUnits();
    };
    const fillUnits = () => {
        const it = current();
        const type = source === "recipe" ? "recipe" : it ? it.unit_type : "weight";
        unitSel.innerHTML = (WASTE_UNITS[type] || WASTE_UNITS.weight).map(([u, l]) => `<option value="${u}">${l}</option>`).join("");
        preview();
    };
    const preview = () => {
        const el = q("#wm-cost");
        if (!el) return;
        const it = current(), qty = parseFloat(qtyEl.value);
        const c = it && qty > 0 ? (source === "recipe" ? recipeWasteCost(it, qty, unitSel.value) : pantryWasteCost(it, qty, unitSel.value)) : null;
        el.textContent = c != null ? `עלות הפחת: ${money(c)}` : "";
    };
    q("#wm-src").querySelectorAll("[data-s]").forEach((b) => {
        b.onclick = () => { source = b.dataset.s; q("#wm-src").querySelectorAll("[data-s]").forEach((x) => x.classList.toggle("active", x === b)); fillItems(); };
    });
    itemSel.onchange = fillUnits;
    unitSel.onchange = preview;
    qtyEl.oninput = preview;
    q("#wm-reasons").querySelectorAll("[data-r]").forEach((b) => {
        b.onclick = () => { reason = b.dataset.r; q("#wm-reasons").querySelectorAll("[data-r]").forEach((x) => x.classList.toggle("active", x === b)); };
    });
    fillItems();

    q("#wm-cancel").onclick = () => attemptClose(overlay);
    q("#wm-save").onclick = busy(async () => {
        const by = q("#wm-by").value.trim();
        try {
            await addWaste({ source_type: source, source_id: itemSel.value, qty: qtyEl.value, unit: unitSel.value, reason, note: q("#wm-note").value, by, date: q("#wm-date").value });
            try { localStorage.setItem("kcp_waste_by", by); } catch (e) { /* לא קריטי */ }
            closeModal();
            toast("נרשם");
            onSaved();
        } catch (e) {
            const el = q(".error-msg");
            el.textContent = e.message;
            el.style.display = "block";
        }
    });
}
