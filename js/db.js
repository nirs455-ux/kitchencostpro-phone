// שכבת נתונים - IndexedDB בתוך הטלפון. מקביל ל-pantry.db (SQLite) של הגרסה הקיימת,
// אבל עצמאי לגמרי - שתי הגרסאות לא מסונכרנות זו עם זו (ראה ייצוא/ייבוא).

const DB_NAME = "kitchencostpro";
const DB_VERSION = 1;

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
    settings: "key",
};

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
            // אינדקסים לשאילתות נפוצות
            const tx = req.transaction;
            tx.objectStore("recipeItems").createIndex("recipe_id", "recipe_id");
            tx.objectStore("dishItems").createIndex("dish_id", "dish_id");
            tx.objectStore("invoices").createIndex("supplier_id", "supplier_id");
            tx.objectStore("invoiceItems").createIndex("invoice_id", "invoice_id");
            tx.objectStore("invoiceItems").createIndex("pantry_item_id", "pantry_item_id");
            tx.objectStore("inventoryCounts").createIndex("pantry_item_id", "pantry_item_id");
            tx.objectStore("pantryItems").createIndex("parent_id", "parent_id");
        };
        req.onsuccess = () => resolve(req.result);
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
