// ייצוא/ייבוא - הגיבוי היחיד לנתונים, כי אין שרת ואין סנכרון אוטומטי.
import { STORES, dbGetAll, dbClearAll, dbPut } from "./db.js";

export async function exportAllData() {
    const data = { exported_at: new Date().toISOString(), version: 1, stores: {} };
    for (const name of Object.keys(STORES)) {
        data.stores[name] = await dbGetAll(name);
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
}

// מחליף את כל הנתונים הקיימים באלה שבקובץ הגיבוי. פעולה הרסנית - קוראים לה רק אחרי אישור מהמשתמש.
export async function importAndReplace(fileText) {
    const data = JSON.parse(fileText);
    if (!data || !data.stores) {
        throw new Error("קובץ לא תקין - זה לא קובץ גיבוי של KitchenCostPro");
    }
    await dbClearAll();
    for (const [name, rows] of Object.entries(data.stores)) {
        if (!STORES[name]) continue;
        for (const row of rows) {
            await dbPut(name, row);
        }
    }
}
