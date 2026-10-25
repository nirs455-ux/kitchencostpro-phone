// שכבת נתונים - IndexedDB בתוך הטלפון. מקביל ל-pantry.db (SQLite) של הגרסה הקיימת,
// אבל עצמאי לגמרי - שתי הגרסאות לא מסונכרנות זו עם זו (ראה ייצוא/ייבוא).

const DB_NAME = "kitchencostpro";
const DB_VERSION = 4; // 2: נוסף מאגר scanQueue (תור סריקות שממתינות לעיבוד). 3: נוסף wasteLogs (פחת / זריקות). 4: נוסף salesLines (דוח מכירות)

const STORES = {
    pantryItems: "id",
    recipes: "id",
    recipeItems: "id",
    dishes: "id",
    dishItems: "id",
    suppliers: "id",
    invoices: "id",
    invoiceItems: "id",
    inventoryCounts: "id",
    wasteLogs: "id",
    salesLines: "id", // שורות דוח מכירות: { report_date, source_type: dish|recipe, source_id, source_name, quantity, line_type }
    settings: "key",
};

// מאגרים שאינם חלק מהגיבוי/ייבוא (זמניים): תור סריקות
const EXTRA_STORES = { scanQueue: "id" };

let dbPromise = null;

export function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            for (const [name, keyPath] of Object.entries(STORES)) {
                if (!db.objectStoreNames.contains(name)) {
                    db.createObjectStore(name, { keyPath, autoIncrement: keyPath === "id" });
                }
            }
            for (const [name, keyPath] of Object.entries(EXTRA_STORES)) {
                if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath, autoIncrement: true });
            }
            // אינדקסים לשאילתות נפוצות (נוצרים רק אם עוד לא קיימים - חשוב בשדרוג מגרסה קודמת)
            const tx = req.transaction;
            const ensureIndex = (store, name) => {
                const os = tx.objectStore(store);
                if (!os.indexNames.contains(name)) os.createIndex(name, name);
            };
            ensureIndex("recipeItems", "recipe_id");
            ensureIndex("dishItems", "dish_id");
            ensureIndex("invoices", "supplier_id");
            ensureIndex("invoiceItems", "invoice_id");
            ensureIndex("invoiceItems", "pantry_item_id");
            ensureIndex("inventoryCounts", "pantry_item_id");
            ensureIndex("pantryItems", "parent_id");
            ensureIndex("salesLines", "report_date");
        };
        req.onsuccess = () => {
            const db = req.result;
            // אם עדכון גרסה מגיע מלשונית/חלון אחר - סוגרים את החיבור כדי שהשדרוג לא ייתקע
            db.onversionchange = () => { db.close(); dbPromise = null; };
            resolve(db);
        };
        req.onblocked = () => { console.warn("שדרוג מסד הנתונים ממתין - סגור לשוניות אחרות של האפליקציה"); try { window.dispatchEvent(new CustomEvent("kcp-db-blocked")); } catch (e) { /* לא קריטי */ } };
        req.onerror = () => reject(req.error);
    });
    return dbPromise;
}

// מאזינים לשינויים בנתונים (לגיבוי אוטומטי לענן). לא מדווח על הגדרות ועל תור הסריקות (זמניים).
const changeListeners = new Set();
export function onDbChange(fn) { changeListeners.add(fn); return () => changeListeners.delete(fn); }
function notify(storeName) {
    if (storeName === "settings" || storeName === "scanQueue") return;
    for (const fn of changeListeners) { try { fn(storeName); } catch (e) { /* מאזין שנכשל לא מפיל כתיבה */ } }
}

function tx(db, storeName, mode) {
    return db.transaction(storeName, mode).objectStore(storeName);
}

export async function dbGetAll(storeName) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const req = tx(db, storeName, "readonly").getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

export async function dbGetByIndex(storeName, indexName, value) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const req = tx(db, storeName, "readonly").index(indexName).getAll(value);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

export async function dbGet(storeName, key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const req = tx(db, storeName, "readonly").get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

export async function dbPut(storeName, value) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const req = tx(db, storeName, "readwrite").put(value);
        req.onsuccess = () => { notify(storeName); resolve(req.result); };
        req.onerror = () => reject(req.error);
    });
}

export async function dbDelete(storeName, key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const req = tx(db, storeName, "readwrite").delete(key);
        req.onsuccess = () => { notify(storeName); resolve(); };
        req.onerror = () => reject(req.error);
    });
}

export async function dbDeleteWhere(storeName, indexName, value) {
    const rows = await dbGetByIndex(storeName, indexName, value);
    for (const row of rows) {
        await dbDelete(storeName, row.id);
    }
}

export async function dbClearAll() {
    const db = await openDB();
    return Promise.all(
        Object.keys(STORES).map(
            (name) =>
                new Promise((resolve, reject) => {
                    const req = tx(db, name, "readwrite").clear();
                    req.onsuccess = () => resolve();
                    req.onerror = () => reject(req.error);
                })
        )
    );
}

// מחליף את כל הנתונים בטרנזקציה אחת: או שהכול מוחלף או שכלום לא משתנה (כשל באמצע = ביטול מלא, הנתונים הישנים נשארים).
// stores = { שם_מאגר: [שורות] }
export async function dbReplaceAll(stores) {
    const db = await openDB();
    const names = Object.keys(STORES);
    await new Promise((resolve, reject) => {
        const t = db.transaction(names, "readwrite");
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error || new Error("השחזור בוטל, הנתונים הקיימים לא שונו"));
        try {
            for (const name of names) {
                const os = t.objectStore(name);
                os.clear();
                for (const row of stores[name] || []) os.put(row);
            }
        } catch (e) { try { t.abort(); } catch (e2) { /* כבר בוטל */ } reject(e); }
    });
    for (const name of names) notify(name);
}

export { STORES };
