// דף יצרן: פרטי העסק, המוצרים לשיווק (כל מוצר מבוסס על מתכון) והדפסת מדבקות עם רכיבים, אלרגנים, תאריכים וערכים תזונתיים.
import { h, openModal, closeModal, toast, escapeHtml, busy, attemptClose, info, confirmDialog, money, curLabel } from "../ui.js";
import { dbGetAll } from "../db.js";
import { listRecipesWithItems } from "../repo/recipesRepo.js";
import { getBusiness, saveBusiness, listProducts, saveProduct, deleteProduct, NUTRITION_FIELDS, DEFAULT_STORAGE } from "../repo/producerRepo.js";
import { buildLabel } from "../recipeLabel.js";
import { getLabelNames } from "../repo/labelNamesRepo.js";
import { buildLabelHtml, LABEL_SIZES, netText } from "../producerLabel.js";
import { textToGrams, gramsToKgText } from "../qty.js";
import { getNutritionDb } from "../repo/nutritionRepo.js";
import { computeNutrition } from "../nutrition.js";
import { listRow, groupsEl } from "./listKit.js";
import { openIngredientPicker, orderCategories } from "./ingredientPicker.js";
import { listPackaging, savePackagingItem, deletePackagingItem, PACK_CATEGORIES, PACK_ICONS } from "../repo/packagingRepo.js";
import { productEconomics } from "../producerCost.js";

const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

// מאפשר למסך המתכון לפתוח כאן יצירת מוצר מתכון מסוים
export function requestNewProductFor(recipeId) { try { sessionStorage.setItem("kcp_producer_recipe", String(recipeId)); } catch (e) { /* לא קריטי */ } }

export async function renderProducerPage(container) {
    const [biz, products, recipes, pantry, packs] = await Promise.all([getBusiness(), listProducts(), listRecipesWithItems(), dbGetAll("pantryItems"), listPackaging()]);
    const pantryById = new Map(pantry.map((x) => [x.id, x]));
    const packById = new Map(packs.map((x) => [x.id, x]));
    const econ = (p) => productEconomics({ recipe: recipes.find((r) => r.id === p.recipe_id), product: p, pantryById, packById });
    const recipeName = (id) => (recipes.find((r) => r.id === id) || {}).name || "מתכון שנמחק";
    const rerender = () => renderProducerPage(container);

    container.innerHTML = `
        <div id="pr-biz"></div>
        <div id="pr-packs"></div>
        <button type="button" class="btn btn-primary btn-big btn-block" id="pr-add" style="margin:10px 0;">＋ מוצר חדש</button>
        <div class="card-title" style="margin:8px 2px 6px;">המוצרים שלי ${info("כל מוצר מבוסס על מתכון: הרכיבים והאלרגנים נלקחים ממנו אוטומטית, ואתה מוסיף משקל, חיי מדף, אחסון וערכים תזונתיים. מכאן מדפיסים מדבקות.")}</div>
        <div id="pr-list"></div>
        <div class="hint" style="margin-top:12px;">המדבקות הן טיוטה לעזר. האחריות לתיוג ולעמידה בתקנות היא של בעל העסק.</div>`;

    const bizRow = listRow({ ic: "🏢", tint: "var(--accent-soft)", name: "פרטי העסק", meta: biz.name ? escapeHtml([biz.name, biz.address, biz.phone].filter(Boolean).join(" · ")) : "עוד לא הוגדרו - יופיעו בתחתית המדבקה", end: "עריכה", onClick: () => openBusinessModal(biz, rerender) });
    container.querySelector("#pr-biz").appendChild(bizRow);
    container.querySelector("#pr-packs").appendChild(listRow({ ic: "📦", tint: "var(--warn-soft)", name: "אריזות", meta: packs.length ? escapeHtml(packs.length === 1 ? "אריזה אחת ברשימה" : packs.length + " אריזות ברשימה") : "צנצנות, מכסים, קופסאות, שקיות, מדבקות - עוד לא הוגדרו", end: "ניהול", onClick: () => openPackagingModal(rerender) }));
    container.querySelector("#pr-add").onclick = () => openProductModal(null, recipes, rerender, null, pantry, packs);

    const list = container.querySelector("#pr-list");
    if (!products.length) list.innerHTML = '<div class="empty-state">עוד אין מוצרים.<br>לחץ על "מוצר חדש" ובחר מתכון.</div>';
    for (const p of products) {
        const e = econ(p);
        const meta = [recipeName(p.recipe_id), p.net_g > 0 ? netText(p.net_g) : "", p.shelf_days > 0 ? `${p.shelf_days} ימי מדף` : ""].filter(Boolean).map(escapeHtml).join(" · ");
        const end = e.totalCost > 0 ? `${money(e.totalCost)}<small>עלות ליחידה</small>` : "מדבקה";
        list.appendChild(listRow({ ic: "🏷", tint: "var(--brand-soft)", name: p.name, meta, end, onClick: () => openProductSheet(p, recipes, rerender, pantry, e, packs) }));
    }

    // הגיע ממסך מתכון: פותחים יצירת מוצר למתכון הזה
    let want = null;
    try { want = sessionStorage.getItem("kcp_producer_recipe"); sessionStorage.removeItem("kcp_producer_recipe"); } catch (e) { /* לא קריטי */ }
    if (want) openProductModal(null, recipes, rerender, Number(want), pantry, packs);
}

