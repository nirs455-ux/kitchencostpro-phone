// מצב עובד: נעילה בקוד פשוט. עובד רואה רק צילום קבלות (נשלחות לבדיקת המנהל) וספירת מלאי - בלי מחירים ורווחים.
// שים לב: זו נעילה נוחה למניעת בלבול ולחיצות בטעות, לא הגנת אבטחה מלאה (הנתונים שמורים בדפדפן של המכשיר).
import { getSetting, setSetting } from "./repo/settingsRepo.js";
import { openModal, closeModal, toast, escapeHtml } from "./ui.js";
import { t } from "./i18n.js";

const MODE_KEY = "kcp_mode";
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // בלי תווים מבלבלים (0/O, 1/I)

async function sha(text) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("kcp-salt:" + text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function isStaffMode() {
    try { return localStorage.getItem(MODE_KEY) === "staff"; } catch (e) { return false; }
}

function setMode(mode) {
    try { localStorage.setItem(MODE_KEY, mode); } catch (e) { /* בלי localStorage - אין נעילה */ }
}

export async function hasPin() {
    return !!(await getSetting("staff_pin_hash"));
}

// מגדיר קוד חדש ומחזיר קוד שחזור (מוצג פעם אחת - לרשום!)
export async function setPin(pin) {
    if (!/^\d{4,8}$/.test(pin)) throw new Error("הקוד חייב להיות 4 עד 8 ספרות");
    let code = "";
    const rnd = crypto.getRandomValues(new Uint8Array(8));
    for (const b of rnd) code += ALPHABET[b % ALPHABET.length];
    await setSetting("staff_pin_hash", await sha(pin));
    await setSetting("staff_recovery_hash", await sha(code));
    return code;
}

export async function removePin() {
    await setSetting("staff_pin_hash", null);
    await setSetting("staff_recovery_hash", null);
    setMode("owner");
}

export async function verifyPin(pin) {
    const h = await getSetting("staff_pin_hash");
    return !!h && h === (await sha(String(pin).trim()));
}

export async function verifyRecovery(code) {
    const h = await getSetting("staff_recovery_hash");
    return !!h && h === (await sha(String(code).trim().toUpperCase()));
}

export function enterStaffMode() {
    setMode("staff");
    location.hash = "home";
    location.reload();
}

export async function leaveStaffMode() {
    setMode("owner");
    await setSetting("role", "manager"); // חוזרים לתפקיד מנהל (הקוד אומת)
    location.hash = "home";
    location.reload();
}

// חלון פתיחת נעילה: קוד, או "שכחתי" עם קוד שחזור
export function openUnlockDialog() {
    const overlay = openModal(`
        <h2>פתיחת מצב מנהל</h2>
        <div class="field"><label>קוד</label><input type="password" inputmode="numeric" autocomplete="off" id="unlock-pin" maxlength="8"></div>
        <div class="error-msg" id="unlock-err"></div>
        <div class="modal-actions"><button type="button" class="btn btn-secondary" id="unlock-cancel">ביטול</button>
            <button type="button" class="btn btn-primary" id="unlock-ok">פתח</button></div>
        <div style="text-align:center;margin-top:10px;"><a href="#" id="unlock-forgot" style="font-size:13px;">שכחתי את הקוד</a></div>
    `);
    const err = overlay.querySelector("#unlock-err");
    const fail = (m) => { err.textContent = m; err.style.display = "block"; };
    overlay.querySelector("#unlock-cancel").onclick = closeModal;
    const submit = async () => {
        if (await verifyPin(overlay.querySelector("#unlock-pin").value)) { await leaveStaffMode(); } else fail("קוד שגוי");
    };
    overlay.querySelector("#unlock-ok").onclick = submit;
    overlay.querySelector("#unlock-pin").addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
    overlay.querySelector("#unlock-forgot").onclick = (e) => {
        e.preventDefault();
        const o2 = openModal(`
            <h2>שחזור גישה</h2>
            <div class="field"><label>קוד השחזור שקיבלת כשהגדרת את הנעילה</label><input type="text" id="rec-code" autocomplete="off" style="text-transform:uppercase;"></div>
            <div class="error-msg" id="rec-err"></div>
            <div class="modal-actions"><button type="button" class="btn btn-secondary" id="rec-cancel">ביטול</button>
                <button type="button" class="btn btn-primary" id="rec-ok">שחזר</button></div>`);
        o2.querySelector("#rec-cancel").onclick = closeModal;
        o2.querySelector("#rec-ok").onclick = async () => {
            if (await verifyRecovery(o2.querySelector("#rec-code").value)) { await removePin(); toast("הנעילה בוטלה"); await leaveStaffMode(); }
            else { const e2 = o2.querySelector("#rec-err"); e2.textContent = "קוד שחזור שגוי"; e2.style.display = "block"; }
        };
    };
    setTimeout(() => overlay.querySelector("#unlock-pin").focus(), 50);
}

// חלון הגדרת נעילה (מהגדרות): בוחרים קוד, מקבלים קוד שחזור
export function openSetPinDialog(onDone) {
    const overlay = openModal(`
        <h2>הגדרת מצב עובד</h2>
        <div class="field"><label>קוד חדש (4 עד 8 ספרות)</label><input type="password" inputmode="numeric" autocomplete="off" id="pin1" maxlength="8"></div>
        <div class="field"><label>הקלד שוב</label><input type="password" inputmode="numeric" autocomplete="off" id="pin2" maxlength="8"></div>
        <div class="error-msg" id="pin-err"></div>
        <div class="modal-actions"><button type="button" class="btn btn-secondary" id="pin-cancel">ביטול</button>
            <button type="button" class="btn btn-primary" id="pin-ok">שמור</button></div>`);
    overlay.querySelector("#pin-cancel").onclick = closeModal;
    overlay.querySelector("#pin-ok").onclick = async () => {
        const err = overlay.querySelector("#pin-err");
        const p1 = overlay.querySelector("#pin1").value, p2 = overlay.querySelector("#pin2").value;
        try {
            if (p1 !== p2) throw new Error("שני הקודים לא זהים");
            const code = await setPin(p1);
            const o2 = openModal(`
                <h2>רשום את קוד השחזור</h2>
                <div class="card" style="text-align:center;"><div class="stat-big" style="letter-spacing:3px;">${escapeHtml(code)}</div></div>
                <div class="hint-warn">רשום אותו במקום בטוח. אם תשכח את הקוד, זו הדרך היחידה לפתוח את המצב בלי למחוק נתונים. הוא לא יוצג שוב.</div>
                <div class="modal-actions"><button type="button" class="btn btn-primary" id="rec-done">רשמתי</button></div>`);
            o2.querySelector("#rec-done").onclick = () => { closeModal(); if (onDone) onDone(); };
        } catch (e) { err.textContent = e.message; err.style.display = "block"; }
    };
}


// ---- קוד מנהל להגדרות: כשיש קוד, כניסה להגדרות מבקשת אותו. אחרי אישור נשארות פתוחות 10 דקות ----
const SETTINGS_OK_KEY = "kcp_settings_ok";
const SETTINGS_TTL = 10 * 60 * 1000;

export function settingsUnlocked() {
    try { const v = Number(sessionStorage.getItem(SETTINGS_OK_KEY)); return !!v && Date.now() - v < SETTINGS_TTL; } catch (e) { return false; }
}
export function markSettingsUnlocked() {
    try { sessionStorage.setItem(SETTINGS_OK_KEY, String(Date.now())); } catch (e) { /* לא קריטי */ }
}

// מריץ onOk אם אין קוד / הוזן קוד נכון / ההגדרות כבר נפתחו לאחרונה. onCancel בביטול.
export async function guardSettings(onOk, onCancel = () => {}) {
    if (!(await hasPin()) || settingsUnlocked()) { onOk(); return; }
    const overlay = openModal(`
        <h2>${escapeHtml(t("p.ask.title"))}</h2>
        <div class="field"><label>${escapeHtml(t("p.ask.label"))}</label><input type="password" inputmode="numeric" autocomplete="off" id="gs-pin" maxlength="8"></div>
        <div class="error-msg" id="gs-err"></div>
        <div class="modal-actions"><button type="button" class="btn btn-secondary" id="gs-cancel">${escapeHtml(t("common.cancel"))}</button>
            <button type="button" class="btn btn-primary" id="gs-ok">${escapeHtml(t("p.ask.ok"))}</button></div>
        <div style="text-align:center;margin-top:10px;"><a href="#" id="gs-forgot" style="font-size:13px;">שכחתי את הקוד</a></div>`);
    const err = overlay.querySelector("#gs-err");
    overlay.querySelector("#gs-cancel").onclick = () => { closeModal(); onCancel(); };
    const submit = async () => {
        if (await verifyPin(overlay.querySelector("#gs-pin").value)) { markSettingsUnlocked(); closeModal(); onOk(); }
        else { err.textContent = t("p.ask.wrong"); err.style.display = "block"; }
    };
    overlay.querySelector("#gs-ok").onclick = submit;
    overlay.querySelector("#gs-pin").addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
    overlay.querySelector("#gs-forgot").onclick = (e) => {
        e.preventDefault();
        const o2 = openModal(`
            <h2>שחזור גישה</h2>
            <div class="field"><label>קוד השחזור שקיבלת כשהגדרת את הקוד</label><input type="text" id="gr-code" autocomplete="off" style="text-transform:uppercase;"></div>
            <div class="error-msg" id="gr-err"></div>
            <div class="modal-actions"><button type="button" class="btn btn-secondary" id="gr-cancel">${escapeHtml(t("common.cancel"))}</button>
                <button type="button" class="btn btn-primary" id="gr-ok">${escapeHtml(t("p.ask.ok"))}</button></div>`);
        o2.querySelector("#gr-cancel").onclick = () => { closeModal(); onCancel(); };
        o2.querySelector("#gr-ok").onclick = async () => {
            if (await verifyRecovery(o2.querySelector("#gr-code").value)) { await removePin(); markSettingsUnlocked(); toast("הקוד בוטל"); closeModal(); onOk(); }
            else { const e2 = o2.querySelector("#gr-err"); e2.textContent = "קוד שחזור שגוי"; e2.style.display = "block"; }
        };
    };
    setTimeout(() => overlay.querySelector("#gs-pin").focus(), 50);
}
