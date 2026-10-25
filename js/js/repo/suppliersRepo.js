// לוגיקת ספקים/חשבוניות - תרגום מדויק של add_supplier/delete_supplier/_parse_invoice_payload/add_invoice/update_invoice/delete_invoice.
import { dbGetAll, dbGet, dbPut, dbDelete, dbGetByIndex, dbDeleteWhere } from "../db.js";
import { expandToParents } from "./subRecipes.js";

export async function listSuppliers() {
    const rows = await dbGetAll("suppliers");
    return rows.sort((a, b) => a.name.localeCompare(b.name, "he"));
}

export async function addSupplier(name) {
    name = (name || "").trim();
    if (!name) throw new Error("יש להזין שם ספק");
    const existing = (await dbGetAll("suppliers")).find((s) => s.name === name);
    if (existing) throw new Error("ספק בשם הזה כבר קיים");
    return dbPut("suppliers", { name });
}

// מה יימחק עם הספק: כמה חשבוניות ובאיזה סכום כולל.
// חשבוניות פעילות (שלא בפח)
export async function activeInvoices() {
    return (await dbGetAll("invoices")).filter((i) => !i.deleted_at);
}

export async function getSupplierDeleteInfo(id) {
    const supplier = await dbGet("suppliers", id);
    if (!supplier) throw new Error("ספק לא נמצא");
    const invoices = (await dbGetByIndex("invoices", "supplier_id", id)).filter((i) => !i.deleted_at);
    const total = invoices.reduce((n, i) => n + (i.total_amount || 0), 0);
    return { id, name: supplier.name, invoice_count: invoices.length, invoices_total: Math.round(total * 100) / 100 };
}

// מחיקת ספק בכל שלב - נמחק יחד עם החשבוניות שלו (האישור מציג כמה).
export async function deleteSupplier(id) {
    for (const inv of await dbGetByIndex("invoices", "supplier_id", id)) {
        await dbDeleteWhere("invoiceItems", "invoice_id", inv.id);
        await dbDelete("invoices", inv.id);
    }
    await dbDelete("suppliers", id);
}

function parseInvoicePayload(data) {
    const supplierId = parseInt(data.supplier_id, 10);
    if (Number.isNaN(supplierId)) throw new Error("יש לבחור ספק");
    const invoiceDate = (data.invoice_date || "").trim();
    if (!invoiceDate) throw new Error("יש להזין תאריך");
    {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(invoiceDate);
        const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
        const valid = d && d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]);
        if (!valid) throw new Error("תאריך לא תקין");
        if (d.getFullYear() < 2000) throw new Error("תאריך החשבונית ישן מדי - בדוק את השנה");
        if (d.getTime() > Date.now() + 366 * 86400000) throw new Error("תאריך החשבונית רחוק מדי בעתיד - בדוק את השנה");
    }
    const documentType = data.document_type || "invoice";
    if (!["invoice", "credit"].includes(documentType)) throw new Error("סוג מסמך לא תקין");
    if (!data.items || data.items.length === 0) throw new Error("יש להוסיף לפחות שורה אחת");

    let total = 0;
    const resolved = [];
    for (const it of data.items) {
        const name = (it.product_name || "").trim();
        if (!name) throw new Error("יש להזין שם מוצר לכל שורה");
        const qty = parseFloat(it.quantity);
        if (!Number.isFinite(qty)) throw new Error("כמות/מחיר לא תקינים");
        if (qty <= 0) throw new Error("כמות חייבת להיות גדולה מ-0");
        // הנתונים נשמרים כפי שהוזנו/מופיעים בקבלה: סכום שורה שהוזן נשמר כמו שהוא (לא מחושב מחדש);
        // אם חסר מחיר ליחידה - נגזר מהסכום; אם חסר סכום - כמות x מחיר.
        const hasPrice = it.unit_price !== null && it.unit_price !== undefined && it.unit_price !== "";
        const hasTotal = it.line_total !== null && it.line_total !== undefined && it.line_total !== "";
        let unitPrice = hasPrice ? parseFloat(it.unit_price) : null;
        let lineTotal = hasTotal ? Math.round(parseFloat(it.line_total) * 100) / 100 : null;
        if ((hasPrice && !Number.isFinite(unitPrice)) || (hasTotal && !Number.isFinite(lineTotal))) throw new Error("כמות/מחיר לא תקינים");
        if (unitPrice === null && lineTotal === null) throw new Error("כמות/מחיר לא תקינים");
        if (unitPrice === null) unitPrice = Math.round((lineTotal / qty) * 10000) / 10000;
        if (lineTotal === null) lineTotal = Math.round(qty * unitPrice * 100) / 100;
        if (unitPrice < 0 || lineTotal < 0) throw new Error("מחיר/סכום לא יכולים להיות שליליים");
        if (unitPrice > 1000000 || lineTotal > 100000000) throw new Error("מחיר/סכום גבוהים מדי - בדוק שלא הוזן מספר שגוי");
        total += lineTotal;
        let pantryItemId = it.pantry_item_id || null;
        if (pantryItemId) pantryItemId = parseInt(pantryItemId, 10);
        const sf = parseFloat(it.stock_factor);
        const stockFactor = Number.isFinite(sf) && sf > 0 && sf !== 1 ? sf : null;
        resolved.push({ product_name: name, quantity: qty, unit_price: unitPrice, line_total: lineTotal, pantry_item_id: pantryItemId, stock_factor: stockFactor });
    }
    return {
        supplier_id: supplierId, invoice_date: invoiceDate, document_type: documentType, items: resolved, total: Math.round(total * 100) / 100,
        petty_cash: !!data.petty_cash, purchaser: (data.purchaser || "").trim(), reimbursed: !!data.petty_cash && !!data.reimbursed,
    };
}