function openBusinessModal(biz, onSaved) {
    const ov = openModal(`
        <h2>פרטי העסק</h2>
        <div class="field"><label>שם העסק</label><input type="text" id="b-name" value="${escapeHtml(biz.name)}"></div>
        <div class="field"><label>כתובת</label><input type="text" id="b-addr" value="${escapeHtml(biz.address)}"></div>
        <div class="field"><label>טלפון</label><input type="text" inputmode="tel" id="b-phone" value="${escapeHtml(biz.phone)}"></div>
        <div class="field"><label>ח.פ. / מספר רישיון (לא חובה)</label><input type="text" id="b-reg" value="${escapeHtml(biz.reg)}"></div>
        <div class="modal-actions"><button type="button" class="btn btn-secondary" id="b-cancel">ביטול</button><button type="button" class="btn btn-primary" id="b-save">שמירה</button></div>`);
    ov.querySelector("#b-cancel").onclick = () => attemptClose(ov);
    ov.querySelector("#b-save").onclick = busy(async () => {
        await saveBusiness({ name: ov.querySelector("#b-name").value, address: ov.querySelector("#b-addr").value, phone: ov.querySelector("#b-phone").value, reg: ov.querySelector("#b-reg").value });
        closeModal(); toast("נשמר"); onSaved();
    });
}

