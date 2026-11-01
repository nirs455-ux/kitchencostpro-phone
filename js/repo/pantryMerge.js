// איחוד שני מוצרי מזווה כפולים: כל ההפניות לנמחק עוברות לנשאר, בטרנזקציה אחת.
import { dbGetAll, dbGet, dbAtomic } from "../db.js";
import { isCountItem } from "../formulas.js";
import { normName } from "../scanMatch.js";
import { recalcAllCosts } from "./recalc.js";

const SETTING_KEYS = ["scan_aliases", "label_names", "nutrition_db", "label_info", "prep_plans", "producer_products"];
const sameId = (a, b) => a != null && b != null && Number(a) === Number(b);
const SKIP_COMMON = ["id", "quantity_g", "item_cost", "price_per_gram", "ingredient_name", "source_name", "pantry_item_id", "source_id", "recipe_id", "dish_id"];
const lineSig = (row) => JSON.stringify(Object.keys(row).filter((k) => !SKIP_COMMON.includes(k)).sort().map((k) => [k, row[k]]));

// מחשב מה צריך להשתנות, בלי לגעת במסד. data: { pantryItems, recipeItems, dishItems, invoiceItems, inventoryCounts, wasteLogs, suppliers, settings: {מפתח: ערך} }
// מחזיר { put: {חנות: [שורות]}, del: {חנות: [מפתחות]}, settings: {מפתח: ערך חדש} }. זורק שגיאה בעברית כשאי אפשר.
export function planPantryMerge(keepId, dropId, data) {
    keepId = Number(keepId); dropId = Number(dropId);
    if (!keepId || !dropId || keepId === dropId) throw new Error("יש לבחור שני מוצרים שונים");
    const pantry = data.pantryItems || [];
    const keep = pantry.find((p) => p.id === keepId), drop = pantry.find((p) => p.id === dropId);
    if (!keep || !drop) throw new Error("אחד המוצרים לא נמצא");
    if (keep.parent_id || drop.parent_id) throw new Error("אפשר לאחד רק מוצרים ראשיים, לא תוצרים מפורקים");
    if (keep.unit_type !== drop.unit_type) throw new Error("אי אפשר לאחד מוצרים עם יחידת מידה שונה");
    if (isCountItem(keep) !== isCountItem(drop)) throw new Error("אי אפשר לאחד: לאחד מהם יש משקל ליחידה ולשני אין, והכמויות במתכונים נשמרו אחרת");

    const put = {}, del = {}, settings = {};
    const addPut = (s, row) => { (put[s] = put[s] || []).push(row); };
    const addDel = (s, key) => { (del[s] = del[s] || []).push(key); };

    // תוצרים מפורקים של הנמחק עוברים לנשאר, אלא אם יש לנשאר תוצר באותו שם
    const keepKids = pantry.filter((p) => p.parent_id === keepId).map((p) => normName(p.name));
    for (const c of pantry.filter((p) => p.parent_id === dropId)) {
        if (keepKids.includes(normName(c.name))) throw new Error(`לשני המוצרים יש תוצר מפורק באותו שם: ${c.name}. מחק או שנה שם לאחד מהם ונסה שוב`);
        addPut("pantryItems", { ...c, parent_id: keepId });
    }

    // מחיר והגדרות: לנשאר יש עדיפות; אם אין לו מחיר ולנמחק יש, מעתיקים את המחיר ופרטי היחידה
    const k2 = { ...keep };
    let keepChanged = false;
    if (!(Number(keep.price) > 0) && Number(drop.price) > 0) {
        k2.price = drop.price; delete k2.price_missing;
        for (const f of ["unit_amount", "pkg_size"]) if (k2[f] == null && drop[f] != null) k2[f] = drop[f];
        keepChanged = true;
    }
    if ((!Array.isArray(keep.allergens) || !keep.allergens.length) && Array.isArray(drop.allergens) && drop.allergens.length) { k2.allergens = drop.allergens; k2.allergens_auto = drop.allergens_auto; keepChanged = true; }
    if (keepChanged) addPut("pantryItems", k2);
    addDel("pantryItems", dropId);

    // שורות שמצביעות על מוצר: מצרפים לשורה זהה של הנשאר באותו מתכון או מנה (סכום כמויות ועלויות), אחרת רק מפנים מחדש
    const repointRows = (store, rows, isDrop, isKeep, ownerField, idField) => {
        for (const row of rows) {
            if (!isDrop(row)) continue;
            const twin = rows.find((r) => isKeep(r) && r[ownerField] === row[ownerField] && lineSig(r) === lineSig(row));
            if (twin) {
                const list = put[store] || (put[store] = []);
                const at = list.findIndex((r) => r.id === twin.id);
                const prior = at >= 0 ? list[at] : twin;
                const merged = { ...prior, quantity_g: (Number(prior.quantity_g) || 0) + (Number(row.quantity_g) || 0), item_cost: (Number(prior.item_cost) || 0) + (Number(row.item_cost) || 0) };
                if (at >= 0) list[at] = merged; else list.push(merged);
                addDel(store, row.id);
            } else {
                addPut(store, { ...row, [idField]: keepId, ...(store === "recipeItems" ? { ingredient_name: keep.name } : { source_name: keep.name }) });
            }
        }
    };
    repointRows("recipeItems", data.recipeItems || [], (r) => sameId(r.pantry_item_id, dropId), (r) => sameId(r.pantry_item_id, keepId), "recipe_id", "pantry_item_id");
    repointRows("dishItems", data.dishItems || [], (r) => r.source_type === "pantry" && sameId(r.source_id, dropId), (r) => r.source_type === "pantry" && sameId(r.source_id, keepId), "dish_id", "source_id");

    for (const r of data.invoiceItems || []) if (sameId(r.pantry_item_id, dropId)) addPut("invoiceItems", { ...r, pantry_item_id: keepId });

    // ספירות מלאי: באותו תאריך מסכמים (לא מאבדים כמות)
    const counts = data.inventoryCounts || [];
    for (const c of counts) {
        if (!sameId(c.pantry_item_id, dropId)) continue;
        const twin = counts.find((x) => sameId(x.pantry_item_id, keepId) && x.count_date === c.count_date);
        if (twin) {
            const list = put.inventoryCounts || (put.inventoryCounts = []);
            const at = list.findIndex((r) => r.id === twin.id);
            const prior = at >= 0 ? list[at] : twin;
            const merged = { ...prior, counted_quantity: (Number(prior.counted_quantity) || 0) + (Number(c.counted_quantity) || 0) };
            if (at >= 0) list[at] = merged; else list.push(merged);
            addDel("inventoryCounts", c.id);
        } else addPut("inventoryCounts", { ...c, pantry_item_id: keepId });
    }

    for (const w of data.wasteLogs || []) if (w.source_type !== "recipe" && sameId(w.source_id, dropId)) addPut("wasteLogs", { ...w, source_id: keepId, name: keep.name });

    // רשימות הזמנה קבועות של ספקים: שורה כפולה (אותו מוצר ואותו מקדם) נשארת פעם אחת
    for (const s of data.suppliers || []) {
        const list = Array.isArray(s.order_list) ? s.order_list : [];
        if (!list.some((l) => sameId(l.pantry_item_id, dropId))) continue;
        const seen = new Set();
        const next = [];
        for (const l of list) {
            const nl = sameId(l.pantry_item_id, dropId) ? { ...l, pantry_item_id: keepId, name: keep.name } : l;
            const idKey = nl.pantry_item_id ? `p${nl.pantry_item_id}|${nl.stock_factor || 1}` : null;
            if (idKey && seen.has(idKey)) continue;
            if (idKey) seen.add(idKey);
            next.push(nl);
        }
        addPut("suppliers", { ...s, order_list: next });
    }

    // הגדרות
    const st = data.settings || {};
    const aliases = { ...(st.scan_aliases || {}) };
    for (const k of Object.keys(aliases)) if (sameId(aliases[k], dropId)) aliases[k] = keepId;
    for (const nm of [drop.name, normName(drop.name)]) { const k = String(nm || "").toLowerCase(); if (k && aliases[k] == null) aliases[k] = keepId; }
    settings.scan_aliases = aliases;
    for (const key of ["label_names", "nutrition_db", "label_info"]) {
        const m = st[key];
        if (!m || typeof m !== "object" || !(dropId in m)) continue;
        const copy = { ...m };
        if (!(keepId in copy)) copy[keepId] = copy[dropId];
        delete copy[dropId];
        settings[key] = copy;
    }
    if (Array.isArray(st.prep_plans) && st.prep_plans.some((p) => (p.rows || []).some((r) => r.source_type === "pantry" && sameId(r.source_id, dropId)))) {
        settings.prep_plans = st.prep_plans.map((p) => {
            const seen = new Set((p.rows || []).filter((r) => r.source_type === "pantry" && sameId(r.source_id, keepId)).map((r) => `${keepId}|${r.group || ""}`));
            const rows = [];
            for (const r of p.rows || []) {
                const moved = r.source_type === "pantry" && sameId(r.source_id, dropId);
                const nr = moved ? { ...r, source_id: keepId, name: keep.name } : r;
                const k = nr.source_type === "pantry" ? `${nr.source_id}|${nr.group || ""}` : null;
                if (k && moved && seen.has(k)) continue; // שורה כפולה שנוצרה מהאיחוד: נשארת הקיימת
                if (k && moved) seen.add(k);
                rows.push(nr);
            }
            return { ...p, rows };
        });
    }
    if (Array.isArray(st.producer_products) && st.producer_products.some((p) => (p.packaging || []).some((x) => sameId(x.pantry_item_id, dropId)))) {
        settings.producer_products = st.producer_products.map((p) => ({ ...p, packaging: (p.packaging || []).map((x) => (sameId(x.pantry_item_id, dropId) ? { ...x, pantry_item_id: keepId } : x)) }));
    }
    return { put, del, settings };
}

