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
export const NON_FOOD_CATEGORIES = new Set(["מחסן"]);
export const UNIT_TYPES = ["weight", "liter", "unit"];
export const UNIT_TYPE_LABELS = { weight: "משקל (ק\"ג)", liter: "נפח (ליטר)", unit: "יחידה" };
export const RECIPE_CATEGORIES = ["כללי", "רטבים", "מרקים", "עיקריות", "תוספות", "קינוחים"];
