// סרוויסים נשמרים במאגר משלהם (serviceLogs), כדי שההיסטוריה לא תיחתך עם 60 התוכניות האחרונות, ותיכלל בגיבוי ובשחזור.
// העותק במאגר מתעדכן בכל שינוי בדף הסרוויס. מחיקת תוכנית לא מוחקת את הסרוויס.
import { dbGetAll, dbPut, dbDelete } from "../db.js";
import { serviceEvents, logFromPlan, logAsPlan } from "../serviceEvents.js";
import { listPlans } from "./prepPlansRepo.js";

export async function syncServiceLog(plan) {
    const log = logFromPlan(plan);
    if (log) await dbPut("serviceLogs", log);
    else if ((await dbGetAll("serviceLogs")).some((l) => l.id === plan.id)) await dbDelete("serviceLogs", plan.id);
}

export const listServiceLogs = () => dbGetAll("serviceLogs");

// היסטוריית סרוויסים כאובייקטים בצורת תוכנית: מהמאגר, ואחריהם תוכניות עם נתוני סרוויס שעוד לא הועתקו
export async function serviceHistoryPlans(plans) {
    const logs = await listServiceLogs();
    const have = new Set(logs.map((l) => l.id));
    const out = logs.map(logAsPlan);
    for (const p of plans || []) if (!have.has(p.id) && Object.keys(p.svc || {}).length) out.push(p);
    return out;
}

// העתקה חד פעמית של סרוויסים קיימים מהתוכניות למאגר
export async function backfillServiceLogs(plans) {
    const have = new Set((await listServiceLogs()).map((l) => l.id));
    for (const p of plans || []) if (!have.has(p.id) && Object.keys(p.svc || {}).length) await syncServiceLog(p);
}

// אירועי צריכה של כל הסרוויסים, למלאי התיאורטי ולדוח הסטיות. ctx.pantry: Map של חומרי גלם
export async function serviceConsumptionEvents(ctx) {
    try { await backfillServiceLogs(await listPlans()); } catch (e) { /* ההעתקה היא עזר */ }
    return serviceEvents(await listServiceLogs(), ctx.pantry);
}