function openProductModal(existing, recipes, onSaved, presetRecipeId = null, pantry = [], packs = []) {
    packs = [...packs];
    const pantryName = (id) => ((pantry.find((x) => x.id === id) || {}).name) || "פריט שנמחק";
    const packRows = ((existing && existing.packaging) || []).map((x) => ({ ...x }));
    const nut = (existing && existing.nutrition) || {};
    const preset = presetRecipeId ? recipes.find((r) => r.id === presetRecipeId) : null;
    const ov = openModal(`
        <h2>${existing ? "עריכת מוצר" : "מוצר חדש"}</h2>
        <div class="field"><label>שם המוצר (כפי שיופיע על המדבקה)</label><input type="text" id="p-name" value="${escapeHtml(existing ? existing.name : preset ? preset.name : "")}"></div>
        <div class="field"><label>מתכון</label><select id="p-recipe"><option value="">בחר מתכון...</option>${recipes.map((r) => `<option value="${r.id}" ${(existing && existing.recipe_id === r.id) || (preset && preset.id === r.id) ? "selected" : ""}>${escapeHtml(r.name)}</option>`).join("")}</select></div>
        <div class="form-row">
            <div class="field"><label>משקל נטו (ק"ג)</label><input type="text" inputmode="decimal" id="p-net" placeholder="למשל 0.350" value="${existing && existing.net_g ? gramsToKgText(existing.net_g) : ""}"></div>
            <div class="field"><label>חיי מדף (ימים)</label><input type="text" inputmode="numeric" id="p-shelf" value="${existing && existing.shelf_days ? existing.shelf_days : ""}"></div>
        </div>
        <div class="field"><label>תנאי אחסון</label><input type="text" id="p-storage" value="${escapeHtml(existing ? existing.storage : DEFAULT_STORAGE)}"></div>
        <div class="field"><label>ברקוד (לא חובה)</label><input type="text" inputmode="numeric" id="p-barcode" value="${escapeHtml(existing ? existing.barcode : "")}"></div>
        <div class="card-title" style="margin:10px 0 4px;">אריזה ${info("מוסיפים את האריזה של היחידה הנמכרת: צנצנת, מכסה, קופסה, מדבקה, שקית. האריזה יכולה להגיע לשליש מעלות המוצר, ולכן היא נכללת בעלות הכוללת ובמחיר. מוצר ביחידות: כמה יחידות למוצר אחד. מוצר במשקל או בנפח: כמה ק\"ג או ליטר, למשל 0.01 הוא 10 גרם.")}</div>
        <div id="p-pack"></div>
        <button type="button" class="btn btn-secondary btn-small" id="p-pack-add" style="margin-bottom:10px;">＋ הוסף אריזה</button>
        <div class="hint" style="margin:-4px 0 10px;">האריזות מנוהלות ברשימה נפרדת (בדף היצרן, "אריזות").</div>
        <div class="field"><label>מחיר מכירה ליחידה (${curLabel()}, לפני מע"מ)</label><input type="text" inputmode="decimal" id="p-sell" value="${existing && existing.sell_price ? existing.sell_price : ""}"></div>
        <details class="pg-more"><summary>ערכים תזונתיים ל-100 גרם (לא חובה)</summary>
            <div class="hint">אם משאירים ריק, הערכים יחושבו אוטומטית מהמתכון (לשונית "תזונה" במתכון). מזינים כאן רק אם יש בדיקה מעבדה או תווית מוכנה.</div>
            <div class="form-row" style="flex-wrap:wrap;">${NUTRITION_FIELDS.map((f) => `<div class="field" style="min-width:45%;"><label>${escapeHtml(f.label)}</label><input type="text" inputmode="decimal" data-nu="${f.key}" value="${nut[f.key] != null ? nut[f.key] : ""}"></div>`).join("")}</div>
        </details>
        <div class="error-msg"></div>
        <div class="modal-actions"><button type="button" class="btn btn-secondary" id="p-cancel">ביטול</button><button type="button" class="btn btn-primary" id="p-save">שמירה</button></div>`);
    const nameEl = ov.querySelector("#p-name");
    const packBox = ov.querySelector("#p-pack");
    const drawPack = () => {
        packBox.innerHTML = "";
        packRows.forEach((r, i) => {
            const legacy = r.pack_id == null && r.pantry_item_id; // אריזה מהמזווה (פורמט ישן)
            const item = r.pack_id ? packs.find((x) => x.id === r.pack_id) : null;
            const label = legacy ? `${pantryName(r.pantry_item_id)} (מהמזווה)` : item ? `${item.name} · ${money(item.price)}` : r.pack_id ? "אריזה שנמחקה" : "בחר אריזה...";
            const row = h(`<div class="item-row-inputs"><div class="top-line">
                <button type="button" class="pick-btn ${item || legacy ? "" : "pk-empty"}" data-pi="${i}" style="flex:2;">${escapeHtml(label)}</button>
                <input type="text" inputmode="decimal" data-pq="${i}" value="${r.qty || ""}" placeholder="יחידות" style="width:80px;">
                <button type="button" class="remove-row-btn" data-pr="${i}">✕</button></div></div>`);
            row.querySelector("[data-pi]").onclick = () => {
                if (!packs.length) { toast("עוד אין אריזות. הגדר אותן בדף היצרן, בשורה \"אריזות\"."); return; }
                openIngredientPicker({
                    title: "בחר אריזה",
                    items: packs.map((x) => ({ key: "k" + x.id, id: x.id, name: x.name, category: x.category, subcategory: "", hint: money(x.price) + " ליחידה" })),
                    onPick: (it) => { delete r.pantry_item_id; r.pack_id = it.id; drawPack(); },
                });
            };
            row.querySelector("[data-pq]").oninput = (e) => { r.qty = parseFloat(String(e.target.value).replace(",", ".")) || 0; };
            row.querySelector("[data-pr]").onclick = () => { packRows.splice(i, 1); drawPack(); };
            packBox.appendChild(row);
        });
    };
    ov.querySelector("#p-pack-add").onclick = () => { packRows.push({ pack_id: 0, qty: 1 }); drawPack(); };
    drawPack();
    ov.querySelector("#p-recipe").onchange = (e) => { const r = recipes.find((x) => String(x.id) === e.target.value); if (r && !nameEl.value.trim()) nameEl.value = r.name; };
    ov.querySelector("#p-cancel").onclick = () => attemptClose(ov);
    ov.querySelector("#p-save").onclick = busy(async () => {
        const nutrition = {};
        ov.querySelectorAll("[data-nu]").forEach((i) => { if (i.value.trim() !== "") nutrition[i.dataset.nu] = i.value; });
        try {
            await saveProduct({
                id: existing ? existing.id : null, name: nameEl.value, recipe_id: ov.querySelector("#p-recipe").value,
                net_g: textToGrams(ov.querySelector("#p-net").value) || 0, shelf_days: ov.querySelector("#p-shelf").value,
                storage: ov.querySelector("#p-storage").value, barcode: ov.querySelector("#p-barcode").value, nutrition,
                sell_price: ov.querySelector("#p-sell").value, packaging: packRows,
            });
            closeModal(); toast("נשמר"); onSaved();
        } catch (e) { const el = ov.querySelector(".error-msg"); el.textContent = e.message; el.style.display = "block"; }
    });
}

