// אייקוני מצב בסרגל העליון: 🤖 עוזר AI (מפתח Gemini) ו-☁️ ענן (גיבוי ל-Drive). אדום = לא מחובר, כתום = דורש טיפול, ירוק = תקין.
// לחיצה מסבירה מה זה אומר ומציעה לחבר. מוסתרים במצב טבח.
import { getSetting } from "./repo/settingsRepo.js";
import { getAgentKey, agentConfigured } from "./agent.js";
import { addonOn } from "./addons.js";
import { getCloudStatus, isCloudAvailable, runBackup } from "./cloud/cloudGlue.js";
import { resolveCloudIssue, fmtWhen } from "./cloud/cloudUi.js";
import { openModal, closeModal, toast, escapeHtml } from "./ui.js";
import { isStaffMode } from "./staff.js";
import { downloadExport } from "./export.js";

// האשף הוא רק שפה ומטבע, ולכן "חבר עוזר AI" מוביל להגדרות (מפתח אישי) ו"חבר ל-Google" מפעיל את החיבור ישירות.
export async function openWizardAt(step) {
    if (step === 2) {
        const { runConnectFlow } = await import("./cloud/cloudUi.js");
        await runConnectFlow();
        window.dispatchEvent(new CustomEvent("kcp-status-refresh"));
        if (location.hash === "#home" || !location.hash) location.reload();
        return;
    }
    location.hash = "settings";
}

export async function computeStatus() {
    const hasKey = !!(await getAgentKey());
    const cs = getCloudStatus();
    const available = await isCloudAvailable();
    let cloud = "bad";
    if (available && cs.enabled) cloud = ["conflict", "needs-auth", "error"].includes(cs.state) ? "warn" : "ok";
    return { agent: hasKey ? "ok" : "bad", cloud, cloudAvailable: available, cs };
}

const LABEL = { ok: "תקין", warn: "דורש טיפול", bad: "לא מחובר" };

export async function renderStatusIcons() {
    const el = document.getElementById("status-icons");
    if (!el) return;
    if (isStaffMode()) { el.innerHTML = ""; return; }
    const st = await computeStatus();
    el.innerHTML = `
        <button type="button" class="st-icon st-${st.agent}" id="st-agent" aria-label="עוזר AI: ${LABEL[st.agent]}" title="עוזר AI (Gemini): ${LABEL[st.agent]}">🤖<i></i></button>
        ${addonOn("cloud") ? `<button type="button" class="st-icon st-${st.cloud}" id="st-cloud" aria-label="ענן: ${LABEL[st.cloud]}" title="ענן (Drive): ${LABEL[st.cloud]}">☁️<i></i></button>` : ""}`;
    el.querySelector("#st-agent").onclick = () => openAgentPopup(st);
    const cb = el.querySelector("#st-cloud");
    if (cb) cb.onclick = () => openCloudPopup(st);
}

function popup(title, text, buttons) {
    const ov = openModal(`<h2>${title}</h2><p>${text}</p>
        <div class="btn-row" style="flex-direction:column;">${buttons.map((b, i) => `<button type="button" class="btn ${b.cls || "btn-secondary"}" data-i="${i}">${b.label}</button>`).join("")}</div>`);
    ov.querySelectorAll("[data-i]").forEach((el) => { el.onclick = async () => { closeModal(); await buttons[Number(el.dataset.i)].run(); }; });
}

async function openAgentPopup(st) {
    const hasOwnKey = !!(await getSetting("gemini_api_key"));
    if (st.agent === "ok") {
        popup("🤖 עוזר AI מחובר ✓", agentConfigured() && !hasOwnKey ? "עוזר AI משותף פעיל (עם מגבלה יומית), ואפשר לסרוק חשבוניות ומתכונים מתמונה. מי שרוצה בלי מגבלה יכול להזין מפתח Gemini אישי בהגדרות." : "מפתח Gemini שמור, ואפשר לסרוק חשבוניות ומתכונים מתמונה.", [
            { label: agentConfigured() ? "מפתח אישי בהגדרות" : "בדוק או החלף מפתח", cls: "btn-primary", run: () => { if (agentConfigured()) location.hash = "settings"; else openWizardAt(1); } },
            { label: "סגור", run: () => {} },
        ]);
    } else {
        popup("🤖 אין עוזר AI מחובר", "בלי עוזר AI (מפתח Gemini) אי אפשר לסרוק חשבוניות ומתכונים מתמונה. אפשר להמשיך לעבוד ידנית, אבל הסריקה לא תעבוד.", [
            { label: "חבר עוזר AI", cls: "btn-primary", run: () => openWizardAt(1) },
            { label: "אחר כך", run: () => {} },
        ]);
    }
}

function openCloudPopup(st) {
    if (!st.cloudAvailable) {
        popup("☁️ אין גיבוי בענן", "החיבור לדרייב עדיין לא הוגדר באפליקציה הזאת. הנתונים שמורים רק בטלפון הזה, ואם הוא יאבד או יימחק, הם יאבדו.", [
            { label: "ייצא גיבוי ידני עכשיו", cls: "btn-primary", run: async () => { await downloadExport(); toast("הגיבוי נשמר בקובץ"); } },
            { label: "סגור", run: () => {} },
        ]);
    } else if (st.cloud === "bad") {
        popup("☁️ אין גיבוי בענן", "הנתונים שמורים רק בטלפון הזה, ואם הוא יאבד או יימחק, הם יאבדו. חבר חשבון Google כדי לשמור אותם אוטומטית בדרייב.", [
            { label: "חבר ל-Google", cls: "btn-primary", run: () => openWizardAt(2) },
            { label: "אחר כך", run: () => {} },
        ]);
    } else if (st.cloud === "warn") {
        const why = st.cs.state === "conflict" ? "הענן שונה ממכשיר אחר." : st.cs.state === "needs-auth" ? "הגיבוי מחכה לאישור שלך." : "הגיבוי האחרון נכשל.";
        popup("☁️ הגיבוי דורש טיפול", why, [
            { label: "טפל עכשיו", cls: "btn-primary", run: async () => { await resolveCloudIssue(); renderStatusIcons(); } },
            { label: "סגור", run: () => {} },
        ]);
    } else {
        popup("☁️ הגיבוי בענן פעיל ✓", `גיבוי אחרון: ${escapeHtml(fmtWhen(st.cs.lastBackup))}. הנתונים נשמרים אוטומטית בתיקייה KitchenCostPro בדרייב.`, [
            { label: "גבה עכשיו", cls: "btn-primary", run: async () => { try { await runBackup({ interactive: true }); toast("הגיבוי נשמר ✓"); } catch (e) { toast(e.message); } renderStatusIcons(); } },
            { label: "סגור", run: () => {} },
        ]);
    }
}

export function initStatusIcons() {
    window.addEventListener("kcp-cloud-status", () => renderStatusIcons());
    window.addEventListener("kcp-status-refresh", () => renderStatusIcons());
    renderStatusIcons();
}