export async function listInvoicesWithItems({ trashed = false } = {}) {
    const suppliers = await listSuppliers();
    const supplierById = Object.fromEntries(suppliers.map((s) => [s.id, s.name]));
    const invoices = (await dbGetAll("invoices")).filter((i) => (trashed ? !!i.deleted_at : !i.deleted_at));
    const out = [];
    for (const inv of invoices) {
        const items = await dbGetByIndex("invoiceItems", "invoice_id", inv.id);
        out.push({ ...inv, supplier_name: supplierById[inv.supplier_id] || "?", items });
    }
    for (const inv of out) inv.has_image = inv.image instanceof Blob;
    out.sort((a, b) => (b.invoice_date || "").localeCompare(a.invoice_date || "") || b.id - a.id);
    return out;
}

// אימות מלא של חשבונית בלי לכתוב כלום (לפני יצירת מוצרי מזווה חדשים)
export async function validateInvoicePayload(data) {
    const clean = parseInvoicePayload(data);
    if (!(await dbGet("suppliers", clean.supplier_id))) throw new Error("ספק לא נמצא");
    return clean;
}

export async function saveInvoice(existingId, data) {
    const clean = parseInvoicePayload(data);
    const supplier = await dbGet("suppliers", clean.supplier_id);
    if (!supplier) throw new Error("ספק לא נמצא");

    const invoiceRow = { supplier_id: clean.supplier_id, invoice_date: clean.invoice_date, total_amount: clean.total, document_type: clean.document_type, petty_cash: clean.petty_cash, purchaser: clean.purchaser, reimbursed: clean.reimbursed };
    let invoiceId = existingId;
    // תמונה: Blob חדש = החלפה; null = הסרה; לא הועבר = נשארת התמונה הקיימת
    if (data.image instanceof Blob) invoiceRow.image = data.image;
    if (existingId) {
        if (data.image === undefined) {
            const prev = await dbGet("invoices", existingId);
            if (prev && prev.image) invoiceRow.image = prev.image;
        }
        invoiceRow.id = existingId;
        await dbPut("invoices", invoiceRow);
    } else {
        invoiceId = await dbPut("invoices", invoiceRow);
    }
    // קודם כותבים את השורות החדשות ורק אז מוחקים את הישנות - כך כשל באמצע לא משאיר חשבונית בלי שורות
    const oldItems = existingId ? await dbGetByIndex("invoiceItems", "invoice_id", existingId) : [];
    for (const it of clean.items) {
        await dbPut("invoiceItems", { ...it, invoice_id: invoiceId });
    }
    for (const old of oldItems) await dbDelete("invoiceItems", old.id);
    return invoiceId;
}

