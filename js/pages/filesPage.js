// מסך "קבצים": כל התמונות והמסמכים שנשמרו באפליקציה, מחולקים לתיקיות (קבלות, מתכונים, התקבלו).
// בענן (בהמשך) התיקייה תיקרא KitchenCostPro ותכיל תת-תיקיות באותם שמות.
import { h, escapeHtml, money, toast } from "../ui.js";
import { listRow } from "./listKit.js";
import { dbGetAll } from "../db.js";
import { listInvoicesWithItems } from "../repo/suppliersRepo.js";
import { listQueue } from "../repo/scanQueue.js";
import { showImageFullscreen } from "../imageUtil.js";
import { groupBySupplier, monthOf, receiptFileName } from "../receiptGroups.js";
import { makeZip } from "../zip.js";

let openFolder = null; // null = רשימת תיקיות
let openSupplier = null; // בתיקיית הקבלות: מפתח ספק פתוח (null = רשימת הספקים)
let monthFilter = ""; // "" = כל החודשים, אחרת YYYY-MM
let urls = [];

const FOLDERS = [
    { key: "invoices", icon: "🧾", title: "קבלות וחשבוניות", hint: "תמונות החשבוניות והקבלות, לפי תאריך" },
    { key: "recipes", icon: "📖", title: "מתכונים", hint: "המסמכים המקוריים של המתכונים שנסרקו" },
    { key: "inbox", icon: "📥", title: "התקבלו", hint: "קבצים שהגיעו ועוד לא עובדו" },
];

async function loadFolder(key) {
    if (key === "invoices") {
        const inv = (await listInvoicesWithItems()).filter((i) => i.image instanceof Blob);
        return inv.map((i) => ({ blob: i.image, title: i.supplier_name, sub: `${(i.invoice_date || "").split("-").reverse().join("/")} · ${money(i.total_amount)}`, sort: i.invoice_date || "", inv: i }));
    }
    if (key === "recipes") {
        const rec = (await dbGetAll("recipes")).filter((r) => r.source_file instanceof Blob);
        return rec.map((r) => ({ blob: r.source_file, title: r.name, sub: r.category || "", sort: r.name || "" }));
    }
    const q = await listQueue();
    return q.map((x) => ({ blob: x.blob, title: "ממתין לעיבוד", sub: (x.created_at || "").slice(0, 10).split("-").reverse().join("/"), sort: x.created_at || "" }));
}

