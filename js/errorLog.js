// יומן תקלות קצר (30 אחרונות) - כדי שאפשר יהיה לשלוח "דוח תקלה" בלחיצה במקום לנחש מה קרה.
import { APP_VERSION } from "./constants.js";
import { dbGetAll } from "./db.js";

const KEY = "kcp_errlog";
const MAX = 30;

function read() {
    try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch (e) { return []; }
}

export function logError(source, err) {
    try {
        const list = read();
        list.push({ t: new Date().toISOString(), src: source, msg: String((err && err.message) || err || "").slice(0, 300) });
        localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX)));
    } catch (e) { /* היומן הוא רק עזר */ }
}

export function clearErrorLog() {
    try { localStorage.removeItem(KEY); localStorage.removeItem(CRUMBS); } catch (e) { /* ignore */ }
}

// פירורי לחם: 60 הפעולות האחרונות (פתיחה, מעבר דף, סריקה, יציאה לרקע, טעינה מחדש). נכנסים לדוח תקלה כדי להבין מה קרה לפני שהאפליקציה קפצה לבית.
const CRUMBS = "kcp_crumbs";
export function crumb(label) {
    try {
        const list = JSON.parse(localStorage.getItem(CRUMBS) || "[]");
        list.push({ t: new Date().toISOString().slice(11, 19), m: String(label).slice(0, 90) });
        localStorage.setItem(CRUMBS, JSON.stringify(list.slice(-60)));
    } catch (e) { /* עזר בלבד */ }
}
function readCrumbs() {
    try { return JSON.parse(localStorage.getItem(CRUMBS) || "[]"); } catch (e) { return []; }
}

export function installErrorHandlers() {
    window.addEventListener("error", (e) => logError("window", e.error || e.message));
    window.addEventListener("unhandledrejection", (e) => logError("promise", e.reason));
}

// טקסט שאפשר להדביק ולשלוח: גרסה, מכשיר, גדלי נתונים, והתקלות האחרונות
// note = כמה מילים מהמשתמש על מה קרה (לא חובה)
export async function buildReport(note = "") {
    const counts = [];
    for (const s of ["pantryItems", "recipes", "dishes", "suppliers", "invoices", "invoiceItems"]) {
        try { counts.push(`${s}=${(await dbGetAll(s)).length}`); } catch (e) { counts.push(`${s}=?`); }
    }
    const errs = read();
    const what = String(note || "").trim().slice(0, 600);
    return [
        ...(what ? [`מה קרה: ${what}`, ""] : []),
        `KitchenCostPro ${APP_VERSION}`,
        `מכשיר: ${navigator.userAgent}`,
        `מסך: ${window.innerWidth}x${window.innerHeight}`,
        `נתונים: ${counts.join(", ")}`,
        `תקלות אחרונות (${errs.length}):`,
        ...errs.map((e) => `  ${e.t} [${e.src}] ${e.msg}`),
        `פעולות אחרונות (שעה UTC):`,
        ...readCrumbs().map((c) => `  ${c.t} ${c.m}`),
    ].join("\n");
}