// מחיקה "רכה": החשבונית עוברת לפח ואפשר לשחזר אותה. היא לא נספרת בסיכומים, במלאי ובהתראות מחיר.
export async function deleteInvoice(id) {
    const inv = await dbGet("invoices", id);
    if (!inv) return;
    await dbPut("invoices", { ...inv, deleted_at: new Date().toISOString() });
}

export async function restoreInvoice(id) {
    const inv = await dbGet("invoices", id);
    if (!inv) return;
    const { deleted_at, ...rest } = inv;
    await dbPut("invoices", rest);
}

// מחיקה סופית (מהפח)
export async function purgeInvoice(id) {
    await dbDeleteWhere("invoiceItems", "invoice_id", id);
    await dbDelete("invoices", id);
}

// ניקוי אוטומטי: מה שנמצא בפח יותר מ-30 יום נמחק סופית
export async function purgeOldTrash(days = 30) {
    const cutoff = Date.now() - days * 86400000;
    for (const inv of await dbGetAll("invoices")) {
        if (inv.deleted_at && new Date(inv.deleted_at).getTime() < cutoff) await purgeInvoice(inv.id);
    }
}

// סיכום קנייה חודשי לפי ספק - מקביל לשאילתת monthly_rows ב-suppliers_page.
export async function monthlySummaryBySupplier() {
    const invoices = await listInvoicesWithItems();
    const summary = {};
    for (const inv of invoices) {
        const ym = (inv.invoice_date || "").slice(0, 7);
        const amount = inv.document_type === "credit" ? -inv.total_amount : inv.total_amount;
        summary[inv.supplier_name] = summary[inv.supplier_name] || {};
        summary[inv.supplier_name][ym] = (summary[inv.supplier_name][ym] || 0) + amount;
    }
    const out = {};
    for (const [supplierName, months] of Object.entries(summary)) {
        out[supplierName] = Object.entries(months)
            .sort((a, b) => b[0].localeCompare(a[0]))
            .map(([month, total]) => ({ month, total: Math.round(total * 100) / 100 }));
    }
    return out;
}


// ---------- התראות שינוי מחיר ----------
// מחיר ליחידת מזווה בכל שורה = מחיר השורה / stock_factor. משווים כל קנייה לקנייה הקודמת של אותו מוצר (זיכויים לא נספרים).
async function priceSeries() {
    const invoices = (await dbGetAll("invoices")).filter((i) => i.document_type !== "credit" && !i.deleted_at);
    const invById = Object.fromEntries(invoices.map((i) => [i.id, i]));
    const series = new Map();
    for (const it of await dbGetAll("invoiceItems")) {
        if (!it.pantry_item_id || !(it.unit_price > 0)) continue;
        const inv = invById[it.invoice_id];
        if (!inv) continue;
        const list = series.get(it.pantry_item_id) || [];
        list.push({ date: inv.invoice_date || "", invoice_id: inv.id, price: it.unit_price / (it.stock_factor || 1) });
        series.set(it.pantry_item_id, list);
    }
    for (const list of series.values()) list.sort((a, b) => a.date.localeCompare(b.date) || a.invoice_id - b.invoice_id);
    return series;
}

// היסטוריית מחירים של מוצר מזווה: כל קנייה (מחיר ליחידת מזווה) עם תאריך וספק, מהישן לחדש. זיכויים וחשבוניות בפח לא נספרים.
export async function priceHistory(pantryItemId) {
    const series = (await priceSeries()).get(pantryItemId) || [];
    if (!series.length) return [];
    const suppliers = Object.fromEntries((await dbGetAll("suppliers")).map((s) => [s.id, s.name]));
    const invoices = Object.fromEntries((await dbGetAll("invoices")).map((i) => [i.id, i]));
    return series.map((p) => ({ ...p, supplier: suppliers[(invoices[p.invoice_id] || {}).supplier_id] || "" }));
}

