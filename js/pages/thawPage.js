// מעקב הפשרות: רישום מוצר מופשר (אפשר מצילום אריזה), סיום ההפשרה עם טמפרטורה, והדפסת הטופס. הנתונים ב-thawRepo.js.
import { openModal, closeModal, toast, escapeHtml, confirmDialog, info } from "../ui.js";
import { openImagePicker } from "../imagePicker.js";
import { getAgentKey } from "../agent.js";
import { scanThawPackage } from "../repo/scanRepo.js";
import { listThaws, saveThaws, getOperator, setOperator } from "../repo/thawRepo.js";
import { FOOD_TYPES, foodTypeLabel, isOpen, nowParts, upsertEntry, removeEntry, printableRows, markPrinted, normalizeEntry } from "../thaw.js";
import { renderThawPdf } from "../thawPdf.js";
import { dateDots } from "../serviceDoc.js";
import { showImageFullscreen, dataUrlToBlob } from "../imageUtil.js";

// תמונה קטנה לשמירה ברשומה (התווית המקורית נשמרת עד סיום הטיפול התרמי)
async function thumbOf(file) {
    try {
        const bmp = await createImageBitmap(file);
        const s = Math.min(1, 640 / Math.max(bmp.width, bmp.height));
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(bmp.width * s)); c.height = Math.max(1, Math.round(bmp.height * s));
        c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
        if (bmp.close) bmp.close();
        return c.toDataURL("image/jpeg", 0.55);
    } catch (e) { return ""; }
}