function openProductSheet(p, recipes, onSaved, pantry = [], e = null, packs = []) {
    const row = (k, v, big = false) => `<div class="pr-row${big ? " pr-big" : ""}"><span>${k}</span><b>${v}</b></div>`;
    const econHtml = e && e.totalCost > 0 ? `<div class="pr-box">
        ${row("עלות התוכן (מהמתכון)", money(e.contentCost))}
        ${row("עלות האריזה" + (e.packagingPct ? ` (${e.packagingPct}% מהעלות)` : ""), money(e.packagingCost))}
        ${row("עלות כוללת ליחידה", money(e.totalCost), true)}
        ${e.sell > 0 ? row("מחיר מכירה לפני מע\"מ", money(e.sell)) + row("רווח ליחידה", `${money(e.profit)} · ${e.profitPct}%`) + row("עלות מתוך המחיר", `${e.costPct}%`) : '<div class="hint">הוסף מחיר מכירה בעריכה כדי לראות רווח.</div>'}
    </div>` : '<div class="hint">אין עדיין עלות: בחר מתכון עם עלות ומשקל נטו, והוסף אריזה.</div>';
    const ov = openModal(`
        <h2>${escapeHtml(p.name)}</h2>
        ${econHtml}
        <div class="sh-actions"><button type="button" class="btn btn-primary" id="s-print">🖨 מדבקות</button><button type="button" class="btn btn-secondary" id="s-edit">עריכה</button></div>
        <div class="sh-actions" style="margin-top:8px;"><button type="button" class="btn btn-danger" id="s-del">מחיקה</button><button type="button" class="btn btn-secondary" id="s-close">סגור</button></div>`);
    ov.querySelector("#s-close").onclick = closeModal;
    ov.querySelector("#s-edit").onclick = () => { closeModal(); openProductModal(p, recipes, onSaved, null, pantry, packs); };
    ov.querySelector("#s-print").onclick = () => { closeModal(); openPrintModal(p, recipes); };
    ov.querySelector("#s-del").onclick = async () => {
        closeModal();
        if (!(await confirmDialog(`למחוק את המוצר "${escapeHtml(p.name)}"? המתכון עצמו לא יימחק.`))) return;
        await deleteProduct(p.id); toast("נמחק"); onSaved();
    };
}

