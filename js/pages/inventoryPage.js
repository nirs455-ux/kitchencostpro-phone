import { buildInventoryView, saveInventoryCounts } from "../repo/inventoryRepo.js";
import { h, toast, escapeHtml } from "../ui.js";
import { orderCategories, matchesDeep, normalize } from "./listKit.js";
import { assignAutoSubs, subOf } from "../autoGroups.js";

function todayLocal() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const CAT_ICON = { "מהים": ["🐟", "var(--accent-soft)"], "קצביה": ["🥩", "var(--danger-soft)"], "ירקניה": ["🥬", "var(--ok-soft)"], "יבשים": ["📦", "var(--warn-soft)"], "מחלבה": ["🥛", "var(--brand-soft)"], "בר": ["🍷", "var(--brand-soft)"], "מחסן": ["🧰", "var(--surface-2)"] };
const unitWord = (u) => (u === "unit" ? "יח'" : u === "liter" ? "ל'" : 'ק"ג');
const invOpen = new Set(); // קבוצות פתוחות (נשמר בין ציורים כדי שלא ייסגר באמצע ספירה)

export async function renderInventoryPage(container) {
    const items = assignAutoSubs(await buildInventoryView());

    container.innerHTML = `
        <div class="field"><label>תאריך הספירה</label><input type="date" id="count-date" value="${todayLocal()}"></div>
        <div class="px-top"><input type="search" id="inv-q" placeholder="חיפוש מוצר לספירה..." autocomplete="off"></div>
        <div id="inventory-list"></div>
        <div class="btn-row" style="position:sticky;bottom:60px;">
            <button class="btn btn-primary btn-block" id="btn-save">שמירת ספירה</button>
        </div>
        <div class="error-msg" id="save-error"></div>
    `;

    const list = container.querySelector("#inventory-list");
    if (items.length === 0) {
        list.innerHTML = '<div class="empty-state">אין עדיין מוצרים בחומרי הגלם - הוסף מוצרים בעמוד "חומרי גלם" תחילה.</div>';
    }
    // המבנה נבנה פעם אחת ורק מציגים/מסתירים, כדי שכמויות שכבר הוזנו לא יימחקו
    const sections = []; // { head, body, rows: [{ el, it }], cat, count }
    for (const cat of orderCategories(items.map((i) => i.category))) {
        const inCat = items.filter((i) => i.category === cat);
        const [ic, tint] = CAT_ICON[cat] || ["📦", "var(--surface-2)"];
        const sec = h(`<div class="px-sec"><div class="px-sh"><span class="px-ic" style="background:${tint};">${ic}</span><b>${escapeHtml(cat)}</b><span class="px-cnt">${inCat.length}</span><span class="px-chev"></span></div><div class="inv-body"></div></div>`);
        const body = sec.querySelector(".inv-body");
        const rows = [];
        const subs = [...new Set(inCat.map((x) => subOf(x)))].sort((a, b) => a.localeCompare(b, "he"));
        for (const sub of subs) {
            if (sub) body.appendChild(h(`<div class="inv-sub">${escapeHtml(sub)}</div>`));
            for (const it of inCat.filter((x) => subOf(x) === sub)) {
                // מוצר עם גודל אריזה (בקבוק 370 מ"ל): סופרים באריזות, והמערכת ממירה לליטר/ק"ג לבד
                const f = it.pkg_size > 0 ? it.pkg_size : 0;
                const cv = (n) => (f ? Math.round((n / f) * 100) / 100 : n);
                const uw = f ? "אריזות" : unitWord(it.unit_type);
                const pkgNote = f ? ` · אריזה = ${+Number(f).toFixed(3)} ${it.unit_type === "liter" ? "ל'" : 'ק"ג'}` : "";
                const row = h(`<div class="inv-item" data-name="${escapeHtml(normalize(it.name + " " + cat + " " + sub))}">
                    <div class="inv-info"><div class="px-name">${escapeHtml(it.name)}</div>
                        <div class="px-meta">קודם: ${it.last_count_date ? `${cv(it.last_counted_quantity)} (${it.last_count_date.split("-").reverse().join("/")})` : "טרם נספר"} · קניות: ${cv(it.purchased_since)}${it.sold_since || it.waste_since ? ` · נצרך: ${cv(it.sold_since + it.waste_since)}` : ""} · תיאורטי: <b>${cv(it.theoretical_quantity)}</b> ${uw}${pkgNote}</div>
                        <div class="muted" id="variance-${it.id}"></div></div>
                    <input type="text" inputmode="decimal" class="count-input" id="count-${it.id}" data-theoretical="${cv(it.theoretical_quantity)}" data-factor="${f || 1}" placeholder="${f ? "אריזות" : "ספרתי"}">
                </div>`);
                body.appendChild(row);
                rows.push({ el: row, it });
                const input = row.querySelector(`#count-${it.id}`);
                const varEl = row.querySelector(`#variance-${it.id}`);
                input.addEventListener("input", () => {
                    const theoretical = parseFloat(input.dataset.theoretical) || 0;
                    const counted = parseFloat(String(input.value).replace(",", "."));
                    if (Number.isNaN(counted)) { varEl.textContent = ""; return; }
                    const diff = Math.round((counted - theoretical) * 1000) / 1000;
                    const color = diff > 0 ? "var(--ok)" : diff < 0 ? "var(--danger)" : "var(--text-2)";
                    varEl.innerHTML = `<span style="color:${color};font-weight:700;">הפרש: ${diff > 0 ? "+" : ""}${diff}</span>`;
                });
            }
        }
        list.appendChild(sec);
        sections.push({ sec, head: sec.querySelector(".px-sh"), body, rows, cat });
    }

    let q = "";
    function applyView() {
        const searching = !!normalize(q);
        for (const g of sections) {
            let any = false;
            for (const r of g.rows) {
                const hit = !searching || matchesDeep({ name: r.el.dataset.name }, q);
                r.el.style.display = hit ? "" : "none";
                if (hit) any = true;
            }
            g.sec.style.display = any ? "" : "none";
            const open = searching || invOpen.has(g.cat) || g.rows.some((r) => r.el.querySelector(".count-input").value !== "");
            g.body.style.display = open ? "" : "none";
            g.head.querySelector(".px-chev").textContent = open ? "▾" : "◂";
        }
    }
    for (const g of sections) g.head.onclick = () => { if (invOpen.has(g.cat)) invOpen.delete(g.cat); else invOpen.add(g.cat); applyView(); };
    container.querySelector("#inv-q").oninput = (e) => { q = e.target.value; applyView(); };
    applyView();

    container.querySelector("#btn-save").onclick = async () => {
        const errEl = container.querySelector("#save-error");
        errEl.style.display = "none";
        const countDate = container.querySelector("#count-date").value;
        const counts = [];
        container.querySelectorAll(".count-input").forEach((input) => {
            if (input.value === "") return;
            const pantry_item_id = input.id.replace("count-", "");
            const n = parseFloat(String(input.value).replace(",", "."));
            counts.push({ pantry_item_id, counted_quantity: Number.isNaN(n) ? "x" : String(Math.round(n * (parseFloat(input.dataset.factor) || 1) * 10000) / 10000) });
        });
        try {
            await saveInventoryCounts(countDate, counts);
            toast("נשמר");
            renderInventoryPage(container);
        } catch (e) {
            errEl.textContent = e.message;
            errEl.style.display = "block";
        }
    };
}
