// קליטת קבצים מכל סוג: זיהוי לפי תוכן הקובץ (לא רק סיומת/סוג - בטלפונים שונים הם מגיעים ריקים או שגויים),
// וחילוץ טקסט מ-Word / Excel / PowerPoint / ODF / RTF / HTML / טקסט (כולל קידוד עברי ישן) ומקבצי Office ישנים (doc/xls).
// הקובץ הזה טהור (בלי DOM) כדי שאפשר לבדוק אותו ב-Node.
import { readZipEntry, listZipEntries } from "./docxText.js";

const utf8 = new TextDecoder("utf-8");
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decodeEntities = (s) => s
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, k) => ENT[k])
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));

const tidy = (text) => text
    .split("\n").map((l) => l.replace(/[ \t]+$/g, "").replace(/\s*\|\s*$/, ""))
    .filter((l, i, a) => l.trim() || (i > 0 && a[i - 1].trim()))
    .join("\n").trim();

function startsWith(bytes, sig) {
    return sig.every((b, i) => bytes[i] === b);
}

// ---- זיהוי סוג לפי תוכן ----
// מחזיר: image | pdf | zip | ole | rtf | html | text | unknown (+ mime לתמונות)
export function sniffKind(bytes, name = "", mime = "") {
    const n = name.toLowerCase();
    if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) return { kind: "pdf", mime: "application/pdf" };
    if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { kind: "image", mime: "image/jpeg" };
    if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) return { kind: "image", mime: "image/png" };
    if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return { kind: "image", mime: "image/gif" };
    if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && bytes[8] === 0x57 && bytes[9] === 0x45) return { kind: "image", mime: "image/webp" };
    if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) { // ISO BMFF: HEIC/HEIF/AVIF
        const brand = String.fromCharCode(...bytes.subarray(8, 12));
        if (/^(heic|heix|hevc|hevx|mif1|msf1)/.test(brand)) return { kind: "image", mime: /^hei|hev/.test(brand) ? "image/heic" : "image/heif" };
        if (brand.startsWith("avif")) return { kind: "image", mime: "image/avif" };
    }
    if (startsWith(bytes, [0x42, 0x4d])) return { kind: "image", mime: "image/bmp" };
    if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || startsWith(bytes, [0x50, 0x4b, 0x05, 0x06])) return { kind: "zip" };
    if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return { kind: "ole" };
    const head = utf8.decode(bytes.subarray(0, 400)).trimStart().toLowerCase();
    if (head.startsWith("{\\rtf")) return { kind: "rtf" };
    if (head.startsWith("<!doctype html") || head.startsWith("<html") || n.endsWith(".html") || n.endsWith(".htm") || mime === "text/html") return { kind: "html" };
    // טקסט UTF-16 (עם BOM) - מכיל NUL רבים, לכן בודקים לפני
    if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)) return { kind: "text" };
    // טקסט: אם כמעט אין בתים בינאריים (NUL / בקרה)
    const sample = bytes.subarray(0, 2000);
    let ctrl = 0;
    for (const b of sample) if (b === 0 || (b < 9) || (b > 13 && b < 32)) ctrl++;
    if (sample.length && ctrl / sample.length < 0.02) return { kind: "text" };
    return { kind: "unknown" };
}

// ---- טקסט רגיל: UTF-8, ואם נראה שבור (קובץ עברי ישן) - windows-1255 ----
export function decodeText(bytes) {
    // BOM של UTF-16
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
    const s = utf8.decode(bytes);
    const bad = (s.match(/�/g) || []).length;
    if (bad > 2 && bad / Math.max(1, s.length) > 0.005) {
        try { return new TextDecoder("windows-1255").decode(bytes); } catch (e) { return s; }
    }
    return s;
}

