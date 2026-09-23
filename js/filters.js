// ניווט לפי קטגוריות: מסך ראשי עם אריחי קטגוריות, ולחיצה מציגה רק את הקטגוריה שנבחרה.
// f.category: "" = מסך הקטגוריות, "*" = הכל, אחרת שם קטגוריה.
import { CATEGORY_GROUPS } from "./constants.js";
import { h, escapeHtml } from "./ui.js";

const states = {};

export function getFilter(key) {
    if (!states[key]) states[key] = { category: "", subcategory: "" };
    return states[key];
}

// כשלא נבחרה קטגוריה - לא מציגים פריטים (רק אריחי הקטגוריות)
export function applyFilter(items, f) {
    if (!f.category) return [];
    return items.filter((i) =>
        (f.category === "*" || i.category === f.category) &&
        (!f.subcategory || i.subcategory === f.subcategory)
    );
}

export function isVisible(item, f) {
    return applyFilter([item], f).length === 1;
}

export function mountFilterBar(container, items, f, onChange) {
    container.innerHTML = "";
    const cats = Object.keys(CATEGORY_GROUPS).filter((c) => items.some((i) => i.category === c));

    // קטגוריה אחת בלבד - נכנסים אליה ישר, בלי מסך בחירה
    const single = cats.length === 1;
    if (single && !f.category) f.category = cats[0];

    const go = (category, subcategory) => {
        f.category = category;
        f.subcategory = subcategory;
        mountFilterBar(container, items, f, onChange);
        onChange();
        window.scrollTo(0, 0);
    };

    if (!f.category) {
        if (items.length === 0) return;
        const grid = h(`<div class="cat-grid"></div>`);
        const tile = (label, n, category, extra = "") => {
            const t = h(`<div class="cat-tile ${extra}"><span class="cat-name">${escapeHtml(label)}</span><span class="cat-count">${n}</span></div>`);
            t.onclick = () => go(category, "");
            return t;
        };
        for (const c of cats) grid.appendChild(tile(c, items.filter((i) => i.category === c).length, c));
        if (cats.length > 1) grid.appendChild(tile("הכל", items.length, "*", "cat-all"));
        container.appendChild(grid);
        return;
    }

    const title = f.category === "*" ? "הכל" : f.category;
    const bar = h(`<div class="cat-bar"></div>`);
    if (!single) {
        const back = h(`<button type="button" class="cat-back">→ קטגוריות</button>`);
        back.onclick = () => go("", "");
        bar.appendChild(back);
    }
    bar.appendChild(h(`<span class="cat-title">${escapeHtml(title)}</span>`));
    container.appendChild(bar);

    const scope = items.filter((i) => f.category === "*" || i.category === f.category);
    const subs = Object.values(CATEGORY_GROUPS).flat().filter((s, idx, arr) => arr.indexOf(s) === idx)
        .filter((s) => scope.some((i) => i.subcategory === s));
    if (subs.length) {
        const row = h(`<div class="sub-scroll"></div>`);
        const chip = (label, active, sub) => {
            const c = h(`<div class="chip ${active ? "active" : ""}">${escapeHtml(label)}</div>`);
            c.onclick = () => go(f.category, sub);
            return c;
        };
        row.appendChild(chip(`הכל (${scope.length})`, !f.subcategory, ""));
        for (const s of subs) row.appendChild(chip(`${s} (${scope.filter((i) => i.subcategory === s).length})`, f.subcategory === s, s));
        container.appendChild(row);
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
