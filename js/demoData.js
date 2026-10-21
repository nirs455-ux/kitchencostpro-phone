// נתוני דוגמה להדגמה: מזווה, ספק וחשבונית, מתכונים, מנות, ערכים תזונתיים, מוצר יצרן עם אריזה ורישומי פחת.
// כל הכתיבה עוברת דרך אותן פונקציות של האפליקציה (אותן בדיקות ואותם חישובים). בטוח להרצה על נתונים קיימים: רק מוסיף.
import { addPantryItem } from "./repo/pantryRepo.js";
import { saveRecipe } from "./repo/recipesRepo.js";
import { saveDish } from "./repo/dishesRepo.js";
import { addSupplier, saveInvoice } from "./repo/suppliersRepo.js";
import { saveNutrition } from "./repo/nutritionRepo.js";
import { saveBusiness, saveProduct, DEFAULT_STORAGE } from "./repo/producerRepo.js";
import { addWaste, todayIso } from "./repo/wasteRepo.js";
import { dbGetAll } from "./db.js";

// [שם, קטגוריה, סוג, מחיר (לק"ג/ליטר/יחידה), משקל ליחידה בגרם, ערכים ל-100 גרם]
const PANTRY = [
    ["קמח לחם", "יבשים", "weight", 4.2, null, { kcal: 361, fat: 1.7, sat: 0.3, carbs: 72, sugars: 1, protein: 12, sodium: 2 }],
    ["סוכר לבן", "יבשים", "weight", 5.9, null, { kcal: 387, fat: 0, sat: 0, carbs: 100, sugars: 100, protein: 0, sodium: 1 }],
    ["מלח דק", "יבשים", "weight", 3.5, null, { kcal: 0, fat: 0, sat: 0, carbs: 0, sugars: 0, protein: 0, sodium: 38758 }],
    ["שמרים יבשים", "יבשים", "weight", 48, null, { kcal: 325, fat: 7.6, sat: 0.9, carbs: 41, sugars: 0, protein: 40, sodium: 51 }],
    ["שמן קנולה", "יבשים", "liter", 9.5, null, { kcal: 884, fat: 100, sat: 7, carbs: 0, sugars: 0, protein: 0, sodium: 0 }],
    ["שמן זית", "יבשים", "liter", 32, null, { kcal: 884, fat: 100, sat: 13.8, carbs: 0, sugars: 0, protein: 0, sodium: 2 }],
    ["טחינה גולמית", "יבשים", "weight", 24, null, { kcal: 595, fat: 53.8, sat: 7.5, carbs: 21.2, sugars: 0.5, protein: 17, sodium: 115 }],
    ["צ'ילי אדום חריף", "ירקניה", "weight", 38, null, { kcal: 40, fat: 0.4, sat: 0.1, carbs: 8.8, sugars: 5.3, protein: 1.9, sodium: 9 }],
    ["צ'ילי ירוק חריף", "ירקניה", "weight", 34, null, { kcal: 40, fat: 0.2, sat: 0, carbs: 9.5, sugars: 5.1, protein: 2, sodium: 7 }],
    ["שום קלוף", "ירקניה", "weight", 22, null, { kcal: 149, fat: 0.5, sat: 0.1, carbs: 33, sugars: 1, protein: 6.4, sodium: 17 }],
    ["בצל לבן", "ירקניה", "weight", 4.5, null, { kcal: 40, fat: 0.1, sat: 0, carbs: 9.3, sugars: 4.2, protein: 1.1, sodium: 4 }],
    ["חצילים", "ירקניה", "weight", 7.5, null, { kcal: 25, fat: 0.2, sat: 0, carbs: 5.9, sugars: 3.5, protein: 1, sodium: 2 }],
    ["עגבניות", "ירקניה", "weight", 6.5, null, { kcal: 18, fat: 0.2, sat: 0, carbs: 3.9, sugars: 2.6, protein: 0.9, sodium: 5 }],
    ["לימון", "ירקניה", "weight", 9, null, { kcal: 29, fat: 0.3, sat: 0, carbs: 9.3, sugars: 2.5, protein: 1.1, sodium: 2 }],
    ["חמאה", "מחלבה", "weight", 46, null, { kcal: 717, fat: 81, sat: 51, carbs: 0.1, sugars: 0.1, protein: 0.9, sodium: 11 }],
    ["שמנת מתוקה", "מחלבה", "liter", 21, null, { kcal: 340, fat: 36, sat: 23, carbs: 2.8, sugars: 2.8, protein: 2.1, sodium: 38 }],
    ["ביצים L", "מחלבה", "unit", 1.1, 53, { kcal: 143, fat: 9.5, sat: 3.1, carbs: 0.7, sugars: 0.4, protein: 12.6, sodium: 142 }],
    ["חזה עוף", "קצביה", "weight", 34, null, { kcal: 120, fat: 2.6, sat: 0.6, carbs: 0, sugars: 0, protein: 23, sodium: 45 }],
    ["סלמון נורווגי", "מהים", "weight", 98, null, { kcal: 208, fat: 13.4, sat: 3.1, carbs: 0, sugars: 0, protein: 20, sodium: 59 }],
    ["צנצנת זכוכית 250 מ\"ל", "מחסן", "unit", 2.1, 120, null],
    ["מכסה לצנצנת", "מחסן", "unit", 0.6, 4, null],
    ["מדבקה למוצר", "מחסן", "unit", 0.25, 1, null],
];