async function openPrintModal(p, recipes) {
    const recipe = recipes.find((r) => r.id === p.recipe_id);
    if (!recipe) { toast("המתכון של המוצר נמחק - ערוך את המוצר ובחר מתכון"); return; }
    const pantry = await dbGetAll("pantryItems");
    const byId = new Map(pantry.map((x) => [x.id, x]));
    const business = await getBusiness();
    const label = buildLabel({ items: recipe.items.map((i) => ({ pantry_item_id: i.pantry_item_id, ingredient_name: i.ingredient_name, quantity_g: i.quantity_g })), pantryById: byId, labelNames: await getLabelNames() });
    const missing = recipe.draft_ingredients || [];
    // ערכים תזונתיים: ידניים (אם הוזנו במוצר) או מחושבים מהמתכון
    const N = computeNutrition({ items: recipe.items, byId, nutritionById: await getNutritionDb(), weightG: recipe.final_weight > 0 && !recipe.is_auto_weight ? recipe.final_weight : 0 });
    const manualNu = p.nutrition && Object.keys(p.nutrition).length > 0;
    const calcNu = N.rows.some((r) => r.has);
    const labelProduct = { ...p, nutrition: manualNu ? p.nutrition : calcNu ? N.per100 : {} };
    const hasNu = manualNu || calcNu;
    const warns = [
        !manualNu && calcNu && N.missing.length ? `הערכים התזונתיים מחושבים מהמתכון אבל חסרים ערכים ל: ${N.missing.map(escapeHtml).join(", ")} (מכסים ${N.coveragePct}% מהמשקל).` : "",
        !manualNu && calcNu && !(recipe.final_weight > 0 && !recipe.is_auto_weight) ? "הערכים מחולקים במשקל הגולמי של הרכיבים. אם יש ירידה בבישול, הזן משקל סופי במתכון." : "",
        missing.length ? `במתכון יש ${missing.length} רכיבים שעדיין לא במזווה (${missing.map((m) => escapeHtml(m.name)).join(", ")}) והם לא ברשימה.` : "",
        label.unknown.length ? `לא הוגדרו אלרגנים עבור: ${label.unknown.map(escapeHtml).join(", ")}. בדוק בלשונית "אלרגנים" של המתכון.` : "",
        !business.name ? "פרטי העסק עוד לא הוגדרו, ולכן לא יופיעו על המדבקה." : "",
    ].filter(Boolean);

    const state = { count: 10, date: todayIso(), size: "70x40", nutrition: hasNu };
    const ov = openModal(`
        <h2>מדבקות: ${escapeHtml(p.name)}</h2>
        ${warns.length ? `<div class="hint-warn">${warns.map((w) => `<div>⚠ ${w}</div>`).join("")}</div>` : ""}
        <div class="form-row">
            <div class="field"><label>כמה מדבקות</label><input type="text" inputmode="numeric" id="l-count" value="${state.count}"></div>
            <div class="field"><label>תאריך ייצור</label><input type="date" id="l-date" value="${state.date}"></div>
        </div>
        <div class="field"><label>גודל מדבקה</label><select id="l-size">${LABEL_SIZES.map((s) => `<option value="${s.key}" ${s.key === state.size ? "selected" : ""}>${s.label}</option>`).join("")}</select></div>
        ${hasNu ? `<div class="checkbox-field"><input type="checkbox" id="l-nu" checked><label for="l-nu">הצג ערכים תזונתיים (${manualNu ? "ידני" : "מחושב מהמתכון"})</label></div>` : ""}
        <div class="card-title" style="margin:8px 0 4px;">תצוגה מקדימה</div>
        <div style="overflow:auto;background:var(--surface-2);padding:10px;border-radius:10px;"><iframe id="l-prev" style="border:0;background:#fff;width:100%;height:260px;"></iframe></div>
        <div class="modal-actions"><button type="button" class="btn btn-secondary" id="l-close">סגור</button><button type="button" class="btn btn-primary" id="l-print">🖨 הדפס</button></div>`);
    const html = (count) => buildLabelHtml({ product: labelProduct, business, label, productionDate: state.date, count, size: state.size, showNutrition: state.nutrition });
    const sync = () => {
        state.count = parseInt(ov.querySelector("#l-count").value, 10) || 1;
        state.date = ov.querySelector("#l-date").value || todayIso();
        state.size = ov.querySelector("#l-size").value;
        const nu = ov.querySelector("#l-nu"); state.nutrition = nu ? nu.checked : false;
        ov.querySelector("#l-prev").srcdoc = html(1);
    };
    ["#l-count", "#l-date", "#l-size", "#l-nu"].forEach((s) => { const el = ov.querySelector(s); if (el) { el.addEventListener("input", sync); el.addEventListener("change", sync); } });
    sync();
    ov.querySelector("#l-close").onclick = closeModal;
    ov.querySelector("#l-print").onclick = () => {
        sync();
        const w = window.open("", "_blank");
        if (!w) { toast("הדפדפן חסם את חלון ההדפסה"); return; }
        w.document.write(html(state.count));
        w.document.close(); w.focus();
        setTimeout(() => w.print(), 400);
    };
}

// ---------- רשימת האריזות של היצרן: קבוצות סגורות לפי קטגוריה, כמו שאר האפליקציה ----------
const packOpen = new Set();

