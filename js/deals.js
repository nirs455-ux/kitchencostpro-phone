// מבצעים בחשבונית: שיוך שורת מבצע למוצר שמעליה, ומחיר לאחר הנחה לפי החשבונית האחרונה. טהור (בלי DOM/DB).
// מחיר חומר הגלם לא משתנה: המחיר לאחר הנחה מחושב מהחשבוניות בכל פעם, ולכן עריכה, מחיקה וחשבונית חדשה משפיעות מיד.

const GENERAL = /כללי|חשבונית|עסקה|קניה|קנייה|קופון|סה["\u05f4]?כ/;
const SPECIFIC = /מבצע|\d\s*ב[-־\s]*\d|\d\s*\+\s*\d/;
const SKIP_WORDS = new Set(["מבצע", "הנחה", "הנחת"]);
const words = (s) => String(s || "").split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3 && !SKIP_WORDS.has(w) && !/^\d+$/.test(w));
const round4 = (n) => Math.round(n * 10000) / 10000;

const belongs = (promoName, productName) => {
    if (GENERAL.test(promoName)) return false;
    if (SPECIFIC.test(promoName)) return true;
    const own = new Set(words(productName));
    return words(promoName).some((w) => own.has(w));
};

// lines לפי סדר החשבונית: { name, quantity, unitPrice, promo, deposit }. בשורת מבצע הסכום הוא |כמות x מחיר|.
// מחזיר Map: אינדקס שורת המוצר -> { names, amount, unitPrice, netUnitPrice }. שורה שאי אפשר לשייך לא מופיעה.
export function linkPromos(lines) {
    const out = new Map();
    let target = -1;
    lines.forEach((line, i) => {
        if (!line.promo) { target = line.deposit ? -1 : i; return; }
        if (target < 0) return;
        const product = lines[target];
        const qty = Number(product.quantity), price = Number(product.unitPrice);
        const amount = Math.abs((Number(line.quantity) || 0) * (Number(line.unitPrice) || 0));
        if (!(qty > 0) || !(price > 0) || !(amount > 0) || !belongs(String(line.name || ""), product.name)) return;
        const prev = out.get(target) || { names: [], amount: 0 };
        const total = prev.amount + amount;
        if (total >= qty * price) return; // הנחה שגדולה מהשורה עצמה: כנראה לא שייכת לה
        out.set(target, { names: [...prev.names, String(line.name || "").trim()], amount: total, unitPrice: price, netUnitPrice: round4((qty * price - total) / qty) });
    });
    return out;
}

// מחיר לאחר הנחה לכל חומר גלם (ליחידת חומר גלם), רק אם בחשבונית האחרונה שלו היה מבצע. Map: pantryId -> מחיר
export function dealPrices(invoices, invoiceItems) {
    const live = new Map(invoices.filter((v) => !v.deleted_at && v.document_type !== "credit").map((v) => [v.id, v]));
    const byInvoice = new Map();
    for (const row of [...invoiceItems].sort((a, b) => a.id - b.id)) {
        if (!live.has(row.invoice_id)) continue;
        if (!byInvoice.has(row.invoice_id)) byInvoice.set(row.invoice_id, []);
        byInvoice.get(row.invoice_id).push(row);
    }
    const ordered = [...byInvoice.keys()].map((id) => live.get(id)).sort((a, b) => String(a.invoice_date || "").localeCompare(String(b.invoice_date || "")) || a.id - b.id);
    const out = new Map();
    for (const inv of ordered) { // מהישנה לחדשה: החשבונית האחרונה קובעת
        const rows = byInvoice.get(inv.id);
        const links = linkPromos(rows.map((r) => ({ name: r.product_name, quantity: r.quantity, unitPrice: r.unit_price, promo: !!r.promo, deposit: r.deposit })));
        const here = new Map();
        rows.forEach((r, i) => {
            if (r.promo || r.deposit || r.no_price || !r.pantry_item_id) return;
            const link = links.get(i);
            if (link) here.set(r.pantry_item_id, link.netUnitPrice / (Number(r.stock_factor) || 1));
            else if (!here.has(r.pantry_item_id)) here.set(r.pantry_item_id, null);
        });
        for (const [id, price] of here) { if (price === null) out.delete(id); else out.set(id, price); }
    }
    return out;
}

// השורה לחישוב: במחיר לאחר הנחה רק אם נבחר בשורה ויש כזה, והוא נמוך ממחיר חומר הגלם
export const withDeal = (item, useDeal, deals) => {
    const price = useDeal && deals ? deals.get(item.id) : null;
    return price > 0 && price < Number(item.price) ? { ...item, price } : item;
};
