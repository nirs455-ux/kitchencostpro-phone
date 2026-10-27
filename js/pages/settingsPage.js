import { getSetting, setSetting } from "../repo/settingsRepo.js";
import { whatsappUrl } from "../shareText.js";
import { downloadExport, downloadSafetyCopy, inspectBackup, importAndReplace } from "../export.js";
import { toast, confirmDialog, info, openModal, closeModal } from "../ui.js";
import { APP_VERSION, THEMES } from "../constants.js";
import { chooseTheme } from "../theme.js";
import { hasPin, openSetPinDialog, enterStaffMode, removePin } from "../staff.js";
import { buildReport, clearErrorLog } from "../errorLog.js";
import { openTrashModal } from "./trashModal.js";
import { listInvoicesWithItems } from "../repo/suppliersRepo.js";
import { openSetupWizard } from "./setupWizard.js";
import { saveQtyMode } from "../locale.js";
import { getQtyMode } from "../qty.js";
import { openTour } from "./tour.js";
import { t, LANGS, getLang } from "../i18n.js";
import { renderCloudCard } from "../cloud/cloudUi.js";
import { getUsdaKey, setUsdaKey } from "../repo/nutritionRepo.js";
import { loadDemoData } from "../demoData.js";
import { agentConfigured } from "../agent.js";

const setOpen = new Set(); // אזורים פתוחים (כברירת מחדל הכול סגור)

