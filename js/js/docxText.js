// חילוץ טקסט מקובץ Word (docx) בתוך הדפדפן, בלי ספריות חיצוניות: docx הוא קובץ zip שמכיל את word/document.xml.
// משמש לסריקת מתכון מקובץ Word (Gemini לא קורא docx ישירות, אז שולחים לו את הטקסט).

const dec = new TextDecoder("utf-8");

async function inflateRaw(bytes) {
    const ds = new DecompressionStream("deflate-raw");
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

// רשימת שמות הקבצים בתוך zip (לזיהוי סוג המסמך: docx / xlsx / pptx / odt ...)
export function listZipEntries(buffer) {
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);
    let eocd = -1;
    for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 65557); i--) {
        if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) return [];
    const entries = view.getUint16(eocd + 10, true);
    let p = view.getUint32(eocd + 16, true);
    const names = [];
    for (let n = 0; n < entries; n++) {
        if (view.getUint32(p, true) !== 0x02014b50) break;
        const nameLen = view.getUint16(p + 28, true);
        const extraLen = view.getUint16(p + 30, true);
        const commentLen = view.getUint16(p + 32, true);
        names.push(dec.decode(bytes.subarray(p + 46, p + 46 + nameLen)));
        p += 46 + nameLen + extraLen + commentLen;
    }
    return names;
}

// קורא ערך אחד מתוך zip לפי שם (שיטות אחסון: 0 = ללא דחיסה, 8 = deflate)
export async function readZipEntry(buffer, wantedName) {
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);
    // מחפשים את End Of Central Directory מהסוף
    let eocd = -1;
    for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 65557); i--) {
        if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("הקובץ אינו מסמך Word תקין");
    const entries = view.getUint16(eocd + 10, true);
    let p = view.getUint32(eocd + 16, true); // תחילת ה-central directory
    for (let n = 0; n < entries; n++) {
        if (view.getUint32(p, true) !== 0x02014b50) break;
        const method = view.getUint16(p + 10, true);
        const compSize = view.getUint32(p + 20, true);
        const nameLen = view.getUint16(p + 28, true);
        const extraLen = view.getUint16(p + 30, true);
        const commentLen = view.getUint16(p + 32, true);
        const localOffset = view.getUint32(p + 42, true);
        const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
        if (name === wantedName) {
            const lNameLen = view.getUint16(localOffset + 26, true);
            const lExtraLen = view.getUint16(localOffset + 28, true);
            const dataStart = localOffset + 30 + lNameLen + lExtraLen;
            const raw = bytes.subarray(dataStart, dataStart + compSize);
            if (method === 0) return raw;
            if (method === 8) return inflateRaw(raw);
            throw new Error("שיטת דחיסה לא נתמכת במסמך");
        }
        p += 46 + nameLen + extraLen + commentLen;
    }
    return null;
}

const ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" };

// document.xml -> טקסט: פסקאות בשורות נפרדות, תאי טבלה מופרדים ב-" | ", טאב ושבירת שורה נשמרים
export function xmlToText(xml) {
    let s = xml
        .replace(/<w:tab\s*\/>/g, "\t")
        .replace(/<w:(br|cr)\b[^>]*\/>/g, "\n")
        .replace(/<\/w:p>\s*<\/w:tc>/g, " | ")
        .replace(/<\/w:tc>/g, " | ")
        .replace(/<\/w:tr>/g, "\n")
        .replace(/<\/w:p>/g, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&(amp|lt|gt|quot|apos);/g, (m) => ENTITIES[m])
        .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
        .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
    return s
        .split("\n")
        .map((line) => line.replace(/[ \t]*\|[ \t]*$/, "").replace(/\s+$/g, ""))
        .filter((line, i, arr) => line.trim() || (i > 0 && arr[i - 1].trim()))
        .join("\n")
        .trim();
}

export async function extractDocxText(buffer) {
    const xmlBytes = await readZipEntry(buffer, "word/document.xml");
    if (!xmlBytes) throw new Error("לא נמצא תוכן במסמך Word");
    return xmlToText(dec.decode(xmlBytes));
}
