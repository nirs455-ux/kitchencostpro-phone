import { getSetting, setSetting } from "../repo/settingsRepo.js";
import { downloadExport, importAndReplace } from "../export.js";
import { toast, confirmDialog, info } from "../ui.js";
import { APP_VERSION, THEMES } from "../constants.js";
import { chooseTheme } from "../theme.js";
import { hasPin, openSetPinDialog, enterStaffMode, removePin } from "../staff.js";
import { buildReport, clearErrorLog } from "../errorLog.js";
import { openTrashModal } from "./trashModal.js";
import { listInvoicesWithItems } from "../repo/suppliersRepo.js";

export async function renderSettingsPage(container) {
    const apiKey = (await getSetting("gemini_api_key")) || "";
    const lastExport = await getSetting("last_export");
    const currentTheme = (await getSetting("theme")) || "";
    const pinSet = await hasPin();
    const trashCount = (await listInvoicesWithItems({ trashed: true })).length;
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
            <div class="card-title">מצב עובד ${info("נעילה בקוד: העובד רואה רק צילום קבלות (נשלחות לבדיקה שלך) וספירת מלאי, בלי מחירים ורווחים. זו נעילה נוחה למניעת בלבול, לא הגנת אבטחה מלאה.")}</div>
            ${pinSet ? `<div class="btn-row"><button class="btn btn-primary btn-small" id="btn-staff-on">🔒 נעל למצב עובד עכשיו</button>
                <button class="btn btn-secondary btn-small" id="btn-staff-pin">שנה קוד</button>
                <button class="btn btn-danger btn-small" id="btn-staff-off">בטל נעילה</button></div>`
              : `<button class="btn btn-secondary btn-small" id="btn-staff-pin">הגדר קוד</button>`}
        </div>

        <div class="card">
            <div class="card-title">פח חשבוניות</div>
            <button class="btn btn-secondary btn-small" id="btn-trash-open">🗑 פתח פח (${trashCount})</button>
        </div>

        <div class="card">
            <div class="card-title">דוח תקלה ${info("אם משהו לא עובד: לחץ להעתקת דוח קצר (גרסה, מכשיר והתקלות האחרונות), והדבק אותו בהודעה אליי.")}</div>
            <div class="btn-row"><button class="btn btn-secondary btn-small" id="btn-report-copy">📋 העתק דוח תקלה</button>
                <button class="btn btn-secondary btn-small" id="btn-report-clear">נקה יומן</button></div>
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

    const pinBtn = container.querySelector("#btn-staff-pin");
    if (pinBtn) pinBtn.onclick = () => openSetPinDialog(() => { toast("הקוד נשמר"); renderSettingsPage(container); });
    const onBtn = container.querySelector("#btn-staff-on");
    if (onBtn) onBtn.onclick = async () => { if (await confirmDialog("לנעול למצב עובד? כדי לפתוח תצטרך את הקוד.")) enterStaffMode(); };
    const offBtn = container.querySelector("#btn-staff-off");
    if (offBtn) offBtn.onclick = async () => { if (await confirmDialog("לבטל את הנעילה והקוד?")) { await removePin(); toast("הנעילה בוטלה"); renderSettingsPage(container); } };
    container.querySelector("#btn-trash-open").onclick = () => openTrashModal(() => renderSettingsPage(container));
    container.querySelector("#btn-report-copy").onclick = async () => {
        const text = await buildReport();
        try { await navigator.clipboard.writeText(text); toast("הדוח הועתק - הדבק אותו בהודעה"); }
        catch (e) {
            const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select();
            try { document.execCommand("copy"); toast("הדוח הועתק"); } catch (e2) { toast("לא הצלחתי להעתיק"); }
            ta.remove();
        }
    };
    container.querySelector("#btn-report-clear").onclick = () => { clearErrorLog(); toast("היומן נוקה"); };

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
