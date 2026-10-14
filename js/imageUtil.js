// עזרי תמונה לחשבוניות: כיווץ לפני שמירה (כדי לא למלא את אחסון הטלפון), הצגה במסך מלא, והמרה לגיבוי.
import { openModal, closeModal, escapeHtml, info } from "./ui.js";

const MAX_SIDE = 1800;
const JPEG_QUALITY = 0.82;

// מקטין את התמונה לצד ארוך של 1800px ושומר כ-JPEG. אם הדפדפן לא מצליח לפענח - שומר את הקובץ המקורי כמו שהוא.
export async function compressImage(file) {
    if (!file || !(file.type || "").startsWith("image/")) return file;
    try {
        const bitmap = await createImageBitmap(file);
        const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
        const w = Math.max(1, Math.round(bitmap.width * scale));
        const h = Math.max(1, Math.round(bitmap.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
        if (bitmap.close) bitmap.close();
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
        // אם הכיווץ לא חסך כלום (קובץ כבר קטן) - משאירים את המקורי
        return blob && blob.size < file.size ? blob : file;
    } catch (e) {
        return file;
    }
}

// מציג תמונה במסך מלא; לחיצה על התמונה מגדילה/מקטינה כדי לקרוא את הפרטים.
export function showImageFullscreen(blob, title) {
    const url = URL.createObjectURL(blob);
    const overlay = openModal(`
        <h2>${escapeHtml(title || "תמונת חשבונית")} ${info("לחץ על התמונה כדי להגדיל או להקטין.")}</h2>
        <div style="max-height:70vh;overflow:auto;border:1px solid #ddd;border-radius:8px;background:#fafafa;">
            <img id="img-full" src="${url}" alt="תמונת חשבונית" style="width:100%;display:block;cursor:zoom-in;">
        </div>
        <div class="modal-actions">
            <button type="button" class="btn btn-secondary" id="img-save">💾 שמור עותק בטלפון</button>
            <button type="button" class="btn btn-primary" id="img-close">סגור</button>
        </div>
    `);
    // דפדפן לא יכול ליצור אלבום בגלריה בעצמו; בטלפון נפתח חלון השיתוף ("שמור תמונה"), ובמחשב הקובץ יורד כרגיל
    overlay.querySelector("#img-save").onclick = async () => {
        const fileName = `חשבונית-${(title || "").replace(/[^\w֐-׿-]+/g, "_") || "תמונה"}.jpg`;
        const file = new File([blob], fileName, { type: blob.type || "image/jpeg" });
        try {
            if (navigator.canShare && navigator.canShare({ files: [file] })) {
                await navigator.share({ files: [file], title: "חשבונית" });
                return;
            }
        } catch (e) {
            if (e && e.name === "AbortError") return;
        }
        const a = document.createElement("a");
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        a.remove();
    };
    const img = overlay.querySelector("#img-full");
    let zoomed = false;
    img.onclick = () => {
        zoomed = !zoomed;
        img.style.width = zoomed ? "300%" : "100%";
        img.style.cursor = zoomed ? "zoom-out" : "zoom-in";
    };
    overlay.querySelector("#img-close").onclick = () => { closeModal(); URL.revokeObjectURL(url); };
}

// ---- גיבוי: Blob <-> אובייקט JSON ----
export function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = reject;
        r.readAsDataURL(blob);
    });
}

export function dataUrlToBlob(dataUrl) {
    const [head, b64] = dataUrl.split(",");
    const mime = (head.match(/data:(.*?);base64/) || [])[1] || "image/jpeg";
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
}