// מוצרים שנקנו מספק (לפי החשבוניות): לבניית הזמנה. מסודר לפי תדירות קנייה, ואז לפי שם.
export async function listSupplierProducts(supplierId) {
    const invoices = (await dbGetAll("invoices")).filter((i) => i.supplier_id === supplierId && !i.deleted_at && i.document_type !== "credit");
    const byId = new Map(invoices.map((i) => [i.id, i]));
    const groups = new Map();
    for (const it of await dbGetAll("invoiceItems")) {
        const inv = byId.get(it.invoice_id);
        if (!inv) continue;
        const key = it.pantry_item_id ? `p${it.pantry_item_id}` : `n${String(it.product_name || "").trim().toLowerCase()}`;
        if (key === "n") continue;
        const g = groups.get(key) || { key, pantry_item_id: it.pantry_item_id || null, name: String(it.product_name || "").trim(), count: 0, last_date: "", last_qty: null, last_price: null };
        g.count++;
        if ((inv.invoice_date || "") >= g.last_date) { g.last_date = inv.invoice_date || ""; g.last_qty = it.quantity; g.last_price = it.unit_price; if (it.product_name) g.name = String(it.product_name).trim(); }
        groups.set(key, g);
    }
    return [...groups.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "he"));
}

// טלפון הספק (לשליחת הזמנה בוואטסאפ). ריק = מסירת הטלפון.
export async function setSupplierPhone(id, phone) {
    const s = await dbGet("suppliers", id);
    if (!s) throw new Error("ספק לא נמצא");
    const clean = String(phone || "").trim();
    if (clean && !/^[\d+\-\s()]{7,20}$/.test(clean)) throw new Error("מספר טלפון לא תקין");
    await dbPut("suppliers", { ...s, phone: clean });
}

// מנות שמושפעות משינוי מחיר של מוצר מזווה (ישירות, או דרך מתכון שמשתמש בו)
export async function dishesAffectedByPantryItem(pantryItemId) {
    const allRecipeItems = await dbGetAll("recipeItems");
    const recipeIds = expandToParents(new Set(allRecipeItems.filter((r) => r.pantry_item_id === pantryItemId).map((r) => r.recipe_id)), allRecipeItems); // כולל מתכונים שמשתמשים בהם כתת-מתכון
    const dishIds = new Set();
    for (const di of await dbGetAll("dishItems")) {
        if ((di.source_type === "pantry" && di.source_id === pantryItemId) || (di.source_type === "recipe" && recipeIds.has(di.source_id))) dishIds.add(di.dish_id);
    }
    const dishes = await dbGetAll("dishes");
    return dishes.filter((d) => dishIds.has(d.id)).map((d) => d.name);
}

// invoiceId: רק שינויים שנוצרו בחשבונית הזו. עם sinceDays: כל השינויים בחלון הזמן. בלי שניהם: השינוי האחרון בכל מוצר.
export async function priceChanges({ thresholdPct = 10, invoiceId = null, sinceDays = null } = {}) {
    const series = await priceSeries();
    const pantry = Object.fromEntries((await dbGetAll("pantryItems")).map((p) => [p.id, p]));
    const out = [];
    const cutoff = sinceDays ? new Date(Date.now() - sinceDays * 86400000).toISOString().slice(0, 10) : null;
    for (const [pid, list] of series) {
        const p = pantry[pid];
        if (!p || list.length < 2) continue;
        const all = list.map((_, i) => i).filter((i) => i > 0);
        const idxs = invoiceId ? all.filter((i) => list[i].invoice_id === invoiceId) : cutoff ? all : [list.length - 1];
        for (const i of idxs) {
            const prev = list[i - 1], cur = list[i];
            if (!(prev.price > 0)) continue;
            const pct = ((cur.price - prev.price) / prev.price) * 100;
            if (Math.abs(pct) < thresholdPct) continue;
            if (cutoff && cur.date < cutoff) continue;
            out.push({ pantry_item_id: pid, name: p.name, unit_type: p.unit_type, prev: prev.price, cur: cur.price, pct: Math.round(pct * 10) / 10, date: cur.date, invoice_id: cur.invoice_id });
        }
    }
    out.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
    return out;
}

