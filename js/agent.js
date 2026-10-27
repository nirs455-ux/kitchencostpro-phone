// "עוזר AI": שרת קטן שמחזיק את מפתח Gemini של הבעלים ומגביל שימוש (ראה agent-worker/). כשהכתובת מוגדרת כאן, המשתמשים לא צריכים מפתח.
// מי שמזין מפתח אישי בהגדרות ממשיך לעבוד ישירות מול Google (המפתח האישי גובר).
import { getSetting } from "./repo/settingsRepo.js";

// הכתובת של ה-Worker אחרי ההקמה, למשל "https://kcp-agent.<החשבון>.workers.dev". ריק = אין עוזר AI (כמו קודם: מפתח אישי בלבד).
export const AGENT_URL = "https://kcp-agent.nirs455.workers.dev";
export const AGENT_SENTINEL = "__agent__";

export const agentConfigured = () => !!AGENT_URL;

// מזהה אקראי למכשיר (להגבלת שימוש ליום). נשמר ב-localStorage, לא בגיבוי.
export function deviceId() {
    try {
        let id = localStorage.getItem("kcp_device");
        if (!id) { id = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now()); localStorage.setItem("kcp_device", id); }
        return id;
    } catch (e) { return "nodevice"; }
}

// מפתח "אפקטיבי" לשאר האפליקציה: מפתח אישי אם הוזן; אחרת סימן מיוחד שמפנה לעוזר AI; אחרת ריק (אין עוזר AI).
export async function getAgentKey() {
    const own = await getSetting("gemini_api_key");
    if (own) return own;
    return AGENT_URL ? AGENT_SENTINEL : "";
}
export async function usingAgent() { return !(await getSetting("gemini_api_key")) && !!AGENT_URL; }

// קריאה לעוזר AI: אותו גוף כמו ל-Gemini, ותשובה באותו פורמט (או 402 כשחרגת מהמגבלה היומית).
export function agentFetch(body, fetchImpl = fetch) {
    return fetchImpl(`${AGENT_URL}/gemini`, { method: "POST", headers: { "Content-Type": "application/json", "X-Device": deviceId() }, body: JSON.stringify(body) });
}