export async function renderThaw(container) {
    let log = await listThaws();
    const persist = async () => { await saveThaws(log); log = await listThaws(); };

    const rowHtml = (e) => `<div class="card-row" data-id="${escapeHtml(e.id)}" style="padding:8px 0;border-top:1px solid var(--border,#0001);gap:8px;align-items:center;">
        <div style="flex:1;min-width:0;"><b>${escapeHtml(e.product || "ללא שם")}</b> <span class="muted">${escapeHtml([e.supplier, foodTypeLabel(e.foodType)].filter(Boolean).join(" · "))}</span>
        <div class="muted">${escapeHtml(`${dateDots(e.startDate)} ${e.startTime}`)}${e.endDate ? escapeHtml(` ← ${dateDots(e.endDate)} ${e.endTime}${e.endTemp ? ` · ${e.endTemp}°` : ""}`) : ""}${e.printed ? ` · ✓` : ""}</div></div>
        ${isOpen(e) ? `<button type="button" class="btn btn-accent btn-small" data-finish="${escapeHtml(e.id)}">הופשר</button>` : ""}</div>`;

    function paint() {
        const open = log.filter(isOpen), done = log.filter((e) => !isOpen(e)).slice(0, 40);
        container.innerHTML = `
            <div class="card">
                <div class="card-title" style="margin:0 0 6px;">מעקב הפשרות ${info("רושמים כל מוצר שמופשר: ספק, מוצר, תאריך פג תוקף, ותחילת ההפשרה. בסיום לוחצים הופשר ומזינים טמפרטורה. הטופס מודפס באותן עמודות של הטופס בנייר.")}</div>
                <div class="btn-row" style="flex-wrap:wrap;gap:6px;">
                    <button type="button" class="btn btn-accent" id="th-photo">📷 הפשרה מצילום</button>
                    <button type="button" class="btn btn-secondary" id="th-new">✎ הפשרה ידנית</button>
                    <button type="button" class="btn btn-secondary" id="th-print">🖨️ הדפסת טופס</button>
                </div>
            </div>
            <div class="card"><div class="card-title" style="margin:0 0 4px;">בהפשרה עכשיו</div>${open.length ? open.map(rowHtml).join("") : `<div class="muted">אין מוצרים בהפשרה.</div>`}</div>
            <div class="card"><div class="card-title" style="margin:0 0 4px;">הפשרות שהסתיימו</div>${done.length ? done.map(rowHtml).join("") : `<div class="muted">עדיין אין.</div>`}</div>`;
        container.querySelector("#th-photo").onclick = startPhoto;
        container.querySelector("#th-new").onclick = () => openForm(null, {});
        container.querySelector("#th-print").onclick = openPrint;
        container.querySelectorAll("[data-finish]").forEach((b) => { b.onclick = (ev) => { ev.stopPropagation(); openFinish(log.find((x) => x.id === b.dataset.finish)); }; });
        container.querySelectorAll("[data-id]").forEach((r) => { r.onclick = () => openForm(log.find((x) => x.id === r.dataset.id), {}); });
    }

    function startPhoto() {
        openImagePicker({
            title: "צילום אריזה",
            hint: "צלם את האריזה כך שהספק, שם המוצר ותאריך התפוגה יהיו קריאים. תראה טיוטה לבדיקה לפני שמירה.",
            onFile: async (file) => {
                const wait = openModal('<div style="text-align:center;padding:24px;color:#666;">קורא את האריזה...</div>');
                const photo = await thumbOf(file);
                let draft = {};
                try { draft = await scanThawPackage(await getAgentKey(), file); } catch (e) { toast(e && e.message ? e.message : "הקריאה נכשלה. אפשר למלא ידנית."); }
                closeModal();
                openForm(null, { ...draft, photo });
            },
        });
    }

    async function openForm(entry, seed) {
        const op = await getOperator();
        const e = entry ? { ...entry } : normalizeEntry({ ...seed, operator: op });
        const isNew = !entry;
        const f = (id, label, val, type = "text", extra = "") => `<div class="field"><label>${escapeHtml(label)}</label><input type="${type}" id="${id}" value="${escapeHtml(val || "")}" ${extra}></div>`;
        const ov = openModal(`
            <h2>${isNew ? "הפשרה חדשה" : "פרטי הפשרה"}</h2>
            ${seed && seed.photo || e.photo ? `<div style="text-align:center;margin-bottom:8px;"><img id="th-img" src="${escapeHtml(e.photo)}" alt="" style="max-height:120px;max-width:100%;border-radius:6px;"></div>` : ""}
            ${seed && seed.notes ? `<div class="hint-warn">${escapeHtml(seed.notes)}</div>` : ""}
            ${isNew && seed && seed.photo ? `<div class="hint-warn">זו קריאה אוטומטית והיא עלולה לטעות. בדוק כל שדה מול האריזה.</div>` : ""}
            ${f("th-sup", "שם ספק המוצר", e.supplier)}
            ${f("th-prod", "שם המוצר", e.product)}
            <div class="field"><label>סוג המזון</label><select id="th-type">${FOOD_TYPES.map((t) => `<option value="${t.key}"${t.key === e.foodType ? " selected" : ""}>${t.label}</option>`).join("")}</select></div>
            ${f("th-exp", "תאריך פג תוקף על פי הוראות יצרן", e.expiry, "date")}
            <div class="form-row">${f("th-sd", "תאריך תחילת ההפשרה", e.startDate, "date")}${f("th-st", "שעת תחילת ההפשרה", e.startTime, "time")}</div>
            <div class="form-row">${f("th-ed", "תאריך סיום ההפשרה", e.endDate, "date")}${f("th-et", "שעת סיום ההפשרה", e.endTime, "time")}</div>
            ${f("th-tmp", "טמפרטורת המזון בסיום ההפשרה", e.endTemp, "text", 'inputmode="decimal"')}
            ${f("th-op", "שם המבצע", e.operator)}
            <div class="modal-actions">${isNew ? "" : `<button type="button" class="btn btn-danger" id="th-del">מחיקה</button>`}<button type="button" class="btn btn-secondary" id="th-cancel">ביטול</button><button type="button" class="btn btn-primary" id="th-save">שמירה</button></div>`);
        const g = (id) => ov.querySelector(id).value;
        const img = ov.querySelector("#th-img");
        if (img && e.photo) img.onclick = () => showImageFullscreen(dataUrlToBlob(e.photo), "אריזה");
        ov.querySelector("#th-cancel").onclick = closeModal;
        const del = ov.querySelector("#th-del");
        if (del) del.onclick = async () => { if (await confirmDialog("למחוק את הרשומה?")) { log = removeEntry(log, e.id); await persist(); paint(); } };
        ov.querySelector("#th-save").onclick = async () => {
            if (!g("#th-prod").trim()) { toast("הזן שם מוצר"); return; }
            const next = { ...e, supplier: g("#th-sup"), product: g("#th-prod"), foodType: g("#th-type"), expiry: g("#th-exp"), startDate: g("#th-sd"), startTime: g("#th-st"), endDate: g("#th-ed"), endTime: g("#th-et"), endTemp: g("#th-tmp"), operator: g("#th-op"), photo: e.photo || (seed && seed.photo) || "" };
            log = upsertEntry(log, next);
            await setOperator(next.operator);
            await persist();
            closeModal(); paint();
        };
    }

    function openFinish(e) {
        if (!e) return;
        const now = nowParts();
        const ov = openModal(`
            <h2>סיום הפשרה</h2>
            <div class="muted" style="margin-bottom:6px;">${escapeHtml(e.product)} ${escapeHtml(e.supplier)}</div>
            <div class="form-row"><div class="field"><label>תאריך סיום ההפשרה</label><input type="date" id="fn-d" value="${now.date}"></div><div class="field"><label>שעת סיום ההפשרה</label><input type="time" id="fn-t" value="${now.time}"></div></div>
            <div class="field"><label>טמפרטורת המזון בסיום ההפשרה</label><input type="text" inputmode="decimal" id="fn-tmp" placeholder="°"></div>
            <div class="modal-actions"><button type="button" class="btn btn-secondary" id="fn-cancel">ביטול</button><button type="button" class="btn btn-primary" id="fn-save">שמירה</button></div>`);
        ov.querySelector("#fn-cancel").onclick = closeModal;
        ov.querySelector("#fn-save").onclick = async () => {
            const g = (id) => ov.querySelector(id).value;
            log = upsertEntry(log, { ...e, endDate: g("#fn-d"), endTime: g("#fn-t"), endTemp: g("#fn-tmp") });
            await persist(); closeModal(); paint();
        };
    }

    function openPrint() {
        const t = nowParts().date;
        const ov = openModal(`
            <h2>הדפסת טופס</h2>
            <label class="checkbox-field"><input type="radio" name="pm" value="unprinted" checked><span>רק מה שעוד לא הודפס</span></label>
            <label class="checkbox-field"><input type="radio" name="pm" value="range"><span>לפי תאריכים</span></label>
            <div class="form-row" id="pm-range" style="display:none;"><div class="field"><label>מתאריך</label><input type="date" id="pm-from" value="${t.slice(0, 8)}01"></div><div class="field"><label>עד תאריך</label><input type="date" id="pm-to" value="${t}"></div></div>
            <div class="muted" id="pm-info"></div>
            <div class="modal-actions"><button type="button" class="btn btn-secondary" id="pm-cancel">ביטול</button><button type="button" class="btn btn-primary" id="pm-go">צור טופס</button></div>`);
        const opts = () => { const mode = ov.querySelector("input[name=pm]:checked").value; return { mode, from: ov.querySelector("#pm-from").value, to: ov.querySelector("#pm-to").value }; };
        const refresh = () => {
            const o = opts(); ov.querySelector("#pm-range").style.display = o.mode === "range" ? "" : "none";
            const r = printableRows(log, o);
            ov.querySelector("#pm-info").textContent = `${r.rows.length} שורות מוכנות להדפסה${r.openCount ? `, ועוד ${r.openCount} שעדיין בהפשרה ולא ייכללו` : ""}`;
        };
        ov.querySelectorAll("input").forEach((i) => { i.onchange = refresh; });
        refresh();
        ov.querySelector("#pm-cancel").onclick = closeModal;
        ov.querySelector("#pm-go").onclick = async () => {
            const o = opts(); const r = printableRows(log, o);
            if (!r.rows.length) { toast("אין שורות להדפסה"); return; }
            let pdf;
            try { pdf = await renderThawPdf(r.rows, o.mode === "range" ? `${dateDots(o.from)} עד ${dateDots(o.to)}` : ""); } catch (er) { toast("יצירת הקובץ נכשלה"); return; }
            closeModal();
            const url = URL.createObjectURL(pdf);
            if (!window.open(url, "_blank")) toast("הדפדפן חסם את פתיחת הדף. אפשר חלונות קופצים לאתר ונסה שוב.");
            setTimeout(() => URL.revokeObjectURL(url), 120000);
            if (await confirmDialog("לסמן את השורות האלה כהודפסו?")) {
                log = markPrinted(log, new Set(r.rows.map((x) => x.id)), nowParts().date);
                await persist(); paint();
            }
        };
    }
    paint();
}