// ---------- דוח חודשי ----------
export async function monthlyReport(ym) {
    const invoices = (await listInvoicesWithItems()).filter((i) => (i.invoice_date || "").startsWith(ym));
    const pantry = Object.fromEntries((await dbGetAll("pantryItems")).map((p) => [p.id, p]));
    const rep = { month: ym, total: 0, invoice_count: invoices.length, by_supplier: {}, by_category: {}, petty_cash_total: 0, petty_cash_count: 0 };
    for (const inv of invoices) {
        const sign = inv.document_type === "credit" ? -1 : 1;
        rep.total += sign * inv.total_amount;
        rep.by_supplier[inv.supplier_name] = (rep.by_supplier[inv.supplier_name] || 0) + sign * inv.total_amount;
        if (inv.petty_cash) { rep.petty_cash_total += sign * inv.total_amount; rep.petty_cash_count += 1; }
        for (const it of inv.items) {
            const cat = it.pantry_item_id && pantry[it.pantry_item_id] ? pantry[it.pantry_item_id].category : "לא משויך למזווה";
            rep.by_category[cat] = (rep.by_category[cat] || 0) + sign * (it.line_total ?? it.quantity * it.unit_price);
        }
    }
    const r2 = (x) => Math.round(x * 100) / 100;
    rep.total = r2(rep.total);
    rep.petty_cash_total = r2(rep.petty_cash_total);
    for (const k of Object.keys(rep.by_supplier)) rep.by_supplier[k] = r2(rep.by_supplier[k]);
    for (const k of Object.keys(rep.by_category)) rep.by_category[k] = r2(rep.by_category[k]);
    return rep;
}

// ---------- ייצוא CSV (נפתח באקסל; BOM לעברית) ----------
function csvCell(v) {
    let t = v == null ? "" : String(v);
    // טקסט שמתחיל ב- = + - @ הופך לנוסחה באקסל - מקבל גרש בהתחלה (מספרים אמיתיים נשארים מספרים)
    if (typeof v === "string" && /^[=+\-@\t\r]/.test(t)) t = "'" + t;
    return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

export function invoicesToCsv(invoices) {
    const head = ["תאריך", "ספק", "סוג מסמך", "קופה קטנה", "רכש", "מוצר", "כמות", "מחיר ליחידה", "סה\"כ שורה", "יש תמונה"];
    const rows = [head];
    for (const inv of invoices) {
        for (const it of inv.items) {
            rows.push([
                inv.invoice_date, inv.supplier_name, inv.document_type === "credit" ? "זיכוי" : "חשבונית",
                inv.petty_cash ? "כן" : "", inv.purchaser || "", it.product_name, it.quantity, it.unit_price,
                it.line_total ?? Math.round(it.quantity * it.unit_price * 100) / 100, inv.has_image ? "כן" : "",
            ]);
        }
    }
    return "\ufeff" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
}


// קופה קטנה שעדיין לא הוחזרה לעובד: { count, total }
export async function pettyCashOwed() {
    let count = 0, total = 0;
    for (const inv of await dbGetAll("invoices")) {
        if (inv.deleted_at || !inv.petty_cash || inv.reimbursed || inv.document_type === "credit") continue;
        count += 1;
        total += inv.total_amount;
    }
    return { count, total: Math.round(total * 100) / 100 };
}

// מחליף סטטוס החזר של חשבונית קופה קטנה (אדום = ממתין, ירוק = הוחזר). מחזיר false אם החשבונית לא קופה קטנה.
export async function setPettyReimbursed(id, reimbursed) {
    const inv = await dbGet("invoices", id);
    if (!inv || !inv.petty_cash) return false;
    await dbPut("invoices", { ...inv, reimbursed: !!reimbursed });
    return true;
}

export async function markAllPettyCashReimbursed() {
    for (const inv of await dbGetAll("invoices")) {
        if (!inv.deleted_at && inv.petty_cash && !inv.reimbursed) await dbPut("invoices", { ...inv, reimbursed: true });
    }
}

// חשבונית שנראית כמו כפולה: אותו ספק, אותו תאריך ואותו סכום
export async function findDuplicateInvoice({ supplierId, date, total, excludeId = null }) {
    const list = await dbGetByIndex("invoices", "supplier_id", parseInt(supplierId, 10));
    return list.find((i) => !i.deleted_at && i.id !== excludeId && i.invoice_date === date && Math.abs(i.total_amount - total) < 0.01) || null;
}