// ---- RTF ----
export function rtfToText(rtf) {
    let s = rtf;
    s = s.replace(/\{\\\*[^{}]*(\{[^{}]*\}[^{}]*)*\}/g, ""); // קבוצות מסומנות (\* ...) מתעלמים
    s = s.replace(/\{\\(fonttbl|colortbl|stylesheet|info|pict)[^{}]*(\{[^{}]*\}[^{}]*)*\}/g, "");
    const out = [];
    const bytesBuf = [];
    const flushBytes = () => {
        if (bytesBuf.length) {
            try { out.push(new TextDecoder("windows-1255").decode(new Uint8Array(bytesBuf))); } catch (e) { out.push(String.fromCharCode(...bytesBuf)); }
            bytesBuf.length = 0;
        }
    };
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (ch === "\\") {
            const m = s.slice(i + 1).match(/^(?:'([0-9a-fA-F]{2})|u(-?\d+)\??|([a-zA-Z]+)(-?\d+)? ?|([\\{}]))/);
            if (!m) continue;
            if (m[1]) { bytesBuf.push(parseInt(m[1], 16)); }
            else {
                flushBytes();
                if (m[2]) { let c = parseInt(m[2], 10); if (c < 0) c += 65536; out.push(String.fromCharCode(c)); }
                else if (m[3]) {
                    if (m[3] === "par" || m[3] === "line" || m[3] === "row") out.push("\n");
                    else if (m[3] === "tab") out.push("\t");
                    else if (m[3] === "cell") out.push(" | ");
                } else if (m[5]) out.push(m[5]);
            }
            i += m[0].length;
        } else if (ch === "{" || ch === "}") {
            flushBytes();
        } else if (ch !== "\r" && ch !== "\n") {
            flushBytes();
            out.push(ch);
        }
    }
    flushBytes();
    return tidy(out.join(""));
}

// ---- HTML ----
export function htmlToText(html) {
    return tidy(decodeEntities(html
        .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "")
        .replace(/<\/(p|div|li|tr|h[1-6]|br|table|ul|ol)\s*>/gi, "\n")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/t[dh]\s*>/gi, " | ")
        .replace(/<[^>]+>/g, "")));
}

// ---- XML כללי של ODF (odt/ods/odp) ----
export function odfToText(xml) {
    return tidy(decodeEntities(xml
        .replace(/<text:tab\s*\/>/g, "\t").replace(/<text:line-break\s*\/>/g, "\n")
        .replace(/<\/text:p>\s*<\/table:table-cell>/g, " | ")
        .replace(/<\/text:(p|h|list-item)>/g, "\n")
        .replace(/<\/table:table-cell>/g, " | ").replace(/<\/table:table-row>/g, "\n")
        .replace(/<[^>]+>/g, "")));
}

// ---- Excel (xlsx) ----
function colIndex(ref) {
    const letters = ref.replace(/[^A-Z]/gi, "").toUpperCase();
    let n = 0;
    for (const c of letters) n = n * 26 + (c.charCodeAt(0) - 64);
    return n - 1;
}

export function xlsxSheetToText(sheetXml, shared) {
    const rows = [];
    for (const rm of sheetXml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
        const cells = [];
        for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
            const attrs = cm[1], inner = cm[2] || "";
            const ref = (attrs.match(/\br="([A-Z]+\d+)"/) || [])[1];
            const type = (attrs.match(/\bt="(\w+)"/) || [])[1];
            let val = "";
            if (type === "s") { const v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1]; val = shared[Number(v)] ?? ""; }
            else if (type === "inlineStr") val = decodeEntities([...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(""));
            else { const v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1]; val = v ? decodeEntities(v) : ""; }
            const idx = ref ? colIndex(ref) : cells.length;
            while (cells.length < idx) cells.push("");
            cells[idx] = val;
        }
        if (cells.some((c) => String(c).trim())) rows.push(cells.join(" | "));
    }
    return rows.join("\n");
}

async function zipToText(buffer) {
    const names = listZipEntries(buffer);
    const read = async (n) => { const b = await readZipEntry(buffer, n); return b ? utf8.decode(b) : null; };
    if (names.includes("word/document.xml")) {
        const xml = await read("word/document.xml");
        const { xmlToText } = await import("./docxText.js");
        return xmlToText(xml);
    }
    if (names.includes("xl/workbook.xml")) {
        const sst = await read("xl/sharedStrings.xml");
        const shared = sst ? [...sst.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => decodeEntities([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(""))) : [];
        const sheets = names.filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort((a, b) => parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0])).slice(0, 6);
        const parts = [];
        for (const sn of sheets) {
            const t = xlsxSheetToText(await read(sn), shared);
            if (t.trim()) parts.push((sheets.length > 1 ? `[גיליון ${parts.length + 1}]\n` : "") + t);
        }
        return tidy(parts.join("\n\n"));
    }
    if (names.includes("content.xml")) return odfToText(await read("content.xml")); // odt / ods / odp
    const slides = names.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0]));
    if (slides.length) {
        const out = [];
        for (const sn of slides) out.push(tidy(decodeEntities((await read(sn)).replace(/<\/a:p>/g, "\n").replace(/<[^>]+>/g, ""))));
        return out.filter(Boolean).join("\n\n");
    }
    throw new Error("סוג המסמך הזה לא נתמך");
}

