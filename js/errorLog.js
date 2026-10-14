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
    try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
}

export function installErrorHandlers() {
    window.addEventListener("error", (e) => logError("window", e.error || e.message));
    window.addEventListener("unhandledrejection", (e) => logError("promise", e.reason));
}

// טקסט שאפשר להדביק ולשלוח: גרסה, מכשיר, גדלי נתונים, והתקלות האחרונות
export async function buildReport() {
    const counts = [];
    for (const s of ["pantryItems", "recipes", "dishes", "suppliers", "invoices", "invoiceItems"]) {
        try { counts.push(`${s}=${(await dbGetAll(s)).length}`); } catch (e) { counts.push(`${s}=?`); }
    }
    const errs = read();
    return [
        `KitchenCostPro ${APP_VERSION}`,
        `מכשיר: ${navigator.userAgent}`,
        `מסך: ${window.innerWidth}x${window.innerHeight}`,
        `נתונים: ${counts.join(", ")}`,
        `תקלות אחרונות (${errs.length}):`,
        ...errs.map((e) => `  ${e.t} [${e.src}] ${e.msg}`),
    ].join("\n");
}
