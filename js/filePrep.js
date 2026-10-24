// הכנת קובץ לשליחה ל-Gemini: תמונה/PDF נשלחים כמו שהם (תמונה מכווצת), וכל סוג מסמך אחר (Word, Excel, RTF, HTML, טקסט, doc ישן...)
// עובר חילוץ טקסט בדפדפן. הזיהוי לפי תוכן הקובץ, כך שזה עובד גם כשהטלפון נותן סוג/סיומת שגויים.
import { readFileContent } from "./fileText.js";
import { compressImage } from "./imageUtil.js";

const MAX_INLINE_BYTES = 18 * 1024 * 1024; // מגבלת הבקשה ל-Gemini (כ-20MB כולל קידוד)
const MAX_TEXT_CHARS = 40000;

// סוגי מסמכים בלבד (בלי תמונות): כפתור "קבצים" פותח ישר את מנהל הקבצים של הטלפון (עם Google Drive ו-OneDrive), בלי חלון הביניים של תמונה/וידאו/קבצים. תמונות נבחרות מ"גלריה".
export const DOC_ACCEPT = [".pdf", ".doc", ".docx", ".rtf", ".odt", ".txt", ".csv", ".xls", ".xlsx", ".ods", ".ppt", ".pptx", "application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "text/plain", "text/csv"].join(",");

// רשימת הסוגים שבוחרי הקבצים יציעו (וגם "כל קובץ" לטלפונים שמסננים לא טוב)
export const FILE_ACCEPT = [
    "image/*", ".heic", ".heif", ".pdf", ".doc", ".docx", ".rtf", ".odt", ".txt", ".md", ".csv", ".html", ".htm",
    ".xls", ".xlsx", ".ods", ".ppt", ".pptx", ".odp",
    "application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/rtf", "text/plain", "text/html", "text/csv", "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.oasis.opendocument.text",
    "application/vnd.oasis.opendocument.spreadsheet", "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
].join(",");

function toBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let bin = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    return btoa(bin);
}

// מחזיר { parts, kind, attachment, partial } - parts מוכנים לשליחה ל-Gemini (אחרי הפרומפט),
// attachment = הקובץ לשמירה ליד הרשומה (תמונה מכווצת / PDF / המסמך המקורי)
export async function prepareParts(file, textLabel = "תוכן המסמך") {
    const buffer = await file.arrayBuffer();
    const info = await readFileContent(buffer, file.name || "", file.type || "");

    if (info.kind === "image") {
        const typed = new File([buffer], file.name || "image", { type: info.mime });
        const small = await compressImage(typed); // אם הדפדפן לא מפענח (למשל HEIC) - נשלח כמו שהוא
        const outBuffer = small === typed ? buffer : await small.arrayBuffer();
        const mime = small === typed ? info.mime : (small.type || "image/jpeg");
        if (outBuffer.byteLength > MAX_INLINE_BYTES) throw new Error("התמונה גדולה מדי. צלם שוב באיכות נמוכה יותר.");
        return { parts: [{ inline_data: { mime_type: mime, data: toBase64(outBuffer) } }], kind: "image", attachment: small };
    }
    if (info.kind === "pdf") {
        if (buffer.byteLength > MAX_INLINE_BYTES) throw new Error("קובץ ה-PDF גדול מדי (מעל 18MB). פצל אותו או צלם את העמודים.");
        return { parts: [{ inline_data: { mime_type: "application/pdf", data: toBase64(buffer) } }], kind: "pdf", attachment: new Blob([buffer], { type: "application/pdf" }) };
    }
    const text = (info.text || "").trim();
    if (!text) throw new Error("לא נמצא טקסט בקובץ. אם התוכן הוא תמונה בתוך המסמך - צלם אותו או שמור כ-PDF.");
    const note = info.partial ? " (קובץ ישן - ייתכן שחלק מהטקסט חסר או משובש)" : "";
    return {
        parts: [{ text: `${textLabel}${note}:\n${text.slice(0, MAX_TEXT_CHARS)}` }],
        kind: "text",
        partial: !!info.partial,
        attachment: new Blob([buffer], { type: file.type || "application/octet-stream" }),
    };
}
