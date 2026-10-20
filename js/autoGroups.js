// קיבוץ אוטומטי לפי תחילת השם: כמה מוצרים באותה קטגוריה שמתחילים באותה מילה (צ'ילי אדום, צ'ילי תאילנדי...) מקבלים
// תת-קטגוריה אוטומטית בשם המילה הזאת. מוצר שהוגדרה לו תת-קטגוריה ידנית לא משתנה. טהור (בלי DOM/DB) כדי לבדוק ב-Node.
// מחשב רק על מוצרים ברמה העליונה (תוצרים מפורקים שייכים למוצר האב).

const clean = (s) => String(s || "").trim().replace(/["'`׳״]/g, "").replace(/\s+/g, " ");

// המילה הראשונה בשם, מנורמלת להשוואה ("צ'ילי" ו"צילי" הן אותה מילה)
export function firstWordKey(name) {
    const w = clean(name).split(" ")[0] || "";
    return w.toLowerCase();
}

// המילה הראשונה כפי שנכתבה (לתצוגה)
export function firstWordLabel(name) {
    return String(name || "").trim().split(/\s+/)[0] || "";
}

// מילים כלליות מדי שלא מייצרות קבוצה (כמות/אריזה)
const SKIP = new Set(["חצי", "קופסת", "קופסה", "בקבוק", "שקית", "חבילת", "חבילה", "סט", "מארז", "ארגז", "כוס", "כף", "כפית", "של", "עם", "בלי"]);

// items: [{ id, name, category, subcategory? }]. מוסיף לכל פריט _sub = תת-קטגוריה ידנית, או אוטומטית (שם המילה), או "".
// minSize = כמה מוצרים לפחות כדי ליצור קבוצה (ברירת מחדל 2). מחזיר את אותה רשימה.
export function assignAutoSubs(items, minSize = 2) {
    const buckets = new Map(); // category|key -> [items]
    for (const it of items) {
        it._sub = it.subcategory || "";
        if (it.subcategory) continue;
        const key = firstWordKey(it.name);
        if (key.length < 2 || SKIP.has(key) || /^\d/.test(key)) continue;
        const bk = `${it.category}|${key}`;
        if (!buckets.has(bk)) buckets.set(bk, []);
        buckets.get(bk).push(it);
    }
    for (const arr of buckets.values()) {
        if (arr.length < minSize) continue;
        const label = firstWordLabel(arr[0].name);
        for (const it of arr) it._sub = label;
    }
    return items;
}

export const subOf = (it) => (it && (it._sub ?? it.subcategory)) || "";
