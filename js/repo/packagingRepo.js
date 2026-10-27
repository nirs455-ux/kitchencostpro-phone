// רשימת אריזות של מודול היצרן (צנצנות, מכסים, קופסאות, שקיות, מדבקות). נפרדת מחומרי הגלם הכללי.
// נשמר בטבלת ההגדרות (כמו מוצרי היצרן), ולכן נכלל בגיבוי בלי שינוי מבנה מסד. מחיר תמיד ליחידה אחת.
import { getSetting, setSetting } from "./settingsRepo.js";

const KEY = "producer_packaging";

export const PACK_CATEGORIES = ["צנצנות ובקבוקים", "מכסים וסגרים", "קופסאות ומגשים", "שקיות ועטיפות", "מדבקות ותוויות", "אחר"];
export const PACK_ICONS = { "צנצנות ובקבוקים": "🫙", "מכסים וסגרים": "⭕", "קופסאות ומגשים": "📦", "שקיות ועטיפות": "🛍", "מדבקות ותוויות": "🏷", "אחר": "📎" };

export async function listPackaging() {
    const v = await getSetting(KEY);
    return Array.isArray(v) ? v : [];
}

// מנקה ומאמת אריזה. שגיאה בעברית אם חסר שם או מחיר תקין. מחיר 0 מותר (למשל אריזה שמתקבלת בחינם).
export function cleanPackagingItem(p) {
    const name = String(p.name || "").trim();
    if (!name) throw new Error("יש להזין שם לאריזה");
    const category = PACK_CATEGORIES.includes(p.category) ? p.category : "אחר";
    const price = parseFloat(String(p.price ?? "").replace(",", "."));
    if (!Number.isFinite(price) || price < 0) throw new Error("יש להזין מחיר תקין ליחידה אחת");
    if (price > 100000) throw new Error("המחיר גבוה מדי - בדוק שלא הוזן מספר שגוי");
    return { id: p.id || Date.now(), name, category, price: Math.round(price * 10000) / 10000 };
}

export async function savePackagingItem(p) {
    const clean = cleanPackagingItem(p);
    const list = await listPackaging();
    const key = clean.name.toLowerCase();
    if (list.some((x) => x.id !== clean.id && x.name.trim().toLowerCase() === key)) throw new Error("כבר קיימת אריזה בשם הזה");
    const i = list.findIndex((x) => x.id === clean.id);
    if (i >= 0) list[i] = clean; else list.push(clean);
    await setSetting(KEY, list);
    return clean;
}

export async function deletePackagingItem(id) {
    await setSetting(KEY, (await listPackaging()).filter((x) => x.id !== id));
}
