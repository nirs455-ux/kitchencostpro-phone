import { dbGet, dbPut } from "../db.js";
import { SHARED_DEVICE_KEYS } from "../deviceSettings.js";

// הגדרות מכשיר (שפה, מטבע, חיבור Google ועוד) משותפות לכל המסעדות: נקראות מ-localStorage, עם נפילה למסד בהפעלה הראשונה
const LS = "kcp_dev_";
const lsGet = (k) => { try { const v = localStorage.getItem(LS + k); return v == null ? undefined : JSON.parse(v); } catch (e) { return undefined; } };
const lsSet = (k, v) => { try { localStorage.setItem(LS + k, JSON.stringify(v)); return true; } catch (e) { return false; } };

export async function getSetting(key, fallback = null) {
    if (SHARED_DEVICE_KEYS.has(key)) {
        const v = lsGet(key);
        if (v !== undefined) return v;
        const row = await dbGet("settings", key);
        if (row) { lsSet(key, row.value); return row.value; }
        return fallback;
    }
    const row = await dbGet("settings", key);
    return row ? row.value : fallback;
}

export async function setSetting(key, value) {
    if (SHARED_DEVICE_KEYS.has(key)) lsSet(key, value);
    await dbPut("settings", { key, value });
}
