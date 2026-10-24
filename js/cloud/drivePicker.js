// בחירת קובץ מ-Google Drive בתוך האפליקציה (Google Picker). הקובץ יורד למכשיר ועובר סריקה כמו כל קובץ אחר.
// גישה: ההרשאה drive.file בלבד. הבורר נותן לאפליקציה גישה רק לקובץ שבחרת, ולא לשאר ה-Drive.
import { GOOGLE_CLIENT_ID, GOOGLE_PICKER_API_KEY } from "./config.js";
import { getDriveAccessToken } from "./cloudGlue.js";

const GAPI_URL = "https://apis.google.com/js/api.js";
// סוגי קבצים שהאפליקציה יודעת לקרוא (מסמכי Google מקוריים לא נתמכים: צריך לייצא אותם ל-PDF)
const MIME_TYPES = [
    "application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/msword", "application/vnd.ms-excel", "text/plain", "text/csv",
].join(",");

// מספר הפרויקט ב-Google Cloud = החלק הראשון של מזהה הלקוח (נדרש לבורר כדי להעניק גישה לקובץ שנבחר)
const appId = () => String(GOOGLE_CLIENT_ID || "").split("-")[0];

export const isDrivePickerAvailable = () => !!(GOOGLE_PICKER_API_KEY && GOOGLE_CLIENT_ID);

let gapiPromise = null;
function loadPicker() {
    if (window.google && window.google.picker) return Promise.resolve();
    if (!gapiPromise) {
        gapiPromise = new Promise((resolve, reject) => {
            const fail = () => { gapiPromise = null; reject(new Error("לא ניתן לטעון את בורר Google Drive. בדוק חיבור לאינטרנט.")); };
            const start = () => window.gapi.load("picker", { callback: resolve, onerror: fail });
            if (window.gapi && window.gapi.load) return start();
            const s = document.createElement("script");
            s.src = GAPI_URL; s.async = true;
            s.onload = start; s.onerror = fail;
            document.head.appendChild(s);
        });
    }
    return gapiPromise;
}

// טוען מראש את הרכיבים כשהחלון נפתח, כדי שהלחיצה על הכפתור תפתח את ההתחברות מיד (דפדפנים חוסמים חלון קופץ שמגיע באיחור)
export function warmDrivePicker() { if (isDrivePickerAvailable()) loadPicker().catch(() => {}); }

// פותח את הבורר. מחזיר File, או null אם המשתמש ביטל. זורק שגיאה בעברית אם משהו נכשל.
export async function pickFromDrive() {
    if (!isDrivePickerAvailable()) throw new Error("בחירה מ-Drive עוד לא הוגדרה.");
    const token = await getDriveAccessToken();
    await loadPicker();
    const picked = await new Promise((resolve) => {
        const g = window.google.picker;
        const view = new g.DocsView(g.ViewId.DOCS).setIncludeFolders(true).setMimeTypes(MIME_TYPES);
        new g.PickerBuilder()
            .setDeveloperKey(GOOGLE_PICKER_API_KEY)
            .setAppId(appId())
            .setOAuthToken(token)
            .addView(view)
            .setLocale("iw")
            .setCallback((data) => {
                if (data.action === g.Action.PICKED && data.docs && data.docs[0]) resolve(data.docs[0]);
                else if (data.action === g.Action.CANCEL) resolve(null);
            })
            .build()
            .setVisible(true);
    });
    if (!picked) return null;
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(picked.id)}?alt=media`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
        if (res.status === 403 || res.status === 404) throw new Error("אין הרשאה לקרוא את הקובץ הזה מ-Drive. נסה לבחור אותו שוב.");
        throw new Error(`הורדת הקובץ מ-Drive נכשלה (${res.status}).`);
    }
    const blob = await res.blob();
    return new File([blob], picked.name || "drive-file", { type: picked.mimeType || blob.type || "application/octet-stream" });
}

// לוגו Drive (צבעי המותג, מצולע פשוט) וכפתור. כשהמפתח לא מוגדר - לא מציגים כלום.
export const DRIVE_LOGO = '<svg width="20" height="20" viewBox="0 0 87.3 78" aria-hidden="true" style="vertical-align:middle;margin-inline-end:6px"><path d="M6.6 66.85l3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8H0c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/><path d="M43.65 25L29.9 1.2c-1.35.8-2.5 1.9-3.3 3.3L1.2 48.5c-.8 1.4-1.2 2.95-1.2 4.5h27.5z" fill="#00ac47"/><path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5H59.8l5.85 11.5z" fill="#ea4335"/><path d="M43.65 25L57.4 1.2C56.05.4 54.5 0 52.9 0H34.4c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d"/><path d="M59.8 53H27.5L13.75 76.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc"/><path d="M73.4 26.5l-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3L43.65 25 59.8 53h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/></svg>';
export const driveButtonHtml = (id) => (isDrivePickerAvailable() ? `<button type="button" class="btn btn-secondary btn-block" id="${id}" style="margin-top:8px;">${DRIVE_LOGO}Google Drive</button>` : "");
