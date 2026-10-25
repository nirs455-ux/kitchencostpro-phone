// ייצוא/ייבוא - הגיבוי היחיד לנתונים, כי אין שרת ואין סנכרון אוטומטי.
import { STORES, dbGetAll, dbReplaceAll } from "./db.js";
import { blobToDataUrl, dataUrlToBlob } from "./imageUtil.js";
import { setSetting } from "./repo/settingsRepo.js";

// הגדרות של חיבור הענן שייכות למכשיר ולא עוברות בגיבוי ידני (ולא נדרסות בייבוא)
const DEVICE_ONLY = (k) => String(k).startsWith("cloud_") || k === "google_client_id";

// images=false: גיבוי קל בלי תמונות חשבוניות וקבצי מקור של מתכונים (כל שאר הנתונים נשמרים)
export async function exportAllData({ images = true } = {}) {
    const data = { exported_at: new Date().toISOString(), version: 1, images, stores: {} };
    for (const name of Object.keys(STORES)) {
        const rows = await dbGetAll(name);
        // תמונות חשבוניות (Blob) נשמרות בגיבוי כ-data URL
        if (name === "invoices") {
            for (const r of rows) {
                if (!images) delete r.image;
                else if (r.image instanceof Blob) r.image = { __image: await blobToDataUrl(r.image) };
            }
        }
        if (name === "recipes") {
            for (const r of rows) {
                if (!images) delete r.source_file;
                else if (r.source_file instanceof Blob) r.source_file = { __image: await blobToDataUrl(r.source_file) };
            }
        }
        data.stores[name] = name === "settings" ? rows.filter((r) => !DEVICE_ONLY(r.key)) : rows;
    }
    return data;
}

function saveJsonFile(data, filename) {
    const blob = new Blob([JSON.stringify(data)], { type: "application/json" }); // בלי רווחים: קובץ קטן יותר
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export async function downloadExport({ images = true } = {}) {
    const data = await exportAllData({ images });
    const stamp = new Date().toISOString().slice(0, 10);
    saveJsonFile(data, `kitchencostpro-backup-${stamp}${images ? "" : "-no-images"}.json`);
    await setSetting("last_export", new Date().toISOString());
}

// עותק ביטחון של המצב הנוכחי, נשמר לפני שחזור/ייבוא (לא מעדכן את "גיבוי אחרון")
export async function downloadSafetyCopy() {
    const data = await exportAllData({ images: true });
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    saveJsonFile(data, `kitchencostpro-before-restore-${stamp}.json`);
}

// בודק קובץ גיבוי ומחזיר סיכום (בלי לשנות כלום), כדי להראות למשתמש מה עומד להיכנס
export function inspectBackup(fileText) {
    let data;
    try { data = JSON.parse(fileText); } catch (e) { throw new Error("הקובץ אינו קובץ גיבוי תקין (לא ניתן לקרוא אותו)"); }
    if (!data || typeof data !== "object" || !data.stores || typeof data.stores !== "object") {
        throw new Error("קובץ לא תקין - זה לא קובץ גיבוי של KitchenCostPro");
    }
    const count = (n) => (Array.isArray(data.stores[n]) ? data.stores[n].length : 0);
    return { data, pantry: count("pantryItems"), recipes: count("recipes"), dishes: count("dishes"), exportedAt: data.exported_at || "", noImages: data.images === false };
}

// מחליף את כל הנתונים הקיימים באלה שבקובץ הגיבוי. פעולה הרסנית - קוראים לה רק אחרי אישור מהמשתמש.
// ההחלפה אטומית: אם משהו נכשל באמצע, הנתונים הקיימים נשארים כמו שהיו.
export async function importAndReplace(fileText) {
    const { data } = inspectBackup(fileText);
    // קודם ממירים ומאמתים את כל השורות (כולל תמונות); רק אם הכול תקין מחליפים את הנתונים הקיימים
    const prepared = {};
    for (const [name, rows] of Object.entries(data.stores)) {
        if (!STORES[name]) continue;
        if (!Array.isArray(rows)) throw new Error(`קובץ גיבוי פגום (${name})`);
        prepared[name] = [];
        for (const row of rows) {
            if (!row || typeof row !== "object") throw new Error(`קובץ גיבוי פגום (${name})`);
            if (name === "settings" && DEVICE_ONLY(row.key)) continue;
            if (name === "invoices" && row.image && row.image.__image) row.image = dataUrlToBlob(row.image.__image);
            if (name === "recipes" && row.source_file && row.source_file.__image) row.source_file = dataUrlToBlob(row.source_file.__image);
            prepared[name].push(row);
        }
    }
    prepared.settings = (prepared.settings || []).concat((await dbGetAll("settings")).filter((r) => DEVICE_ONLY(r.key)));
    try { await dbReplaceAll(prepared); }
    catch (e) { throw new Error("השחזור נכשל והנתונים הקיימים לא שונו. ייתכן שהקובץ פגום או שחסר בו מידע."); }
}
