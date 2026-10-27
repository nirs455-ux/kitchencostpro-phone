// יוצר קובץ ZIP בלי ספרייה חיצונית (אחסון בלי דחיסה: תמונות ו-PDF כבר דחוסים). טהור, נבדק ב-Node.
// files: [{ name, data: Uint8Array }]. שמות בעברית נשמרים (דגל UTF-8). מחזיר Uint8Array.

let table = null;
function crcTable() {
    if (table) return table;
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c >>> 0;
    }
    return table;
}

export function crc32(bytes) {
    const t = crcTable();
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(d) {
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const date = ((Math.max(d.getFullYear(), 1980) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    return { time, date };
}

// שם קובץ בטוח בתוך ה-ZIP: בלי תווים אסורים, וכל שם ייחודי (שמות כפולים מקבלים מספר)
export function safeEntryName(name, used) {
    // "/" מפריד תיקיות בתוך ה-ZIP (תיקייה לכל ספק); כל חלק מנוקה בנפרד
    const clean = (x) => String(x).replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").replace(/\s+/g, " ").trim().slice(0, 100);
    let n = String(name || "file").split("/").map(clean).filter(Boolean).join("/") || "file";
    if (!used) return n;
    const dot = n.lastIndexOf(".");
    const base = dot > 0 ? n.slice(0, dot) : n;
    const ext = dot > 0 ? n.slice(dot) : "";
    let out = n;
    for (let i = 2; used.has(out); i++) out = `${base} (${i})${ext}`;
    used.add(out);
    return out;
}

export function makeZip(files, now = new Date()) {
    const enc = new TextEncoder();
    const { time, date } = dosDateTime(now);
    const used = new Set();
    const parts = [];
    const central = [];
    let offset = 0;
    for (const f of files) {
        const name = enc.encode(safeEntryName(f.name, used));
        const data = f.data;
        const crc = crc32(data);
        const local = new DataView(new ArrayBuffer(30));
        local.setUint32(0, 0x04034b50, true);
        local.setUint16(4, 20, true);
        local.setUint16(6, 0x0800, true); // שמות קבצים ב-UTF-8
        local.setUint16(8, 0, true); // בלי דחיסה
        local.setUint16(10, time, true);
        local.setUint16(12, date, true);
        local.setUint32(14, crc, true);
        local.setUint32(18, data.length, true);
        local.setUint32(22, data.length, true);
        local.setUint16(26, name.length, true);
        local.setUint16(28, 0, true);
        parts.push(new Uint8Array(local.buffer), name, data);
        const c = new DataView(new ArrayBuffer(46));
        c.setUint32(0, 0x02014b50, true);
        c.setUint16(4, 20, true);
        c.setUint16(6, 20, true);
        c.setUint16(8, 0x0800, true);
        c.setUint16(10, 0, true);
        c.setUint16(12, time, true);
        c.setUint16(14, date, true);
        c.setUint32(16, crc, true);
        c.setUint32(20, data.length, true);
        c.setUint32(24, data.length, true);
        c.setUint16(28, name.length, true);
        c.setUint32(42, offset, true);
        central.push(new Uint8Array(c.buffer), name);
        offset += 30 + name.length + data.length;
    }
    const centralSize = central.reduce((n, p) => n + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);
    const all = [...parts, ...central, new Uint8Array(end.buffer)];
    const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
    let pos = 0;
    for (const p of all) { out.set(p, pos); pos += p.length; }
    return out;
}
