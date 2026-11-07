// נתוני כרטיס "היום" במסך הפתיחה: הפשרה, סועדים צפויים, הכנות להיום והסרוויס האחרון. קורא את אותן הגדרות כמו מסך התחזית.
import { dbGetAll } from "./db.js";
import { getSetting } from "./repo/settingsRepo.js";
import { listPlans, todayIso } from "./repo/prepPlansRepo.js";
import { historyPoints } from "./serviceDoc.js";
import { serviceHistoryPlans } from "./repo/serviceRepo.js";
import { buildForecast, thawFor, thawDaysOf } from "./forecast.js";

// קלט משותף לתחזית ולהזמנה: חומרי גלם, תוכניות, נקודות היסטוריה, הגדרות, והפריטים מהתפריט שנבחר
export async function loadForecastInputs() {
    const pantry = new Map((await dbGetAll("pantryItems")).filter((p) => !p.parent_id).map((p) => [p.id, p]));
    const plans = await listPlans();
    const points = historyPoints(await serviceHistoryPlans(plans), pantry);
    const planId = await getSetting("forecast_plan", "");
    const plan = plans.find((p) => p.id === planId) || plans[0] || null;
    const items = plan ? plan.rows.filter((r) => r.source_type === "pantry" && pantry.has(r.source_id)).map((r) => ({ id: r.source_id, name: pantry.get(r.source_id).name, per: r.per, cnt: pantry.get(r.source_id).unit_type === "unit" })) : [];
    return {
        pantry, plans, points, plan, items,
        entered: (await getSetting("forecast_days", {})) || {},
        margin: String((await getSetting("forecast_margin", "10")) ?? "10"),
    };
}

export async function loadTodayCard() {
    const pantry = new Map((await dbGetAll("pantryItems")).filter((p) => !p.parent_id).map((p) => [p.id, p]));
    const plans = await listPlans();
    const today = todayIso();
    const points = historyPoints(await serviceHistoryPlans(plans), pantry);
    const entered = (await getSetting("forecast_days", {})) || {};
    const margin = String((await getSetting("forecast_margin", "10")) ?? "10");
    const thaw = (await getSetting("forecast_thaw", {})) || {};
    const planId = await getSetting("forecast_plan", "");
    const plan = plans.find((p) => p.id === planId) || plans[0] || null;
    const items = plan ? plan.rows.filter((r) => r.source_type === "pantry" && pantry.has(r.source_id)).map((r) => ({ id: r.source_id, name: pantry.get(r.source_id).name, per: r.per, cnt: pantry.get(r.source_id).unit_type === "unit" })) : [];
    const maxThaw = Math.max(0, ...items.map((i) => thawDaysOf(thaw, i.id)));
    const m = buildForecast({ startIso: today, days: 3, extraDays: maxThaw, entered, points, items, marginPct: margin });
    const week = buildForecast({ startIso: today, days: 7, entered, points, items: [], marginPct: margin });
    const last = [...points].filter((p) => p.date <= today).pop() || null;
    const t0 = m.days[0];
    return {
        today, hasItems: items.length > 0, anyThaw: maxThaw > 0,
        days: m.days.filter((d) => !d.extra).map((d) => ({ date: d.date, weekday: d.weekday, diners: d.diners, entered: d.entered })),
        weekDiners: week.days.reduce((s, d) => s + d.diners, 0),
        thaw: thawFor(m, 0, thaw),
        prep: t0.lines.filter((l) => l.qty > 0),
        missingToday: !(t0.diners > 0),
        last,
    };
}
