// מסכי הענן: זרימת חיבור (כולל שאלה מה לעשות אם כבר יש גיבוי), כרטיס הגדרות, וטקסטים משותפים.
import { openModal, closeModal, toast, escapeHtml } from "../ui.js";
import { connectCloud, disconnectCloud, restoreFromCloud, runBackup, localHasData, getCloudStatus, isCloudAvailable, getClientId, setClientId } from "./cloudGlue.js";

export const fmtWhen = (iso) => {
    if (!iso) return "עדיין לא";
    const d = new Date(iso);
    const p = (n) => String(n).padStart(2, "0");
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

function ask({ title, text, buttons }) {
    return new Promise((resolve) => {
        const ov = openModal(`<h2>${title}</h2><p>${text}</p>
            <div class="btn-row" style="flex-direction:column;">${buttons.map((b, i) => `<button type="button" class="btn ${b.cls || "btn-secondary"}" data-i="${i}">${b.label}</button>`).join("")}</div>`);
        ov.querySelectorAll("[data-i]").forEach((el) => { el.onclick = () => { closeModal(); resolve(buttons[Number(el.dataset.i)].value); }; });
    });
}

// מתחבר לחשבון ומטפל במצבים: אין גיבוי / יש גיבוי וטלפון ריק / יש גיבוי וגם נתונים בטלפון.
// מחזיר "connected" | "restored" | "cancelled". לא זורק על ביטול של המשתמש.
export async function runConnectFlow() {
    let info;
    try { info = await connectCloud(); } catch (e) { toast(e.message || "ההתחברות נכשלה"); return "cancelled"; }
    const hasLocal = await localHasData();
    if (!info.exists) {
        try { await runBackup({ interactive: true, force: true }); toast("מחובר. הגיבוי הראשון נשמר בדרייב ✓"); } catch (e) { toast("מחובר, אבל הגיבוי נכשל: " + e.message); }
        return "connected";
    }
    if (!hasLocal) {
        const go = await ask({ title: "נמצא גיבוי בענן", text: `יש בדרייב גיבוי מתאריך ${fmtWhen(info.modifiedTime)}. לשחזר אותו לטלפון הזה?`, buttons: [{ label: "שחזר מהענן", cls: "btn-primary", value: "restore" }, { label: "לא עכשיו", value: "skip" }] });
        if (go === "restore") { try { await restoreFromCloud(); toast("הנתונים שוחזרו מהענן ✓"); return "restored"; } catch (e) { toast("השחזור נכשל: " + e.message); } }
        return "connected";
    }
    const choice = await ask({
        title: "יש כבר גיבוי בענן",
        text: `בדרייב יש גיבוי מתאריך ${fmtWhen(info.modifiedTime)}, ובטלפון הזה יש נתונים אחרים. <b>אי אפשר לשמור את שניהם</b>, צריך לבחור:`,
        buttons: [
            { label: "שחזר מהענן (הנתונים בטלפון יוחלפו)", cls: "btn-primary", value: "restore" },
            { label: "החלף את הענן בנתוני הטלפון", cls: "btn-danger", value: "overwrite" },
            { label: "ביטול (לא להתחבר עכשיו)", value: "cancel" },
        ],
    });
    if (choice === "restore") { try { await restoreFromCloud(); toast("הנתונים שוחזרו מהענן ✓"); return "restored"; } catch (e) { toast("השחזור נכשל: " + e.message); return "cancelled"; } }
    if (choice === "overwrite") { try { await runBackup({ interactive: true, force: true }); toast("הענן עודכן מנתוני הטלפון ✓"); return "connected"; } catch (e) { toast("הגיבוי נכשל: " + e.message); return "cancelled"; } }
    await disconnectCloud();
    return "cancelled";
}

// טיפול בהתנגשות (הענן שונה ממכשיר אחר) או בהרשאה שפגה, מתוך לחיצה של המשתמש
export async function resolveCloudIssue() {
    const st = getCloudStatus();
    if (st.state === "conflict") {
        const c = await ask({
            title: "הענן השתנה ממכשיר אחר",
            text: "מישהו (או מכשיר אחר שלך) שמר גיבוי חדש יותר בדרייב. אי אפשר לשמור את שניהם.",
            buttons: [{ label: "שחזר מהענן (נתוני הטלפון יוחלפו)", cls: "btn-primary", value: "restore" }, { label: "החלף את הענן בנתוני הטלפון", cls: "btn-danger", value: "overwrite" }, { label: "אחר כך", value: "later" }],
        });
        if (c === "restore") { try { await restoreFromCloud(); toast("שוחזר מהענן ✓"); } catch (e) { toast("השחזור נכשל: " + e.message); } }
        else if (c === "overwrite") { try { await runBackup({ interactive: true, force: true }); toast("הענן עודכן ✓"); } catch (e) { toast(e.message); } }
    } else {
        try { const r = await runBackup({ interactive: true }); toast(r && r.needsAuth ? "ההתחברות לא הושלמה" : "הגיבוי נשמר ✓"); } catch (e) { toast(e.message); }
    }
}

const STATE_TEXT = {
    idle: "מחובר ✓", backing: "מגבה...", conflict: "⚠ הענן שונה ממכשיר אחר", "needs-auth": "⚠ נדרש אישור מחדש כדי לגבות", error: "⚠ הגיבוי נכשל",
};

// כרטיס הגדרות. container = אלמנט שבו מציירים. onChange נקרא אחרי שינוי מצב
export async function renderCloudCard(container, onChange = () => {}) {
    const available = await isCloudAvailable();
    const st = getCloudStatus();
    if (!available) {
        container.innerHTML = `<div class="card-title">☁️ גיבוי בענן (Google Drive)</div>
            <div class="hint">עדיין לא הוגדר מזהה לקוח של Google, ולכן אי אפשר להתחבר. זה נעשה פעם אחת על ידי מי שמפעיל את האפליקציה.</div>
            <div class="field" style="margin-top:8px;"><label>מזהה לקוח (Client ID)</label><input type="text" id="cc-id" dir="ltr" placeholder="xxxx.apps.googleusercontent.com" value="${escapeHtml(await getClientId())}"></div>
            <button class="btn btn-secondary btn-small" id="cc-save-id">שמירה</button>`;
        container.querySelector("#cc-save-id").onclick = async () => { await setClientId(container.querySelector("#cc-id").value); toast("נשמר"); renderCloudCard(container, onChange); };
        return;
    }
    if (!st.enabled) {
        container.innerHTML = `<div class="card-title">☁️ גיבוי בענן (Google Drive)</div>
            <div class="hint">שומר את הנתונים והתמונות בתיקייה KitchenCostPro בדרייב שלך. האפליקציה רואה רק קבצים שהיא יצרה.</div>
            <button class="btn btn-primary btn-block" id="cc-connect" style="margin-top:8px;">התחבר עם Google</button>`;
        container.querySelector("#cc-connect").onclick = async () => { await runConnectFlow(); renderCloudCard(container, onChange); onChange(); };
        return;
    }
    container.innerHTML = `<div class="card-title">☁️ גיבוי בענן (Google Drive)</div>
        <div class="card-row"><span>${STATE_TEXT[st.state] || "מחובר ✓"}</span><span class="muted">גיבוי אחרון: ${fmtWhen(st.lastBackup)}</span></div>
        <div class="btn-row" style="margin-top:8px;">
            <button class="btn btn-primary btn-small" id="cc-now">גבה עכשיו</button>
            ${st.state === "conflict" || st.state === "needs-auth" || st.state === "error" ? '<button class="btn btn-accent btn-small" id="cc-fix">טפל בבעיה</button>' : ""}
            <button class="btn btn-secondary btn-small" id="cc-restore">שחזר מהענן</button>
            <button class="btn btn-secondary btn-small" id="cc-off">התנתק</button>
        </div>`;
    const re = () => { renderCloudCard(container, onChange); onChange(); };
    container.querySelector("#cc-now").onclick = async () => { try { const r = await runBackup({ interactive: true }); toast(r && r.conflict ? "הענן שונה ממכשיר אחר" : "הגיבוי נשמר ✓"); } catch (e) { toast(e.message); } re(); };
    const fix = container.querySelector("#cc-fix");
    if (fix) fix.onclick = async () => { await resolveCloudIssue(); re(); };
    container.querySelector("#cc-restore").onclick = async () => {
        const go = await ask({ title: "שחזור מהענן", text: "הנתונים בטלפון הזה יוחלפו בגיבוי שבדרייב. להמשיך?", buttons: [{ label: "שחזר", cls: "btn-danger", value: "yes" }, { label: "ביטול", value: "no" }] });
        if (go === "yes") { try { await restoreFromCloud(); toast("שוחזר ✓"); } catch (e) { toast("השחזור נכשל: " + e.message); } }
        re();
    };
    container.querySelector("#cc-off").onclick = async () => { await disconnectCloud(); toast("הגיבוי בענן כבוי. הקבצים בדרייב נשארים."); re(); };
}