async function openPackagingModal(onChanged) {
    const draw = async () => {
        const list = await listPackaging();
        const groups = orderCategories([...PACK_CATEGORIES, ...list.map((x) => x.category)]).filter((c) => list.some((x) => x.category === c)).map((c) => ({
            key: "pk:" + c, title: c, ic: PACK_ICONS[c] || "📎", tint: "var(--warn-soft)",
            rows: list.filter((x) => x.category === c).sort((a, b) => a.name.localeCompare(b.name, "he")).map((x) => listRow({ ic: PACK_ICONS[c] || "📎", tint: "var(--warn-soft)", name: x.name, meta: "ליחידה", end: money(x.price), onClick: () => openPackagingForm(x, draw) })),
        }));
        const ov = openModal(`
            <h2>אריזות ${info("רשימת האריזות שלך: צנצנות, מכסים, קופסאות, שקיות, מדבקות. מחיר ליחידה אחת. בכל מוצר בוחרים אילו אריזות הוא כולל, והעלות נכנסת לעלות המוצר.")}</h2>
            <button type="button" class="btn btn-primary btn-block" id="pk-add" style="margin-bottom:10px;">＋ אריזה חדשה</button>
            <div id="pk-groups">${list.length ? "" : '<div class="empty-state">עוד אין אריזות.<br>לחץ על "אריזה חדשה" והוסף את הראשונה.</div>'}</div>
            <div class="modal-actions"><button type="button" class="btn btn-secondary" id="pk-close">סגור</button></div>`);
        if (list.length) ov.querySelector("#pk-groups").appendChild(groupsEl(groups, packOpen, false, (k) => { if (packOpen.has(k)) packOpen.delete(k); else packOpen.add(k); draw(); }));
        ov.querySelector("#pk-add").onclick = () => openPackagingForm(null, draw);
        ov.querySelector("#pk-close").onclick = () => { closeModal(); if (onChanged) onChanged(); };
    };
    await draw();
}

// existing = אריזה לעריכה או null. onDone(saved|null) אחרי שמירה/מחיקה (כאשר חוזרים לרשימה)
function openPackagingForm(existing, onDone) {
    const ov = openModal(`
        <h2>${existing ? "עריכת אריזה" : "אריזה חדשה"}</h2>
        <div class="field"><label>שם האריזה</label><input type="text" id="pf-name" value="${existing ? escapeHtml(existing.name) : ""}" placeholder="למשל צנצנת 350 גרם"></div>
        <div class="field"><label>קטגוריה</label><select id="pf-cat">${PACK_CATEGORIES.map((c) => `<option value="${c}" ${existing && existing.category === c ? "selected" : ""}>${c}</option>`).join("")}</select></div>
        <div class="field"><label>מחיר ליחידה אחת (${curLabel()})</label><input type="text" inputmode="decimal" id="pf-price" value="${existing ? existing.price : ""}"></div>
        <div class="error-msg"></div>
        <div class="modal-actions" style="flex-wrap:wrap;">${existing ? '<button type="button" class="btn btn-danger" id="pf-del">מחיקה</button>' : ""}<button type="button" class="btn btn-secondary" id="pf-cancel">ביטול</button><button type="button" class="btn btn-primary" id="pf-save">שמירה</button></div>`);
    ov.querySelector("#pf-cancel").onclick = () => { closeModal(); if (onDone) onDone(null); };
    ov.querySelector("#pf-save").onclick = busy(async () => {
        try {
            const saved = await savePackagingItem({ id: existing ? existing.id : null, name: ov.querySelector("#pf-name").value, category: ov.querySelector("#pf-cat").value, price: ov.querySelector("#pf-price").value });
            closeModal(); toast("נשמר"); if (onDone) onDone(saved);
        } catch (e) { const el = ov.querySelector(".error-msg"); el.textContent = e.message; el.style.display = "block"; }
    });
    const del = ov.querySelector("#pf-del");
    if (del) del.onclick = async () => {
        closeModal();
        if (!(await confirmDialog(`למחוק את האריזה "${escapeHtml(existing.name)}"? מוצרים שמשתמשים בה יפסיקו לכלול אותה בעלות.`))) { if (onDone) onDone(null); return; }
        await deletePackagingItem(existing.id); toast("נמחקה"); if (onDone) onDone(null);
    };
}
