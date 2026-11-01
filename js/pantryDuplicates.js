// זיהוי כפילויות במזווה (תפוז / תפוזים) והצעה מי יישאר - טהור, בלי DB.
import { sameWords, conflicts, normName } from "./scanMatch.js";

export const pairKey = (a, b) => `${Math.min(a, b)}-${Math.max(a, b)}`;

// כמה פעמים כל מוצר בשימוש: שורות מתכון, שורות מנה, שורות חשבונית וספירות מלאי. מחזיר Map מזהה -> מספר
export function buildUsageCounts({ recipeItems = [], dishItems = [], invoiceItems = [], inventoryCounts = [] } = {}) {
    const m = new Map();
    const add = (id) => { if (id != null && id !== "") { const k = Number(id); m.set(k, (m.get(k) || 0) + 1); } };
    for (const r of recipeItems) add(r.pantry_item_id);
    for (const r of dishItems) if (r.source_type === "pantry") add(r.source_id);
    for (const r of invoiceItems) add(r.pantry_item_id);
    for (const r of inventoryCounts) add(r.pantry_item_id);
    return m;
}

const usageOf = (usage, id) => (usage instanceof Map ? usage.get(id) : usage && usage[id]) || 0;

// מי נשאר: יותר שימוש, אחר כך מי שיש לו מחיר, אחר כך המזהה הישן יותר
export function chooseKeep(a, b, usageCounts) {
    const ua = usageOf(usageCounts, a.id), ub = usageOf(usageCounts, b.id);
    if (ua !== ub) return ua > ub ? a : b;
    const pa = Number(a.price) > 0, pb = Number(b.price) > 0;
    if (pa !== pb) return pa ? a : b;
    return a.id <= b.id ? a : b;
}

// pantryRows: כל השורות (מסננים רק עליונות). dismissed: מערך או Set של מפתחות זוגות שסומנו כמוצרים שונים.
export function findDuplicatePairs(pantryRows, usageCounts, dismissed = []) {
    const skip = dismissed instanceof Set ? dismissed : new Set(dismissed || []);
    const tops = (pantryRows || []).filter((r) => r && !r.parent_id && String(r.name || "").trim());
    const out = [];
    for (let i = 0; i < tops.length; i++) {
        for (let j = i + 1; j < tops.length; j++) {
            const a = tops[i], b = tops[j];
            const same = normName(a.name) === normName(b.name) || (sameWords(a.name, b.name) && !conflicts(a.name, b.name));
            if (!same || (a.unit_type || "") !== (b.unit_type || "")) continue;
            const key = pairKey(a.id, b.id);
            if (skip.has(key)) continue;
            const keep = chooseKeep(a, b, usageCounts);
            const drop = keep === a ? b : a;
            out.push({ key, a, b, keepId: keep.id, dropId: drop.id, usage: { [a.id]: usageOf(usageCounts, a.id), [b.id]: usageOf(usageCounts, b.id) } });
        }
    }
    return out;
}
