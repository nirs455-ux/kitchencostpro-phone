// חלון בחירה בעיצוב האפליקציה, במקום תיבת הבחירה של המערכת (פונט גדול, בלי חיפוש, כותרות קבוצה שנראות כאפשרויות).
// enhanceSelect(select) מסתיר את ה-select, מציג במקומו כפתור, ושומר עליו כמקור האמת (value + אירוע change).
import { escapeHtml } from "./ui.js";

const SEARCH_FROM = 7; // מספר אפשרויות שממנו מציגים שורת חיפוש

function readOptions(select) {
    const out = [];
    for (const node of select.children) {
        if (node.tagName === "OPTGROUP") {
            out.push({ group: node.label });
            for (const o of node.children) out.push({ value: o.value, label: o.textContent });
        } else out.push({ value: node.value, label: node.textContent });
    }
    return out;
}

// מחזיר את הערך שנבחר, או null אם סגרו בלי לבחור
export function pickOption({ title, options, value }) {
    return new Promise((resolve) => {
        const overlay = document.createElement("div");
        overlay.className = "pk-overlay";
        const searchable = options.filter((o) => !o.group).length >= SEARCH_FROM;
        overlay.innerHTML = `<div class="pk-sheet" role="dialog">
            <div class="pk-head"><b>${escapeHtml(title || "בחירה")}</b><button type="button" class="pk-x" aria-label="סגור">✕</button></div>
            ${searchable ? '<input type="text" class="pk-search" placeholder="חיפוש">' : ""}
            <div class="pk-list"></div></div>`;
        const list = overlay.querySelector(".pk-list");
        const close = (v) => { overlay.remove(); resolve(v); };
        const draw = (term) => {
            const t = String(term || "").trim().toLowerCase();
            let pendingGroup = null, html = "", any = false;
            for (const o of options) {
                if (o.group) { pendingGroup = o.group; continue; }
                if (t && !o.label.toLowerCase().includes(t)) continue;
                if (pendingGroup) { html += `<div class="pk-group">${escapeHtml(pendingGroup)}</div>`; pendingGroup = null; }
                any = true;
                html += `<button type="button" class="pk-opt${o.value === value ? " sel" : ""}" data-v="${escapeHtml(o.value)}"><span>${escapeHtml(o.label)}</span>${o.value === value ? "<i>✓</i>" : ""}</button>`;
            }
            list.innerHTML = any ? html : '<div class="pk-empty">לא נמצא</div>';
            list.querySelectorAll(".pk-opt").forEach((b) => { b.onclick = () => close(b.dataset.v); });
        };
        overlay.addEventListener("click", (e) => { if (e.target === overlay) close(null); });
        overlay.querySelector(".pk-x").onclick = () => close(null);
        const s = overlay.querySelector(".pk-search");
        if (s) s.oninput = () => draw(s.value);
        draw("");
        document.body.appendChild(overlay);
        if (s) s.focus();
    });
}

export function enhanceSelect(select, title) {
    if (!select || select.__pk) return;
    select.__pk = true;
    select.style.display = "none";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pk-btn";
    select.insertAdjacentElement("afterend", btn);
    const refresh = () => {
        const o = select.options[select.selectedIndex];
        btn.innerHTML = `<span>${escapeHtml(o ? o.textContent : "")}</span><i>▾</i>`;
    };
    select.refreshPicker = refresh;
    select.addEventListener("change", refresh);
    btn.onclick = async () => {
        const label = select.closest(".field") && select.closest(".field").querySelector("label");
        const v = await pickOption({ title: title || (label ? label.textContent.trim() : ""), options: readOptions(select), value: select.value });
        if (v === null || v === select.value) return;
        select.value = v;
        select.dispatchEvent(new Event("change", { bubbles: true }));
    };
    refresh();
}
