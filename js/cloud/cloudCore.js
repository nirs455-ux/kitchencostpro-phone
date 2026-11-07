// ליבת הגיבוי לענן (דרייב): מנהלת תיקיות, גיבוי, שחזור והגנה מדריסה. לא תלויה בדפדפן (הכול מוזרק) כדי שאפשר לבדוק ב-Node.
import { packForCloud, unpackFromCloud, DATA_FILE, extFor } from "./pack.js";

export const ROOT_FOLDER = "KitchenCostPro";
// שמות תיקיות בדרייב (בעברית, לפי מסך הקבצים)
export const FOLDER_NAMES = { receipts: "קבלות", recipes: "מתכונים", inbox: "התקבלו", backups: "גיבויים" };
const KEEP_SNAPSHOTS = 7;

export class CloudConflict extends Error {
    constructor(remoteTime) { super("בענן יש גרסה חדשה יותר ממכשיר אחר"); this.name = "CloudConflict"; this.remoteTime = remoteTime; }
}

// deps: { drive, getStores(): Promise<{store:[rows]}>, setStores(stores): Promise<void>, settings: { get(key), set(key, value) }, now(): Date, meta(): object }
export function createCloud(deps) {
    const { drive, getStores, setStores, settings } = deps;
    const now = deps.now || (() => new Date());
    let running = false;
    let again = false;

    const getIds = async () => (await settings.get("cloud_ids")) || null;

    // יוצר (או מוצא) את תיקיית KitchenCostPro ותתי התיקיות. מחזיר { root, receipts, recipes, inbox, backups }
    async function ensureFolders() {
        const cached = await getIds();
        if (cached && cached.root) return cached;
        const root = await drive.ensureFolder(ROOT_FOLDER, null);
        const ids = { root };
        for (const [key, name] of Object.entries(FOLDER_NAMES)) ids[key] = await drive.ensureFolder(name, root);
        await settings.set("cloud_ids", ids);
        return ids;
    }

    // בדיקה בחיבור: האם כבר יש גיבוי בענן. { exists, modifiedTime }
    async function remoteInfo() {
        const ids = await ensureFolders();
        const f = await drive.findOne(DATA_FILE, ids.root, "file");
        return { exists: !!f, modifiedTime: f ? f.modifiedTime : null, id: f ? f.id : null };
    }

    async function connect() {
        await ensureFolders();
        await settings.set("cloud_enabled", true);
        return remoteInfo();
    }

    async function disconnect() {
        await settings.set("cloud_enabled", false);
    }

    const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

    async function pruneSnapshots(ids) {
        const files = (await drive.list(ids.backups)).filter((f) => /^data-\d{4}-\d{2}-\d{2}\.json$/.test(f.name)).sort((a, b) => b.name.localeCompare(a.name));
        for (const f of files.slice(KEEP_SNAPSHOTS)) await drive.remove(f.id);
    }

    // גיבוי מלא. force=true דורס גם אם הענן שונה (אחרי אישור המשתמש). מחזיר { uploadedImages, at }
    // מיקום קבצים מסודר (תיקיות לפי קטגוריה/ספק וחודש, שמות קריאים). כבוי עד שהמשתמש מאשר. קבצים קיימים מועברים, לא נמחקים
    const isOrganized = async () => !!(await settings.get("cloud_organized"));
    const subCache = {};
    async function ensureSub(ids, folder, sub) {
        let parent = ids[folder];
        let path = "";
        for (const seg of sub) {
            path += `/${seg}`;
            const k = `${folder}${path}`;
            if (!subCache[k]) subCache[k] = await drive.ensureFolder(seg, parent);
            parent = subCache[k];
        }
        return parent;
    }

    async function backup({ force = false, organize = false } = {}) {
        if (running) { again = true; return { skipped: true }; }
        running = true;
        try {
            const ids = await ensureFolders();
            // הגנה: אם הקובץ בענן שונה מאז הגיבוי האחרון שלנו - מישהו אחר כתב אליו
            const remote = await remoteInfo();
            const lastRemote = await settings.get("cloud_remote_mtime");
            if (!force && remote.exists && lastRemote && remote.modifiedTime && remote.modifiedTime !== lastRemote) throw new CloudConflict(remote.modifiedTime);
            if (!force && remote.exists && !lastRemote) throw new CloudConflict(remote.modifiedTime);

            // דריסה בכוח: קודם שומרים את הנתונים שבענן בתיקיית הגיבויים (לא נמחק אוטומטית), כדי שאפשר יהיה לשחזר אם זו הייתה טעות
            if (force && remote.exists && remote.id) {
                try {
                    const old = await drive.downloadText(remote.id);
                    await drive.upsertByName({ name: `before-overwrite-${now().toISOString().replace(/[:.]/g, "-")}.json`, parentId: ids.backups, blob: new Blob([old], { type: "application/json" }), mime: "application/json" });
                } catch (e) { /* עותק הביטחון נכשל: לא חוסמים את הגיבוי שהמשתמש אישר */ }
            }

            if (organize && !(await isOrganized())) { // לפני שמסדרים: עותק של הנתונים שבענן, לא נמחק אוטומטית
                if (remote.exists && remote.id) {
                    try {
                        const old = await drive.downloadText(remote.id);
                        await drive.upsertByName({ name: `before-organize-${now().toISOString().replace(/[:.]/g, "-")}.json`, parentId: ids.backups, blob: new Blob([old], { type: "application/json" }), mime: "application/json" });
                    } catch (e) { throw new Error("לא הצלחתי לשמור עותק ביטחון לפני הסידור, ולכן לא שיניתי דבר בדרייב"); }
                }
                await settings.set("cloud_organized", true);
            }
            const organized = await isOrganized();
            const stores = await getStores();
            const { json, blobs } = packForCloud(stores, { ...(deps.meta ? deps.meta() : {}), exported_at: now().toISOString(), organized }, { organized });
            const filesMap = (await settings.get("cloud_files")) || {};
            let uploaded = 0;
            let moved = 0;
            // אחרי שחזור מפת הקבצים ריקה: בלי בדיקה בענן כל תמונה הייתה עולה שוב ככפילות. לכן מחפשים אותה לפי שם בתיקייה (פעם אחת לכל תיקייה)
            const folderFiles = {};
            const findRemote = async (parentId, fileName) => {
                if (!folderFiles[parentId]) folderFiles[parentId] = Object.fromEntries((await drive.list(parentId)).map((x) => [x.name, x]));
                return folderFiles[parentId][fileName] || null;
            };
            for (const [key, info] of blobs) {
                const path = info.sub.join("/");
                const targetParent = info.sub.length ? await ensureSub(ids, info.folder, info.sub) : ids[info.folder];
                let known = filesMap[key];
                const atTarget = known && known.fileName === info.fileName && (known.path || "") === path;
                if (!atTarget) {
                    const remoteFile = await findRemote(targetParent, info.fileName);
                    if (remoteFile) known = { id: remoteFile.id, size: Number(remoteFile.size), fileName: info.fileName, folder: info.folder, path, parent: targetParent };
                    else if (info.sub.length || (known && known.path)) {
                        // הקובץ כבר בדרייב במקום אחר (השם הישן בתיקייה הראשית או מיקום קודם): מעבירים ומשנים שם, בלי להעלות מחדש
                        let from = known && known.id ? { id: known.id, parent: known.parent || ids[known.folder], size: known.size } : null;
                        if (!from) { const legacy = await findRemote(ids[info.folder], info.legacyName); if (legacy) from = { id: legacy.id, parent: ids[info.folder], size: Number(legacy.size) }; }
                        if (from) {
                            await drive.move({ id: from.id, name: info.fileName, fromParent: from.parent, toParent: targetParent });
                            known = { id: from.id, size: from.size, fileName: info.fileName, folder: info.folder, path, parent: targetParent };
                            folderFiles[targetParent] = null; // המפה של התיקייה השתנתה
                            moved += 1;
                        }
                    }
                }
                if (known && known.size === info.blob.size && known.fileName === info.fileName && (known.path || "") === path) { filesMap[key] = known; continue; }
                const res = await drive.putFile({ name: info.fileName, parentId: targetParent, blob: info.blob, mime: info.blob.type || "application/octet-stream", existingId: known ? known.id : null });
                filesMap[key] = { id: res.id, size: info.blob.size, fileName: info.fileName, folder: info.folder, path, parent: targetParent };
                uploaded += 1;
            }
            await settings.set("cloud_files", filesMap);
            const res = await drive.upsertByName({ name: DATA_FILE, parentId: ids.root, blob: json, mime: "application/json" });
            await settings.set("cloud_remote_mtime", res.modifiedTime || null);

            // צילום יומי (אחד ליום, שבעה אחרונים)
            const day = isoDay(now());
            if ((await settings.get("cloud_last_snapshot")) !== day) {
                await drive.upsertByName({ name: `data-${day}.json`, parentId: ids.backups, blob: json, mime: "application/json" });
                await settings.set("cloud_last_snapshot", day);
                await pruneSnapshots(ids);
            }
            const at = now().toISOString();
            await settings.set("cloud_last_backup", at);
            return { uploadedImages: uploaded, movedFiles: moved, at };
        } finally {
            running = false;
            if (again) { again = false; /* הקורא מתזמן שוב */ }
        }
    }

    // שחזור מלא מהענן: מוריד, מאמת, ורק אז מחליף את הנתונים המקומיים
    async function restore() {
        const ids = await ensureFolders();
        const f = await drive.findOne(DATA_FILE, ids.root, "file");
        if (!f) throw new Error("לא נמצא גיבוי בענן");
        const text = await drive.downloadText(f.id);
        const cache = {};
        const listFolder = async (folderKey) => {
            if (!cache[folderKey]) cache[folderKey] = Object.fromEntries((await drive.list(ids[folderKey])).map((x) => [x.name, x.id]));
            return cache[folderKey];
        };
        const subIds = {};
        const findInPath = async (folderKey, path, fileName) => { // לפי תיקיות המשנה, או null אם משהו חסר
            let parent = ids[folderKey];
            for (const seg of path.split("/")) {
                const k = `${parent}/${seg}`;
                if (subIds[k] === undefined) { const f = await drive.findOne(seg, parent, "application/vnd.google-apps.folder"); subIds[k] = f ? f.id : null; }
                if (!subIds[k]) return null;
                parent = subIds[k];
            }
            const f = await drive.findOne(fileName, parent, "file");
            return f ? f.id : null;
        };
        const { stores, meta } = await unpackFromCloud(text, async (ref, folderKey) => {
            let id = ref.path ? await findInPath(folderKey, ref.path, ref.fileName) : null;
            if (!id) { // בלי תיקיות משנה (גיבוי ישן) או אחרי שהקובץ הוזז ידנית: חיפוש לפי השם הישן בתיקייה הראשית
                const map = await listFolder(folderKey);
                id = map[ref.fileName] || map[`${ref.__cloud}.${extFor(ref.type)}`];
            }
            if (!id) throw new Error(`חסר קובץ בענן: ${ref.fileName}`);
            const blob = await drive.download(id);
            return blob.type || !ref.type ? blob : new Blob([blob], { type: ref.type });
        });
        await setStores(stores);
        if (meta && meta.organized) await settings.set("cloud_organized", true); // מכשיר שמשחזר מגיבוי מסודר ממשיך לסדר, ולא מחזיר שמות ישנים
        await settings.set("cloud_remote_mtime", f.modifiedTime || null);
        await settings.set("cloud_last_backup", now().toISOString());
        // מפת הקבצים נבנית מחדש בגיבוי הבא
        await settings.set("cloud_files", {});
        return { rows: Object.values(stores).reduce((n, r) => n + r.length, 0) };
    }

    // שמירת דוח (HTML) בתיקייה ייעודית: KitchenCostPro / folder / sub... / name. אותו שם = מעדכן את אותו קובץ
    const reportCache = {};
    async function saveReport({ folder, sub = [], name, blob, mime = "text/html" }) {
        const ids = await ensureFolders();
        let parent = ids.root;
        for (const seg of [folder, ...sub]) {
            const k = `${parent}/${seg}`;
            if (!reportCache[k]) reportCache[k] = await drive.ensureFolder(seg, parent);
            parent = reportCache[k];
        }
        const f = await drive.upsertByName({ name, parentId: parent, blob, mime });
        return { id: f.id, path: [ROOT_FOLDER, folder, ...sub, name].join(" / ") };
    }

    return { ensureFolders, remoteInfo, connect, disconnect, backup, restore, isOrganized, saveReport, needsAgain: () => again };
}
