import { getSetting, setSetting } from "../repo/settingsRepo.js";
import { downloadExport, importAndReplace } from "../export.js";
import { toast, confirmDialog } from "../ui.js";

export async function renderSettingsPage(container) {
    const apiKey = (await getSetting("gemini_api_key")) || "";

    container.innerHTML = `
        <div class="card">
            <div class="card-title">מפתח Gemini API</div>
            <div class="hint">נדרש לסריקת חשבוניות. נשמר רק בתוך הטלפון הזה, לא נשלח לשום מקום חוץ מ-Google.</div>
            <div class="field" style="margin-top:8px;"><input type="text" id="f-apikey" value="${apiKey}" placeholder="הדבק כאן את המפתח"></div>
            <button class="btn btn-primary btn-small" id="btn-save-key">שמירה</button>
        </div>

        <div class="card">
            <div class="card-title">גיבוי (ייצוא/ייבוא)</div>
            <div class="hint">אין שרת ואין סנכרון אוטומטי - זה הגיבוי היחיד לנתונים שבטלפון. מומלץ לייצא אחרי כל עדכון משמעותי.</div>
            <div class="btn-row">
                <button class="btn btn-primary btn-small" id="btn-export">📤 ייצוא קובץ גיבוי</button>
                <button class="btn btn-secondary btn-small" id="btn-import">📥 ייבוא מקובץ</button>
            </div>
            <input type="file" id="import-file" accept=".json" style="display:none;">
            <div class="error-msg" id="import-error"></div>
        </div>

        <div class="card">
            <div class="card-title">על האפליקציה</div>
            <div class="hint">
                גרסת טלפון עצמאית של KitchenCostPro - כל הנתונים נשמרים רק במכשיר הזה, בלי שרת.
                <br>היא <b>לא</b> מסונכרנת עם הגרסה שרצה במחשב - כל אחת עם הנתונים שלה. השתמש בייצוא/ייבוא כדי להעביר נתונים בין השתיים אם צריך.
            </div>
        </div>
    `;

    container.querySelector("#btn-save-key").onclick = async () => {
        await setSetting("gemini_api_key", container.querySelector("#f-apikey").value.trim());
        toast("נשמר");
    };

    container.querySelector("#btn-export").onclick = async () => {
        await downloadExport();
        toast("קובץ גיבוי הורד");
    };

    const fileInput = container.querySelector("#import-file");
    container.querySelector("#btn-import").onclick = () => fileInput.click();
    fileInput.addEventListener("change", async () => {
        const file = fileInput.files[0];
        if (!file) return;
        const ok = await confirmDialog("ייבוא יחליף את כל הנתונים הקיימים בטלפון בנתונים מהקובץ. להמשיך?");
        if (!ok) { fileInput.value = ""; return; }
        try {
            const text = await file.text();
            await importAndReplace(text);
            toast("הנתונים יובאו בהצלחה");
            location.hash = "pantry";
            location.reload();
        } catch (e) {
            const el = container.querySelector("#import-error");
            el.textContent = e.message;
            el.style.display = "block";
        }
        fileInput.value = "";
    });
}
