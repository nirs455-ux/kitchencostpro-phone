// סקירת ייבוא של קובץ עם הרבה מתכונים: כל מתכון שורה סגורה, לחיצה פותחת אחד בכל פעם, ומייבאים את המסומנים כטיוטות.
import { openModal, closeModal, escapeHtml, toast } from "../ui.js";
import { dbGetAll } from "../db.js";
import { getSetting } from "../repo/settingsRepo.js";
import { saveRecipe } from "../repo/recipesRepo.js";
import { LINE_YIELD_FLAG } from "../repo/lineYieldMigration.js";
import { importData } from "../recipesBatch.js";

const unitHe = { g: "גרם", kg: 'ק"ג', ml: 'מ"ל', l: "ליטר", tbsp: "כף", tsp: "כפית", cup: "כוס", unit: "יחידות" };
const qtyText = (ing) => (ing.original_quantity != null ? `${ing.original_quantity} ${unitHe[ing.original_unit] || ""}`.trim() : "");
const missingCount = (d) => d.ingredients.filter((i) => !i.pantry_item_id).length;

// result: { drafts, failed, stopped }. onDone: נקרא אחרי ייבוא (רענון הרשימה)
export function openBatchReview(result, onDone) {
    const { drafts, failed = [], stopped = null } = result;
    const ov = openModal(`
        <h2>נמצאו ${drafts.length} מתכונים</h2>
        <div class="hint">כל מתכון נשמר כטיוטה. לחיצה על שורה פותחת אותו. רכיבים שלא נמצאו בחומרי הגלם נשמרים בטיוטה להשלמה.</div>
        ${failed.length ? `<div class="hint-warn">${stopped ? escapeHtml(stopped) + " " : ""}לא נקראו ${failed.length} מתכונים: ${escapeHtml(failed.slice(0, 8).join(", "))}${failed.length > 8 ? "..." : ""}. אפשר להעלות את הקובץ שוב אחר כך. מתכונים שכבר יובאו ידולגו.</div>` : ""}
        <label class="checkbox-field"><input type="checkbox" id="rb-all" checked><span>בחר הכול</span></label>
        <div id="rb-list">${drafts.map((d, i) => `
            <div class="card" style="margin:0 0 6px;" data-i="${i}">
                <div class="rb-head" style="display:flex;gap:8px;align-items:center;cursor:pointer;">
                    <input type="checkbox" class="rb-chk" checked>
                    <b style="flex:1;">${escapeHtml(d.name)}</b>
                    <span class="muted">${d.ingredients.length} מרכיבים</span>
                    ${missingCount(d) ? `<span class="tag tag-warn">חסרים ${missingCount(d)}</span>` : ""}
                    <span class="rb-arrow">◂</span>
                </div>
                <div class="rb-body" style="display:none;margin-top:8px;">
                    ${d.ingredients.map((g) => `<div class="card-row" style="padding:4px 0;gap:8px;"><span>${escapeHtml(g.original_name)}</span><span class="muted" style="text-align:left;">${escapeHtml(qtyText(g))}${g.pantry_item_id ? ` ← ${escapeHtml(g.matched_name || "")}${g.fuzzy ? " (משוער)" : ""}` : " לא נמצא"}</span></div>`).join("")}
                    ${d.method ? `<div class="hint" style="white-space:pre-wrap;margin-top:6px;">${escapeHtml(d.method.length > 400 ? d.method.slice(0, 400) + "..." : d.method)}</div>` : ""}
                </div>
            </div>`).join("")}</div>
        <div class="modal-actions"><button type="button" class="btn btn-secondary" id="rb-cancel">ביטול</button><button type="button" class="btn btn-primary" id="rb-go">ייבא את המסומנים</button></div>`);

    const cards = [...ov.querySelectorAll("#rb-list .card")];
    cards.forEach((c) => {
        c.querySelector(".rb-head").addEventListener("click", (e) => {
            if (e.target.classList.contains("rb-chk")) return;
            const open = c.querySelector(".rb-body").style.display === "none";
            cards.forEach((o) => { o.querySelector(".rb-body").style.display = "none"; o.querySelector(".rb-arrow").textContent = "◂"; }); // אחד פתוח בכל פעם
            if (open) { c.querySelector(".rb-body").style.display = ""; c.querySelector(".rb-arrow").textContent = "▾"; }
        });
    });
    ov.querySelector("#rb-all").onchange = (e) => cards.forEach((c) => { c.querySelector(".rb-chk").checked = e.target.checked; });
    ov.querySelector("#rb-cancel").onclick = closeModal;
    ov.querySelector("#rb-go").onclick = async (e) => {
        const btn = e.target; btn.disabled = true; btn.textContent = "מייבא...";
        const pantry = new Map((await dbGetAll("pantryItems")).map((r) => [r.id, r]));
        const ready = (await getSetting(LINE_YIELD_FLAG, "")) === "done";
        let ok = 0; const skipped = [], bad = [];
        for (const c of cards) {
            if (!c.querySelector(".rb-chk").checked) continue;
            const d = drafts[Number(c.dataset.i)];
            try { await saveRecipe(null, importData(d, pantry, ready)); ok++; continue; } catch (er) {
                if (/כבר קיים מתכון/.test(er.message)) { skipped.push(d.name); continue; }
            }
            try { await saveRecipe(null, importData(d, pantry, ready, { allAsDraft: true })); ok++; } catch (er) { bad.push(d.name); } // גיבוי: הכול כטיוטה
        }
        closeModal();
        toast(`יובאו ${ok} מתכונים${skipped.length ? `, דולגו ${skipped.length} שכבר קיימים` : ""}${bad.length ? `, נכשלו ${bad.length}` : ""}`, 6000);
        if (onDone) await onDone();
    };
}
