// הניצולת האחרונה שהוזנה בשורה לכל מוצר: מוצעת בהקשה אחת בשורה הבאה (מתכון או מנה). לא משנה את המוצר ואת העלויות שלו.
import { getSetting, setSetting } from "./settingsRepo.js";

const KEY = "last_line_yield";

export async function getLastYields() {
    return (await getSetting(KEY, {})) || {};
}

// map: האובייקט שנטען לחלון, מתעדכן מיד כדי ששורה נוספת תציע את אותו מספר
export async function rememberYield(map, pantryId, pct) {
    if (!(pct > 0 && pct < 100)) return;
    map[pantryId] = pct;
    const all = await getLastYields();
    all[pantryId] = pct;
    await setSetting(KEY, all);
}
