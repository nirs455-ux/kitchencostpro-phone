// חלון ערכים תזונתיים למוצר: חיפוש ב-USDA (עם תרגום השם לאנגלית, דירוג ו-3 תוצאות טובות בלבד), חיפוש לפי ברקוד ב-Open Food Facts, צילום תווית, או הזנה ידנית.
// בחירה ממאגר USDA נזכרת לפי השם הנקי, ומוצר אחר עם אותו שם נקי מקבל אותה אוטומטית.
import { openModal, closeModal, toast, escapeHtml, h, busy } from "../ui.js";
import { getAgentKey } from "../agent.js";
import { getNutritionDb, saveNutrition, removeNutrition, getUsdaKey, toEnglishFoodName, searchUsda, lookupBarcode, rememberChoice } from "../repo/nutritionRepo.js";
import { NUTRIENTS, rankUsdaFoods } from "../nutrition.js";
import { preparedWord } from "../allergenResolve.js";
import { openLabelScan } from "./labelModal.js";

const SRC_LABEL = { usda: "USDA", off: "Open Food Facts", manual: "הזנה ידנית", label: "תווית יצרן", remembered: "נזכר מבחירה קודמת" };
const TOP = 3; // כמה התאמות מוצגות מיד; השאר תחת "הצג עוד"

const summary = (p) => ["kcal", "protein", "fat", "carbs"].filter((k) => p[k] != null).map((k) => `${NUTRIENTS.find((n) => n.key === k).short} ${+Number(p[k]).toFixed(1)}`).join(" · ");

