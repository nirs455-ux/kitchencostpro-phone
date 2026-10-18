// ייצוא/ייבוא - הגיבוי היחיד לנתונים, כי אין שרת ואין סנכרון אוטומטי.
import { STORES, dbGetAll, dbClearAll, dbPut } from "./db.js";
import { blobToDataUrl, dataUrlToBlob } from "./imageUtil.js";
import { setSetting } from "./repo/settingsRepo.js";

// הגדרות של חיבור הענן שייכות למכשיר ולא עוברות בגיבוי ידני (ולא נדרסות בייבוא)
const DEVICE_ONLY = (k) => String(k).startsWith("cloud_") || k === "google_client_id";

export async function exportAllData() {
    const data = { exported_at: new Date().toISOString(), version: 1, stores: {} };
    for (const name of Object.keys(STORES)) {
        const rows = await dbGetAll(name);
        // תמונות חשבוניות (Blob) נשמרות בגיבוי כ-data URL
        if (name === "invoices") {
            for (const r of rows) {
                if (r.image instanceof Blob) r.image = { __image: await blobToDataUrl(r.image) };
            }
        }
        if (name === "recipes") {
            for (const r of rows) {
                if (r.source_file instanceof Blob) r.source_file = { __image: await blobToDataUrl(r.source_file) };
            }
        }
        data.stores[name] = name === "settings" ? rows.filter((r) => !DEVICE_ONLY(r.key)) : rows;
    }
    return data;
}

export async function downloadExport() {
    const data = await exportAllData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `kitchencostpro-backup-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    await setSetting("last_export", new Date().toISOString());
}

// מחליף את כל הנתונים הקיימים באלה שבקובץ הגיבוי. פעולה הרסנית - קוראים לה רק אחרי אישור מהמשתמש.
export async function importAndReplace(fileText) {
    const data = JSON.parse(fileText);
    if (!data || !data.stores) {
        throw new Error("קובץ לא תקין - זה לא קובץ גיבוי של KitchenCostPro");
    }
    // קודם ממירים ומאמתים את כל השורות (כולל תמונות); רק אם הכול תקין מוחקים את הנתונים הקיימים
    const prepared = [];
    for (const [name, rows] of Object.entries(data.stores)) {
        if (!STORES[name]) continue;
        if (!Array.isArray(rows)) throw new Error(`קובץ גיבוי פגום (${name})`);
        for (const row of rows) {
            if (name === "settings" && DEVICE_ONLY(row.key)) continue;
            if (name === "invoices" && row.image && row.image.__image) row.image = dataUrlToBlob(row.image.__image);
            if (name === "recipes" && row.source_file && row.source_file.__image) row.source_file = dataUrlToBlob(row.source_file.__image);
            prepared.push([name, row]);
        }
    }
    const keep = (await dbGetAll("settings")).filter((r) => DEVICE_ONLY(r.key));
    await dbClearAll();
    for (const [name, row] of prepared) await dbPut(name, row);
    for (const r of keep) await dbPut("settings", r);
}
