// חיבור הגיבוי לענן לדפדפן: התחברות Google (GIS), מסד הנתונים המקומי, תזמון גיבוי אוטומטי וסטטוס למסכים.
import { createDrive, DriveAuthError } from "./driveApi.js";
import { createCloud, CloudConflict } from "./cloudCore.js";
import { STORES, dbGetAll, dbReplaceAll, onDbChange } from "../db.js";
import { getSetting, setSetting } from "../repo/settingsRepo.js";
import { APP_VERSION } from "../constants.js";
import { GOOGLE_CLIENT_ID } from "./config.js";
import { logError } from "../errorLog.js";

const SCOPE = "https://www.googleapis.com/auth/drive.file"; // רק קבצים שהאפליקציה יצרה
const GIS_URL = "https://accounts.google.com/gsi/client";
const DEBOUNCE_MS = 20000;
// הגדרות שלא עולות לענן ולא נדרסות בשחזור: מפתח Gemini, מצב הענן עצמו, מזהה הלקוח
const LOCAL_ONLY = (k) => k === "gemini_api_key" || k === "google_client_id" || k.startsWith("cloud_");

let clientIdCache = null;
export async function getClientId() {
    if (clientIdCache) return clientIdCache;
    clientIdCache = ((await getSetting("google_client_id")) || GOOGLE_CLIENT_ID || "").trim();
    return clientIdCache;
}
export async function setClientId(v) { clientIdCache = null; await setSetting("google_client_id", (v || "").trim()); }
export async function isCloudAvailable() { return !!(await getClientId()); }

// ---- התחברות Google ----
let gisPromise = null;
function loadGis() {
    if (window.google && window.google.accounts && window.google.accounts.oauth2) return Promise.resolve();
    if (!gisPromise) {
        gisPromise = new Promise((resolve, reject) => {
            const s = document.createElement("script");
            s.src = GIS_URL; s.async = true;
            s.onload = () => resolve();
            s.onerror = () => { gisPromise = null; reject(new Error("לא ניתן לטעון את ההתחברות של Google. בדוק חיבור לאינטרנט.")); };
            document.head.appendChild(s);
        });
    }
    return gisPromise;
}

let tokenState = { token: null, expiresAt: 0 };
// מבקש טוקן מ-Google. interactive=true רק מתוך לחיצה של המשתמש (דפדפנים חוסמים חלון קופץ אחרת)
function requestToken({ interactive }) {
    return new Promise(async (resolve, reject) => {
        try {
            const clientId = await getClientId();
            if (!clientId) throw new Error("חסר מזהה לקוח של Google (ראה הגדרות)");
            await loadGis();
            const timer = setTimeout(() => reject(new DriveAuthError("ההתחברות לא הושלמה")), interactive ? 120000 : 15000);
            const client = window.google.accounts.oauth2.initTokenClient({
                client_id: clientId, scope: SCOPE,
                callback: (resp) => {
                    clearTimeout(timer);
                    if (resp.error || !resp.access_token) return reject(new DriveAuthError(resp.error_description || "ההתחברות ל-Google נדחתה"));
                    tokenState = { token: resp.access_token, expiresAt: Date.now() + (Number(resp.expires_in) || 3600) * 1000 };
                    resolve(tokenState.token);
                },
                error_callback: (e) => { clearTimeout(timer); reject(new DriveAuthError(e && e.type === "popup_closed" ? "החלון נסגר לפני שהסתיימה ההתחברות" : "ההתחברות ל-Google נכשלה")); },
            });
            client.requestAccessToken({ prompt: interactive ? "" : "none" });
        } catch (e) { reject(e); }
    });
}

let allowInteractive = false; // נדלק רק בתוך פעולה שהמשתמש התחיל
async function getToken() {
    if (tokenState.token && tokenState.expiresAt - 60000 > Date.now()) return tokenState.token;
    return requestToken({ interactive: allowInteractive });
}
async function withInteractive(fn) {
    allowInteractive = true;
    try { return await fn(); } finally { allowInteractive = false; }
}

// טוקן Drive לבורר הקבצים (נקרא מתוך לחיצה של המשתמש, ולכן מותר להציג חלון התחברות)
export async function getDriveAccessToken() { return withInteractive(() => getToken()); }

