// אריזת הנתונים לענן: JSON בלי תמונות + קבצי תמונה נפרדים (כך הקובץ הראשי קטן והתמונות מועלות פעם אחת).
// טהור (בלי DOM/DB). תמונות חשבוניות (invoices.image) ומסמכי מתכון (recipes.source_file) הם Blob.

const IMAGE_FIELDS = { invoices: { field: "image", prefix: "inv", folder: "receipts" }, recipes: { field: "source_file", prefix: "rec", folder: "recipes" } };
export const DATA_FILE = "kitchencostpro-data.json";

const EXT_BY_MIME = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "application/pdf": "pdf" };
export const extFor = (mime) => EXT_BY_MIME[mime] || "bin";

const safeName = (s) => String(s == null ? "" : s).replace(/[/:*?"<>|]+/g, " ").replace(/\\/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);

// מיקום קריא בדרייב: מתכון בתיקייה לפי קטגוריה בשם המתכון, חשבונית לפי ספק וחודש בשם התאריך והספק.
// שם שכבר תפוס באותה תיקייה מקבל מספר סידורי. sub = שמות תיקיות המשנה, fileName = שם הקובץ
function readablePlace(storeName, row, ext, stores, taken) {
    let sub, base;
    if (storeName === "recipes") {
        sub = [safeName(row.category) || "ללא קטגוריה"];
        base = safeName(row.name) || "מתכון";
    } else {
        const sup = ((stores.suppliers || []).find((s) => s.id === row.supplier_id) || {}).name;
        const supplier = safeName(sup) || "ספק לא ידוע";
        const date = /^\d{4}-\d{2}-\d{2}/.test(row.invoice_date || "") ? row.invoice_date.slice(0, 10) : "";
        sub = [supplier, date ? date.slice(0, 7) : "ללא תאריך"];
        base = `${date || "ללא תאריך"} ${supplier}`;
    }
    const dir = sub.join("/");
    let name = `${base}.${ext}`, n = 1;
    while (taken.has(`${dir}/${name}`.toLowerCase())) { n += 1; name = `${base} ${n}.${ext}`; }
    taken.add(`${dir}/${name}`.toLowerCase());
    return { sub, fileName: name };
}

// stores: { storeName: [rows] }. organized=true: שמות קריאים ותיקיות משנה (ברירת מחדל: השמות הפנימיים הישנים).
// מחזיר { json, blobs: Map(key -> { blob, folder, sub, fileName, legacyName }) }
export function packForCloud(stores, meta = {}, { organized = false } = {}) {
    const blobs = new Map();
    const out = {};
    const taken = new Set();
    for (const [name, rows] of Object.entries(stores)) {
        const cfg = IMAGE_FIELDS[name];
        out[name] = rows.map((r) => {
            if (!cfg || !(r[cfg.field] instanceof Blob)) return r;
            const key = `${cfg.prefix}-${r.id}`;
            const blob = r[cfg.field];
            const legacyName = `${key}.${extFor(blob.type)}`;
            const place = organized ? readablePlace(name, r, extFor(blob.type), stores, taken) : { sub: [], fileName: legacyName };
            blobs.set(key, { blob, folder: cfg.folder, sub: place.sub, fileName: place.fileName, legacyName });
            const ref = { __cloud: key, type: blob.type || "", size: blob.size, fileName: place.fileName };
            if (place.sub.length) ref.path = place.sub.join("/");
            return { ...r, [cfg.field]: ref };
        });
    }
    return { json: JSON.stringify({ format: 2, meta, stores: out }), blobs };
}

// מפרק JSON מהענן. getBlob(ref) מחזיר Promise<Blob> לפי { __cloud, fileName, type }. מחזיר { stores, meta }
export async function unpackFromCloud(jsonText, getBlob) {
    const data = JSON.parse(jsonText);
    if (!data || !data.stores || typeof data.stores !== "object") throw new Error("קובץ הגיבוי בענן לא תקין");
    const stores = {};
    for (const [name, rows] of Object.entries(data.stores)) {
        if (!Array.isArray(rows)) throw new Error(`קובץ גיבוי פגום (${name})`);
        const cfg = IMAGE_FIELDS[name];
        stores[name] = [];
        for (const r of rows) {
            if (cfg && r[cfg.field] && r[cfg.field].__cloud) {
                const ref = r[cfg.field];
                stores[name].push({ ...r, [cfg.field]: await getBlob(ref, cfg.folder) });
            } else stores[name].push(r);
        }
    }
    return { stores, meta: data.meta || {} };
}

export const IMAGE_FOLDERS = ["receipts", "recipes"];
