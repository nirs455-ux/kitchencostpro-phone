import { dbGet, dbPut } from "../db.js";

export async function getSetting(key, fallback = null) {
    const row = await dbGet("settings", key);
    return row ? row.value : fallback;
}

export async function setSetting(key, value) {
    await dbPut("settings", { key, value });
}
