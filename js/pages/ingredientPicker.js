import { bindUnitChoice } from "../unitChoice.js";
// בורר מרכיבים: חיפוש + קטגוריות + תתי-קטגוריות + "אחרונים". משמש לבניית מתכון ולבניית מנה (ועובד גם עם מאות מוצרים).
// נפתח כשכבה נפרדת מעל החלון הפתוח (בלי לסגור אותו). מחזיר את הבחירה דרך onPick.
import { isWaterName } from "../freeItems.js";
import { CATEGORY_GROUPS, UNIT_TYPES, UNIT_TYPE_LABELS } from "../constants.js";
import { escapeHtml, layerOpened, layerClosed } from "../ui.js";
import { getSetting, setSetting } from "../repo/settingsRepo.js";
import { nameCovers } from "../nameMatch.js";
import { guessCategory } from "../guessCategory.js";
import { estimateYield } from "../yieldKb.js";

const RECENT_KEY = "picker_recent";
const RECENT_MAX = 12;

// מנרמל טקסט לחיפוש: אותיות קטנות, בלי גרשיים/מקפים/סימנים
export function normalize(s) {
    return String(s || "").toLowerCase().replace(/["'`׳״]/g, "").replace(/[\-–_.,()־]/g, " ").replace(/\s+/g, " ").trim();
}

// האם הפריט תואם את החיפוש: כל מילה בחיפוש חייבת להופיע בשם או בקטגוריה
export function matches(item, query) {
    const q = normalize(query);
    if (!q) return true;
    const hay = normalize(`${item.name} ${item.category || ""} ${item.subcategory || ""}`);
    return q.split(" ").every((t) => hay.includes(t));
}

// פריט תואם אם הוא עצמו או אחד מהתוצרים המפורקים שלו תואם (חיפוש "נקי" מוצא את "בצל לבן" שיש לו תוצר "נקי")
export function matchesDeep(item, query) {
    return matches(item, query) || (item.children || []).some((c) => matches({ ...c, category: item.category, subcategory: item.subcategory }, query));
}

// סדר: מי ששמו מתחיל במילה הראשונה קודם, אחר כך לפי א-ב
export function rankResults(items, query) {
    const first = normalize(query).split(" ")[0] || "";
    return [...items].sort((a, b) => {
        const sa = normalize(a.name).startsWith(first) ? 0 : 1;
        const sb = normalize(b.name).startsWith(first) ? 0 : 1;
        return sa - sb || a.name.localeCompare(b.name, "he");
    });
}

// סדר קטגוריות: קודם לפי הרשימה הקבועה של חומרי הגלם, אחר כך לפי א-ב
export function orderCategories(cats) {
    const fixed = Object.keys(CATEGORY_GROUPS);
    return [...new Set(cats)].sort((a, b) => {
        const ia = fixed.indexOf(a), ib = fixed.indexOf(b);
        if (ia !== -1 || ib !== -1) return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
        return a.localeCompare(b, "he");
    });
}

async function loadRecents() {
    const v = await getSetting(RECENT_KEY);
    return Array.isArray(v) ? v : [];
}
async function pushRecent(key) {
    const list = (await loadRecents()).filter((k) => k !== key);
    list.unshift(key);
    await setSetting(RECENT_KEY, list.slice(0, RECENT_MAX));
}

// items: [{ key, type, id, name, category, subcategory, indent, hint, tab }]. tabs: [{ key, label }] (אם יש יותר מאחד מוצגת בחירה)
// זוכר איפה עצרת (לשונית, חיפוש, קטגוריה וגלילה) כדי שהוספת מרכיב הבא תמשיך משם. מתאפס כשפותחים בונה חדש.
let memory = null;
export function resetPickerMemory() { memory = null; }

// onCreate: מאפשר להוסיף מוצר חדש תוך כדי עבודה. מקבל { name, category, unit_type, price } ומחזיר את הפריט החדש (או זורק שגיאה)
// multi: בחירה של כמה פריטים יחד (מסמנים ולוחצים "הוסף"), onPick מקבל מערך. מוצר חדש שנוצר מצטרף לסימון.
export async function openIngredientPicker({ title = "בחר מרכיב", items, tabs = null, onPick, onCreate = null, multi = false }) {
    const layer = document.createElement("div");
    layer.className = "picker";
    document.body.appendChild(layer);
    const tabList = tabs && tabs.length > 1 ? tabs : null;
    const st = { tab: tabList ? tabList[0].key : null, q: "", cat: "", sub: "", open: null, openGroups: new Set() };
    let restoreScroll = 0;
    // הזיכרון משותף לכל הבוחרים: משחזרים רק אם הלשונית שייכת לבורר הזה, והקטגוריה קיימת בו (בורר אחר לא יסתיר פריטים)
    const sameKind = !!memory && (tabList ? tabList.some((t) => t.key === memory.tab) : memory.tab === null);
    if (memory && sameKind) {
        st.tab = memory.tab; st.cat = memory.cat; st.sub = memory.sub; // החיפוש מתנקה בכל פתיחה
        restoreScroll = memory.q ? 0 : memory.scroll || 0;
        if (st.cat && !items.some((i) => i.category === st.cat && (!st.tab || i.tab === st.tab))) { st.cat = ""; st.sub = ""; restoreScroll = 0; }
    }
    let lastScroll = restoreScroll;
    const remember = () => { memory = { tab: st.tab, q: st.q, cat: st.cat, sub: st.sub, scroll: lastScroll }; };
    let flat = items.flatMap((i) => [i, ...(i.children || [])]);
    const sel = new Map(); // בחירה מרובה: key -> פריט

    layerOpened();
    const close = () => { layer.remove(); layerClosed(); };
    const visibleItems = () => items.filter((i) => !st.tab || i.tab === st.tab);

    // שלב שני: למוצר שיש לו תוצרים מפורקים (בצל לבן -> נקי...) מציגים את האפשרויות. כל השאר נבחר ישר.
    function drawOptions(parent) {
        const opts = [{ ...parent, indent: false, hint: [parent.hint, "כמו שקנית"].filter(Boolean).join(" · "), name: parent.name }, ...(parent.children || [])];
        layer.innerHTML = `
            <div class="pk-top"><button type="button" class="pk-close" id="pk-back" aria-label="חזרה">→</button><div class="pk-title">${escapeHtml(parent.name)}</div></div>
            <div class="pk-sub">איזו צורה של המוצר?</div>
            <div class="pk-list" id="pk-list">${opts.map((o) => `<div class="pk-row" data-key="${escapeHtml(o.key)}"><div class="pk-name">${escapeHtml(o === opts[0] ? `${parent.name} (כמו שקנית)` : o.name)}</div><div class="pk-hint">${escapeHtml(o.hint || "")}</div></div>`).join("")}</div>`;
        layer.querySelector("#pk-back").onclick = () => { st.open = null; draw(); };
        layer.querySelectorAll(".pk-row").forEach((r) => {
            r.onclick = async () => {
                const item = flat.find((i) => i.key === r.dataset.key);
                if (!item) return;
                remember();
                close();
                onPick(item);
            };
        });
    }

    // טופס קצר למוצר חדש: שם, קטגוריה, יחידת מדידה ומחיר
    function drawCreate(name) {
        layer.innerHTML = `
            <div class="pk-top"><button type="button" class="pk-close" id="pk-back" aria-label="חזרה">→</button><div class="pk-title">מוצר חדש בחומרי הגלם</div></div>
            <div style="padding:0 16px 16px;overflow:auto;flex:1;">
                <div class="field"><label>שם המוצר</label><input type="text" id="pk-n-name" value="${escapeHtml(name)}"></div>
                <div class="field"><label>קטגוריה</label><select id="pk-n-cat">${Object.keys(CATEGORY_GROUPS).map((c) => `<option value="${escapeHtml(c)}"${c === guessCategory(name) ? " selected" : ""}>${escapeHtml(c)}</option>`).join("")}</select></div>
                <div class="field"><label>נמדד ב-</label><select id="pk-n-unit">${UNIT_TYPES.map((u) => `<option value="${u}">${escapeHtml(UNIT_TYPE_LABELS[u])}</option>`).join("")}</select></div>
                <div class="field" id="pk-n-yield-wrap" style="display:none;"><label>ניצולת מוערכת, באחוזים</label><input type="text" inputmode="decimal" id="pk-n-yield"><div class="hint">אחרי קילוף וניקוי. אפשר לשנות, ועיבוד אמיתי בחומרי הגלם יחליף אותה.</div></div>
                <div class="field" id="pk-n-ua-wrap" style="display:none;"><label>משקל ליחידה, בגרמים, לא חובה</label><input type="text" inputmode="decimal" id="pk-n-ua"></div>
                <div class="field"><label>מחיר</label><input type="text" inputmode="decimal" id="pk-n-price" placeholder="אפשר להשלים אחר כך"><label class="checkbox-field" style="margin:8px 0 0;"><input type="checkbox" id="pk-n-free"><span>ללא עלות</span></label><div class="hint">אפשר לשמור בלי מחיר. המרכיב ייכנס למתכון, ולא יתרום לעלות עד שתזין מחיר בחומרי הגלם.</div></div>
                <div class="error-msg" id="pk-n-err"></div>
                <button type="button" class="btn btn-primary" id="pk-n-save">הוסף ובחר</button>
            </div>`;
        layer.querySelector("#pk-back").onclick = () => draw();
        // ניצולת מוערכת לפי השם (גזר, אבטיח...): מוצגת רק כשיש הערכה, ורק למוצר שנמדד במשקל
        const yWrap = layer.querySelector("#pk-n-yield-wrap"), yIn = layer.querySelector("#pk-n-yield"), nameIn = layer.querySelector("#pk-n-name"), unitSel = layer.querySelector("#pk-n-unit");
        bindUnitChoice(unitSel);
        let yEst = null;
        const syncYield = () => {
            const est = unitSel.value === "weight" ? estimateYield(nameIn.value) : null;
            if (est !== yEst) { yEst = est; yIn.value = est || ""; }
            yWrap.style.display = est ? "" : "none";
        };
        const freeBox = layer.querySelector("#pk-n-free"), priceIn = layer.querySelector("#pk-n-price");
        const syncFree = () => { priceIn.disabled = freeBox.checked; if (freeBox.checked) priceIn.value = ""; };
        freeBox.addEventListener("change", syncFree);
        nameIn.addEventListener("input", () => { syncYield(); if (isWaterName(nameIn.value) && !freeBox.checked) { freeBox.checked = true; syncFree(); } });
        const uaWrap = layer.querySelector("#pk-n-ua-wrap");
        const syncUa = () => { uaWrap.style.display = unitSel.value === "unit" ? "" : "none"; };
        unitSel.addEventListener("change", () => { syncYield(); syncUa(); });
        syncYield();
        syncUa();
        if (isWaterName(nameIn.value)) { freeBox.checked = true; syncFree(); }
        layer.querySelector("#pk-n-save").onclick = async () => {
            const err = layer.querySelector("#pk-n-err");
            const btn = layer.querySelector("#pk-n-save");
            const data = { name: layer.querySelector("#pk-n-name").value, category: layer.querySelector("#pk-n-cat").value, unit_type: layer.querySelector("#pk-n-unit").value, price: layer.querySelector("#pk-n-price").value };
            if (freeBox.checked) data.free = true;
            if (data.unit_type === "unit") { data.unit_amount = layer.querySelector("#pk-n-ua").value.trim(); }
            if (yEst) { // ההערכה נשמרת כהערכה; ערך ששונה (או רוקן) נשמר כערך של המשתמש
                const typed = String(yIn.value).trim().replace(",", ".");
                if (typed !== String(yEst)) { data.yield_pct = typed; if (typed === "") data.no_yield_est = true; }
            }
            if (!data.category) { err.textContent = "בחר קטגוריה"; err.style.display = "block"; return; }
            btn.disabled = true;
            try {
                const item = await onCreate(data);
                if (multi) {
                    const full = { ...item, tab: item.tab || st.tab };
                    items.push(full); flat = items.flatMap((i) => [i, ...(i.children || [])]);
                    sel.set(full.key, full); st.q = ""; st.cat = ""; st.sub = "";
                    draw();
                    return;
                }
                remember();
                close();
                onPick(item);
            } catch (e) {
                err.textContent = e.message;
                err.style.display = "block";
                btn.disabled = false;
            }
        };
    }

    function draw(keepSearchFocus = false) {
        if (st.open) { const parent = flat.find((i) => i.key === st.open); if (parent) { drawOptions(parent); return; } st.open = null; }
        const base = visibleItems();
        const cats = orderCategories(base.map((i) => i.category).filter(Boolean));
        const subs = st.cat ? [...new Set(base.filter((i) => i.category === st.cat).map((i) => i.subcategory).filter(Boolean))] : [];
        layer.innerHTML = `
            <div class="pk-top"><button type="button" class="pk-close" id="pk-close" aria-label="סגור">✕</button><div class="pk-title">${escapeHtml(title)}</div></div>
            ${tabList ? `<div class="seg" id="pk-tabs" style="margin:0 12px 8px;">${tabList.map((t) => `<button type="button" data-tab="${t.key}" class="${t.key === st.tab ? "active" : ""}">${escapeHtml(t.label)}</button>`).join("")}</div>` : ""}
            <div class="pk-search"><input type="search" id="pk-q" placeholder="חיפוש לפי שם..." value="${escapeHtml(st.q)}" autocomplete="off"></div>
            <div class="pk-chips" id="pk-cats"><button type="button" class="chip ${st.cat ? "" : "active"}" data-cat="">הכול</button>${cats.map((c) => `<button type="button" class="chip ${st.cat === c ? "active" : ""}" data-cat="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join("")}</div>
            ${subs.length ? `<div class="pk-chips" id="pk-subs"><button type="button" class="chip ${st.sub ? "" : "active"}" data-sub="">כל ${escapeHtml(st.cat)}</button>${subs.map((c) => `<button type="button" class="chip ${st.sub === c ? "active" : ""}" data-sub="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join("")}</div>` : ""}
            <div class="pk-list" id="pk-list"></div>
            ${multi ? `<div style="padding:10px 16px calc(10px + env(safe-area-inset-bottom,0px));"><button type="button" class="btn btn-primary btn-block" id="pk-ok"${sel.size ? "" : " disabled"}>${sel.size ? `הוסף ${sel.size}` : "סמן פריטים להוספה"}</button></div>` : ""}`;
        const list = layer.querySelector("#pk-list");
        list.addEventListener("scroll", () => { lastScroll = list.scrollTop; });

        const inScope = (i) => (!st.cat || i.category === st.cat) && (!st.sub || i.subcategory === st.sub);
        let shown = base.filter((i) => matchesDeep(i, st.q) && inScope(i));
        // לא נמצא? חיפוש סלחני: בלי מספרים ואחוזים ("חומץ 5%" מוצא "חומץ"), ועם רבים/יחיד ("עגבניות" מוצא "עגבנייה")
        if (!shown.length && st.q.trim()) shown = base.filter((i) => inScope(i) && (nameCovers(st.q, i.name) || (i.children || []).some((c) => nameCovers(st.q, c.name))));
        const mk = (i) => {
            const n = (i.children || []).length;
            const on = multi && sel.has(i.key);
            return `<div class="pk-row" data-key="${escapeHtml(i.key)}"${on ? ' style="background:var(--accent-soft);"' : ""}><div class="pk-name">${multi ? (on ? "☑ " : "☐ ") : ""}${escapeHtml(i.name)}</div><div class="pk-hint">${escapeHtml(i.hint || "")}${n ? ` · ${n + 1} אפשרויות ›` : ""}</div></div>`;
        };

        const createBtn = onCreate && st.q.trim() ? `<button type="button" class="btn btn-secondary" id="pk-new" style="margin:10px 0;width:100%;">＋ <span>הוסף כמוצר חדש:</span> <b>${escapeHtml(st.q.trim())}</b></button>` : "";
        if (!shown.length) {
            list.innerHTML = `<div class="empty-state">${st.q ? `לא נמצא "${escapeHtml(st.q)}"` : "אין פריטים בקטגוריה הזאת"}</div>${createBtn}`;
        } else if (normalize(st.q)) {
            list.innerHTML = rankResults(shown, st.q).map((i) => mk({ ...i, hint: [i.category, i.hint].filter(Boolean).join(" · ") })).join("") + createBtn;
        } else {
            let html = "";
            // קבוצות לפי קטגוריה (ואם נבחרה קטגוריה עם תתי-קטגוריות: לפי תת-קטגוריה)
            const groupBy = st.cat ? (i) => i.subcategory || "" : (i) => i.category || "אחר";
            const groups = new Map();
            for (const i of shown) { const g = groupBy(i); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(i); }
            const order = st.cat ? [...groups.keys()].sort((a, b) => a.localeCompare(b, "he")) : orderCategories([...groups.keys()]);
            // קטגוריות סגורות: רואים רק שם ומספר, ולחיצה פותחת את הרשימה שלה. קבוצה בודדת (או בלי שם) מוצגת פתוחה.
            const single = order.length <= 1;
            for (const g of order) {
                if (g && !single) {
                    const isOpen = st.openGroups.has(g);
                    html += `<div class="pk-acc" data-grp="${escapeHtml(g)}"><span>${isOpen ? "▾" : "◂"} ${escapeHtml(g)}</span><span class="pk-n">${groups.get(g).length}</span></div>`;
                    if (isOpen) html += groups.get(g).map(mk).join("");
                } else {
                    if (g) html += `<div class="pk-head">${escapeHtml(g)} <span class="pk-n">${groups.get(g).length}</span></div>`;
                    html += groups.get(g).map(mk).join("");
                }
            }
            list.innerHTML = html;
        }

        layer.querySelector("#pk-close").onclick = close;
        const okBtn = layer.querySelector("#pk-ok");
        if (okBtn) okBtn.onclick = () => { const picked = [...sel.values()]; remember(); close(); onPick(picked); };
        list.querySelectorAll(".pk-acc").forEach((h) => {
            h.onclick = () => {
                const g = h.dataset.grp;
                if (st.openGroups.has(g)) st.openGroups.delete(g); else st.openGroups.add(g);
                const keep = list.scrollTop;
                draw();
                const l2 = layer.querySelector("#pk-list");
                if (l2) l2.scrollTop = keep;
            };
        });
        const newBtn = layer.querySelector("#pk-new");
        if (newBtn) newBtn.onclick = () => drawCreate(st.q.trim());
        layer.querySelectorAll("#pk-tabs [data-tab]").forEach((b) => { b.onclick = () => { st.tab = b.dataset.tab; st.cat = ""; st.sub = ""; draw(); }; });
        layer.querySelectorAll("#pk-cats [data-cat]").forEach((b) => { b.onclick = () => { st.cat = b.dataset.cat; st.sub = ""; draw(); }; });
        layer.querySelectorAll("#pk-subs [data-sub]").forEach((b) => { b.onclick = () => { st.sub = b.dataset.sub; draw(); }; });
        const qEl = layer.querySelector("#pk-q");
        qEl.oninput = () => {
            st.q = qEl.value;
            const pos = qEl.selectionStart;
            draw(true);
            const again = layer.querySelector("#pk-q");
            again.focus();
            try { again.setSelectionRange(pos, pos); } catch (e) { /* לא קריטי */ }
        };
        list.querySelectorAll(".pk-row").forEach((r) => {
            r.onclick = async () => {
                const item = flat.find((i) => i.key === r.dataset.key);
                if (!item) return;
                if (multi) {
                    if (sel.has(item.key)) sel.delete(item.key); else sel.set(item.key, item);
                    const keep = list.scrollTop;
                    draw();
                    const l2 = layer.querySelector("#pk-list");
                    if (l2) l2.scrollTop = keep;
                    return;
                }
                if ((item.children || []).length) { st.open = item.key; draw(); return; }
                remember();
                close();
                onPick(item);
            };
        });
    }
    draw();
    if (restoreScroll) { const l = layer.querySelector("#pk-list"); if (l) l.scrollTop = restoreScroll; layer.scrollTop = restoreScroll; }
    return { close };
}

// הופך שורת <select> נסתרת (שהקוד הקיים קורא ממנה) לכפתור בחירה: לחיצה פותחת את הבורר, ובחירה מעדכנת את ה-select ומפעילה change
export function bindPickerButton({ button, select, getItems, tabs, title, keyOf, onCreate = null }) {
    button.onclick = () => openIngredientPicker({
        title, items: getItems(), tabs, onCreate,
        onPick: (item) => { select.value = keyOf(item); select.dispatchEvent(new Event("change", { bubbles: true })); refreshPickerButton(button, select); },
    });
    refreshPickerButton(button, select);
}

export function refreshPickerButton(button, select) {
    const opt = select.selectedOptions && select.selectedOptions[0];
    const has = opt && opt.value !== "";
    button.textContent = has ? opt.textContent.replace(/^↳\s*/, "") : button.dataset.ph || "בחר מרכיב...";
    button.classList.toggle("pk-empty", !has);
}
