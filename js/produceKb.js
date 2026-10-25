// הערכות משקל ליחידה ותפוקת מיץ לפירות וירקות נפוצים. אלו ממוצעים להערכה בלבד (גודל, זן ועונה משנים), ולכן כל מקום שמשתמש בהם מסמן "הערכה".
// טהור (בלי DOM), נבדק ב-tests/produce_kb.verify.mjs

// [תבנית שם, גרם ליחידה בינונית, קטנה, גדולה]. סדר חשוב: הספציפי לפני הכללי.
const UNIT_G = [
    [/עגבני.*שרי|שרי.*עגבני/, 15, 10, 25],
    [/עגבני/, 120, 80, 180],
    [/מלפפון/, 130, 90, 180],
    [/בצל ירוק|בצלצל/, 20, 12, 30],
    [/בצל/, 150, 90, 220],
    [/שן שום|שיני שום/, 4, 3, 6],
    [/שום/, 50, 35, 70],
    [/גזר/, 80, 50, 130],
    [/תפו.?א|תפוח אדמה|תפוחי אדמה/, 170, 110, 250],
    [/בטטה/, 250, 150, 400],
    [/פלפל חריף|צילי|ג.לפניו/, 20, 10, 40],
    [/פלפל/, 180, 120, 250],
    [/חציל/, 350, 220, 500],
    [/קישוא/, 150, 100, 220],
    [/לימון/, 100, 70, 150],
    [/ליים/, 70, 50, 90],
    [/תפוז/, 200, 140, 280],
    [/אשכולית/, 350, 250, 500],
    [/אבוקדו/, 220, 150, 320],
    [/תפוח/, 180, 120, 250],
    [/בננה/, 120, 90, 160],
];

// גודל: s קטנה, m בינונית (ברירת מחדל), l גדולה
export function unitWeightG(name, size = "m") {
    const n = String(name || "");
    for (const [re, m, s, l] of UNIT_G) if (re.test(n)) return size === "s" ? s : size === "l" ? l : m;
    return null;
}

// [תבנית שם הפרי, מ"ל מיץ ליחידה בינונית, גרם ליחידה בינונית]
const JUICE = [
    [/לימון/, 40, 100],
    [/ליים/, 25, 70],
    [/תפוז/, 70, 200],
    [/אשכולית/, 150, 350],
    [/רימון/, 120, 300],
];

export function juiceInfo(name) {
    const n = String(name || "");
    for (const [re, ml, weightG] of JUICE) if (re.test(n)) return { ml, weightG };
    return null;
}

// "מיץ לימון" -> "לימון" (אחרת null). "מיץ לימון סחוט" ו"מיץ לימון טרי" גם.
export function juiceFruitName(name) {
    const m = String(name || "").trim().match(/^מיץ\s+(?:של\s+)?(.+)$/);
    if (!m) return null;
    const fruit = m[1].replace(/(\s+(סחוט|טרי|טרייה|סחיט))+$/, "").trim();
    return fruit || null;
}

// כמה גרם פרי צריך כדי לקבל ml מ"ל מיץ (לפי ממוצע), ו/או כמה יחידות
export function gramsFromJuiceMl(fruitName, ml) {
    const j = juiceInfo(fruitName);
    return j && ml > 0 ? (ml / j.ml) * j.weightG : null;
}
export function fruitsFromJuiceMl(fruitName, ml) {
    const j = juiceInfo(fruitName);
    return j && ml > 0 ? ml / j.ml : null;
}
