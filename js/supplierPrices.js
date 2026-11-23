// מוצר שמגיע ביותר מספק אחד: לכל ספק נשמר המחיר האחרון שלו, ומחיר המוצר הוא הממוצע הפשוט שלהם. טהור (בלי DB), נבדק ב-tests/supplier_prices.verify.mjs.
// item.suppliers = [{ supplier_id, price }] (שני ספקים ומעלה). מוצר בלי השדה הזה נשאר עם מחיר אחד, כמו תמיד.

const round4 = (n) => Math.round(n * 10000) / 10000;

export function avgPrice(suppliers) {
    const list = (suppliers || []).filter((s) => Number(s.price) >= 0);
    return list.length ? round4(list.reduce((n, s) => n + Number(s.price), 0) / list.length) : 0;
}

// הספקים שידועים למוצר: הרשימה השמורה, אחרת הספק של החשבונית האחרונה (previousId)
export function knownSupplierIds(item, previousId = null) {
    if (item && Array.isArray(item.suppliers) && item.suppliers.length) return item.suppliers.map((s) => Number(s.supplier_id));
    return previousId != null ? [Number(previousId)] : [];
}

// מחשב את המחיר והספקים של מוצר קיים אחרי שורה בחשבונית.
// supplierId: ספק החשבונית (או null). additional: המשתמש אישר "ספק נוסף". previousId: הספק הקודם של המוצר (מחשבונית אחרונה).
// מחזיר { price, suppliers } כש-suppliers = null אומר "מוצר עם ספק אחד" (השדה יימחק).
export function nextSupplierPrice(item, supplierId, newPrice, { additional = false, previousId = null } = {}) {
    const sid = supplierId == null || supplierId === "" ? null : Number(supplierId);
    const list = Array.isArray(item.suppliers) ? item.suppliers.map((s) => ({ supplier_id: Number(s.supplier_id), price: Number(s.price) })) : null;
    if (sid != null && list && list.some((s) => s.supplier_id === sid)) {
        list.find((s) => s.supplier_id === sid).price = newPrice;
        return { price: avgPrice(list), suppliers: list };
    }
    if (sid != null && additional) {
        const base = list || (previousId != null && Number(previousId) !== sid ? [{ supplier_id: Number(previousId), price: Number(item.price) || 0 }] : []);
        if (base.length) {
            const next = [...base, { supplier_id: sid, price: newPrice }];
            return { price: avgPrice(next), suppliers: next };
        }
    }
    return { price: newPrice, suppliers: null };
}

// ספק מוסר מהרשימה: נשארו שניים ומעלה = ממוצע, אחד = מחיר שלו בלבד
export function removeSupplier(item, supplierId) {
    const list = (item.suppliers || []).filter((s) => Number(s.supplier_id) !== Number(supplierId));
    if (list.length >= 2) return { price: avgPrice(list), suppliers: list };
    if (list.length === 1) return { price: Number(list[0].price), suppliers: null };
    return { price: Number(item.price) || 0, suppliers: null };
}
