// מסך "קבצים": כל התמונות והמסמכים שנשמרו באפליקציה, מחולקים לתיקיות (קבלות, מתכונים, התקבלו).
// בענן (בהמשך) התיקייה תיקרא KitchenCostPro ותכיל תת-תיקיות באותם שמות.
import { h, escapeHtml, money } from "../ui.js";
import { dbGetAll } from "../db.js";
import { listInvoicesWithItems } from "../repo/suppliersRepo.js";
import { listQueue } from "../repo/scanQueue.js";
import { showImageFullscreen } from "../imageUtil.js";

let openFolder = null; // null = רשימת תיקיות
let urls = [];

const FOLDERS = [
    { key: "invoices", icon: "🧾", title: "קבלות וחשבוניות", hint: "תמונות החשבוניות והקבלות, לפי תאריך" },
    { key: "recipes", icon: "📖", title: "מתכונים", hint: "המסמכים המקוריים של המתכונים שנסרקו" },
    { key: "inbox", icon: "📥", title: "התקבלו", hint: "קבצים שהגיעו ועוד לא עובדו" },
];

async function loadFolder(key) {
    if (key === "invoices") {
        const inv = (await listInvoicesWithItems()).filter((i) => i.image instanceof Blob);
        return inv.map((i) => ({ blob: i.image, title: i.supplier_name, sub: `${(i.invoice_date || "").split("-").reverse().join("/")} · ${money(i.total_amount)}`, sort: i.invoice_date || "" }));
    }
    if (key === "recipes") {
        const rec = (await dbGetAll("recipes")).filter((r) => r.source_file instanceof Blob);
        return rec.map((r) => ({ blob: r.source_file, title: r.name, sub: r.category || "", sort: r.name || "" }));
    }
    const q = await listQueue();
    return q.map((x) => ({ blob: x.blob, title: "ממתין לעיבוד", sub: (x.created_at || "").slice(0, 10).split("-").reverse().join("/"), sort: x.created_at || "" }));
}

async function counts() {
    const out = {};
    for (const f of FOLDERS) out[f.key] = (await loadFolder(f.key)).length;
    return out;
}

export async function renderFilesPage(container) {
    for (const u of urls) URL.revokeObjectURL(u);
    urls = [];
    if (!openFolder) {
        const n = await counts();
        container.innerHTML = `<div class="hint" style="margin:4px 2px 10px;">כל מה שצילמת או העלית, מסודר בתיקיות.</div><div id="files-folders"></div>`;
        const box = container.querySelector("#files-folders");
        for (const f of FOLDERS) {
            const card = h(`<div class="card files-folder"><div class="card-row"><span class="card-title">${f.icon} ${f.title}</span><span class="seg-n">${n[f.key]}</span></div><div class="muted">${f.hint}</div></div>`);
            card.onclick = () => { openFolder = f.key; renderFilesPage(container); };
            box.appendChild(card);
        }
        return;
    }
    const folder = FOLDERS.find((f) => f.key === openFolder);
    const files = (await loadFolder(openFolder)).sort((a, b) => b.sort.localeCompare(a.sort, "he"));
    container.innerHTML = `<button type="button" class="btn btn-secondary btn-small" id="files-back">→ כל התיקיות</button>
        <div class="card-title" style="margin:10px 2px;">${folder.icon} ${folder.title} <span class="seg-n">${files.length}</span></div>
        <div id="files-grid" class="files-grid"></div>`;
    container.querySelector("#files-back").onclick = () => { openFolder = null; renderFilesPage(container); };
    const grid = container.querySelector("#files-grid");
    if (!files.length) { grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;">אין עדיין קבצים בתיקייה הזאת.</div>'; return; }
    for (const f of files) {
        const isImg = (f.blob.type || "").startsWith("image/");
        let thumb;
        if (isImg) { const u = URL.createObjectURL(f.blob); urls.push(u); thumb = `<img src="${u}" alt="">`; }
        else thumb = `<div class="files-doc">${f.blob.type === "application/pdf" ? "PDF" : "📄"}</div>`;
        const tile = h(`<div class="files-tile">${thumb}<div class="files-cap"><b>${escapeHtml(f.title)}</b><span>${escapeHtml(f.sub)}</span></div></div>`);
        tile.onclick = () => showImageFullscreen(f.blob, f.title);
        grid.appendChild(tile);
    }
}

export function openFilesFolder(key) { openFolder = key || null; }
