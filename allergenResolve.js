// שם נקי לרכיב (לתווית) והכרעת אלרגנים של מוצר: הגדרה ידנית/מתווית > מאגר הידע > "לא ידוע". אין ניחוש לפי שם.
// טהור (בלי DOM/DB) כדי שאפשר לבדוק ב-Node.
import { lookupAllergenKb } from "./allergenKb.js";

const NUM = "\\d+(?:[.,]\\d+)?";
const UNIT_WORDS = ["יחידות", "יחידה", "יח", "קג", "ק\"ג", "קילו", "גרם", "גר", "ליטר", "מל", "מ\"ל", "חבילות", "חבילה", "קופסאות", "קופסה", "מגש", "אריזה", "ארוז", "שקית", "שקיות"];
// מילות עיבוד/אריזה שאינן חלק משם הרכיב בתווית
const PROCESS_WORDS = new Set(["קלוף", "קלופה", "קלופים", "קלופות", "מקולף", "מקולפת", "קצוץ", "קצוצה", "קצוצים", "פרוס", "פרוסה", "פרוסות", "פרוסים", "מגורד", "מגוררת", "טחון", "טחונה", "שלם", "שלמה", "שלמים", "שלמות", "טרי", "טריה", "טריים", "קפוא", "קפואה", "קפואים", "מבושל", "מבושלת", "מרוסק", "חתוך", "חצוי", "חצויה", "נקי", "נקייה", "מנוקה", "מנוקים", "מעובד", "מעובדת", "גולמי"]);

// "שום שלם 4 יחידות" -> "שום", "בצל קלוף" -> "בצל". אם הניקוי ריקן את השם - מחזירים את השם המקורי.
export function cleanIngredientName(name) {
    const original = String(name || "").trim();
    let s = original;
    // כמות ויחידה: "4 יחידות", "1.5 ק\"ג", "500 גרם", גם בלי מספר ("ארוז")
    const unitAlt = UNIT_WORDS.map((w) => w.replace(/["']/g, "[\"']?")).join("|");
    s = s.replace(new RegExp(`(?:${NUM})\\s*(?:${unitAlt})?`, "g"), " ");
    s = s.replace(new RegExp(`(^|\\s)(?:${unitAlt})(?=\\s|$)`, "g"), " ");
    const words = s.split(/\s+/).filter(Boolean);
    const kept = words.filter((w) => !PROCESS_WORDS.has(w.replace(/["'`]/g, "")));
    s = kept.join(" ").replace(/[\-–,()]+\s*$/, "").replace(/^\s*[\-–,()]+/, "").replace(/\s+/g, " ").trim();
    return s || original;
}

// שם לתווית: שם שהוגדר ידנית (labelNames לפי מזהה) > שם המוצר שממנו נגזר (לתוצר מפורק) > שם נקי
// byId: Map או אובייקט של שורות מזווה
export function labelNameOf(row, byId, labelNames = {}) {
    if (!row) return "";
    const get = (id) => (byId instanceof Map ? byId.get(id) : byId && byId[id]);
    const manual = (r) => { const v = labelNames && labelNames[r.id]; return typeof v === "string" && v.trim() ? v.trim() : ""; };
    if (manual(row)) return manual(row);
    if (row.parent_id) {
        const parent = get(row.parent_id);
        if (parent) return manual(parent) || cleanIngredientName(parent.name);
    }
    return cleanIngredientName(row.name);
}

// מחזיר { status, keys, likely, source, name }
//   status: "free" (ידוע שאין) | "known" (רשימה ידועה) | "partial" (לפחות אלה, ייתכנו נוספים) | "unknown" (לא ידוע)
//   source: "manual" (הוגדר על ידי המשתמש/מצילום תווית) | "kb" (מאגר הידע) | null
export function resolveAllergens(row, byId, labelNames = {}) {
    const get = (id) => (byId instanceof Map ? byId.get(id) : byId && byId[id]);
    const src = row && row.parent_id ? get(row.parent_id) || row : row;
    const name = labelNameOf(row, byId, labelNames);
    if (!src) return { status: "unknown", keys: [], likely: [], source: null, name };
    // הוגדר ידנית (או נשמר מצילום תווית): allergens_auto = ניחוש ישן לפי שם - מתעלמים ממנו לגמרי
    if (Array.isArray(src.allergens) && !src.allergens_auto) {
        return { status: src.allergens.length ? "known" : "free", keys: [...src.allergens], likely: [], source: "manual", name };
    }
    const hit = lookupAllergenKb(name) || (src !== row ? null : lookupAllergenKb(src.name));
    if (hit) return { ...hit, source: "kb", name };
    return { status: "unknown", keys: [], likely: [], source: null, name };
}