// ארוז את הקבלות בקובץ ZIP (תת-תיקייה לכל ספק כשבוחרים "הכול") ושלח: גיליון שיתוף (מייל/וואטסאפ), ואם אין - הורדה
async function sendReceipts(groups, label) {
    const entries = [];
    for (const g of groups) {
        const list = g.files.filter((i) => !monthFilter || monthOf(i) === monthFilter);
        for (const inv of list) {
            const data = new Uint8Array(await inv.image.arrayBuffer());
            const fname = receiptFileName(inv, g.name);
            entries.push({ name: groups.length > 1 ? `${g.name}/${fname}` : fname, data });
        }
    }
    if (!entries.length) { toast("אין קבלות לשליחה"); return; }
    const zipName = `קבלות-${label}${monthFilter ? "-" + monthFilter : ""}.zip`;
    const file = new File([makeZip(entries)], zipName, { type: "application/zip" });
    try {
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title: zipName });
            return;
        }
    } catch (e) { if (e && e.name === "AbortError") return; }
    const u = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = u; a.download = zipName;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 4000);
    toast("הקובץ ירד למכשיר - אפשר לשלוח אותו מהקבצים");
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
            const card = listRow({ ic: f.icon, tint: "var(--accent-soft)", name: f.title, meta: f.hint, end: String(n[f.key]) });
            card.onclick = () => { openFolder = f.key; renderFilesPage(container); };
            box.appendChild(card);
        }
        return;
    }
    const folder = FOLDERS.find((f) => f.key === openFolder);
    let files = (await loadFolder(openFolder)).sort((a, b) => b.sort.localeCompare(a.sort, "he"));
    if (openFolder === "invoices") {
        const groups = groupBySupplier(files.map((f) => f.inv));
        const months = [...new Set(files.map((f) => monthOf(f.inv)).filter(Boolean))].sort().reverse();
        if (monthFilter && !months.includes(monthFilter)) monthFilter = "";
        const monthSel = `<div class="field" style="margin:8px 0;"><label>חודש</label><select id="rc-month"><option value="">כל החודשים</option>${months.map((m) => `<option value="${m}" ${m === monthFilter ? "selected" : ""}>${m.split("-").reverse().join("/")}</option>`).join("")}</select></div>`;
        const grp = openSupplier ? groups.find((g) => g.key === openSupplier) : null;
        if (!grp) {
            openSupplier = null;
            container.innerHTML = `<button type="button" class="btn btn-secondary btn-small" id="files-back">→ כל התיקיות</button>
                <div class="card-title" style="margin:10px 2px;">${folder.icon} ${folder.title} <span class="seg-n">${files.length}</span></div>
                ${files.length ? monthSel + '<button type="button" class="btn btn-primary btn-block" id="rc-send-all">📤 שלח הכול (תיקייה לכל ספק)</button>' : ""}
                <div id="rc-suppliers" style="margin-top:10px;"></div>`;
            container.querySelector("#files-back").onclick = () => { openFolder = null; renderFilesPage(container); };
            const box = container.querySelector("#rc-suppliers");
            if (!groups.length) { box.innerHTML = '<div class="empty-state">אין עדיין קבלות.</div>'; return; }
            const cnt = (g) => g.files.filter((i) => !monthFilter || monthOf(i) === monthFilter).length;
            for (const g of groups) {
                const card = listRow({ ic: "📁", tint: "var(--accent-soft)", name: g.name, meta: "קבלות לפי תאריך", end: String(cnt(g)) });
                card.onclick = () => { openSupplier = g.key; renderFilesPage(container); };
                box.appendChild(card);
            }
            container.querySelector("#rc-month").onchange = (e) => { monthFilter = e.target.value; renderFilesPage(container); };
            container.querySelector("#rc-send-all").onclick = () => sendReceipts(groups, "כל-הספקים");
            return;
        }
        files = files.filter((f) => grp.files.includes(f.inv) && (!monthFilter || monthOf(f.inv) === monthFilter));
        container.innerHTML = `<button type="button" class="btn btn-secondary btn-small" id="files-back">→ כל הספקים</button>
            <div class="card-title" style="margin:10px 2px;">📁 ${escapeHtml(grp.name)} <span class="seg-n">${files.length}</span></div>
            ${monthSel}
            <button type="button" class="btn btn-primary btn-block" id="rc-send">📤 שלח (מייל / וואטסאפ)</button>
            <div id="files-grid" class="files-grid" style="margin-top:10px;"></div>`;
        container.querySelector("#files-back").onclick = () => { openSupplier = null; renderFilesPage(container); };
        container.querySelector("#rc-month").onchange = (e) => { monthFilter = e.target.value; renderFilesPage(container); };
        container.querySelector("#rc-send").onclick = () => sendReceipts([grp], grp.name);
        fillGrid(container, files);
        return;
    }
    container.innerHTML = `<button type="button" class="btn btn-secondary btn-small" id="files-back">→ כל התיקיות</button>
        <div class="card-title" style="margin:10px 2px;">${folder.icon} ${folder.title} <span class="seg-n">${files.length}</span></div>
        <div id="files-grid" class="files-grid"></div>`;
    container.querySelector("#files-back").onclick = () => { openFolder = null; renderFilesPage(container); };
    fillGrid(container, files);
}

function fillGrid(container, files) {
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

export function openFilesFolder(key) { openFolder = key || null; openSupplier = null; }
