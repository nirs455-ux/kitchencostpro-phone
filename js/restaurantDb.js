// הקמת מסד נתונים למסעדה חדשה: תוספים שנבחרו, ואופציונלית העתקה ממסעדה קיימת.
// ההעתקה כוללת חומרי גלם, מתכונים, מנות וספקים (בלי היסטוריית הזמנות). חשבוניות, ספירות, מכירות, פחת וסרוויסים לא מועתקים.
import { openDBByName } from "./db.js";

export const COPY_STORES = ["pantryItems", "recipes", "recipeItems", "dishes", "dishItems", "suppliers"];

const getAll = (db, store) => new Promise((resolve, reject) => { const r = db.transaction(store, "readonly").objectStore(store).getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
const putAll = (db, store, rows) => new Promise((resolve, reject) => {
    const t = db.transaction(store, "readwrite");
    const os = t.objectStore(store);
    for (const r of rows) os.put(r);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error("הכתיבה בוטלה"));
});

// מעתיק שורות של מסעדה אחרת, כשהספקים נשארים בלי היסטוריית הזמנות
export function rowsToCopy(store, rows) {
    return store === "suppliers" ? rows.map((s) => ({ ...s, order_history: [] })) : rows;
}

export async function prepareNewDb(dbName, { addons = [], copyFromDb = null } = {}) {
    const db = await openDBByName(dbName);
    try {
        await putAll(db, "settings", [
            { key: "addons", value: addons }, { key: "setup_done", value: true },
            { key: "addon_adv_seen", value: true }, { key: "addon_split_seen", value: true },
        ]);
        if (copyFromDb) {
            const src = await openDBByName(copyFromDb);
            try { for (const store of COPY_STORES) await putAll(db, store, rowsToCopy(store, await getAll(src, store))); } finally { src.close(); }
        }
    } finally { db.close(); }
}
