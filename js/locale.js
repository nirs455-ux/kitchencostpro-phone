// הגדרות אזור: מדינה ← מטבע, מערכת יחידות ורשימת אלרגנים אזורית. נקבע באשף ההפעלה ואפשר לשנות בהגדרות.
// הנתונים נשמרים תמיד בגרמים ובמספרים; רק התצוגה משתנה. רשימת האלרגנים האזורית משמשת רק את המתכון ומודול היצרן.
import { getSetting, setSetting } from "./repo/settingsRepo.js";
import { setCurrencySymbol } from "./ui.js";
import { setQtyMode } from "./qty.js";

export const CURRENCIES = {
    ILS: { symbol: "₪", label: "שקל (₪)" },
    USD: { symbol: "$", label: "דולר ($)" },
    EUR: { symbol: "€", label: "יורו (€)" },
    CHF: { symbol: "CHF", label: "פרנק שווייצרי (CHF)" },
    GBP: { symbol: "£", label: "לירה שטרלינג (£)" },
};

// allergens: il = רשימת ישראל (13), us = ארה"ב, eu = אירופה/שוויץ/בריטניה (14). ההגדרה נשמרת עכשיו, והחבילות האזוריות יתווספו בהמשך.
export const COUNTRIES = [
    { key: "IL", name: "ישראל", currency: "ILS", units: "metric", allergens: "il" },
    { key: "US", name: "ארצות הברית", currency: "USD", units: "imperial", allergens: "us" },
    { key: "CH", name: "שווייץ", currency: "CHF", units: "metric", allergens: "eu" },
    { key: "DE", name: "גרמניה / אירופה", currency: "EUR", units: "metric", allergens: "eu" },
    { key: "GB", name: "בריטניה", currency: "GBP", units: "metric", allergens: "eu" },
    { key: "OTHER", name: "אחר", currency: "USD", units: "metric", allergens: "il" },
];

export const LANGUAGES = [
    { key: "he", label: "עברית", ready: true },
    { key: "en", label: "English", ready: false },
    { key: "de", label: "Deutsch", ready: false },
];

export function countryByKey(key) { return COUNTRIES.find((c) => c.key === key) || COUNTRIES[0]; }

// טוען את ההגדרות לזיכרון (בעיקר סמל המטבע) לפני שהמסכים מצוירים
export async function initLocale() {
    const code = await getSetting("currency", "ILS");
    setCurrencySymbol((CURRENCIES[code] || CURRENCIES.ILS).symbol);
    setQtyMode(await getSetting("qty_mode", "g")); // הקלדת כמויות: g (גרמים, ברירת מחדל) או kg (ק"ג עם נקודה)
}

export async function saveQtyMode(m) {
    await setSetting("qty_mode", m === "kg" ? "kg" : "g");
    setQtyMode(m);
}

export async function saveLocale({ country, currency, units, language }) {
    const c = countryByKey(country);
    await setSetting("country", c.key);
    await setSetting("currency", CURRENCIES[currency] ? currency : c.currency);
    await setSetting("units", units === "imperial" ? "imperial" : "metric");
    await setSetting("language", language || "he");
    await setSetting("allergen_region", c.allergens);
    await initLocale();
}
