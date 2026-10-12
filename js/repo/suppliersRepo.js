// לוגיקת ספקים/חשבוניות - תרגום מדויק של add_supplier/delete_supplier/_parse_invoice_payload/add_invoice/update_invoice/delete_invoice.
import { dbGetAll, dbGet, dbPut, dbDelete, dbGetByIndex, dbDeleteWhere } from "../db.js";

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
export async function getSupplierDeleteInfo(id) {
    const supplier = await dbGet("suppliers", id);
    if (!supplier) throw new Error("ספק לא נמצא");
    const invoices = await dbGetByIndex("invoices", "supplier_id", id);
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
    const documentType = data.document_type || "invoice";
    if (!["invoice", "credit"].includes(documentType)) throw new Error("סוג מסמך לא תקין");
    if (!data.items || data.items.length === 0) throw new Error("יש להוסיף לפחות שורה אחת");

    let total = 0;
    const resolved = [];
    for (const it of data.items) {
        const name = (it.product_name || "").trim();
        if (!name) throw new Error("יש להזין שם מוצר לכל שורה");
        const qty = parseFloat(it.quantity);
        if (Number.isNaN(qty)) throw new Error("כמות/מחיר לא תקינים");
        if (qty <= 0) throw new Error("כמות חייבת להיות גדולה מ-0");
        // הנתונים נשמרים כפי שהוזנו/מופיעים בקבלה: סכום שורה שהוזן נשמר כמו שהוא (לא מחושב מחדש);
        // אם חסר מחיר ליחידה - נגזר מהסכום; אם חסר סכום - כמות x מחיר.
        const hasPrice = it.unit_price !== null && it.unit_price !== undefined && it.unit_price !== "";
        const hasTotal = it.line_total !== null && it.line_total !== undefined && it.line_total !== "";
        let unitPrice = hasPrice ? parseFloat(it.unit_price) : null;
        let lineTotal = hasTotal ? Math.round(parseFloat(it.line_total) * 100) / 100 : null;
        if ((hasPrice && Number.isNaN(unitPrice)) || (hasTotal && Number.isNaN(lineTotal))) throw new Error("כמות/מחיר לא תקינים");
        if (unitPrice === null && lineTotal === null) throw new Error("כמות/מחיר לא תקינים");
        if (unitPrice === null) unitPrice = Math.round((lineTotal / qty) * 10000) / 10000;
        if (lineTotal === null) lineTotal = Math.round(qty * unitPrice * 100) / 100;
        if (unitPrice < 0 || lineTotal < 0) throw new Error("מחיר/סכום לא יכולים להיות שליליים");
        total += lineTotal;
        let pantryItemId = it.pantry_item_id || null;
        if (pantryItemId) pantryItemId = parseInt(pantryItemId, 10);
        const sf = parseFloat(it.stock_factor);
        const stockFactor = Number.isFinite(sf) && sf > 0 && sf !== 1 ? sf : null;
        resolved.push({ product_name: name, quantity: qty, unit_price: unitPrice, line_total: lineTotal, pantry_item_id: pantryItemId, stock_factor: stockFactor });
    }
    return { supplier_id: supplierId, invoice_date: invoiceDate, document_type: documentType, items: resolved, total: Math.round(total * 100) / 100 };
}

export async function listInvoicesWithItems() {
    const suppliers = await listSuppliers();
    const supplierById = Object.fromEntries(suppliers.map((s) => [s.id, s.name]));
    const invoices = await dbGetAll("invoices");
    const out = [];
    for (const inv of invoices) {
        const items = await dbGetByIndex("invoiceItems", "invoice_id", inv.id);
        out.push({ ...inv, supplier_name: supplierById[inv.supplier_id] || "?", items });
    }
    for (const inv of out) inv.has_image = inv.image instanceof Blob;
    out.sort((a, b) => (b.invoice_date || "").localeCompare(a.invoice_date || "") || b.id - a.id);
    return out;
}

export async function saveInvoice(existingId, data) {
    const clean = parseInvoicePayload(data);
    const supplier = await dbGet("suppliers", clean.supplier_id);
    if (!supplier) throw new Error("ספק לא נמצא");

    const invoiceRow = { supplier_id: clean.supplier_id, invoice_date: clean.invoice_date, total_amount: clean.total, document_type: clean.document_type };
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
        await dbDeleteWhere("invoiceItems", "invoice_id", existingId);
    } else {
        invoiceId = await dbPut("invoices", invoiceRow);
    }
    for (const it of clean.items) {
        await dbPut("invoiceItems", { ...it, invoice_id: invoiceId });
    }
    return invoiceId;
}

export async function deleteInvoice(id) {
    await dbDeleteWhere("invoiceItems", "invoice_id", id);
    await dbDelete("invoices", id);
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
