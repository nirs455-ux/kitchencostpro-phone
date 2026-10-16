// תבנית ביצים: משקלים קבועים (בלי קליפה) של ביצה שלמה, חלבון וחלמון לפי גודל.
// העלות מתחלקת בין חלבון לחלמון לפי משקל: כל גרם מבצה שבורה עולה אותו דבר. לא נוגעים בנוסחאות המחיר.

export const EGG_SIZES = {
    S: { liquid: 45, white: 29, yolk: 16 },
    M: { liquid: 52, white: 33, yolk: 19 },
    L: { liquid: 61, white: 39, yolk: 22 },
    XL: { liquid: 67, white: 43, yolk: 24 },
};

export function isEggName(name) {
    return /ביצ/.test(String(name || ""));
}

// ניחוש גודל מהשם ("ביצים L", "ביצה גודל XL", "ביצים M 30"). ברירת מחדל: M
export function guessEggSize(name) {
    const n = String(name || "").toUpperCase();
    if (/(^|[^A-Z])XL([^A-Z]|$)/.test(n) || n.includes("גדול מאוד")) return "XL";
    if (/(^|[^A-Z])L([^A-Z]|$)/.test(n) || n.includes("גדולה") || n.includes("גדול")) return "L";
    if (/(^|[^A-Z])S([^A-Z]|$)/.test(n) || n.includes("קטנה") || n.includes("קטן")) return "S";
    return "M";
}

const round4 = (x) => Math.round(x * 10000) / 10000;

// מחיר ליחידה (חלבון אחד / חלמון אחד) כך שהמחיר לגרם זהה לביצה השלמה (price/liquid)
export function partPrice(eggPrice, liquid, part) {
    if (!(liquid > 0) || !(part > 0)) return 0;
    return round4((eggPrice * part) / liquid);
}

// כמה ביצים לשבור כדי לקבל גרמי חלבון / חלמון. מחזיר גם מה נשאר מהחלק השני ומה העלות.
export function eggsNeeded({ whiteG = 0, yolkG = 0, white, yolk, eggPrice = 0 }) {
    whiteG = Number(whiteG) || 0;
    yolkG = Number(yolkG) || 0;
    if (!(white > 0) || !(yolk > 0)) return null;
    if (whiteG <= 0 && yolkG <= 0) return null;
    const eggs = Math.max(whiteG > 0 ? Math.ceil(whiteG / white - 1e-9) : 0, yolkG > 0 ? Math.ceil(yolkG / yolk - 1e-9) : 0);
    const leftWhiteG = Math.round((eggs * white - whiteG) * 10) / 10;
    const leftYolkG = Math.round((eggs * yolk - yolkG) * 10) / 10;
    const ppgLiquid = eggPrice / (white + yolk);
    return {
        eggs,
        leftWhiteG, leftWhiteCount: Math.floor(leftWhiteG / white + 1e-9),
        leftYolkG, leftYolkCount: Math.floor(leftYolkG / yolk + 1e-9),
        eggsCost: Math.round(eggs * eggPrice * 100) / 100,
        usedCost: Math.round((whiteG + yolkG) * ppgLiquid * 100) / 100,
    };
}

// סיכום ביצים למתכון: items = [{ pantry_item_id, quantity_g }], rows = כל שורות המזווה.
// מחזיר לכל סוג ביצה שחלבון/חלמון שלו במתכון: כמה ביצים לשבור וכמה נשאר.
export function recipeEggSummary(items, rows) {
    const byId = new Map(rows.map((r) => [r.id, r]));
    const groups = new Map();
    for (const it of items) {
        const row = byId.get(Number(it.pantry_item_id));
        if (!row || !row.egg_part || !row.parent_id) continue;
        const g = groups.get(row.parent_id) || { whiteG: 0, yolkG: 0 };
        if (row.egg_part === "white") g.whiteG += Number(it.quantity_g) || 0;
        else g.yolkG += Number(it.quantity_g) || 0;
        groups.set(row.parent_id, g);
    }
    const out = [];
    for (const [parentId, g] of groups) {
        const parent = byId.get(parentId);
        const white = rows.find((r) => r.parent_id === parentId && r.egg_part === "white");
        const yolk = rows.find((r) => r.parent_id === parentId && r.egg_part === "yolk");
        if (!parent || !white || !yolk) continue;
        const r = eggsNeeded({ whiteG: g.whiteG, yolkG: g.yolkG, white: white.unit_amount, yolk: yolk.unit_amount, eggPrice: parent.price });
        if (r) out.push({ name: parent.name, ...g, ...r });
    }
    return out;
}

export function eggSummaryText(e) {
    const left = [];
    if (e.leftWhiteG > 0 && e.leftWhiteCount > 0) left.push(`${e.leftWhiteCount} חלבונים (${e.leftWhiteG} גרם)`);
    if (e.leftYolkG > 0 && e.leftYolkCount > 0) left.push(`${e.leftYolkCount} חלמונים (${e.leftYolkG} גרם)`);
    return `🥚 ${e.name}: לשבור ${e.eggs} ביצים` + (left.length ? ` · נשארים ${left.join(" ו-")}` : "");
}
