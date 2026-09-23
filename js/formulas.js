// מנוע התמחור - תרגום מדויק של הנוסחאות מתוך main.py (Python).
// אסור לשנות כאן לוגיקה בלי לשנות גם ב-main.py - שתי הגרסאות חייבות להישאר זהות.

export const ICE_GLAZE_DEDUCTION = 0.20; // 20% ניכוי קרח למוצרים קפואים

// מקביל ל-round() של פייתון (round-half-to-even) על מספר עשרוני - קירוב סביר,
// לא מבטיח זהות מוחלטת ב-100% מהמקרים בגלל ייצוג floating point, אך זהה כמעט תמיד.
export function pyRound(value, decimals = 0) {
    const factor = Math.pow(10, decimals);
    const scaled = value * factor;
    const rounded = Math.round(scaled);
    if (Math.abs(scaled - Math.floor(scaled) - 0.5) < 1e-9) {
        const floor = Math.floor(scaled);
        const isEven = floor % 2 === 0;
        return (isEven ? floor : floor + 1) / factor;
    }
    return rounded / factor;
}

// מחשב את המחיר האמיתי לק"ג/ליטר/יחידה אחרי ניצולת וקרח.
export function effectivePrice(price, yieldPct, isFrozen) {
    let yieldFactor = (yieldPct || 100) / 100;
    if (yieldFactor <= 0) yieldFactor = 1;
    const iceFactor = isFrozen ? (1 - ICE_GLAZE_DEDUCTION) : 1;
    return pyRound(price / (yieldFactor * iceFactor), 2);
}

// ממיר את המחיר האמיתי של מרכיב למחיר-לגרם אחיד, לשימוש במתכונים.
export function pricePerGram(item) {
    const eff = effectivePrice(item.price, item.yield_pct, item.is_frozen);
    if (item.unit_type === "weight" || item.unit_type === "liter") {
        return eff / 1000;
    }
    const amount = item.unit_amount || 1;
    return eff / amount;
}

// מחשב אחוז ניצולת ממשקל לפני/אחרי (אם שניהם קיימים), אחרת מחזיר את הערך הידני.
export function computeYieldPct(weightBefore, weightAfter, manualYieldPct) {
    if (weightBefore && weightAfter) {
        return pyRound((weightAfter / weightBefore) * 100, 2);
    }
    const y = manualYieldPct == null ? 100 : manualYieldPct;
    if (!(y > 0 && y <= 1000)) {
        throw new Error("ניצולת חייבת להיות מספר חיובי");
    }
    return y;
}

// מחשב עלות שורת מרכיב במתכון/מנה: item_cost = price_per_gram * quantity_g (מעוגל ל-4 ספרות).
export function itemCost(pricePerGramValue, quantityG) {
    return pyRound(pricePerGramValue * quantityG, 4);
}

// מחשב cost_per_gram למתכון: total_cost / final_weight (0 אם המשקל 0).
export function recipeCostPerGram(totalCost, finalWeight) {
    return finalWeight > 0 ? pyRound(totalCost / finalWeight, 4) : 0;
}

// מחשב את כל שדות התמחור של מנה, בדיוק כמו add_dish/update_dish ב-main.py.
export function computeDishPricing(totalCost, sellingPrice, vatPct) {
    totalCost = pyRound(totalCost, 2);
    const priceBeforeVat = vatPct ? sellingPrice / (1 + vatPct / 100) : sellingPrice;
    const profitAmount = pyRound(priceBeforeVat - totalCost, 2);
    const profitPct = priceBeforeVat > 0 ? pyRound((profitAmount / priceBeforeVat) * 100, 2) : 0;
    const foodCostPct = priceBeforeVat > 0 ? pyRound((totalCost / priceBeforeVat) * 100, 2) : 0;
    return {
        total_cost: totalCost,
        price_before_vat: pyRound(priceBeforeVat, 2),
        profit_amount: profitAmount,
        profit_pct: profitPct,
        food_cost_pct: foodCostPct,
    };
}
