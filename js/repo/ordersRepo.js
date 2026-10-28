// הזמנות לספקים: רשימת הזמנה קבועה לכל ספק, פרטי קשר (טלפון ומייל) והיסטוריית הזמנות.
// הכול נשמר בתוך שורת הספק (order_list, order_history, email), כך שהגיבוי והשחזור כוללים אותם בלי שינוי במבנה המסד.
import { dbGet, dbGetAll, dbPut } from "../db.js";

const MAX_HISTORY = 60;
const txt = (v) => String(v == null ? "" : v).trim();
let seq = 0;
const pad = (n) => String(n).padStart(2, "0");
export const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const newKey = () => `l${Date.now().toString(36)}${(seq++).toString(36)}`;

// זהות שורה: חומר גלם (או שם) + גודל היחידה בחשבונית, כך שקילו וארגז של אותו מוצר הן שתי שורות נפרדות
export const lineIdentity = (l) => `${l.pantry_item_id ? `p${l.pantry_item_id}` : `n${txt(l.name).toLowerCase()}`}|${l.stock_factor || 1}`;

export const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(txt(e));

// שורה ברשימה: שם, יחידת הזמנה (טקסט חופשי: ק"ג / ארגז / יחידה), כמות רגילה (טקסט, יכול להיות ריק), קישור לחומר גלם
export function normalizeLine(l) {
    return { key: l.key || newKey(), name: txt(l.name), unit: txt(l.unit), qty: txt(l.qty), pantry_item_id: l.pantry_item_id || null, stock_factor: l.stock_factor || null };
}

async function mustGet(supplierId) {
    const s = await dbGet("suppliers", supplierId);
    if (!s) throw new Error("ספק לא נמצא");
    return s;
}

export async function getOrderBook(supplierId) {
    const s = await mustGet(supplierId);
    return {
        supplier: s,
        list: (s.order_list || []).map(normalizeLine),
        history: (s.order_history || []).slice().sort((a, b) => b.id - a.id),
        phone: s.phone || "",
        email: s.email || "",
        days: (s.order_days || []).slice(),
        cutoff: s.order_cutoff || "",
    };
}

export async function saveOrderList(supplierId, list) {
    const s = await mustGet(supplierId);
    const seen = new Set();
    const clean = [];
    for (const l of list.map(normalizeLine)) {
        if (!l.name) continue;
        const dupKey = lineIdentity(l);
        if (seen.has(dupKey)) continue;
        seen.add(dupKey);
        clean.push(l);
    }
    await dbPut("suppliers", { ...s, order_list: clean });
    return clean;
}

// פרטי הספק להזמנות: טלפון, מייל, ימי חלוקה (0 = ראשון ... 6 = שבת) ושעת סגירת הזמנות (HH:MM)
export async function setSupplierContact(supplierId, { phone, email, days, cutoff }) {
    const s = await mustGet(supplierId);
    const p = txt(phone);
    const e = txt(email);
    if (p && !/^[\d+\-\s()]{7,20}$/.test(p)) throw new Error("מספר טלפון לא תקין");
    if (e && !validEmail(e)) throw new Error("כתובת המייל לא תקינה");
    const c = txt(cutoff);
    if (c && !/^([01]\d|2[0-3]):[0-5]\d$/.test(c)) throw new Error("שעה לא תקינה");
    const d = [...new Set((days || []).map(Number).filter((n) => n >= 0 && n <= 6))].sort();
    await dbPut("suppliers", { ...s, phone: p, email: e, order_days: d, order_cutoff: c });
}

// שומר הזמנה שנשלחה. via: whatsapp / email / copy
export async function recordOrder(supplierId, { lines, note, via }) {
    const s = await mustGet(supplierId);
    const entry = { id: Date.now(), date: localDate(new Date()), via: via || "", note: txt(note), lines: lines.map((l) => ({ name: txt(l.name), qty: txt(l.qty), unit: txt(l.unit) })) };
    const history = [entry, ...(s.order_history || [])].slice(0, MAX_HISTORY);
    await dbPut("suppliers", { ...s, order_history: history });
    return entry;
}

