// סינון לפי קטגוריה/תת-קטגוריה (לשוניות) וקיבוץ עם כותרות - משותף למזווה, עיבוד ומלאי.
import { CATEGORY_GROUPS } from "./constants.js";
import { h, escapeHtml } from "./ui.js";

const states = {};

export function getFilter(key) {
    if (!states[key]) states[key] = { category: "", subcategory: "" };
    return states[key];
}

export function applyFilter(items, f) {
    return items.filter((i) =>
        (!f.category || i.category === f.category) &&
        (!f.subcategory || i.subcategory === f.subcategory)
    );
}

// מצייר את שורות הלשוניות לתוך container. onChange נקרא אחרי כל בחירה.
export function mountFilterBar(container, items, f, onChange) {
    container.innerHTML = "";
    const mkChip = (label, active, onClick) => {
        const chip = h(`<div class="chip ${active ? "active" : ""}">${escapeHtml(label)}</div>`);
        chip.onclick = onClick;
        return chip;
    };
    const select = (category, subcategory) => {
        f.category = category;
        f.subcategory = subcategory;
        mountFilterBar(container, items, f, onChange);
        onChange();
    };

    const cats = Object.keys(CATEGORY_GROUPS).filter((c) => items.some((i) => i.category === c));
    const catRow = h(`<div class="chips"></div>`);
    catRow.appendChild(mkChip(`הכל (${items.length})`, !f.category, () => select("", "")));
    for (const c of cats) {
        const n = items.filter((i) => i.category === c).length;
        catRow.appendChild(mkChip(`${c} (${n})`, f.category === c, () => select(c, "")));
    }
    container.appendChild(catRow);

    if (f.category) {
        const subs = (CATEGORY_GROUPS[f.category] || []).filter((s) =>
            items.some((i) => i.category === f.category && i.subcategory === s)
        );
        if (subs.length) {
            const subRow = h(`<div class="chips"></div>`);
            subRow.appendChild(mkChip("כל התת-קטגוריות", !f.subcategory, () => select(f.category, "")));
            for (const s of subs) {
                const n = items.filter((i) => i.category === f.category && i.subcategory === s).length;
                subRow.appendChild(mkChip(`${s} (${n})`, f.subcategory === s, () => select(f.category, s)));
            }
            container.appendChild(subRow);
        }
    }
}

// מקבץ לפי קטגוריה ותת-קטגוריה, לפי סדר הקטגוריות שהוגדר. מחזיר [{title, items}].
export function groupBySection(items) {
    const catOrder = Object.keys(CATEGORY_GROUPS);
    const groups = new Map();
    for (const it of items) {
        const title = it.subcategory ? `${it.category} / ${it.subcategory}` : it.category;
        if (!groups.has(title)) groups.set(title, { title, category: it.category, sub: it.subcategory || "", items: [] });
        groups.get(title).items.push(it);
    }
    return [...groups.values()].sort((a, b) => {
        const ca = catOrder.indexOf(a.category), cb = catOrder.indexOf(b.category);
        if (ca !== cb) return ca - cb;
        return a.sub.localeCompare(b.sub, "he");
    });
}

export function groupTitleEl(title, count) {
    return h(`<div class="group-title">${escapeHtml(title)} <span class="muted">(${count})</span></div>`);
}
