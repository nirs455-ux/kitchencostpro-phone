// קבועים - מקבילים בדיוק ל-CATEGORY_GROUPS/UNIT_TYPES/RECIPE_CATEGORIES ב-main.py.
export const CATEGORY_GROUPS = {
    "מהים": ["דגים", "פירות ים"],
    "קצביה": ["בעלי כנף", "בקר", "כבש", "חזיר"],
    "ירקניה": [],
    "יבשים": [],
    "מחלבה": [],
    "בר": [],
    "מחסן": [], // לא-מזון: ניקיון, חד-פעמי וכו' - לא מוצע במתכונים/מנות
};
// גרסת האפליקציה - מוצגת בהגדרות כדי לוודא שהטלפון עדכן (תואם ל-CACHE_NAME ב-service-worker.js)
export const APP_VERSION = "2026-10-16 (v32)";

// ערכות עיצוב זמינות (data-theme על <html>; ההגדרות ב-css/style.css)
export const THEMES = [
    { key: "", label: "קלאסי (הנוכחי)", color: "#a8541b" },
    { key: "warm", label: "מטבח חם", color: "#b5532a" },
    { key: "clean", label: "נקי ומודרני", color: "#0f766e" },
    { key: "dark", label: "כהה מקצועי", color: "#f59e0b" },
];
export const NON_FOOD_CATEGORIES = new Set(["מחסן"]);
export const UNIT_TYPES = ["weight", "liter", "unit"];
export const UNIT_TYPE_LABELS = { weight: "משקל (ק\"ג)", liter: "נפח (ליטר)", unit: "יחידה" };
export const RECIPE_CATEGORIES = ["כללי", "רטבים", "מרקים", "עיקריות", "תוספות", "קינוחים"];
