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

export async function deleteSupplier(id) {
    const invoices = await dbGetByIndex("invoices", "supplier_id", id);
    if (invoices.length > 0) throw new Error("לא ניתן למחוק ספק שיש לו חשבוניות - מחק קודם את החשבוניות");
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
        const unitPrice = parseFloat(it.unit_price);
        if (Number.isNaN(qty) || Number.isNaN(unitPrice)) throw new Error("כמות/מחיר לא תקינים");
        if (qty <= 0 || unitPrice < 0) throw new Error("כמות חייבת להיות גדולה מ-0");
        const lineTotal = Math.round(qty * unitPrice * 100) / 100;
        total += lineTotal;
        let pantryItemId = it.pantry_item_id || null;
        if (pantryItemId) pantryItemId = parseInt(pantryItemId, 10);
        resolved.push({ product_name: name, quantity: qty, unit_price: unitPrice, line_total: lineTotal, pantry_item_id: pantryItemId });
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
    out.sort((a, b) => (b.invoice_date || "").localeCompare(a.invoice_date || "") || b.id - a.id);
    return out;
}

export async function saveInvoice(existingId, data) {
    const clean = parseInvoicePayload(data);
    const supplier = await dbGet("suppliers", clean.supplier_id);
    if (!supplier) throw new Error("ספק לא נמצא");

    const invoiceRow = { supplier_id: clean.supplier_id, invoice_date: clean.invoice_date, total_amount: clean.total, document_type: clean.document_type };
    let invoiceId = existingId;
    if (existingId) {
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