export async function deleteOrder(supplierId, orderId) {
    const s = await mustGet(supplierId);
    await dbPut("suppliers", { ...s, order_history: (s.order_history || []).filter((o) => o.id !== orderId) });
}

// סקירה לכל הספקים: כמה פריטים ברשימה ומתי הוזמן לאחרונה
export async function ordersOverview() {
    const rows = await dbGetAll("suppliers");
    return rows.sort((a, b) => a.name.localeCompare(b.name, "he")).map((s) => {
        const h = (s.order_history || []).slice().sort((x, y) => y.id - x.id);
        return { supplier: s, days: s.order_days || [], cutoff: s.order_cutoff || "", items: (s.order_list || []).length, orders: h.length, last: h[0] ? h[0].date : "", via: h[0] ? h[0].via : "" };
    });
}

export const lineQtyText = (l) => [txt(l.qty), txt(l.unit)].filter(Boolean).join(" ");

const BASE_UNIT = { weight: 'ק"ג', liter: "ליטר", unit: "יח'" };
const fmt = (n) => +Number(n).toFixed(3);

// שורות הזמנה לפי החשבוניות של הספק: כל מוצר לפי היחידה שבה נקנה (ק"ג / ארגז וכו'), מהנקנה הכי הרבה.
// כמות רגילה = ממוצע הכמויות בקניות קודמות. יחידה: stock_factor ריק = יחידת חומר הגלם, אחרת אריזה שמכילה כמה יחידות.
export async function suggestOrderLines(supplierId) {
    const invoices = (await dbGetAll("invoices")).filter((i) => i.supplier_id === supplierId && !i.deleted_at && i.document_type !== "credit");
    const byId = new Map(invoices.map((i) => [i.id, i]));
    const pantry = new Map((await dbGetAll("pantryItems")).map((p) => [p.id, p]));
    const groups = new Map();
    for (const it of await dbGetAll("invoiceItems")) {
        const inv = byId.get(it.invoice_id);
        if (!inv) continue;
        const name = txt(it.product_name);
        const p = it.pantry_item_id ? pantry.get(it.pantry_item_id) : null;
        const factor = it.stock_factor && Number(it.stock_factor) !== 1 ? Number(it.stock_factor) : null;
        const base = { name: p ? p.name : name, pantry_item_id: p ? p.id : null, stock_factor: factor };
        if (!base.name) continue;
        const key = lineIdentity(base);
        const g = groups.get(key) || { ...base, count: 0, sum: 0 };
        g.count++;
        g.sum += Number(it.quantity) || 0;
        const bu = p ? BASE_UNIT[p.unit_type] || "" : "";
        g.unit = factor ? (bu ? `ארגז/אריזה (${fmt(factor)} ${bu})` : "ארגז/אריזה") : bu;
        groups.set(key, g);
    }
    return [...groups.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "he")).map((g) => ({
        name: g.name, unit: g.unit, qty: String(fmt(g.sum / g.count)), pantry_item_id: g.pantry_item_id, stock_factor: g.stock_factor, count: g.count,
    }));
}

// הזמנות שצריך לבצע: ספקים שהיום (או מחר) הוא אחד מימי החלוקה שלהם ועוד לא נשלחה להם הזמנה היום.
// overdue = שעת הסגירה עברה. today/tomorrow: רשימות של { supplier, cutoff, overdue }.
export async function dueOrders(now = new Date()) {
    const suppliers = await dbGetAll("suppliers");
    const todayStr = localDate(now);
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const nowHM = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const out = { today: [], tomorrow: [] };
    for (const s of suppliers) {
        const days = s.order_days || [];
        if (!days.length) continue;
        const cutoff = s.order_cutoff || "";
        if (days.includes(now.getDay()) && !(s.order_history || []).some((o) => o.date === todayStr)) out.today.push({ supplier: s, cutoff, overdue: !!cutoff && nowHM > cutoff });
        if (days.includes(tomorrow.getDay()) && !(s.order_history || []).some((o) => o.date === todayStr)) out.tomorrow.push({ supplier: s, cutoff, overdue: false });
    }
    const byName = (x, y) => x.supplier.name.localeCompare(y.supplier.name, "he");
    out.today.sort(byName); out.tomorrow.sort(byName);
    return out;
}
