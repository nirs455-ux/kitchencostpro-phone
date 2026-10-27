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

export const EGG_PARTS = [["whole", "שלמה"], ["white", "חלבון"], ["yolk", "חלמון"]];
export const EGG_PART_LABEL = Object.fromEntries(EGG_PARTS);
// שמות לתצוגה בממשק: "חלבון" לבד הוא גם רכיב תזונה (Protein), ולכן בתצוגה כותבים "חלבון ביצה" כדי שהתרגום יהיה נכון (Egg white)
export const EGG_PART_UI = { whole: "שלמה", white: "חלבון ביצה", yolk: "חלמון" };

// מוצר ביצה בחומרי הגלם: ברמה העליונה, ביחידות, ובשם יש "ביצ"
export function isEggProduct(row) {
    return !!row && !row.parent_id && row.unit_type === "unit" && isEggName(row.name);
}

export function eggSizeOf(row) {
    return row && EGG_SIZES[row.egg_size] ? row.egg_size : guessEggSize(row && row.name);
}

// כמה גרם הוא חלק אחד של ביצה בגודל נתון: שלמה (נוזל ללא קליפה) / חלבון / חלמון
export function partGrams(size, part) {
    const e = EGG_SIZES[size] || EGG_SIZES.M;
    return part === "white" ? e.white : part === "yolk" ? e.yolk : e.liquid;
}

const round1 = (x) => Math.round(x * 10) / 10;

// חישוב ביצים לכמה גרמים משלושת החלקים. מחזיר { eggs, wholeEggs, ...שאריות ועלות } או null.
// wholeG מבצה שלמה (לפי משקל נוזל), whiteG/yolkG מחלקים - נשברות ביצים עד שהחלק הדורש יותר מסופק, והשאר נשאר.
export function eggBreakdown({ size, wholeG = 0, whiteG = 0, yolkG = 0, eggPrice = 0 }) {
    const e = EGG_SIZES[size] || EGG_SIZES.M;
    wholeG = Number(wholeG) || 0;
    const parts = eggsNeeded({ whiteG, yolkG, white: e.white, yolk: e.yolk, eggPrice });
    const wholeEggs = wholeG > 0 ? Math.ceil(wholeG / e.liquid - 1e-9) : 0;
    if (!parts && !wholeEggs) return null;
    const p = parts || { eggs: 0, leftWhiteG: 0, leftWhiteCount: 0, leftYolkG: 0, leftYolkCount: 0 };
    const eggs = p.eggs + wholeEggs;
    return { ...p, eggs, wholeEggs, size, eggsCost: Math.round(eggs * eggPrice * 100) / 100 };
}

// סיכום ביצים למתכון: items = [{ pantry_item_id, quantity_g, egg_part, egg_size? }], rows = כל שורות חומרי הגלם.
export function recipeEggSummary(items, rows) {
    const byId = new Map(rows.map((r) => [r.id, r]));
    const groups = new Map();
    for (const it of items) {
        const row = byId.get(Number(it.pantry_item_id));
        if (!row || !isEggProduct(row) || !EGG_PART_LABEL[it.egg_part]) continue;
        const g = groups.get(row.id) || { whole: 0, white: 0, yolk: 0, size: it.egg_size && EGG_SIZES[it.egg_size] ? it.egg_size : eggSizeOf(row) };
        g[it.egg_part] += Number(it.quantity_g) || 0;
        groups.set(row.id, g);
    }
    const out = [];
    for (const [id, g] of groups) {
        const row = byId.get(id);
        const r = eggBreakdown({ size: g.size, wholeG: g.whole, whiteG: g.white, yolkG: g.yolk, eggPrice: row.price });
        if (r) out.push({ name: row.name, ...r });
    }
    return out;
}

export function eggSummaryText(e) {
    const left = [];
    if (e.leftWhiteCount > 0) left.push(`${e.leftWhiteCount} חלבונים (${e.leftWhiteG} גרם)`);
    if (e.leftYolkCount > 0) left.push(`${e.leftYolkCount} חלמונים (${e.leftYolkG} גרם)`);
    return `🥚 ${e.name}: לשבור ${e.eggs} ביצים` + (left.length ? ` · נשארים ${left.join(" ו-")}` : "");
}

// עלות ביצים במתכון = כל הביצים ששוברים * מחיר ביצה (משלמים על כולן, גם אם משתמשים רק בחלק מהחלבון/החלמון).
// העלות מתחלקת בין שורות הביצים לפי הגרמים שלהן, והסכום שווה בדיוק לעלות הביצים. lines = [{ egg_part, grams }]
export function allocateEggCosts(lines, size, eggPrice) {
    const sum = (part) => lines.filter((l) => l.egg_part === part).reduce((n, l) => n + (Number(l.grams) || 0), 0);
    const b = eggBreakdown({ size, wholeG: sum("whole"), whiteG: sum("white"), yolkG: sum("yolk"), eggPrice });
    const totalG = lines.reduce((n, l) => n + (Number(l.grams) || 0), 0);
    if (!b || !(totalG > 0)) return { costs: lines.map(() => 0), breakdown: b };
    let left = Math.round(b.eggsCost * 10000) / 10000;
    const costs = lines.map((l, i) => {
        if (i === lines.length - 1) return left;
        const c = Math.round(((b.eggsCost * (Number(l.grams) || 0)) / totalG) * 10000) / 10000;
        left = Math.round((left - c) * 10000) / 10000;
        return c;
    });
    return { costs, breakdown: b };
}
