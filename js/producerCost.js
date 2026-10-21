// עלות מוצר של יצרן: תוכן (המתכון) + אריזה. טהור (בלי DOM/DB) כדי שאפשר לבדוק ב-Node.
// אריזה = מוצרים מהמזווה (צנצנת, מכסה, קופסה, מדבקה...). מוצר ביחידות: כמות ביחידות. מוצר במשקל/נפח: כמות בק"ג/ליטר.
import { effectivePrice } from "./formulas.js";

const r2 = (n) => Math.round(n * 100) / 100;

// packaging: [{ pantry_item_id, qty }], pantryById: Map/obj של שורות מזווה
export function packagingCost(packaging, pantryById) {
    const get = (id) => (pantryById instanceof Map ? pantryById.get(id) : pantryById[id]);
    const lines = [];
    let total = 0;
    for (const p of packaging || []) {
        const row = get(p.pantry_item_id);
        const qty = Number(p.qty) || 0;
        if (!row || !(qty > 0)) continue;
        const unitPrice = effectivePrice(row.price, row.yield_pct, row.is_frozen);
        const cost = unitPrice * qty;
        total += cost;
        lines.push({ name: row.name, qty, unit_type: row.unit_type, cost: r2(cost) });
    }
    return { total: r2(total), lines };
}

// recipe: { cost_per_gram }, product: { net_g, packaging, sell_price }, vatPct: מע"מ (ברירת מחדל 18)
export function productEconomics({ recipe, product, pantryById, vatPct = 18 }) {
    const contentCost = recipe && product.net_g > 0 ? (Number(recipe.cost_per_gram) || 0) * product.net_g : 0;
    const pack = packagingCost(product.packaging, pantryById);
    const totalCost = contentCost + pack.total;
    const sell = Number(product.sell_price) || 0; // לפני מע"מ
    const out = {
        contentCost: r2(contentCost), packagingCost: pack.total, packagingLines: pack.lines, totalCost: r2(totalCost),
        packagingPct: totalCost > 0 ? r2((pack.total / totalCost) * 100) : 0,
        sell, sellWithVat: sell > 0 ? r2(sell * (1 + vatPct / 100)) : 0,
        profit: sell > 0 ? r2(sell - totalCost) : null,
        profitPct: sell > 0 ? r2(((sell - totalCost) / sell) * 100) : null,
        costPct: sell > 0 ? r2((totalCost / sell) * 100) : null,
    };
    return out;
}
