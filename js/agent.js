// "עוזר AI": שרת קטן שמחזיק את מפתח Gemini של הבעלים ומגביל שימוש (ראה agent-worker/). כשהכתובת מוגדרת כאן, המשתמשים לא צריכים מפתח.
// אין מפתח אישי באפליקציה: כל הסריקות עוברות דרך העוזר, והמפתח נשמר רק בשרת.
import { getSetting, setSetting } from "./repo/settingsRepo.js";

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

// סימן מיוחד שמפנה לעוזר AI (ריק = אין עוזר). מפתח אישי שנשמר בגרסאות קודמות נמחק מהמכשיר.
export async function getAgentKey() {
    if (await getSetting("gemini_api_key")) await setSetting("gemini_api_key", "");
    return AGENT_URL ? AGENT_SENTINEL : "";
}
export async function usingAgent() { return !!AGENT_URL; }

// קריאה לעוזר AI: אותו גוף כמו ל-Gemini, ותשובה באותו פורמט (או 402 כשחרגת מהמגבלה היומית).
export function agentFetch(body, fetchImpl = fetch) {
    return fetchImpl(`${AGENT_URL}/gemini`, { method: "POST", headers: { "Content-Type": "application/json", "X-Device": deviceId() }, body: JSON.stringify(body) });
}
