// קבלות לפי ספק: איחוד שמות ספק כתובים שונה ("אלקטרה בע״מ" / "אלקטרה בעמ"), תיקייה לכל ספק, ושמות קבצים לשליחה. טהור.

export function supplierKey(name) {
    let s = String(name || "").toLowerCase().replace(/[׳״"'`.,]/g, "").replace(/\s+/g, " ").trim();
    s = s.replace(/\s(בעמ|ltd|inc)$/, "").trim();
    return s;
}

// invoices: [{ supplier_name, invoice_date, total_amount, image }] -> [{ key, name, files: [...] }] ממוין לפי שם
export function groupBySupplier(invoices) {
    const map = new Map();
    for (const inv of invoices) {
        const raw = String(inv.supplier_name || "").trim();
        const key = supplierKey(raw) || "—";
        if (!map.has(key)) map.set(key, { key, names: new Map(), files: [] });
        const g = map.get(key);
        if (raw) g.names.set(raw, (g.names.get(raw) || 0) + 1);
        g.files.push(inv);
    }
    return [...map.values()]
        .map((g) => {
            const best = [...g.names.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0];
            return { key: g.key, name: best ? best[0] : "ללא ספק", files: g.files };
        })
        .sort((a, b) => a.name.localeCompare(b.name, "he"));
}

export const monthOf = (inv) => String(inv.invoice_date || "").slice(0, 7); // YYYY-MM

const EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "application/pdf": "pdf" };
export const extOf = (type) => EXT[type] || "bin";

// שם קובץ: תאריך_ספק_סכום.סיומת  (למשל 2026-10-03_אלקטרה_184.50.jpg)
export function receiptFileName(inv, supplierName) {
    const amt = Number(inv.total_amount) > 0 ? "_" + Number(inv.total_amount).toFixed(2) : "";
    return `${inv.invoice_date || "ללא-תאריך"}_${supplierName}${amt}.${extOf(inv.image && inv.image.type)}`;
}
