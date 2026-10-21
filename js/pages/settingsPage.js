import { getSetting, setSetting } from "../repo/settingsRepo.js";
import { downloadExport, importAndReplace } from "../export.js";
import { toast, confirmDialog, info } from "../ui.js";
import { APP_VERSION, THEMES } from "../constants.js";
import { chooseTheme } from "../theme.js";
import { hasPin, openSetPinDialog, enterStaffMode, removePin } from "../staff.js";
import { buildReport, clearErrorLog } from "../errorLog.js";
import { openTrashModal } from "./trashModal.js";
import { listInvoicesWithItems } from "../repo/suppliersRepo.js";
import { openSetupWizard } from "./setupWizard.js";
import { openTour } from "./tour.js";
import { t, LANGS, getLang } from "../i18n.js";
import { renderCloudCard } from "../cloud/cloudUi.js";
import { getUsdaKey, setUsdaKey } from "../repo/nutritionRepo.js";

const setOpen = new Set(); // אזורים פתוחים (כברירת מחדל הכול סגור)

export async function renderSettingsPage(container) {
    const apiKey = (await getSetting("gemini_api_key")) || "";
    const usdaKey = await getUsdaKey();
    const lastExport = await getSetting("last_export");
    const currentTheme = (await getSetting("theme")) || "";
    const pinSet = await hasPin();
    const trashCount = (await listInvoicesWithItems({ trashed: true })).length;
    const autoSave = !!(await getSetting("scan_autosave"));
    let persisted = null;
    try { persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : null; } catch (e) { /* לא נתמך */ }

    container.innerHTML = `
        <div class="px-sec set-sec" data-sec="backup">
            <div class="px-sh"><span class="px-ic" style="background:var(--accent-soft);">☁</span><b>גיבוי וענן</b><span class="px-chev">${setOpen.has("backup") ? "▾" : "◂"}</span></div>
            <div class="set-body" ${setOpen.has("backup") ? "" : "hidden"}>
                <div class="card" id="cloud-card"></div>
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
            </div>
        </div>
        <div class="px-sec set-sec" data-sec="scan">
            <div class="px-sh"><span class="px-ic" style="background:var(--brand-soft);">🤖</span><b>סריקה ובינה מלאכותית</b><span class="px-chev">${setOpen.has("scan") ? "▾" : "◂"}</span></div>
            <div class="set-body" ${setOpen.has("scan") ? "" : "hidden"}>
                <div class="card">
            <div class="card-title">מפתח Gemini API ${info("נדרש לסריקת חשבוניות. נשמר רק בתוך הטלפון הזה, ולא נשלח לשום מקום חוץ מ-Google.")}</div>
            <div class="field" style="margin-top:8px;"><input type="text" id="f-apikey" value="${apiKey}" placeholder="הדבק כאן את המפתח"></div>
            <button class="btn btn-primary btn-small" id="btn-save-key">שמירה</button>
        </div>
        <div class="card">
            <div class="card-title">מפתח USDA (ערכים תזונתיים) ${info("לחיפוש ערכים תזונתיים של חומרי גלם במאגר USDA. המפתח חינמי: נרשמים בכתובת fdc.nal.usda.gov/api-key-signup.html והוא מגיע במייל. בלי מפתח החיפוש עובד אבל מוגבל מאוד. נשמר רק בתוך הטלפון הזה.")}</div>
            <div class="field" style="margin-top:8px;"><input type="text" id="f-usdakey" value="${usdaKey}" placeholder="הדבק כאן את המפתח (לא חובה)"></div>
            <button class="btn btn-primary btn-small" id="btn-save-usda">שמירה</button>
        </div>
                <div class="card">
            <div class="card-title">סריקה מהירה ${info("כשכל השורות מזוהות, אין שינוי מחיר חריג, יש ספק והסכום תואם לקבלה - החשבונית נשמרת לבד אחרי 5 שניות (אפשר לעצור). אחרת תראה רק את מה שדורש בדיקה.")}</div>
            <div class="checkbox-field"><input type="checkbox" id="f-autosave" ${autoSave ? "checked" : ""}>
                <label for="f-autosave">שמירה אוטומטית אחרי סריקה כשהכול תקין</label></div>
        </div>
            </div>
        </div>
        <div class="px-sec set-sec" data-sec="look">
            <div class="px-sh"><span class="px-ic" style="background:var(--warn-soft);">🎨</span><b>מראה</b><span class="px-chev">${setOpen.has("look") ? "▾" : "◂"}</span></div>
            <div class="set-body" ${setOpen.has("look") ? "" : "hidden"}>
                <div class="card">
            <div class="card-title">שפה / Language</div>
            <div class="chips" id="lang-chips" style="margin-bottom:14px;">${LANGS.map((l) => `<button type="button" class="chip ${l.key === getLang() ? "active" : ""}" data-lang-key="${l.key}">${l.name}</button>`).join("")}</div>
            <div class="card-title">מראה האפליקציה ${info("בחר ערכת עיצוב. השינוי מיידי, ואפשר להחליף בכל רגע.")}</div>
            <div class="chips" id="theme-chips">${THEMES.map((t) => `<button type="button" class="chip ${t.key === currentTheme ? "active" : ""}" data-theme-key="${t.key}"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${t.color};margin-left:6px;"></span>${t.label}</button>`).join("")}</div>
        </div>
            </div>
        </div>
        <div class="px-sec set-sec" data-sec="staff">
            <div class="px-sh"><span class="px-ic" style="background:var(--danger-soft);">🔒</span><b>הרשאות ומצב עובד</b><span class="px-chev">${setOpen.has("staff") ? "▾" : "◂"}</span></div>
            <div class="set-body" ${setOpen.has("staff") ? "" : "hidden"}>
                <div class="card">
            <div class="card-title">מצב עובד ${info("נעילה בקוד: העובד רואה רק צילום קבלות (נשלחות לבדיקה שלך) וספירת מלאי, בלי מחירים ורווחים. זו נעילה נוחה למניעת בלבול, לא הגנת אבטחה מלאה.")}</div>
            ${pinSet ? `<div class="btn-row"><button class="btn btn-primary btn-small" id="btn-staff-on">🔒 נעל למצב עובד עכשיו</button>
                <button class="btn btn-secondary btn-small" id="btn-staff-pin">שנה קוד</button>
                <button class="btn btn-danger btn-small" id="btn-staff-off">בטל נעילה</button></div>`
              : `<button class="btn btn-secondary btn-small" id="btn-staff-pin">הגדר קוד</button>`}
        </div>
            </div>
        </div>
        <div class="px-sec set-sec" data-sec="tools">
            <div class="px-sh"><span class="px-ic" style="background:var(--surface-2);">🧰</span><b>כלים (קבצים, פח, דוח תקלה)</b><span class="px-chev">${setOpen.has("tools") ? "▾" : "◂"}</span></div>
            <div class="set-body" ${setOpen.has("tools") ? "" : "hidden"}>
                <div class="card"><button class="btn btn-secondary btn-block" id="btn-producer">🏭 יצרן: מוצרים ומדבקות</button></div>
                <div class="card"><button class="btn btn-secondary btn-block" id="btn-files">📁 קבצים (קבלות, מתכונים, התקבלו)</button></div>
                <div class="card">
            <div class="card-title">פח חשבוניות</div>
            <button class="btn btn-secondary btn-small" id="btn-trash-open">🗑 פתח פח (${trashCount})</button>
        </div>
                <div class="card">
            <div class="card-title">דוח תקלה ${info("אם משהו לא עובד: לחץ להעתקת דוח קצר (גרסה, מכשיר והתקלות האחרונות), והדבק אותו בהודעה אליי.")}</div>
            <div class="btn-row"><button class="btn btn-secondary btn-small" id="btn-report-copy">📋 העתק דוח תקלה</button>
                <button class="btn btn-secondary btn-small" id="btn-report-clear">נקה יומן</button></div>
        </div>
            </div>
        </div>
        <div class="px-sec set-sec" data-sec="help">
            <div class="px-sh"><span class="px-ic" style="background:var(--ok-soft);">🧭</span><b>עזרה ועל האפליקציה</b><span class="px-chev">${setOpen.has("help") ? "▾" : "◂"}</span></div>
            <div class="set-body" ${setOpen.has("help") ? "" : "hidden"}>
                <div class="card"><button class="btn btn-secondary btn-block" id="btn-tour">${t("settings.tour")}</button></div>
                <div class="card"><button class="btn btn-secondary btn-block" id="btn-wizard">🧭 אשף הפעלה (מפתח, מדינה, מטבע)</button></div>
                <div class="card">
            <div class="card-title">על האפליקציה ${info("גרסת טלפון עצמאית של KitchenCostPro - כל הנתונים נשמרים רק במכשיר הזה, בלי שרת. היא לא מסונכרנת עם הגרסה שבמחשב. השתמש בייצוא וייבוא כדי להעביר נתונים בין השתיים.")}</div>
            <div class="hint"><b>גרסה:</b> ${APP_VERSION}</div>
        </div>
            </div>
        </div>
    `;
    container.querySelectorAll(".set-sec > .px-sh").forEach((hd) => {
        hd.onclick = () => {
            const sec = hd.parentElement, k = sec.dataset.sec, body = sec.querySelector(".set-body");
            if (setOpen.has(k)) setOpen.delete(k); else setOpen.add(k);
            body.hidden = !setOpen.has(k);
            hd.querySelector(".px-chev").textContent = setOpen.has(k) ? "▾" : "◂";
        };
    });
    container.querySelector("#btn-producer").onclick = () => { location.hash = "producer"; };
    container.querySelector("#btn-files").onclick = () => { location.hash = "files"; };
    renderCloudCard(container.querySelector("#cloud-card"));
    container.querySelector("#btn-tour").onclick = async () => openTour({ role: (await getSetting("role")) || "manager" });
    container.querySelector("#btn-wizard").onclick = () => openSetupWizard({ onDone: () => location.reload() });

    container.querySelector("#btn-save-key").onclick = async () => {
        await setSetting("gemini_api_key", container.querySelector("#f-apikey").value.trim());
        window.dispatchEvent(new CustomEvent("kcp-status-refresh"));
        toast("נשמר");
    };

    container.querySelector("#btn-save-usda").onclick = async () => { await setUsdaKey(container.querySelector("#f-usdakey").value); toast("נשמר"); };
    container.querySelectorAll("[data-lang-key]").forEach((b) => {
        b.onclick = async () => { await setSetting("language", b.dataset.langKey); location.reload(); };
    });
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