export async function mergePantryItems(keepId, dropId) {
    const [pantryItems, recipeItems, dishItems, invoiceItems, inventoryCounts, wasteLogs, suppliers] = await Promise.all(
        ["pantryItems", "recipeItems", "dishItems", "invoiceItems", "inventoryCounts", "wasteLogs", "suppliers"].map((s) => dbGetAll(s)));
    const settings = {};
    for (const k of SETTING_KEYS) { const r = await dbGet("settings", k); if (r && r.value != null) settings[k] = r.value; }
    const plan = planPantryMerge(keepId, dropId, { pantryItems, recipeItems, dishItems, invoiceItems, inventoryCounts, wasteLogs, suppliers, settings });
    const stores = [...new Set([...Object.keys(plan.put), ...Object.keys(plan.del), "settings"])];
    await dbAtomic(stores, (t) => {
        for (const [s, rows] of Object.entries(plan.put)) for (const r of rows) t.objectStore(s).put(r);
        for (const [s, keys] of Object.entries(plan.del)) for (const k of keys) t.objectStore(s).delete(k);
        for (const [key, value] of Object.entries(plan.settings)) t.objectStore("settings").put({ key, value });
    });
    try { await recalcAllCosts(); } catch (e) { /* החישוב מחדש ירוץ גם אוטומטית */ }
}
