// מודול יצרן: פרטי העסק ורשימת המוצרים לשיווק (מבוססים על מתכון). נשמר בטבלת ההגדרות, כך שנכלל בגיבוי ובשחזור בלי שינוי מבנה מסד.
import { getSetting, setSetting } from "./settingsRepo.js";

const BIZ_KEY = "producer_business";
const PRODUCTS_KEY = "producer_products";

export const NUTRITION_FIELDS = [
    { key: "kcal", label: 'אנרגיה (קק"ל)' },
    { key: "fat", label: "שומן (גרם)" },
    { key: "sat", label: "מזה רווי (גרם)" },
    { key: "carbs", label: "פחמימות (גרם)" },
    { key: "sugars", label: "מזה סוכרים (גרם)" },
    { key: "protein", label: "חלבון (גרם)" },
    { key: "sodium", label: 'נתרן (מ"ג)' },
];

export const DEFAULT_STORAGE = "יש לאחסן בקירור (עד 4°C)";

export async function getBusiness() {
    const v = await getSetting(BIZ_KEY);
    return { name: "", address: "", phone: "", reg: "", ...(v && typeof v === "object" ? v : {}) };
}
export async function saveBusiness(b) {
    const clean = {};
    for (const k of ["name", "address", "phone", "reg"]) clean[k] = String(b[k] || "").trim();
    await setSetting(BIZ_KEY, clean);
    return clean;
}

export async function listProducts() {
    const v = await getSetting(PRODUCTS_KEY);
    return Array.isArray(v) ? v : [];
}

const num = (x) => {
    const n = parseFloat(String(x ?? "").replace(",", "."));
    return Number.isFinite(n) && n >= 0 ? n : null;
};

// מנקה ומאמת מוצר. נזרקת שגיאה בעברית אם חסר שם או מתכון.
export function cleanProduct(p) {
    const name = String(p.name || "").trim();
    if (!name) throw new Error("יש להזין שם מוצר");
    const recipe_id = Number(p.recipe_id);
    if (!recipe_id) throw new Error("יש לבחור מתכון");
    const nutrition = {};
    for (const f of NUTRITION_FIELDS) { const n = num(p.nutrition && p.nutrition[f.key]); if (n != null) nutrition[f.key] = n; }
    return {
        id: p.id || Date.now(),
        name, recipe_id,
        net_g: num(p.net_g) || 0,
        shelf_days: Math.min(3650, Math.round(num(p.shelf_days) || 0)), // עד 10 שנים (מעבר לכך כנראה טעות הקלדה)
        storage: String(p.storage || "").trim(),
        barcode: String(p.barcode || "").trim(),
        sell_price: num(p.sell_price) || 0, // מחיר מכירה ליחידה לפני מע"מ
        // אריזה: מוצרים מהמזווה (צנצנת, מכסה, קופסה...) והכמות שלהם ליחידת מוצר אחת
        packaging: (Array.isArray(p.packaging) ? p.packaging : []).map((x) => ({ pantry_item_id: Number(x.pantry_item_id), qty: num(x.qty) || 0 })).filter((x) => x.pantry_item_id && x.qty > 0),
        nutrition,
    };
}

export async function saveProduct(p) {
    const clean = cleanProduct(p);
    const list = await listProducts();
    const i = list.findIndex((x) => x.id === clean.id);
    if (i >= 0) list[i] = clean; else list.push(clean);
    await setSetting(PRODUCTS_KEY, list);
    return clean;
}

export async function deleteProduct(id) {
    await setSetting(PRODUCTS_KEY, (await listProducts()).filter((x) => x.id !== id));
}

// תאריך ISO (yyyy-mm-dd) + ימים -> תאריך ISO. עובד לפי התאריך המקומי כדי שלא יזוז ביום.
export function addDaysIso(iso, days) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso)) || !Number.isFinite(Number(days))) return ""; // תאריך/ימים לא תקינים: לא מדפיסים NaN
    const [y, m, d] = String(iso).split("-").map((x) => parseInt(x, 10));
    const dt = new Date(y, (m || 1) - 1, d || 1);
    dt.setDate(dt.getDate() + (Number(days) || 0));
    if (Number.isNaN(dt.getTime())) return "";
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}
export const fmtDateHe = (iso) => String(iso || "").split("-").reverse().join("/");