const RECIPES = [
    { name: "צ'ילי קראנץ'", category: "רטבים", final: 700, method: "1. קוצצים דק את הצ'ילי והשום.\n2. מחממים את השמן ל-90 מעלות, מוזגים על הצ'ילי והשום.\n3. מערבבים עם מלח וסוכר, מקררים ומעבירים לצנצנות.",
      items: [["צ'ילי אדום חריף", 250], ["צ'ילי ירוק חריף", 100], ["שום קלוף", 90], ["שמן קנולה", 400], ["מלח דק", 12], ["סוכר לבן", 20]] },
    { name: "ממרח חצילים", category: "רטבים", final: 900, method: "1. צולים את החצילים על להבה ומסננים.\n2. מעבדים עם טחינה, לימון ושום.\n3. מתבלים במלח ושמן זית.",
      items: [["חצילים", 900], ["טחינה גולמית", 120], ["לימון", 60], ["שום קלוף", 20], ["מלח דק", 8], ["שמן זית", 40]] },
    { name: "בצק לחם כפרי", category: "תוספות", final: 1350, method: "1. מערבבים קמח, מים ושמרים.\n2. מתפיחים שעה, מעצבים ואופים 35 דקות ב-230 מעלות.",
      items: [["קמח לחם", 1000], ["מלח דק", 20], ["שמרים יבשים", 8], ["שמן זית", 30]] },
];

const DISHES = [
    { name: "סלמון בחמאת לימון", price: 98, items: [["pantry", "סלמון נורווגי", 220], ["pantry", "חמאה", 30], ["pantry", "לימון", 40]] },
    { name: "חזה עוף עם ממרח חצילים", price: 72, items: [["pantry", "חזה עוף", 230], ["recipe", "ממרח חצילים", 80], ["pantry", "שמן זית", 15]] },
    { name: "לחם כפרי וצ'ילי קראנץ'", price: 28, items: [["recipe", "בצק לחם כפרי", 150], ["recipe", "צ'ילי קראנץ'", 40]] },
];

export async function loadDemoData() {
    const have = new Map((await dbGetAll("pantryItems")).map((p) => [p.name, p.id]));
    const id = {};
    let added = 0;
    for (const [name, category, unit_type, price, unitG, nut] of PANTRY) {
        if (have.has(name)) { id[name] = have.get(name); continue; }
        id[name] = await addPantryItem({ name, category, unit_type, price, ...(unit_type === "unit" ? { unit_amount: String(unitG), ...(name.startsWith("ביצים") ? { egg_size: "L" } : {}) } : {}) });
        added++;
        if (nut) await saveNutrition(id[name], nut, { source: "usda", label: "דוגמה" });
    }

    const recipeIds = {};
    const haveRecipes = new Map((await dbGetAll("recipes")).map((r) => [r.name, r.id]));
    for (const r of RECIPES) {
        if (haveRecipes.has(r.name)) { recipeIds[r.name] = haveRecipes.get(r.name); continue; }
        recipeIds[r.name] = await saveRecipe(null, { name: r.name, category: r.category, method: r.method, final_weight: String(r.final), items: r.items.map(([n, g]) => ({ pantry_item_id: id[n], quantity_g: g })) });
    }

    const haveDishes = new Set((await dbGetAll("dishes")).map((d) => d.name));
    for (const d of DISHES) {
        if (haveDishes.has(d.name)) continue;
        await saveDish(null, { name: d.name, selling_price: String(d.price), vat_pct: 18, items: d.items.map(([t, n, g]) => ({ source_type: t, source_id: t === "recipe" ? recipeIds[n] : id[n], quantity_g: g })) });
    }

    // ספק וחשבונית (מעדכנת מחירים ומלאי)
    const supplierId = await addSupplier("ירקות הצפון").catch(async () => (await dbGetAll("suppliers")).find((s) => s.name === "ירקות הצפון").id);
    const d = new Date(); d.setDate(d.getDate() - 3);
    const dateIso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    await saveInvoice(null, { supplier_id: supplierId, invoice_date: dateIso, document_type: "invoice", items: [
        { product_name: "צ'ילי אדום חריף", quantity: 5, unit_price: 38, pantry_item_id: id["צ'ילי אדום חריף"] },
        { product_name: "שום קלוף", quantity: 3, unit_price: 22, pantry_item_id: id["שום קלוף"] },
        { product_name: "חצילים", quantity: 10, unit_price: 7.5, pantry_item_id: id["חצילים"] },
    ] }).catch(() => {});

    // יצרן: פרטי עסק ומוצר עם אריזה
    await saveBusiness({ name: "המטבח של דוגמה", address: "תל אביב", phone: "03-1234567", reg: "" });
    await saveProduct({ name: "צ'ילי קראנץ' 250 מ\"ל", recipe_id: recipeIds["צ'ילי קראנץ'"], net_g: 230, shelf_days: 90, storage: DEFAULT_STORAGE, sell_price: 32,
        packaging: [{ pantry_item_id: id["צנצנת זכוכית 250 מ\"ל"], qty: 1 }, { pantry_item_id: id["מכסה לצנצנת"], qty: 1 }, { pantry_item_id: id["מדבקה למוצר"], qty: 1 }] });

    // פחת לדוגמה
    await addWaste({ source_type: "pantry", source_id: id["עגבניות"], qty: 0.8, unit: "kg", reason: "spoiled", date: todayIso(), by: "דנה" }).catch(() => {});
    await addWaste({ source_type: "pantry", source_id: id["חמאה"], qty: 0.25, unit: "kg", reason: "expired", date: todayIso(), by: "דנה" }).catch(() => {});
    return { pantry: added, recipes: RECIPES.length, dishes: DISHES.length };
}
