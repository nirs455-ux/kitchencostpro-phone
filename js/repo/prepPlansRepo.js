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

// תוכנית תקינה מכל קלט (גם מגיבוי ישן/פגום)
export function normalizePlan(p) {
    const rows = Array.isArray(p && p.rows) ? p.rows.filter((r) => r && (r.source_type === "dish" || r.source_type === "recipe" || r.source_type === "pantry") && Number.isFinite(Number(r.source_id))) : [];
    const done = {};
    for (const [k, v] of Object.entries((p && p.done) || {})) if (v) done[k] = true;
    return {
        id: txt(p && p.id) || `p${Date.now().toString(36)}`,
        name: txt(p && p.name),
        date: /^\d{4}-\d{2}-\d{2}$/.test(txt(p && p.date)) ? p.date : todayIso(),
        guests: txt(p && p.guests),
        margin: p && p.margin != null && txt(p.margin) !== "" ? txt(p.margin) : "10",
        rows: rows.map((r) => ({ source_type: r.source_type, source_id: Number(r.source_id), name: txt(r.name), per: txt(r.per), share: txt(r.share), group: txt(r.group) })),
        allergens: Array.isArray(p && p.allergens) ? p.allergens.filter((k) => typeof k === "string") : [],
        custom: normalizeCustom(p && p.custom),
        overrides: normalizeOverrides(p && p.overrides),
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
