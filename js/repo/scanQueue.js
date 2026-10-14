// תור סריקות: תמונות שלא הצלחנו לעבד (אין חיבור / השרת עמוס) נשמרות כאן ומעובדות מאוחר יותר.
import { dbGetAll, dbPut, dbDelete } from "../db.js";

export async function addToQueue(blob) {
    return dbPut("scanQueue", { blob, created_at: new Date().toISOString() });
}

export async function listQueue() {
    const rows = await dbGetAll("scanQueue");
    return rows.sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""));
}

export async function removeFromQueue(id) {
    await dbDelete("scanQueue", id);
}