export async function renderSettingsPage(container) {
    const apiKey = (await getSetting("gemini_api_key")) || "";
    const usdaKey = await getUsdaKey();
    const producerOn = !!((await getSetting("producer_mode")) || (await getSetting("role")) === "producer");
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
                <button class="btn btn-primary btn-small" id="btn-export">📤 גיבוי מלא (עם תמונות)</button>
                <button class="btn btn-secondary btn-small" id="btn-export-lite">📄 גיבוי קל (בלי תמונות)</button>
                <button class="btn btn-secondary btn-small" id="btn-import">📥 שחזור מקובץ</button>
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
            <div class="card-title">${agentConfigured() ? "מפתח Gemini אישי (לא חובה)" : "מפתח Gemini API"} ${info(agentConfigured() ? "בלי מפתח האפליקציה משתמשת בסוכן משותף עם מגבלה יומית. אם תזין מפתח אישי, הסריקה תעבור ישירות לחשבון שלך בגוגל, בלי המגבלה. נשמר רק בתוך הטלפון הזה, ולא נשלח לשום מקום חוץ מ-Google." : "נדרש לסריקת חשבוניות. נשמר רק בתוך הטלפון הזה, ולא נשלח לשום מקום חוץ מ-Google.")}</div>
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
                <div class="card"><div class="checkbox-field"><input type="checkbox" id="f-producer-mode" ${producerOn ? "checked" : ""}><label for="f-producer-mode"><b>מודול יצרן</b> (מוצרים עם אריזה, מדבקות, אלרגנים וערכים תזונתיים) ${info("מוסיף את כפתור יצרן בתפריט. מתאים למי שמוכר מוצרים באריזה. אפשר להפעיל וליצור בכל זמן, והנתונים נשמרים.")}</label></div></div>
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
                <div class="card"><button class="btn btn-secondary btn-block" id="btn-demo">🧪 טען נתוני דוגמה (להדגמה)</button></div>
                <div class="card"><button class="btn btn-secondary btn-block" id="btn-files">📁 קבצים (קבלות, מתכונים, התקבלו)</button></div>
                <div class="card">
            <div class="card-title">פח חשבוניות</div>
            <button class="btn btn-secondary btn-small" id="btn-trash-open">🗑 פתח פח (${trashCount})</button>
        </div>
                <div class="card">
            <div class="card-title">דיווח על תקלה ${info("אם משהו לא עובד: לחץ, כתוב כמה מילים על מה קרה, ושתף את הדוח (וואטסאפ, מייל ועוד) או העתק אותו. הדוח לא נשלח אוטומטית לשום מקום ולא כולל חשבוניות או מחירים: רק גרסה, סוג מכשיר, כמה נתונים יש, והתקלות האחרונות.")}</div>
            <div class="btn-row"><button class="btn btn-secondary btn-small" id="btn-report-open">📝 דווח על תקלה</button></div>
        </div>
            </div>
        </div>
        <div class="px-sec set-sec" data-sec="help">
            <div class="px-sh"><span class="px-ic" style="background:var(--ok-soft);">🧭</span><b>עזרה ועל האפליקציה</b><span class="px-chev">${setOpen.has("help") ? "▾" : "◂"}</span></div>
            <div class="set-body" ${setOpen.has("help") ? "" : "hidden"}>
                <div class="card"><button class="btn btn-secondary btn-block" id="btn-tour">${t("settings.tour")}</button></div>
                <div class="card"><div class="card-title">הקלדת כמויות ${info("בגרמים מקלידים מספר שלם: 100, 1500. בקילוגרמים מקלידים עם נקודה: 0.100, 1.5. הנתונים נשמרים בגרמים בכל מקרה, ולכן אפשר להחליף בכל רגע.")}</div>
                    <select id="set-qty"><option value="g" ${getQtyMode() === "g" ? "selected" : ""}>גרמים (100)</option><option value="kg" ${getQtyMode() === "kg" ? "selected" : ""}>ק"ג עם נקודה (0.100)</option></select></div>
                <div class="card"><button class="btn btn-secondary btn-block" id="btn-wizard">🧭 שפה ומטבע</button></div>
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
    container.querySelector("#f-producer-mode").onchange = async (e) => {
        await setSetting("producer_mode", e.target.checked);
        if (!e.target.checked && (await getSetting("role")) === "producer") await setSetting("role", "manager");
        toast(e.target.checked ? "מודול יצרן הופעל" : "מודול יצרן כובה");
        location.reload();
    };
    container.querySelector("#btn-demo").onclick = async () => {
        if (!(await confirmDialog("להוסיף נתוני דוגמה (מזווה, מתכונים, מנות, חשבונית ומוצר יצרן)?<br><br>הנתונים הקיימים שלך לא יימחקו, רק יתווספו פריטים חדשים."))) return;
        try { await loadDemoData(); toast("נתוני הדוגמה נטענו"); location.hash = "home"; } catch (e) { toast("לא הצלחתי לטעון: " + e.message); }
    };
    container.querySelector("#btn-producer").onclick = () => { location.hash = "producer"; };
    container.querySelector("#btn-files").onclick = () => { location.hash = "files"; };
    renderCloudCard(container.querySelector("#cloud-card"));
    container.querySelector("#btn-tour").onclick = async () => openTour({ role: (await getSetting("role")) || "manager" });
    container.querySelector("#set-qty").onchange = async (e) => { await saveQtyMode(e.target.value); toast("נשמר"); };
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
    container.querySelector("#btn-report-open").onclick = async () => {
        const ov = openModal(`
            <h2>דיווח על תקלה</h2>
            <div class="hint" style="margin-bottom:6px;">הדוח לא נשלח אוטומטית. כאן אתה רואה בדיוק מה בו, כותב כמה מילים, מזין לאן לשלוח (פעם אחת, והיעד נשמר), ולוחץ שלח. הוא לא כולל חשבוניות או מחירים.</div>
            <div class="field"><label>מה קרה? (לא חובה, אבל עוזר מאוד)</label><textarea id="rp-note" rows="3" style="width:100%;" placeholder="באיזה מסך היית, מה לחצת, ומה ציפית שיקרה"></textarea></div>
            <div class="field"><label>לאן לשלוח (טלפון לוואטסאפ, או מייל)</label><input type="text" id="rp-to" inputmode="email" placeholder="מספר טלפון או כתובת מייל" style="width:100%;"></div>
            <div class="card-title" style="margin:8px 0 4px;">הדוח</div>
            <pre id="rp-text" class="card" style="white-space:pre-wrap;font-size:12px;max-height:200px;overflow:auto;direction:ltr;text-align:left;margin:0 0 8px;"></pre>
            <div class="modal-actions" style="flex-wrap:wrap;">
                <button type="button" class="btn btn-secondary" id="rp-clear">נקה יומן</button>
                <button type="button" class="btn btn-secondary" id="rp-copy">📋 העתק</button>
                <button type="button" class="btn btn-primary" id="rp-share">📤 שתף</button>
            </div>
            <button type="button" class="btn btn-secondary btn-block" id="rp-close" style="margin-top:8px;">סגור</button>`);
        const noteEl = ov.querySelector("#rp-note"), box = ov.querySelector("#rp-text");
        const refresh = async () => { box.textContent = await buildReport(noteEl.value); };
        noteEl.addEventListener("input", refresh);
        await refresh();
        const copy = async () => {
            const text = await buildReport(noteEl.value);
            try { await navigator.clipboard.writeText(text); toast("הדוח הועתק - הדבק אותו בהודעה"); }
            catch (e) {
                const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select();
                try { document.execCommand("copy"); toast("הדוח הועתק"); } catch (e2) { toast("לא הצלחתי להעתיק"); }
                ta.remove();
            }
        };
        ov.querySelector("#rp-copy").onclick = copy;
        // יעד הדוחות נשמר: מייל פותח הודעת מייל מוכנה, מספר טלפון פותח וואטסאפ מוכן, ובלי יעד נפתח תפריט השיתוף
        const toEl = ov.querySelector("#rp-to");
        try { toEl.value = (await getSetting("report_to")) || ""; } catch (e) { /* לא קריטי */ }
        ov.querySelector("#rp-share").onclick = async () => {
            const text = await buildReport(noteEl.value);
            const to = toEl.value.trim();
            try { await setSetting("report_to", to); } catch (e) { /* לא קריטי */ }
            if (to.includes("@")) { window.location.href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent("דוח תקלה - KitchenCostPro")}&body=${encodeURIComponent(text.slice(0, 1800))}`; return; }
            if (/\d{7,}/.test(to)) { window.open(whatsappUrl(text, to), "_blank"); return; }
            if (navigator.share) { try { await navigator.share({ title: "דוח תקלה - KitchenCostPro", text }); } catch (e) { /* בוטל */ } }
            else await copy();
        };
        ov.querySelector("#rp-clear").onclick = async () => { clearErrorLog(); toast("היומן נוקה"); await refresh(); };
        ov.querySelector("#rp-close").onclick = closeModal;
    };

    container.querySelector("#f-autosave").onchange = async (e) => { await setSetting("scan_autosave", e.target.checked); toast("נשמר"); };

    container.querySelector("#btn-export").onclick = async () => {
        await downloadExport({ images: true });
        toast("קובץ גיבוי הורד");
    };
    container.querySelector("#btn-export-lite").onclick = async () => {
        await downloadExport({ images: false });
        toast("גיבוי קל הורד (בלי תמונות חשבוניות)");
    };

    const fileInput = container.querySelector("#import-file");
    container.querySelector("#btn-import").onclick = () => fileInput.click();
    fileInput.addEventListener("change", async () => {
        const file = fileInput.files[0];
        if (!file) return;
        const el = container.querySelector("#import-error");
        el.style.display = "none";
        try {
            const text = await file.text();
            const s = inspectBackup(text); // בודק שהקובץ תקין לפני שנוגעים בנתונים
            const when = s.exportedAt ? new Date(s.exportedAt).toLocaleString("he-IL") : "לא ידוע";
            const ok = await confirmDialog(`הקובץ מכיל ${s.pantry} מוצרים, ${s.recipes} מתכונים, ${s.dishes} מנות. נוצר: ${when}.<br><br>השחזור יחליף את <b>כל</b> הנתונים הקיימים בטלפון.${s.noImages ? "<br>זה גיבוי בלי תמונות, ולכן תמונות חשבוניות שקיימות היום יימחקו." : ""}<br><br>לפני כן יורד אוטומטית עותק של המצב הנוכחי, לשמירה למקרה שתתחרט. להמשיך?`);
            if (!ok) { fileInput.value = ""; return; }
            await downloadSafetyCopy();
            await importAndReplace(text);
            toast("הנתונים יובאו בהצלחה");
            location.hash = "pantry";
            location.reload();
        } catch (e) {
            el.textContent = e.message;
            el.style.display = "block";
        }
        fileInput.value = "";
    });
}
