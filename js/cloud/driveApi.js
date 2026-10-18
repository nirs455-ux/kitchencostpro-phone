// שכבה דקה מעל Google Drive API (v3): תיקיות, העלאה/עדכון/הורדה/רשימה/מחיקה.
// לא תלויה בדפדפן: getToken ו-fetchImpl מוזרקים, כך שאפשר לבדוק אותה ב-Node מול דרייב מדומה.

const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
export const FOLDER_MIME = "application/vnd.google-apps.folder";

// שגיאת הרשאה: הטוקן פג או נדחה
export class DriveAuthError extends Error {
    constructor(msg = "נדרשת התחברות מחדש ל-Google") { super(msg); this.name = "DriveAuthError"; }
}

const escQ = (s) => String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'");

export function createDrive({ getToken, fetchImpl }) {
    const doFetch = fetchImpl || ((...a) => fetch(...a));

    async function call(url, opts = {}) {
        const token = await getToken();
        const r = await doFetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}` } });
        if (r.status === 401) throw new DriveAuthError();
        if (r.status === 403) {
            // 403 יכול להיות הרשאה חסרה או מכסה; מבדילים לפי התוכן
            const t = await r.text().catch(() => "");
            if (/insufficient|PERMISSION|forbidden|unauthorized/i.test(t)) throw new DriveAuthError("אין הרשאה לדרייב. התחבר מחדש ואשר גישה.");
            throw new Error(`Drive 403: ${t.slice(0, 200)}`);
        }
        if (!r.ok) throw new Error(`Drive ${r.status}: ${(await r.text().catch(() => "")).slice(0, 200)}`);
        return r;
    }

    // מחפש קובץ/תיקייה לפי שם בתוך תיקיית אב (בלי פח). מחזיר את הראשון או null
    async function findOne(name, parentId, mime) {
        let q = `name = '${escQ(name)}' and trashed = false`;
        if (parentId) q += ` and '${escQ(parentId)}' in parents`;
        if (mime) q += mime === FOLDER_MIME ? ` and mimeType = '${FOLDER_MIME}'` : ` and mimeType != '${FOLDER_MIME}'`;
        const url = `${API}/files?q=${encodeURIComponent(q)}&pageSize=10&fields=${encodeURIComponent("files(id,name,modifiedTime,size,mimeType)")}&spaces=drive`;
        const j = await (await call(url)).json();
        return (j.files || [])[0] || null;
    }

    async function ensureFolder(name, parentId) {
        const found = await findOne(name, parentId, FOLDER_MIME);
        if (found) return found.id;
        const body = { name, mimeType: FOLDER_MIME, ...(parentId ? { parents: [parentId] } : {}) };
        const r = await call(`${API}/files?fields=id`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        return (await r.json()).id;
    }

    async function list(parentId) {
        const out = [];
        let pageToken = "";
        do {
            const q = `'${escQ(parentId)}' in parents and trashed = false`;
            const url = `${API}/files?q=${encodeURIComponent(q)}&pageSize=200&fields=${encodeURIComponent("nextPageToken,files(id,name,modifiedTime,size,mimeType)")}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`;
            const j = await (await call(url)).json();
            out.push(...(j.files || []));
            pageToken = j.nextPageToken || "";
        } while (pageToken);
        return out;
    }

    // יוצר קובץ חדש (multipart) או מחליף תוכן של קיים (existingId). blob = Blob או מחרוזת
    async function putFile({ name, parentId, blob, mime = "application/octet-stream", existingId = null }) {
        const body = blob instanceof Blob ? blob : new Blob([String(blob)], { type: mime });
        if (existingId) {
            const r = await call(`${UPLOAD}/files/${encodeURIComponent(existingId)}?uploadType=media&fields=id,modifiedTime`, { method: "PATCH", headers: { "Content-Type": mime }, body });
            return r.json();
        }
        const boundary = "kcp" + Math.random().toString(36).slice(2) + Date.now().toString(36);
        const meta = JSON.stringify({ name, ...(parentId ? { parents: [parentId] } : {}) });
        const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`;
        const tail = `\r\n--${boundary}--`;
        const r = await call(`${UPLOAD}/files?uploadType=multipart&fields=id,modifiedTime`, {
            method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body: new Blob([head, body, tail]),
        });
        return r.json();
    }

    // יוצר או מעדכן לפי שם בתיקייה
    async function upsertByName({ name, parentId, blob, mime }) {
        const existing = await findOne(name, parentId, "file");
        return putFile({ name, parentId, blob, mime, existingId: existing ? existing.id : null });
    }

    async function download(id) {
        return (await call(`${API}/files/${encodeURIComponent(id)}?alt=media`)).blob();
    }

    async function downloadText(id) {
        return (await call(`${API}/files/${encodeURIComponent(id)}?alt=media`)).text();
    }

    async function remove(id) {
        await call(`${API}/files/${encodeURIComponent(id)}`, { method: "DELETE" });
    }

    return { findOne, ensureFolder, list, putFile, upsertByName, download, downloadText, remove };
}
