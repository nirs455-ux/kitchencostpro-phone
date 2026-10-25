// אריזת הנתונים לענן: JSON בלי תמונות + קבצי תמונה נפרדים (כך הקובץ הראשי קטן והתמונות מועלות פעם אחת).
// טהור (בלי DOM/DB). תמונות חשבוניות (invoices.image) ומסמכי מתכון (recipes.source_file) הם Blob.

const IMAGE_FIELDS = { invoices: { field: "image", prefix: "inv", folder: "receipts" }, recipes: { field: "source_file", prefix: "rec", folder: "recipes" } };
export const DATA_FILE = "kitchencostpro-data.json";

const EXT_BY_MIME = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "application/pdf": "pdf" };
export const extFor = (mime) => EXT_BY_MIME[mime] || "bin";

// stores: { storeName: [rows] }. מחזיר { json, blobs: Map(key -> { blob, folder, fileName }) }
export function packForCloud(stores, meta = {}) {
    const blobs = new Map();
    const out = {};
    for (const [name, rows] of Object.entries(stores)) {
        const cfg = IMAGE_FIELDS[name];
        out[name] = rows.map((r) => {
            if (!cfg || !(r[cfg.field] instanceof Blob)) return r;
            const key = `${cfg.prefix}-${r.id}`;
            const blob = r[cfg.field];
            const fileName = `${key}.${extFor(blob.type)}`;
            blobs.set(key, { blob, folder: cfg.folder, fileName });
            return { ...r, [cfg.field]: { __cloud: key, type: blob.type || "", size: blob.size, fileName } };
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
