// מדבקה למדפסת (Niimbot ודומיו): בוחרים גודל, תאריכים ואלרגנים, רואים תצוגה מקדימה ושומרים/משתפים תמונה לייבוא באפליקציית המדפסת.
import { openModal, closeModal, toast, escapeHtml } from "../ui.js";
import { getSetting, setSetting } from "../repo/settingsRepo.js";
import { LABEL_SIZES, renderLabel, shortDateText } from "../labelImage.js";

const pad = (n) => String(n).padStart(2, "0");
const toInput = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromInput = (v) => { const [y, m, d] = String(v).split("-").map(Number); return y ? new Date(y, m - 1, d) : new Date(); };

export async function openStickerModal({ recipeId, name, allergens }) {
    const shelfKey = `sticker_shelf_${recipeId}`;
    let size = (await getSetting("sticker_size")) || "50x30";
    if (!LABEL_SIZES[size]) size = "50x30";
    const shelf = (await getSetting(shelfKey)) || "";
    const ov = openModal(`
        <h2>🏷 מדבקה: ${escapeHtml(name)}</h2>
        <div class="field"><label>גודל מדבקה</label><select id="st-size">${Object.entries(LABEL_SIZES).map(([k, v]) => `<option value="${k}" ${k === size ? "selected" : ""}>${v.label}</option>`).join("")}</select></div>
        <div class="field"><label>תאריך הכנה</label><input type="date" id="st-date" value="${toInput(new Date())}"></div>
        <div class="field"><label>חיי מדף בימים (ריק = בלי תאריך תוקף)</label><input type="text" inputmode="numeric" id="st-shelf" value="${escapeHtml(String(shelf))}"></div>
        <div class="field"><label>כמות או משקל (לא חובה)</label><input type="text" id="st-weight" placeholder='למשל: 1.2 ק"ג'></div>
        <div class="field"><label>אלרגנים (אפשר לערוך)</label><input type="text" id="st-all" value="${escapeHtml(allergens || "")}"></div>
        <div style="text-align:center;margin:8px 0;"><img id="st-prev" alt="תצוגה מקדימה" style="max-width:100%;border:1px solid var(--border,#999);background:#fff;"></div>
        <div class="hint">התמונה נשמרת או נשלחת, ומייבאים אותה באפליקציית המדפסת (הוספת תמונה) באותו גודל מדבקה.</div>
        <div class="modal-actions" style="flex-wrap:wrap;">
            <button type="button" class="btn btn-secondary" id="st-close">סגור</button>
            <button type="button" class="btn btn-secondary" id="st-save">⬇ שמור תמונה</button>
            <button type="button" class="btn btn-primary" id="st-share">📤 שתף</button>
        </div>`);
    const q = (s) => ov.querySelector(s);
    const build = () => {
        const days = parseInt(q("#st-shelf").value, 10);
        const prep = fromInput(q("#st-date").value);
        const exp = days > 0 ? new Date(prep.getFullYear(), prep.getMonth(), prep.getDate() + days) : null;
        return renderLabel({ size: q("#st-size").value, name, prepared: shortDateText(prep), expiry: exp ? shortDateText(exp) : "", allergens: q("#st-all").value.trim(), weight: q("#st-weight").value.trim() });
    };
    const refresh = () => { q("#st-prev").src = build().toDataURL("image/png"); };
    ov.addEventListener("input", refresh);
    ov.addEventListener("change", async () => { await setSetting("sticker_size", q("#st-size").value); await setSetting(shelfKey, q("#st-shelf").value.trim()); refresh(); });
    q("#st-close").onclick = closeModal;
    const blobOf = () => new Promise((res) => build().toBlob(res, "image/png"));
    const fileName = () => `מדבקה-${name.replace(/[\/:*?"<>|]+/g, " ").trim()}-${q("#st-size").value}.png`;
    q("#st-save").onclick = async () => {
        const url = URL.createObjectURL(await blobOf());
        const a = document.createElement("a");
        a.href = url; a.download = fileName();
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        toast("התמונה נשמרה");
    };
    q("#st-share").onclick = async () => {
        const file = new File([await blobOf()], fileName(), { type: "image/png" });
        try {
            if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: name });
            else toast("השיתוף לא נתמך כאן. השתמש ב'שמור תמונה'");
        } catch (e) { /* בוטל */ }
    };
    refresh();
}
