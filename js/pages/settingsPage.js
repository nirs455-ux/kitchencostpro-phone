import { getSetting, setSetting } from "../repo/settingsRepo.js";
import { downloadExport, importAndReplace } from "../export.js";
import { toast, confirmDialog, info } from "../ui.js";
import { APP_VERSION, THEMES } from "../constants.js";
import { chooseTheme } from "../theme.js";

export async function renderSettingsPage(container) {
    const apiKey = (await getSetting("gemini_api_key")) || "";
    const lastExport = await getSetting("last_export");
    const currentTheme = (await getSetting("theme")) || "";
    const autoSave = !!(await getSetting("scan_autosave"));
    let persisted = null;
    try { persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : null; } catch (e) { /* לא נתמך */ }

    container.innerHTML = `
        <div class="card">
            <div class="card-title">מפתח Gemini API ${info("נדרש לסריקת חשבוניות. נשמר רק בתוך הטלפון הזה, ולא נשלח לשום מקום חוץ מ-Google.")}</div>
            <div class="field" style="margin-top:8px;"><input type="text" id="f-apikey" value="${apiKey}" placeholder="הדבק כאן את המפתח"></div>
            <button class="btn btn-primary btn-small" id="btn-save-key">שמירה</button>
        </div>

        <div class="card">
            <div class="card-title">מראה האפליקציה ${info("בחר ערכת עיצוב. השינוי מיידי, ואפשר להחליף בכל רגע.")}</div>
            <div class="chips" id="theme-chips">${THEMES.map((t) => `<button type="button" class="chip ${t.key === currentTheme ? "active" : ""}" data-theme-key="${t.key}"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${t.color};margin-left:6px;"></span>${t.label}</button>`).join("")}</div>
        </div>

        <div class="card">
            <div class="card-title">סריקה מהירה ${info("כשכל השורות מזוהות, אין שינוי מחיר חריג, יש ספק והסכום תואם לקבלה - החשבונית נשמרת לבד אחרי 5 שניות (אפשר לעצור). אחרת תראה רק את מה שדורש בדיקה.")}</div>
            <div class="checkbox-field"><input type="checkbox" id="f-autosave" ${autoSave ? "checked" : ""}>
                <label for="f-autosave">שמירה אוטומטית אחרי סריקה כשהכול תקין</label></div>
        </div>

        <div class="card">
            <div class="card-title">גיבוי (ייצוא/ייבוא) ${info("אין שרת ואין סנכרון אוטומטי - זה הגיבוי היחיד לנתונים שבטלפון. מומלץ לייצא אחרי כל עדכון משמעותי.")}</div>
            <div class="hint" style="margin-bottom:6px;"><b>גיבוי אחרון:</b> ${lastExport ? new Date(lastExport).toLocaleString("he-IL") : "עדיין לא יוצא"}
                <br><b>אחסון קבוע:</b> ${persisted === true ? "פעיל - הדפדפן לא ימחק נתונים אוטומטית" : persisted === false ? "לא אושר ע\"י הדפדפן - מומלץ לגבות לעיתים קרובות" : "לא נתמך בדפדפן הזה"}</div>
            <div class="btn-row">
                <button class="btn btn-primary btn-small" id="btn-export">📤 ייצוא קובץ גיבוי</button>
                <button class="btn btn-secondary btn-small" id="btn-import">📥 ייבוא מקובץ</button>
            </div>
            <input type="file" id="import-file" accept=".json" style="display:none;">
            <div class="error-msg" id="import-error"></div>
        </div>

        <div class="card">
            <div class="card-title">על האפליקציה ${info("גרסת טלפון עצמאית של KitchenCostPro - כל הנתונים נשמרים רק במכשיר הזה, בלי שרת. היא לא מסונכרנת עם הגרסה שבמחשב. השתמש בייצוא וייבוא כדי להעביר נתונים בין השתיים.")}</div>
            <div class="hint"><b>גרסה:</b> ${APP_VERSION}</div>
        </div>
    `;

    container.querySelector("#btn-save-key").onclick = async () => {
        await setSetting("gemini_api_key", container.querySelector("#f-apikey").value.trim());
        toast("נשמר");
    };

    container.querySelectorAll("[data-theme-key]").forEach((b) => {
        b.onclick = async () => {
            await chooseTheme(b.dataset.themeKey);
            container.querySelectorAll("[data-theme-key]").forEach((x) => x.classList.toggle("active", x === b));
        };
    });

    container.querySelector("#f-autosave").onchange = async (e) => { await setSetting("scan_autosave", e.target.checked); toast("נשמר"); };

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
