// תוספות (add-ons): כל משתמש בוחר אילו יכולות הוא רוצה, ומה שכבוי נעלם מהמסכים. הנתונים לא נמחקים, והפעלה מחדש מחזירה הכול.
// בסיס שתמיד פעיל: בית, חומרי גלם, מתכונים, מנות, פחת, ספקים והזמנות, שפות. הגיבוי לקובץ ידני תמיד זמין.
import { dbGetAll } from "./db.js";
import { getSetting, setSetting } from "./repo/settingsRepo.js";

export const ADDONS = [
    { key: "count", icon: "📋", label: "ספירת מלאי", desc: "ספירה, דף ספירה להדפסה, צילום דף והקראה בקול, והתראת ספירה בבית." },
    { key: "prep", icon: "📝", label: "מיז אן פלאס", desc: "תפריט וסועדים: מה להכין ומה להזמין, צ'ק ליסט להדפסה ולשליחה לטבחים." },
    { key: "sales", icon: "📈", label: "מכירות ודוח סטיות", desc: "דיווח מכירות, צריכה תיאורטית מול ספירה בפועל." },
    { key: "scan", icon: "🧾", label: "סריקת חשבוניות והנהלת חשבונות", desc: "צילום חשבונית שנקראת אוטומטית, וייצוא לאקסל." },
    { key: "nutrition", icon: "🥗", label: "תזונה ואלרגנים", desc: "אלרגנים וערכים תזונתיים למתכונים (USDA, ברקוד, צילום תווית)." },
    { key: "producer", icon: "🏭", label: "יצרן ומדבקות", desc: "מוצרים באריזה ומדבקות להדפסה." },
    { key: "cloud", icon: "☁️", label: "גיבוי לענן", desc: "גיבוי אוטומטי ל-Google Drive וסנכרון בין מכשירים." },
];
export const ADDON_KEYS = ADDONS.map((a) => a.key);
const SETTING = "addons";

// משתמש חדש (בלי נתונים) מתחיל נקי. משתמש שכבר עובד עם המערכת לא מאבד כלום: כל מה שהיה גלוי נשאר גלוי.
export function initialAddons({ hasData, producerMode = false } = {}) {
    const on = hasData ? new Set(ADDON_KEYS.filter((k) => k !== "producer")) : new Set(); // יצרן היה תמיד אופציונלי: פעיל רק למי שהפעיל אותו
    if (producerMode) on.add("producer");
    return on;
}

// ערך שמור (מגיבוי ישן/פגום) -> קבוצה תקינה של מפתחות מוכרים בלבד
export function parseAddons(raw) {
    if (!Array.isArray(raw)) return null;
    return new Set(raw.filter((k) => ADDON_KEYS.includes(k)));
}

let enabled = null; // Set אחרי הטעינה. לפני כן הכול מוצג (כדי לא להסתיר דבר בטעות)
export const addonOn = (key) => (enabled ? enabled.has(key) : true);
export const enabledAddons = () => (enabled ? [...enabled] : [...ADDON_KEYS]);

export async function loadAddons() {
    const stored = parseAddons(await getSetting(SETTING, null));
    if (stored) { enabled = stored; return enabled; }
    let hasData = false;
    try { hasData = (await dbGetAll("pantryItems")).length + (await dbGetAll("recipes")).length + (await dbGetAll("invoices")).length > 0; } catch (e) { hasData = true; }
    enabled = initialAddons({ hasData, producerMode: !!(await getSetting("producer_mode")) });
    await setSetting(SETTING, [...enabled]);
    return enabled;
}

export async function setAddon(key, on) {
    if (!ADDON_KEYS.includes(key)) return;
    if (!enabled) await loadAddons();
    if (on) enabled.add(key); else enabled.delete(key);
    await setSetting(SETTING, [...enabled]);
    if (key === "producer") { // המתג הישן של מודול יצרן נשאר מסונכרן
        await setSetting("producer_mode", !!on);
        if (!on && (await getSetting("role")) === "producer") await setSetting("role", "manager");
    }
    document.dispatchEvent(new CustomEvent("kcp-addons"));
}

// שחזור מגיבוי עשוי להחליף את ההגדרה: טוענים מחדש
export function resetAddonsCache() { enabled = null; }
