// ערכת רכיבים משותפת לרשימות באותו סגנון (חומרי גלם, מתכונים, מנות): שורת פריט, וקבוצות סגורות שנפתחות בלחיצה.
import { h, escapeHtml } from "../ui.js";
import { matchesDeep, normalize, orderCategories } from "./ingredientPicker.js";

export { matchesDeep, normalize };

// שורת פריט: אייקון בעיגול, שם, שורת פירוט, וצד שמאל (מחיר / תג). onClick בלחיצה
export function listRow({ ic = "•", tint = "var(--surface-2)", name, meta = "", end = "", onClick }) {
    const row = h(`<div class="px-row"><span class="px-ic" style="background:${tint};">${ic}</span>
        <div class="px-main"><div class="px-name">${escapeHtml(name)}</div><div class="px-meta">${meta}</div></div>
        <div class="px-price">${end}</div></div>`);
    if (onClick) row.onclick = onClick;
    return row;
}

// קבוצות סגורות: groups = [{ key, title, ic, tint, rows: [element] }]. open = Set של מפתחות פתוחים. searching = פותח הכול.
// onToggle(key) נקרא בלחיצה על כותרת (המסך מצייר מחדש).
export function groupsEl(groups, open, searching, onToggle) {
    const wrap = document.createElement("div");
    for (const g of groups) {
        const isOpen = searching || open.has(g.key);
        const sec = h(`<div class="px-sec"><div class="px-sh" data-k="${escapeHtml(g.key)}"><span class="px-ic" style="background:${g.tint || "var(--surface-2)"};">${g.ic || "📁"}</span><b>${escapeHtml(g.title)}</b><span class="px-cnt">${g.count ?? g.rows.length}</span><span class="px-chev">${isOpen ? "▾" : "◂"}</span></div></div>`);
        sec.querySelector(".px-sh").onclick = () => onToggle(g.key);
        if (isOpen) for (const r of g.rows) sec.appendChild(r);
        wrap.appendChild(sec);
    }
    return wrap;
}

export { orderCategories };
