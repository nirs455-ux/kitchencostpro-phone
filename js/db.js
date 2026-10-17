// שכבת נתונים - IndexedDB בתוך הטלפון. מקביל ל-pantry.db (SQLite) של הגרסה הקיימת,
// אבל עצמאי לגמרי - שתי הגרסאות לא מסונכרנות זו עם זו (ראה ייצוא/ייבוא).

const DB_NAME = "kitchencostpro";
const DB_VERSION = 3; // 2: נוסף מאגר scanQueue (תור סריקות שממתינות לעיבוד). 3: נוסף wasteLogs (פחת / זריקות)

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
        };
        req.onsuccess = () => {
            const db = req.result;
            // אם עדכון גרסה מגיע מלשונית/חלון אחר - סוגרים את החיבור כדי שהשדרוג לא ייתקע
            db.onversionchange = () => { db.close(); dbPromise = null; };
            resolve(db);
        };
        req.onblocked = () => console.warn("שדרוג מסד הנתונים ממתין - סגור לשוניות אחרות של האפליקציה");
        req.onerror = () => reject(req.error);
    });
    return dbPromise;
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
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

export async function dbDelete(storeName, key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const req = tx(db, storeName, "readwrite").delete(key);
        req.onsuccess = () => resolve();
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

export { STORES };
