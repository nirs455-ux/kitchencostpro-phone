// שיתוף בוואטסאפ: קישור wa.me, ניסוח הודעות (מתכון, קטגוריית מתכונים, הזמנה לספק). טהור (בלי DOM/DB) כדי שאפשר לבדוק ב-Node.

// מספר טלפון ישראלי -> פורמט בינלאומי בלי + (0521234567 / 052-123-4567 / +972521234567 -> 972521234567). לא תקין -> "".
export function normalizePhoneIL(raw) {
    let d = String(raw || "").replace(/[^\d+]/g, "");
    if (d.startsWith("+")) d = d.slice(1);
    else if (d.startsWith("00")) d = d.slice(2);
    else if (d.startsWith("0")) d = "972" + d.slice(1);
    if (!/^\d{9,15}$/.test(d)) return "";
    return d;
}

// קישור לוואטסאפ. עם טלפון: פותח צ'אט עם הספק; בלי טלפון: בוחרים איש קשר. הטקסט מוגבל כדי שהקישור לא יהיה ארוך מדי.
export function whatsappUrl(text, phone = "") {
    const p = normalizePhoneIL(phone);
    const t = encodeURIComponent(String(text || "").slice(0, 3500));
    return p ? `https://wa.me/${p}?text=${t}` : `https://wa.me/?text=${t}`;
}

// קישור למייל (נפתח באפליקציית המייל של הטלפון). אורך הגוף מוגבל כדי שהקישור לא יהיה ארוך מדי.
export function mailtoUrl(email, subject, body) {
    return `mailto:${encodeURIComponent(String(email || "").trim())}?subject=${encodeURIComponent(subject || "")}&body=${encodeURIComponent(String(body || "").slice(0, 1800))}`;
}

// כמות בגרמים -> טקסט לקריאה ("600 גרם" / '1.25 ק"ג')
export function qtyText(g) {
    const n = Number(g) || 0;
    if (n >= 1000) return `${+(n / 1000).toFixed(3)} ק"ג`;
    return `${+n.toFixed(1)} גרם`;
}

// מתכון לשיתוף: בלי עלויות. direct = שורות כפי ששמורות (תת-מתכון מסומן 📖).
export function recipeShareText(recipe) {
    const lines = [`*${recipe.name}*`];
    if (recipe.category) lines.push(recipe.category);
    const items = [...(recipe.direct_items || recipe.items || [])].sort((a, b) => (Number(b.quantity_g) || 0) - (Number(a.quantity_g) || 0));
    if (items.length) {
        lines.push("", "רכיבים:");
        for (const i of items) lines.push(`• ${i.sub_recipe_id != null ? "📖 " : ""}${i.ingredient_name || ""} - ${i.unit_count ? +Number(i.quantity_g).toFixed(2) + " יחידות" : qtyText(i.quantity_g)}`);
    }
    for (const d of recipe.draft_ingredients || []) lines.push(`• ${d.name}${d.quantity != null ? " - " + d.quantity + (d.unit ? " " + d.unit : "") : ""}`);
    if (Number(recipe.final_weight) > 0) lines.push("", `משקל סופי: ${qtyText(recipe.final_weight)}`);
    if (recipe.method) lines.push("", "אופן ההכנה:", String(recipe.method).trim());
    return lines.join("\n");
}

// כל המתכונים של קטגוריה בהודעה אחת
export function categoryShareText(category, recipes) {
    const head = `*${category}* (${recipes.length} מתכונים)`;
    return [head, ...recipes.map((r) => "\n──────────\n" + recipeShareText({ ...r, category: "" }))].join("\n");
}

// הזמנה לספק. lines: [{ name, qty }] (רק שורות עם כמות)
export function orderText(supplierName, dateText, lines, note = "") {
    const out = [`שלום ${supplierName || ""}, הזמנה ל-${dateText}:`.replace("  ", " "), ""];
    for (const l of lines) out.push(`• ${l.name} - ${l.qty}`);
    if (note && note.trim()) out.push("", note.trim());
    out.push("", "תודה!");
    return out.join("\n");
}
