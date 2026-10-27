// צילום תווית יצרן של מוצר מוכן: קורא אלרגנים, רכיבים וערכים תזונתיים (ל-100 גרם), מציג טיוטה לבדיקה ושומר רק באישור.
import { openModal, closeModal, toast, escapeHtml, busy } from "../ui.js";
import { openImagePicker } from "../imagePicker.js";
import { getAgentKey } from "../agent.js";
import { scanLabelImage } from "../repo/scanRepo.js";
import { setItemAllergens } from "../repo/pantryRepo.js";
import { saveNutrition, saveLabelInfo } from "../repo/nutritionRepo.js";
import { ALLERGENS } from "../allergens.js";
import { NUTRIENTS } from "../nutrition.js";

// item: מוצר חומרי גלם. onDone נקרא אחרי שמירה.
export function openLabelScan({ item, onDone }) {
    openImagePicker({
        title: `צילום תווית: ${item.name}`,
        hint: "צלם את התווית של היצרן: קרוב, ישר, באור טוב, כך שרשימת הרכיבים, האלרגנים והטבלה התזונתית בפריים. אפשר לצלם כמה פעמים. תראה טיוטה ותאשר לפני שמירה.",
        onFile: (file) => scanAndReview(item, file, onDone),
    });
}

async function scanAndReview(item, file, onDone) {
    openModal('<div style="text-align:center;padding:24px;color:#666;">קורא את התווית...</div>');
    let draft;
    try {
        draft = await scanLabelImage(await getAgentKey(), file);
    } catch (e) {
        closeModal();
        const ov = openModal(`<h2>שגיאה בקריאת התווית</h2><div class="error-msg" style="display:block;">${escapeHtml(e.message)}</div><div class="modal-actions"><button class="btn btn-secondary" id="lb-close">סגור</button><button class="btn btn-primary" id="lb-retry">צלם שוב</button></div>`);
        ov.querySelector("#lb-close").onclick = closeModal;
        ov.querySelector("#lb-retry").onclick = () => { closeModal(); openLabelScan({ item, onDone }); };
        return;
    }
    closeModal();
    review(item, draft, onDone);
}

function review(item, draft, onDone) {
    const sel = new Set(draft.contains);
    const may = new Set(draft.mayContain);
    const ov = openModal(`
        <h2>טיוטה מהתווית</h2>
        <div class="hint-warn">זו קריאה אוטומטית, והיא עלולה לטעות. <b>בדוק כל ערך מול התווית עצמה</b> לפני שמירה, במיוחד אלרגנים.</div>
        ${draft.name ? `<div class="hint">על התווית: <b>${escapeHtml(draft.name)}</b> (נשמר תחת "${escapeHtml(item.name)}")</div>` : ""}
        ${draft.warnings.map((w) => `<div class="hint-warn">${escapeHtml(w)}</div>`).join("")}
        ${draft.notes ? `<div class="hint">הערה מהקריאה: ${escapeHtml(draft.notes)}</div>` : ""}
        <div class="card-title" style="margin:10px 0 4px;">מכיל (אלרגנים)</div>
        <div class="chips" id="lb-al"></div>
        <div class="card-title" style="margin:10px 0 4px;">עלול להכיל עקבות</div>
        <div class="chips" id="lb-may"></div>
        <div class="card-title" style="margin:10px 0 4px;">ערכים תזונתיים ל-100 גרם${draft.fromServing ? " (חושב ממנה)" : ""}</div>
        <div class="form-row" style="flex-wrap:wrap;">${NUTRIENTS.map((n) => `<div class="field" style="min-width:45%;"><label>${escapeHtml(n.label)}</label><input type="text" inputmode="decimal" data-lb="${n.key}" value="${draft.per100[n.key] != null ? draft.per100[n.key] : ""}"></div>`).join("")}</div>
        <div class="card-title" style="margin:10px 0 4px;">רכיבים (כפי שמודפס)</div>
        <textarea id="lb-ing" rows="4" style="width:100%;">${escapeHtml(draft.ingredients)}</textarea>
        <div class="error-msg"></div>
        <div class="modal-actions"><button class="btn btn-secondary" id="lb-cancel">ביטול</button><button class="btn btn-primary" id="lb-save">שמירה</button></div>`);

    const draw = () => {
        const chips = (set, host, dataAttr) => {
            host.innerHTML = ALLERGENS.map((a) => `<button type="button" class="chip ${set.has(a.key) ? "active" : ""}" ${dataAttr}="${a.key}">${a.label}</button>`).join("");
            host.querySelectorAll(`[${dataAttr}]`).forEach((b) => { b.onclick = () => { const k = b.dataset[dataAttr.replace("data-", "")]; if (set.has(k)) set.delete(k); else set.add(k); draw(); }; });
        };
        chips(sel, ov.querySelector("#lb-al"), "data-al");
        chips(may, ov.querySelector("#lb-may"), "data-may");
    };
    draw();
    ov.querySelector("#lb-cancel").onclick = closeModal;
    ov.querySelector("#lb-save").onclick = busy(async () => {
        const el = ov.querySelector(".error-msg");
        try {
            const per100 = {};
            ov.querySelectorAll("[data-lb]").forEach((i) => { if (String(i.value).trim() !== "") per100[i.dataset.lb] = i.value; });
            await setItemAllergens(item.id, [...sel]);
            if (Object.keys(per100).length) await saveNutrition(item.id, per100, { source: "label", label: draft.name });
            await saveLabelInfo(item.id, { ingredients: ov.querySelector("#lb-ing").value, mayContain: [...may].filter((k) => !sel.has(k)), net_g: draft.netG });
            closeModal();
            toast("נשמר מהתווית");
            if (onDone) onDone();
        } catch (e) {
            el.textContent = e.message;
            el.style.display = "block";
        }
    });
}
