// תוכניות מיז אן פלאס שמורות: שם, תאריך, סועדים, מרווח, תפריט, וסימוני "בוצע" לכל משימה.
// נשמר כהגדרה אחת (prep_plans), ולכן נכלל בגיבוי ובשחזור בלי שינוי במבנה המסד.
import { getSetting, setSetting } from "./settingsRepo.js";

const KEY = "prep_plans";
const MAX_PLANS = 60;
const txt = (v) => String(v == null ? "" : v).trim();
const pad = (n) => String(n).padStart(2, "0");
export const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

// פריטים ידניים (מנות שאין במערכת, משימות לאותו אירוע): טקסט חופשי. kind: prep = להכין, order = להזמין
export function normalizeCustom(list) {
    if (!Array.isArray(list)) return [];
    return list.filter((c) => c && txt(c.label)).map((c, i) => {
        const sid = c.supplier_id === "" || c.supplier_id == null ? NaN : Number(c.supplier_id);
        return { id: txt(c.id) || `c${Date.now().toString(36)}${i}`, kind: c.kind === "order" ? "order" : "prep", label: txt(c.label), qty: txt(c.qty), supplier_id: Number.isFinite(sid) ? sid : null };
    });
}

// שינוי ידני של כמות מחושבת: מפתח משימה -> טקסט חופשי. מחיקת השינוי מחזירה את החישוב
export function normalizeOverrides(o) {
    const out = {};
    for (const [k, v] of Object.entries(o && typeof o === "object" ? o : {})) if (txt(v)) out[k] = txt(v);
    return out;
}

// דף סרוויס: לכל נתח בתפריט (מפתח "pantry:12"): יצא לסרוויס, חזר מסרוויס, נזרק, פחת. טקסט חופשי בק"ג או ביחידות
export function normalizeSvc(o) {
    const out = {};
    for (const [k, v] of Object.entries(o && typeof o === "object" ? o : {})) {
        if (!/^(pantry|recipe|dish):\d+$/.test(k) || !v || typeof v !== "object") continue;
        const row = { out: txt(v.out), back: txt(v.back), thrown: txt(v.thrown), shrink: txt(v.shrink) };
        if (row.out || row.back || row.thrown || row.shrink) out[k] = row;
    }
    return out;
}

export const DIET_KEYS = ["kosher", "vegetarian", "vegan"];
export function normalizeNeedCounts(o) {
    const out = {};
    for (const [k, v] of Object.entries(o && typeof o === "object" ? o : {})) { const t = txt(v); if (/^[a-z_]+$/.test(k) && t) out[k] = t; }
    return out;
}

// סרוויס: התפריט הקבוע. מוזן פעם אחת ונפתח בכל יום חדש
const MENU_KEY = "service_menu";
export async function getServiceMenu() { return normalizePlan({ rows: await getSetting(MENU_KEY, []) }).rows; }
export async function saveServiceMenu(rows) { await setSetting(MENU_KEY, normalizePlan({ rows }).rows); }

// תוכנית תקינה מכל קלט (גם מגיבוי ישן/פגום)
export function normalizePlan(p) {
    const rows = Array.isArray(p && p.rows) ? p.rows.filter((r) => r && (r.source_type === "dish" || r.source_type === "recipe" || r.source_type === "pantry") && Number.isFinite(Number(r.source_id))) : [];
    const done = {};
    for (const [k, v] of Object.entries((p && p.done) || {})) if (v) done[k] = true;
    const svc = normalizeSvc(p && p.svc);
    // סוג: סרוויס יומי או אירוע. תוכנית ישנה בלי סוג שיש בה נתוני סרוויס נחשבת סרוויס
    const kind = p && p.kind === "service" ? "service" : p && p.kind === "event" ? "event" : (txt(p && p.seat1) || txt(p && p.seat2) || Object.keys(svc).length ? "service" : "event");
    return {
        id: txt(p && p.id) || `p${Date.now().toString(36)}`,
        kind,
        name: txt(p && p.name),
        date: /^\d{4}-\d{2}-\d{2}$/.test(txt(p && p.date)) ? p.date : todayIso(),
        guests: txt(p && p.guests),
        seat1: txt(p && p.seat1),
        seat2: txt(p && p.seat2),
        price: txt(p && p.price), // מחיר לסועד בשקלים (לחישוב אחוז עלות מזון)
        svc,
        note: typeof (p && p.note) === "string" ? p.note.slice(0, 4000) : "",
        margin: p && p.margin != null && txt(p.margin) !== "" ? txt(p.margin) : "10",
        rows: rows.map((r) => ({ source_type: r.source_type, source_id: Number(r.source_id), name: txt(r.name), per: txt(r.per), share: txt(r.share), group: txt(r.group), diet: DIET_KEYS.includes(r.diet) ? r.diet : "" })),
        allergens: Array.isArray(p && p.allergens) ? p.allergens.filter((k) => typeof k === "string") : [],
        diets: Array.isArray(p && p.diets) ? p.diets.filter((k) => DIET_KEYS.includes(k)) : [], // כשר, צמחוני, טבעוני
        needCounts: normalizeNeedCounts(p && p.needCounts), // כמה סועדים לכל אלרגן והעדפה: מפתח -> מספר
        custom: normalizeCustom(p && p.custom),
        overrides: normalizeOverrides(p && p.overrides),
        overrideBase: normalizeOverrides(p && p.overrideBase), // הטקסט המחושב ברגע השינוי, כדי לזהות שינוי שהתיישן
        done,
        updated: Number(p && p.updated) || Date.now(),
    };
}

// מחליף/מוסיף תוכנית לפי מזהה; החדשה ביותר ראשונה; מגבלה על מספר התוכניות
export function upsertPlan(list, plan) {
    const p = { ...normalizePlan(plan), updated: Date.now() };
    return [p, ...list.filter((x) => x.id !== p.id)].slice(0, MAX_PLANS);
}
export const removePlan = (list, id) => list.filter((x) => x.id !== id);

// משימות שנשארו ללא סימון: הסימון של משימה שכבר לא קיימת (נמחקה מהתפריט) לא נספר
export function progress(taskKeys, done) {
    const total = taskKeys.length;
    const finished = taskKeys.filter((k) => done && done[k]).length;
    return { total, finished };
}

export async function listPlans() {
    const raw = await getSetting(KEY, []);
    return (Array.isArray(raw) ? raw : []).map(normalizePlan).sort((a, b) => b.updated - a.updated);
}
export async function savePlans(list) { await setSetting(KEY, list); }
