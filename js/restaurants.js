// מסעדות: מקום עבודה נפרד לכל מסעדה, עם מסד נתונים משלה (IndexedDB). הרשימה נשמרת ב-localStorage, מחוץ לכל מסעדה.
// המסעדה הראשונה משתמשת במסד הקיים (kitchencostpro) בלי שום העברת נתונים. מסעדות נוספות מקבלות מסד חדש לפי המזהה שלהן.
export const FIRST_ID = "r1";
export const FIRST_DB = "kitchencostpro";
export const FIRST_NAME = "המסעדה שלי";
const REG = "kcp_restaurants", ACT = "kcp_active_restaurant";

export const dbNameOf = (id) => (id === FIRST_ID ? FIRST_DB : `kitchencostpro_${id}`);
const validId = (id) => typeof id === "string" && /^[a-z0-9]{1,12}$/.test(id);
const safeStorage = () => { try { return globalThis.localStorage || null; } catch (e) { return null; } };

export function readRegistry(storage = safeStorage()) {
    let list = [];
    try { list = JSON.parse((storage && storage.getItem(REG)) || "[]"); } catch (e) { list = []; }
    list = (Array.isArray(list) ? list : []).filter((r) => r && validId(r.id)).map((r) => ({ id: r.id, name: String(r.name || "").trim(), fav: !!r.fav, dbName: dbNameOf(r.id) }));
    if (!list.some((r) => r.id === FIRST_ID)) list.unshift({ id: FIRST_ID, name: "", fav: false, dbName: FIRST_DB });
    let active = "";
    try { active = (storage && storage.getItem(ACT)) || ""; } catch (e) { active = ""; }
    if (!list.some((r) => r.id === active)) active = FIRST_ID;
    return { list, activeId: active };
}

function write(storage, list, activeId) {
    if (!storage) return;
    storage.setItem(REG, JSON.stringify(list.map(({ id, name, fav }) => ({ id, name, fav }))));
    storage.setItem(ACT, activeId);
}

export const displayName = (r) => (r && r.name) || (r && r.id === FIRST_ID ? FIRST_NAME : "מסעדה");
export const activeRestaurant = (storage) => { const { list, activeId } = readRegistry(storage); return list.find((r) => r.id === activeId); };
export const activeDbName = (storage) => activeRestaurant(storage).dbName;

// רשימה לתצוגה: מועדפות קודם, אחר כך לפי שם
export function sortedList(list) {
    return [...list].sort((a, b) => (b.fav ? 1 : 0) - (a.fav ? 1 : 0) || displayName(a).localeCompare(displayName(b), "he"));
}

const newId = () => Math.random().toString(36).slice(2, 8);

// מוסיף מסעדה. id אופציונלי (שחזור מדרייב משתמש במזהה שנשמר שם). לא משנה את המסעדה הפעילה
export function addRestaurant(name, { storage = safeStorage(), id = "", rnd = newId } = {}) {
    const { list, activeId } = readRegistry(storage);
    let rid = id;
    if (rid) { if (!validId(rid)) throw new Error("מזהה מסעדה לא תקין"); if (list.some((r) => r.id === rid)) return list.find((r) => r.id === rid); }
    else { do { rid = rnd(); } while (!/^[a-z0-9]{3,12}$/.test(rid) || rid === FIRST_ID || list.some((r) => r.id === rid)); }
    const r = { id: rid, name: String(name || "").trim(), fav: false, dbName: dbNameOf(rid) };
    write(storage, [...list, r], activeId);
    return r;
}

export function renameRestaurant(id, name, storage = safeStorage()) {
    const { list, activeId } = readRegistry(storage);
    write(storage, list.map((r) => (r.id === id ? { ...r, name: String(name || "").trim() } : r)), activeId);
}
export function setFavorite(id, fav, storage = safeStorage()) {
    const { list, activeId } = readRegistry(storage);
    write(storage, list.map((r) => (r.id === id ? { ...r, fav: !!fav } : r)), activeId);
}
export function setActiveRestaurant(id, storage = safeStorage()) {
    const { list } = readRegistry(storage);
    if (!list.some((r) => r.id === id)) throw new Error("מסעדה לא נמצאה");
    write(storage, list, id);
}
// מסירה מהרשימה בלבד (מחיקת המסד היא פעולה נפרדת). אי אפשר להסיר את הפעילה ואת הראשונה
export function removeRestaurant(id, storage = safeStorage()) {
    const { list, activeId } = readRegistry(storage);
    if (id === FIRST_ID) throw new Error("אי אפשר למחוק את המסעדה הראשונה");
    if (id === activeId) throw new Error("אי אפשר למחוק את המסעדה הפעילה. עבור קודם למסעדה אחרת");
    write(storage, list.filter((r) => r.id !== id), activeId);
}

// שם תיקייה בדרייב למסעדה: "שם [מזהה]". המזהה קבוע גם אם משנים שם
export const cloudFolderName = (r) => `${displayName(r).replace(/[\\/:*?"<>|\[\]]/g, " ").replace(/\s+/g, " ").trim() || "מסעדה"} [${r.id}]`;
export const RESTAURANTS_FOLDER = "מסעדות";
export function cloudRootPath(r) { return r.id === FIRST_ID ? ["KitchenCostPro"] : ["KitchenCostPro", RESTAURANTS_FOLDER, cloudFolderName(r)]; }
export function parseCloudFolderName(name) { const m = /^(.*) \[([a-z0-9]{3,12})\]$/.exec(String(name || "")); return m ? { name: m[1].trim(), id: m[2] } : null; }
