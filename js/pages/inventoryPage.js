import { buildInventoryView, saveInventoryCounts } from "../repo/inventoryRepo.js";
import { h, toast, escapeHtml } from "../ui.js";
import { getFilter, mountFilterBar, groupBySection, groupTitleEl } from "../filters.js";

function todayLocal() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export async function renderInventoryPage(container) {
    const items = await buildInventoryView();

    container.innerHTML = `
        <div class="subtitle">הזן את הכמות שנספרה בפועל - המערכת מחשבת לבד את היתרה התיאורטית ומציגה את ההפרש.</div>
        <div class="field"><label>תאריך הספירה</label><input type="date" id="count-date" value="${todayLocal()}"></div>
        <div id="inventory-filter"></div>
        <div id="inventory-list"></div>
        <div class="btn-row" style="position:sticky;bottom:60px;">
            <button class="btn btn-primary btn-block" id="btn-save">שמירת ספירה</button>
        </div>
        <div class="error-msg" id="save-error"></div>
    `;

    const list = container.querySelector("#inventory-list");
    if (items.length === 0) {
        list.innerHTML = '<div class="empty-state">אין עדיין מוצרים במזווה - הוסף מוצרים בעמוד "מזווה" תחילה.</div>';
    }
    const sections = [];
    for (const g of groupBySection(items)) {
      const section = document.createElement("div");
      section.dataset.cat = g.category;
      section.dataset.sub = g.sub;
      section.appendChild(groupTitleEl(g.title, g.items.length));
      list.appendChild(section);
      sections.push(section);
      for (const it of g.items) {
        const card = h(`
            <div class="card">
                <div class="card-title">${escapeHtml(it.name)}</div>
                <div class="card-row"><span class="tag">${escapeHtml(it.category)}</span></div>
                <div class="card-row"><span class="muted">ספירה קודמת</span><span>${it.last_count_date ? `${it.last_counted_quantity} (${it.last_count_date})` : "טרם נספר"}</span></div>
                <div class="card-row"><span class="muted">קניות מאז</span><span>${it.purchased_since}</span></div>
                <div class="card-row"><span class="muted">יתרה תיאורטית</span><span style="font-weight:700;">${it.theoretical_quantity}</span></div>
                <div class="field" style="margin-top:8px;">
                    <label>ספירה בפועל</label>
                    <input type="number" step="any" class="count-input" id="count-${it.id}" data-theoretical="${it.theoretical_quantity}" placeholder="כמות שנספרה">
                    <div class="muted" id="variance-${it.id}"></div>
                </div>
            </div>
        `);
        section.appendChild(card);
        const input = card.querySelector(`#count-${it.id}`);
        const varEl = card.querySelector(`#variance-${it.id}`);
        input.addEventListener("input", () => {
            const theoretical = parseFloat(input.dataset.theoretical) || 0;
            const counted = parseFloat(input.value);
            if (Number.isNaN(counted)) { varEl.textContent = ""; return; }
            const diff = Math.round((counted - theoretical) * 1000) / 1000;
            const color = diff > 0 ? "#2e7d32" : diff < 0 ? "#c0392b" : "#666";
            varEl.innerHTML = `<span style="color:${color};font-weight:700;">הפרש: ${diff > 0 ? "+" : ""}${diff}</span>`;
        });
      }
    }

    // סינון בלי לצייר מחדש - כדי שכמויות שכבר הוזנו לא יימחקו
    const filter = getFilter("inventory");
    function applyVisibility() {
        for (const s of sections) {
            const okCat = !filter.category || s.dataset.cat === filter.category;
            const okSub = !filter.subcategory || s.dataset.sub === filter.subcategory;
            s.style.display = okCat && okSub ? "" : "none";
        }
    }
    mountFilterBar(container.querySelector("#inventory-filter"), items, filter, applyVisibility);
    applyVisibility();

    container.querySelector("#btn-save").onclick = async () => {
        const errEl = container.querySelector("#save-error");
        errEl.style.display = "none";
        const countDate = container.querySelector("#count-date").value;
        const counts = [];
        container.querySelectorAll(".count-input").forEach((input) => {
            if (input.value === "") return;
            const pantry_item_id = input.id.replace("count-", "");
            counts.push({ pantry_item_id, counted_quantity: input.value });
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