// ---- אדפטרים למסד המקומי ----
async function getStores() {
    const out = {};
    for (const name of Object.keys(STORES)) {
        const rows = await dbGetAll(name);
        out[name] = name === "settings" ? rows.filter((r) => !LOCAL_ONLY(r.key)) : rows;
    }
    return out;
}

let restoring = false;
async function setStores(stores) {
    // מוודאים שהכול תקין לפני שמוחקים (unpack כבר בדק מבנה); שומרים הגדרות מקומיות
    const keep = (await dbGetAll("settings")).filter((r) => LOCAL_ONLY(r.key));
    const prepared = {};
    for (const [name, rows] of Object.entries(stores)) {
        if (!STORES[name] || !Array.isArray(rows)) continue;
        prepared[name] = rows.filter((row) => !(name === "settings" && LOCAL_ONLY(row.key)));
    }
    prepared.settings = (prepared.settings || []).concat(keep);
    restoring = true;
    try {
        await dbReplaceAll(prepared); // אטומי: כשל באמצע לא משאיר מסד חצי-ריק
    } finally { restoring = false; }
}

const settingsAdapter = { get: (k) => getSetting(k), set: (k, v) => setSetting(k, v) };
const drive = createDrive({ getToken });
const cloud = createCloud({ drive, getStores, setStores, settings: settingsAdapter, meta: () => ({ app: "KitchenCostPro", app_version: APP_VERSION }) });

// ---- סטטוס ----
const status = { state: "idle", message: "", lastBackup: null, enabled: false };
const emit = () => window.dispatchEvent(new CustomEvent("kcp-cloud-status", { detail: { ...status } }));
function setState(state, message = "") { status.state = state; status.message = message; emit(); }
export function getCloudStatus() { return { ...status }; }
async function refreshStatus() {
    status.enabled = !!(await getSetting("cloud_enabled"));
    status.lastBackup = await getSetting("cloud_last_backup");
}

// ---- גיבוי אוטומטי ----
let timer = null;
async function markDirty() {
    if (!status.enabled) return;
    await setSetting("cloud_dirty", true);
    clearTimeout(timer);
    timer = setTimeout(() => runBackup({ auto: true }), DEBOUNCE_MS);
}
export async function runBackup({ auto = false, force = false, interactive = false } = {}) {
    await refreshStatus();
    if (!status.enabled) return { skipped: true };
    if (status.state === "backing") return { skipped: true };
    setState("backing");
    try {
        const res = await (interactive ? withInteractive(() => cloud.backup({ force })) : cloud.backup({ force }));
        if (res && res.skipped) { setState("idle"); return res; }
        await setSetting("cloud_dirty", false);
        await refreshStatus();
        setState("idle");
        if (cloud.needsAgain()) markDirty();
        return res;
    } catch (e) {
        if (e instanceof CloudConflict) { setState("conflict", e.message); return { conflict: true }; }
        if (e instanceof DriveAuthError) { setState("needs-auth", e.message); return { needsAuth: true }; }
        logError("cloud-backup", e);
        setState("error", e.message || "הגיבוי נכשל");
        if (!auto) throw e;
        return { error: e };
    }
}

// ---- פעולות למסכים ----
// מחבר חשבון: מחזיר { exists, modifiedTime } (האם כבר יש גיבוי בענן) כדי שהמסך ישאל מה לעשות
export async function connectCloud() {
    const info = await withInteractive(() => cloud.connect());
    await refreshStatus();
    emit();
    return info;
}
export async function disconnectCloud() {
    await cloud.disconnect();
    tokenState = { token: null, expiresAt: 0 };
    await refreshStatus();
    setState("idle");
}
export async function restoreFromCloud() {
    const res = await withInteractive(() => cloud.restore());
    await setSetting("cloud_dirty", false);
    await refreshStatus();
    setState("idle"); // הנתונים עכשיו זהים לענן: מנקה התנגשות/שגיאה קודמת
    return res;
}
export async function localHasData() {
    for (const n of ["pantryItems", "recipes", "invoices", "dishes"]) if ((await dbGetAll(n)).length) return true;
    return false;
}

export async function initCloud() {
    await refreshStatus();
    onDbChange((store) => { if (!restoring) markDirty(); });
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden" && status.enabled && timer) { clearTimeout(timer); runBackup({ auto: true }); }
    });
    if (status.enabled && (await getSetting("cloud_dirty"))) runBackup({ auto: true });
    emit();
}
