// יומן הפשרות (טופס משרד הבריאות): נרמול, סינון להדפסה, וקריאת אריזה. טהור (בלי DOM/DB/רשת) כדי שאפשר לבדוק ב-Node.
const txt = (v) => String(v == null ? "" : v).trim();
const pad = (n) => String(n).padStart(2, "0");
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const HM = /^\d{2}:\d{2}$/;

export const FOOD_TYPES = [{ key: "raw", label: "גולמי" }, { key: "ready", label: "מוכן" }, { key: "half", label: "חצי מוכן" }];
export const foodTypeLabel = (k) => (FOOD_TYPES.find((t) => t.key === k) || { label: "" }).label;
export const DEFAULT_OPERATOR = "ניר סלומון";
export const MAX_ENTRIES = 1500;
export const MAX_PHOTOS = 300; // תמונות רק ב-300 הרשומות האחרונות, כדי שהגיבוי לא יתנפח

export const THAW_SCAN_PROMPT = `You are reading a photo of a food product package (Hebrew, English or other). Extract ONLY what is clearly printed. Never guess. If a value is not visible or not readable, use null.
Return ONLY valid JSON, no markdown, in exactly this shape:
{
  "supplier": string or null (the producer / brand / importer name printed on the package),
  "product_name": string or null,
  "expiry_date": string or null (the "use by" / "best before" / expiry date, as YYYY-MM-DD. Israeli labels write day first: DD/MM/YY or DD.MM.YYYY. Two-digit years are 20YY),
  "notes": string or null (anything unclear)
}`;

const validIso = (s) => {
    if (!ISO.test(s)) return "";
    const [y, m, d] = s.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d ? s : "";
};

// answer: אובייקט JSON מ-Gemini. מחזיר טיוטה לבדיקה
export function parseThawAnswer(answer) {
    const a = answer && typeof answer === "object" ? answer : {};
    return { supplier: txt(a.supplier), product: txt(a.product_name), expiry: validIso(txt(a.expiry_date)), notes: txt(a.notes) };
}

export function nowParts(d = new Date()) {
    return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

export function normalizeEntry(e) {
    const x = e && typeof e === "object" ? e : {};
    const temp = txt(x.endTemp).replace(",", ".");
    return {
        id: txt(x.id) || `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
        supplier: txt(x.supplier),
        product: txt(x.product),
        expiry: validIso(txt(x.expiry)),
        foodType: FOOD_TYPES.some((t) => t.key === x.foodType) ? x.foodType : "raw",
        startDate: validIso(txt(x.startDate)) || nowParts().date,
        startTime: HM.test(txt(x.startTime)) ? txt(x.startTime) : nowParts().time,
        endDate: validIso(txt(x.endDate)),
        endTime: HM.test(txt(x.endTime)) ? txt(x.endTime) : "",
        endTemp: temp && Number.isFinite(parseFloat(temp)) ? temp : "",
        operator: txt(x.operator),
        photo: typeof x.photo === "string" && x.photo.startsWith("data:image/") ? x.photo : "",
        printed: validIso(txt(x.printed)),
    };
}

export const isOpen = (e) => !e.endDate || !e.endTime;

// החדש ראשון. תמונות נשמרות רק במספר הרשומות האחרונות
export function normalizeLog(list) {
    const arr = (Array.isArray(list) ? list : []).map(normalizeEntry).sort((a, b) => `${b.startDate} ${b.startTime}`.localeCompare(`${a.startDate} ${a.startTime}`)).slice(0, MAX_ENTRIES);
    arr.forEach((e, i) => { if (i >= MAX_PHOTOS) e.photo = ""; });
    return arr;
}

export function upsertEntry(list, entry) {
    const e = normalizeEntry(entry);
    return normalizeLog([e, ...list.filter((x) => x.id !== e.id)]);
}
export const removeEntry = (list, id) => list.filter((x) => x.id !== id);

// שורות להדפסה: רק רשומות שההפשרה בהן הסתיימה. mode "unprinted" = מה שעוד לא הודפס, "range" = לפי תאריך התחלה
export function printableRows(list, { mode = "unprinted", from = "", to = "" } = {}) {
    const inScope = list.filter((e) => (mode === "range" ? (!from || e.startDate >= from) && (!to || e.startDate <= to) : !e.printed));
    const rows = inScope.filter((e) => !isOpen(e)).sort((a, b) => `${a.startDate} ${a.startTime}`.localeCompare(`${b.startDate} ${b.startTime}`));
    return { rows, openCount: inScope.length - rows.length };
}

export const markPrinted = (list, ids, date) => list.map((e) => (ids.has(e.id) ? { ...e, printed: date } : e));
