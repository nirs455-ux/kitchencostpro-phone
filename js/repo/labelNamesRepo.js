// "שם בתווית" לכל מוצר חומרי גלם (למשל "שום שלם 4 יחידות" -> "שום"). נשמר בהגדרות, מחוץ לטבלת חומרי הגלם, ולכן נכלל בגיבוי בלי שינוי מבנה מסד.
import { getSetting, setSetting } from "./settingsRepo.js";

const KEY = "label_names";

export async function getLabelNames() {
    const v = await getSetting(KEY);
    return v && typeof v === "object" ? v : {};
}

// name ריק = מחיקת השם הידני (חוזרים לשם הנקי האוטומטי)
export async function setLabelName(pantryId, name) {
    const all = await getLabelNames();
    const clean = String(name || "").trim().slice(0, 80);
    if (clean) all[pantryId] = clean; else delete all[pantryId];
    await setSetting(KEY, all);
    return all;
}