// ---- קבצי Office ישנים (doc / xls / ppt): חילוץ מחרוזות קריאות (best effort - התוצאה עשויה להיות חלקית) ----
export function oleStrings(bytes) {
    const out = [];
    const isHeb = (c) => c >= 0x05d0 && c <= 0x05ea;
    const isOk = (c) => isHeb(c) || (c >= 0x20 && c <= 0x7e) || c === 0x0d || c === 0x0a || c === 0x09 || c === 0x201c || c === 0x201d || c === 0x2013 || c === 0xb0;
    // UTF-16LE
    let run = [];
    const flush16 = () => { if (run.length >= 4) out.push(String.fromCharCode(...run)); run = []; };
    for (let i = 0; i + 1 < bytes.length; i += 2) {
        const c = bytes[i] | (bytes[i + 1] << 8);
        if (isOk(c)) run.push(c === 0x0d ? 0x0a : c); else flush16();
    }
    flush16();
    // 8 סיביות (טקסט "דחוס" של Word): ASCII + עברית windows-1255 (0xE0-0xFA)
    const dec = new TextDecoder("windows-1255");
    let r8 = [];
    const flush8 = () => { if (r8.length >= 6) out.push(dec.decode(new Uint8Array(r8))); r8 = []; };
    for (const b of bytes) {
        if ((b >= 0x20 && b <= 0x7e) || (b >= 0xe0 && b <= 0xfa) || b === 0x0d || b === 0x0a || b === 0x09) r8.push(b === 0x0d ? 0x0a : b); else flush8();
    }
    flush8();
    // מסננים רעש: שורות עם מעט אותיות
    const clean = out.join("\n").split("\n").map((l) => l.trim()).filter((l) => {
        const letters = (l.match(/[A-Za-zא-ת]/g) || []).length;
        return l.length >= 3 && letters / l.length >= 0.5;
    });
    const seen = new Set();
    return clean.filter((l) => (seen.has(l) ? false : (seen.add(l), true))).join("\n");
}

// ---- נקודת הכניסה: מקבל ArrayBuffer + שם + mime, מחזיר { kind, mime?, text?, partial? } ----
export async function readFileContent(buffer, name = "", mime = "") {
    const bytes = new Uint8Array(buffer);
    const sniffed = sniffKind(bytes, name, mime);
    switch (sniffed.kind) {
        case "image": return { kind: "image", mime: sniffed.mime };
        case "pdf": return { kind: "pdf", mime: "application/pdf" };
        case "zip": {
            if (listZipEntries(buffer).includes("QuickLook/Preview.jpg")) throw new Error("קבצי Pages אינם נתמכים. ייצא אותם כ-Word או PDF ונסה שוב.");
            return { kind: "text", text: await zipToText(buffer) };
        }
        case "ole": {
            const text = oleStrings(bytes);
            if (text.length < 20) throw new Error("לא הצלחתי לקרוא את הקובץ הישן הזה. פתח אותו ושמור כ-Word (docx) או PDF, ונסה שוב.");
            return { kind: "text", text, partial: true };
        }
        case "rtf": return { kind: "text", text: rtfToText(utf8.decode(bytes)) };
        case "html": return { kind: "text", text: htmlToText(decodeText(bytes)) };
        case "text": return { kind: "text", text: tidy(decodeText(bytes).split(String.fromCharCode(13)).join("")) };
        default: throw new Error("סוג הקובץ לא מוכר. אפשר להעלות תמונה, PDF, Word, Excel, או קובץ טקסט.");
    }
}
