// תוכניות מיז אן פלאס שמורות: שם, תאריך, סועדים, מרווח, תפריט, וסימוני "בוצע" לכל משימה.
// נשמר כהגדרה אחת (prep_plans), ולכן נכלל בגיבוי ובשחזור בלי שינוי במבנה המסד.
import { getSetting, setSetting } from "./settingsRepo.js";

const KEY = "prep_plans";
const MAX_PLANS = 60;
const txt = (v) => String(v == null ? "" : v).trim();
const pad = (n) => String(n).padStart(2, "0");
export const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

// תוכנית תקינה מכל קלט (גם מגיבוי ישן/פגום)
export function normalizePlan(p) {
    const rows = Array.isArray(p && p.rows) ? p.rows.filter((r) => r && (r.source_type === "dish" || r.source_type === "recipe") && Number.isFinite(Number(r.source_id))) : [];
    const done = {};
    for (const [k, v] of Object.entries((p && p.done) || {})) if (v) done[k] = true;
    return {
        id: txt(p && p.id) || `p${Date.now().toString(36)}`,
        name: txt(p && p.name),
        date: /^\d{4}-\d{2}-\d{2}$/.test(txt(p && p.date)) ? p.date : todayIso(),
        guests: txt(p && p.guests),
        margin: p && p.margin != null && txt(p.margin) !== "" ? txt(p.margin) : "10",
        rows: rows.map((r) => ({ source_type: r.source_type, source_id: Number(r.source_id), name: txt(r.name), per: txt(r.per), share: txt(r.share) })),
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