// name = שם המוצר במזווה, cleanName = שם נקי של חומר הגלם (לחיפוש ולזיכרון). onSaved(db) נקרא אחרי שמירה או הסרה
// onCreateRecipe: אם הועבר, בהערת "מוצר מעובד" מופיע כפתור שיוצר מתכון למוצר (למשל שום מטוגן = שום + שמן)
export async function openNutritionLookup({ name, cleanName, pantryId, onSaved, onDone, onCreateRecipe }) {
    const shown = cleanName || name;
    const db = await getNutritionDb();
    const cur = db[pantryId] || null;
    const prepared = preparedWord(name) || preparedWord(shown);
    const ov = openModal(`
        <h2>ערכים תזונתיים: ${escapeHtml(shown)}</h2>
        ${prepared ? `<div class="hint-warn">השם "${escapeHtml(prepared)}" מרמז על מוצר מעובד, וערכי המאגר הם לחומר גלם. אם זה מוצר שהכנת (למשל שום מטוגן), עדיף ליצור אותו כמתכון (למשל שום + שמן) ולהשתמש בו כתת-מתכון: התזונה תחושב מהרכיבים האמיתיים.${onCreateRecipe ? '<div style="margin-top:8px;"><button type="button" class="btn btn-primary btn-small" id="nu-make-recipe">➕ צור מתכון למוצר הזה</button></div>' : ""}</div>` : ""}
        ${cur ? `<div class="hint-warn" style="background:var(--ok-soft);border-color:var(--ok);">יש ערכים שמורים (${escapeHtml(SRC_LABEL[cur._source] || "")}${cur._label ? ": " + escapeHtml(cur._label) : ""}). אפשר להחליף או להסיר.</div>` : ""}
        <div class="card-title" style="margin:8px 0 4px;">חיפוש במאגר USDA</div>
        <div class="field" style="margin:0 0 6px;"><input type="text" id="nu-q" value="${escapeHtml(shown)}" placeholder="שם המוצר"></div>
        <button type="button" class="btn btn-secondary btn-small" id="nu-search">🔍 חפש</button>
        <div id="nu-results" style="margin-top:8px;"></div>
        <div class="card-title" style="margin:14px 0 4px;">מוצר ארוז: צילום התווית</div>
        <button type="button" class="btn btn-secondary btn-small" id="nu-label">📷 צלם תווית (ערכים ואלרגנים)</button>
        <div class="card-title" style="margin:14px 0 4px;">או חיפוש לפי ברקוד</div>
        <div class="cv-row"><input type="text" inputmode="numeric" id="nu-bc" placeholder="ברקוד" style="font-size:16px;font-weight:400;"><button type="button" class="btn btn-secondary btn-small" id="nu-bc-go">חפש</button></div>
        <div id="nu-bc-res" style="margin-top:8px;"></div>
        <details class="pg-more" ${cur && cur._source === "manual" ? "open" : ""}><summary>הזנה ידנית (ל-100 גרם)</summary>
            <div class="form-row" style="flex-wrap:wrap;">${NUTRIENTS.map((n) => `<div class="field" style="min-width:45%;"><label>${escapeHtml(n.label)}</label><input type="text" inputmode="decimal" data-nu="${n.key}" value="${cur && cur[n.key] != null ? cur[n.key] : ""}"></div>`).join("")}</div>
            <button type="button" class="btn btn-primary btn-small" id="nu-manual">שמירה</button>
        </details>
        <div class="hint" style="margin-top:10px;">הערכים הם הערכה לחומר גלם. לתיוג רשמי נדרשת בדיקה מקצועית.</div>
        <div class="modal-actions">${cur ? '<button type="button" class="btn btn-danger" id="nu-del">הסר ערכים</button>' : ""}<button type="button" class="btn btn-secondary" id="nu-close">סגור</button></div>`);

    const save = async (per100, source, label) => {
        try {
            const newDb = await saveNutrition(pantryId, per100, { source, label });
            if (source === "usda") await rememberChoice(shown, per100, label); // זיכרון לפי שם נקי
            closeModal(); toast("נשמר"); if (onSaved) onSaved(newDb); if (onDone) onDone();
        } catch (e) { toast(e.message); }
    };
    const rowFor = (title, sub, per100, source, label, best = false) => {
        const row = h(`<div class="pk-row" style="cursor:pointer;${best ? "border:2px solid var(--ok);border-radius:10px;" : ""}"><div class="pk-name">${best ? "✅ " : ""}${escapeHtml(title)}</div><div class="pk-hint">${best ? "ההצעה הטובה ביותר · " : ""}${escapeHtml(sub)}</div></div>`);
        row.onclick = () => save(per100, source, label);
        return row;
    };

    ov.querySelector("#nu-close").onclick = () => { closeModal(); if (onDone) onDone(); };
    const mk = ov.querySelector("#nu-make-recipe");
    if (mk) mk.onclick = () => { closeModal(); onCreateRecipe(); };
    ov.querySelector("#nu-label").onclick = () => { closeModal(); openLabelScan({ item: { id: pantryId, name }, onDone: () => { if (onDone) onDone(); } }); };
    const del = ov.querySelector("#nu-del");
    if (del) del.onclick = async () => { const newDb = await removeNutrition(pantryId); closeModal(); toast("הוסר"); if (onSaved) onSaved(newDb); if (onDone) onDone(); };

    const runSearch = busy(async () => {
        const box = ov.querySelector("#nu-results");
        box.innerHTML = '<div class="hint">מחפש...</div>';
        const q = ov.querySelector("#nu-q").value;
        const en = await toEnglishFoodName(await getAgentKey(), q);
        const { foods, error } = await searchUsda(en, await getUsdaKey());
        box.innerHTML = "";
        if (error) { box.innerHTML = `<div class="hint-warn">${escapeHtml(error)}</div>`; return; }
        if (!foods.length) { box.innerHTML = `<div class="hint">לא נמצאו תוצאות עבור "${escapeHtml(en)}". נסה שם באנגלית (למשל olive oil).</div>`; return; }
        const ranked = rankUsdaFoods(foods, en);
        box.appendChild(h(`<div class="hint" style="margin-bottom:4px;">חיפשתי: ${escapeHtml(en)}. ההתאמות הטובות ביותר (ל-100 גרם), מסודרות לפי קרבה לחומר גלם:</div>`));
        ranked.slice(0, TOP).forEach((f, i) => box.appendChild(rowFor(f.name, summary(f.per100), f.per100, "usda", f.name, i === 0)));
        if (ranked.length > TOP) {
            const more = h(`<button type="button" class="btn-link" style="margin-top:6px;">הצג עוד ${ranked.length - TOP} אפשרויות</button>`);
            more.onclick = () => { more.remove(); ranked.slice(TOP).forEach((f) => box.appendChild(rowFor(f.name, summary(f.per100), f.per100, "usda", f.name))); };
            box.appendChild(more);
        }
    });
    ov.querySelector("#nu-search").onclick = runSearch;
    ov.querySelector("#nu-q").addEventListener("keydown", (e) => { if (e.key === "Enter") ov.querySelector("#nu-search").click(); });
    if (!cur && !prepared) runSearch.call(ov.querySelector("#nu-search")); // אין עדיין ערכים: מציעים מיד את ההתאמה הטובה ביותר

    ov.querySelector("#nu-bc-go").onclick = busy(async () => {
        const box = ov.querySelector("#nu-bc-res");
        box.innerHTML = '<div class="hint">מחפש...</div>';
        const { product, error } = await lookupBarcode(ov.querySelector("#nu-bc").value);
        box.innerHTML = "";
        if (error) { box.innerHTML = `<div class="hint-warn">${escapeHtml(error)}</div>`; return; }
        box.appendChild(rowFor(product.name || "מוצר", summary(product.per100), product.per100, "off", product.name));
    });

    ov.querySelector("#nu-manual").onclick = () => {
        const v = {};
        ov.querySelectorAll("[data-nu]").forEach((i) => { v[i.dataset.nu] = i.value; });
        save(v, "manual", "");
    };
}
