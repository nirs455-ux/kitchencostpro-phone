// הזמנות לספק: רשימת הזמנה קבועה (נשמרת), שליחה בוואטסאפ / במייל / העתקה, והיסטוריית הזמנות.
import { openModal, closeModal, toast, escapeHtml, confirmDialog } from "../ui.js";
import { listAllPantryItems } from "../repo/pantryRepo.js";
import { getOrderBook, saveOrderList, setSupplierContact, recordOrder, deleteOrder, normalizeLine, lineQtyText, validEmail, suggestOrderLines, lineIdentity } from "../repo/ordersRepo.js";
import { whatsappUrl, mailtoUrl, orderText, normalizePhoneIL, MAIL_BODY_MAX } from "../shareText.js";

const shortDate = (d) => { const [y, m, day] = String(d || "").split("-"); return day ? `${parseInt(day, 10)}.${parseInt(m, 10)}.${y.slice(2)}` : String(d || ""); };
const VIA = { whatsapp: "💬 וואטסאפ", email: "✉️ מייל", copy: "📋 הועתק" };
const defaultUnit = (p) => (p.unit_type === "weight" ? 'ק"ג' : p.unit_type === "liter" ? "ליטר" : "יח'");

export async function openOrderModal(supplier, onChanged, startTab = "order") {
    let seeded = false;
    let book = await getOrderBook(supplier.id);
    let pantry = [];
    try { pantry = (await listAllPantryItems()).filter((p) => !p.parent_id); } catch (e) { /* ההשלמה האוטומטית היא רק עזר */ }
    // רשימה ריקה: נבנית אוטומטית מהחשבוניות של הספק (כל מוצר ביחידה שבה נקנה, כמות רגילה = ממוצע הקניות)
    if (!book.list.length && !book.history.length) {
        try { const seed = (await suggestOrderLines(supplier.id)).slice(0, 60); if (seed.length) { book.list = await saveOrderList(supplier.id, seed); seeded = true; } } catch (e) { /* בונים ידנית */ }
    }
    let tab = startTab;
    const qtys = new Map(); // key -> כמות להזמנה הנוכחית
    let note = "";
    let phone = book.phone;
    let email = book.email;
    let days = book.days.slice();
    let cutoff = book.cutoff;

    const ov = openModal(`<div id="oq-root" style="display:flex;flex-direction:column;height:100%;min-height:0;"></div>`, { page: true });
    const root = ov.querySelector("#oq-root");
    const changed = () => { if (onChanged) onChanged(); };

    // שומר את מה שהוקלד לפני בנייה מחדש של המסך
    const grab = () => {
        root.querySelectorAll("[data-oq]").forEach((i) => qtys.set(i.dataset.oq, i.value));
        const n = root.querySelector("#oq-note"); if (n) note = n.value;
        const p = root.querySelector("#oq-phone"); if (p) phone = p.value;
        const e = root.querySelector("#oq-email"); if (e) email = e.value;
        const c = root.querySelector("#oq-cutoff"); if (c) cutoff = c.value;
        if (root.querySelector("#oq-days")) days = [...root.querySelectorAll("#oq-days input:checked")].map((i) => +i.value);
    };
    const persistList = async () => { book.list = await saveOrderList(supplier.id, book.list); };

    function draw() {
        root.innerHTML = `
            <div class="pg-top"><button type="button" class="pg-back" id="oq-close" aria-label="חזרה">→</button><div class="pg-title">הזמנות: ${escapeHtml(supplier.name)}</div></div>
            <div class="seg" id="oq-seg" style="margin:8px 14px 0;">
                <button data-t="order" class="${tab === "order" ? "active" : ""}">הזמנה</button>
                <button data-t="list" class="${tab === "list" ? "active" : ""}">רשימה <span class="seg-n">${book.list.length}</span></button>
                <button data-t="history" class="${tab === "history" ? "active" : ""}">היסטוריה <span class="seg-n">${book.history.length}</span></button>
                <button data-t="details" class="${tab === "details" ? "active" : ""}">פרטי ספק</button>
            </div>
            <div class="pg-body" id="oq-body"></div>
            <div class="pg-foot" id="oq-foot" hidden></div>`;
        root.querySelectorAll("#oq-seg button").forEach((b) => { b.onclick = () => { grab(); tab = b.dataset.t; draw(); }; });
        root.querySelector("#oq-close").onclick = closeModal;
        const body = root.querySelector("#oq-body");
        if (tab === "list") drawList(body); else if (tab === "history") drawHistory(body); else if (tab === "details") drawDetails(body); else drawOrder(body);
    }

    // ---------- פרטי ספק ----------
    const DAY_NAMES = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];
    function drawDetails(body) {
        body.innerHTML = `
            <div class="hint">הפרטים האלה משמשים לשליחת ההזמנה ולתזכורות.</div>
            <div class="field"><label>טלפון (וואטסאפ)</label><input type="tel" id="oq-phone" value="${escapeHtml(phone)}" placeholder="050-1234567"></div>
            <div class="field"><label>מייל</label><input type="email" id="oq-email" dir="ltr" value="${escapeHtml(email)}" placeholder="orders@supplier.com"></div>
            <div class="field"><label>ימי חלוקה של הספק</label>
                <div id="oq-days" class="fchips" style="flex-wrap:wrap;">${DAY_NAMES.map((n, i) => `<label class="chip ${days.includes(i) ? "active" : ""}" style="cursor:pointer;"><input type="checkbox" value="${i}" ${days.includes(i) ? "checked" : ""} style="display:none;">${n}</label>`).join("")}</div></div>
            <div class="field"><label>שעת סגירת הזמנות (עד מתי אפשר להזמין לחלוקה)</label><input type="time" id="oq-cutoff" value="${escapeHtml(cutoff)}"></div>
            <div class="error-msg"></div>
            <button type="button" class="btn btn-primary btn-block" id="oq-save-details">שמירת פרטי הספק</button>`;
        body.querySelectorAll("#oq-days input").forEach((i) => { i.onchange = () => i.parentElement.classList.toggle("active", i.checked); });
        const err = body.querySelector(".error-msg");
        body.querySelector("#oq-save-details").onclick = async () => {
            grab();
            try { await setSupplierContact(supplier.id, { phone, email, days, cutoff }); } catch (e) { err.textContent = e.message; err.style.display = "block"; return; }
            supplier.phone = phone.trim(); supplier.email = email.trim();
            book = await getOrderBook(supplier.id);
            toast("נשמר");
            changed();
        };
    }

    // ---------- הזמנה חדשה ----------
    function drawOrder(body) {
        const rows = book.list.map((l) => `
            <div class="item-row-inputs"><div class="top-line">
                <div style="flex:2;min-width:0;"><div style="font-weight:600;">${escapeHtml(l.name)}</div>${l.qty || l.unit ? `<div class="hint" style="margin:0;">רגיל: ${escapeHtml(lineQtyText(l))}</div>` : ""}</div>
                <input type="text" inputmode="decimal" data-oq="${l.key}" value="${escapeHtml(qtys.get(l.key) || "")}" placeholder="כמות" style="width:74px;">
                <span style="min-width:34px;font-size:13px;">${escapeHtml(l.unit)}</span>
            </div></div>`).join("");
        body.innerHTML = `
            ${book.list.length ? `<div class="card-row" style="margin-bottom:6px;"><span class="hint" style="margin:0;">מלא כמות רק למה שרוצים להזמין.</span><button type="button" class="btn btn-secondary btn-small" id="oq-fill">מלא כמויות רגילות</button></div><div id="oq-list">${rows}</div>`
                : `<div class="empty-state">אין עדיין חשבוניות של הספק הזה, ולכן הרשימה ריקה.<br>אפשר להוסיף פריטים ידנית.</div><button type="button" class="btn btn-primary btn-block" id="oq-build">הוספת פריטים</button>`}
            <div class="field" style="margin-top:8px;"><label>הערות או מוצרים נוספים להזמנה הזו</label><textarea id="oq-note" rows="2" style="width:100%;" placeholder="למשל: לספק עד 7 בבוקר">${escapeHtml(note)}</textarea></div>
            <div class="hint" style="margin-top:6px;">${phone || email ? `יישלח אל: ${escapeHtml([phone, email].filter(Boolean).join(" · "))}` : "עוד לא הוזנו טלפון או מייל של הספק. אפשר להוסיף בלשונית פרטי ספק."}</div>`;
        const foot = root.querySelector("#oq-foot");
        foot.hidden = false;
        foot.innerHTML = `<div class="error-msg"></div>
            <div class="modal-actions" style="margin-top:0;flex-wrap:wrap;">
                <button type="button" class="btn btn-secondary" id="oq-copy">📋 העתק</button>
                <button type="button" class="btn btn-secondary" id="oq-mail">✉️ מייל</button>
                <button type="button" class="btn btn-primary" id="oq-send">💬 וואטסאפ</button>
            </div>`;
        const err = foot.querySelector(".error-msg");
        const fail = (m) => { err.textContent = m; err.style.display = "block"; };
        const fill = body.querySelector("#oq-fill");
        if (fill) fill.onclick = () => { grab(); book.list.forEach((l) => { if (l.qty) qtys.set(l.key, l.qty); }); draw(); };
        const bld = body.querySelector("#oq-build");
        if (bld) bld.onclick = () => { grab(); tab = "list"; draw(); };

        const collect = () => {
            grab();
            const lines = book.list.filter((l) => (qtys.get(l.key) || "").trim()).map((l) => ({ name: l.name, unit: l.unit, qty: qtys.get(l.key).trim() }));
            return { lines, note };
        };
        const textOf = (c) => orderText(supplier.name, new Date().toLocaleDateString("he-IL"), c.lines.map((l) => ({ name: l.name, qty: lineQtyText(l) })), c.note);
        const finish = async (c, via) => {
            await recordOrder(supplier.id, { lines: c.lines, note: c.note, via });
            book = await getOrderBook(supplier.id);
            qtys.clear(); note = "";
            toast("ההזמנה נשמרה בהיסטוריה");
            changed();
            draw();
        };
        const check = (c) => { if (!c.lines.length && !c.note.trim()) { fail("לא הוזנה אף כמות."); return false; } return true; };

        foot.querySelector("#oq-copy").onclick = async () => {
            const c = collect(); if (!check(c)) return;
            try { await navigator.clipboard.writeText(textOf(c)); } catch (e) { fail("לא הצלחתי להעתיק"); return; }
            await finish(c, "copy");
        };
        foot.querySelector("#oq-send").onclick = async () => {
            const c = collect(); if (!check(c)) return;
            if (!normalizePhoneIL(phone)) { fail("חסר טלפון תקין של הספק. אפשר להוסיף בלשונית פרטי ספק."); return; }
            window.open(whatsappUrl(textOf(c), phone), "_blank", "noopener");
            await finish(c, "whatsapp");
        };
        foot.querySelector("#oq-mail").onclick = async () => {
            const c = collect(); if (!check(c)) return;
            if (!validEmail(email)) { fail("חסרה כתובת מייל תקינה של הספק. אפשר להוסיף בלשונית פרטי ספק."); return; }
            if (textOf(c).length > MAIL_BODY_MAX) { fail("הרשימה ארוכה מדי לשליחה במייל (המייל היה נחתך). שלח בוואטסאפ או העתק."); return; }
            const subject = `הזמנה ל-${new Date().toLocaleDateString("he-IL")} - ${supplier.name}`;
            window.location.href = mailtoUrl(email, subject, textOf(c));
            await finish(c, "email");
        };
    }

    // ---------- רשימת הזמנה ----------
    async function drawList(body) {
        const inList = new Set(book.list.map(lineIdentity));
        let suggestions = [];
        try { suggestions = (await suggestOrderLines(supplier.id)).filter((p) => !inList.has(lineIdentity(p))).slice(0, 40); } catch (e) { /* הצעות הן רק עזר */ }
        const rows = book.list.map((l, i) => `
            <div class="item-row-inputs" data-i="${i}"><div class="top-line">
                <div style="flex:2;min-width:0;font-weight:600;">${escapeHtml(l.name)}</div>
                <button type="button" class="btn btn-secondary btn-small" data-up="${i}" ${i === 0 ? "disabled" : ""}>↑</button>
                <button type="button" class="btn btn-secondary btn-small" data-down="${i}" ${i === book.list.length - 1 ? "disabled" : ""}>↓</button>
                <button type="button" class="btn btn-danger btn-small" data-del="${i}">✕</button>
            </div><div class="top-line" style="margin-top:4px;">
                <input type="text" inputmode="decimal" data-dq="${i}" value="${escapeHtml(l.qty)}" placeholder="כמות רגילה" style="width:42%;">
                <input type="text" data-du="${i}" value="${escapeHtml(l.unit)}" placeholder="יחידה (למשל ארגז)" style="width:50%;">
            </div></div>`).join("");
        body.innerHTML = `
            <div class="hint">הרשימה נבנתה מהחשבוניות של הספק ונשמרת. הכמות הרגילה היא ממוצע הקניות הקודמות. אפשר לשנות, להוסיף ולסדר.</div>
            <div id="oq-rows">${rows || '<div class="empty-state">הרשימה ריקה.</div>'}</div>
            <div class="field" style="margin-top:8px;"><label>הוספת פריט (חומר גלם או שם חופשי)</label>
                <div class="top-line"><input type="text" id="oq-add" list="oq-pantry-dl" placeholder="התחל להקליד שם" style="flex:1;"><button type="button" class="btn btn-primary btn-small" id="oq-add-btn">הוסף</button></div>
                <datalist id="oq-pantry-dl">${pantry.map((p) => `<option value="${escapeHtml(p.name)}"></option>`).join("")}</datalist></div>
            ${suggestions.length ? `<div class="field"><label>מהחשבוניות של הספק, עוד לא ברשימה <button type="button" class="btn btn-secondary btn-small" id="oq-all">הוסף את כולם</button></label>
                <div class="fchips" style="flex-wrap:wrap;">${suggestions.map((p, i) => `<button type="button" class="chip" data-sg="${i}">+ ${escapeHtml(p.name)}${p.unit ? ` (${escapeHtml(p.unit)})` : ""}</button>`).join("")}</div></div>` : ""}`;

        const reload = async () => { await persistList(); changed(); draw(); };
        body.querySelectorAll("[data-dq]").forEach((i) => { i.onchange = async () => { book.list[+i.dataset.dq].qty = i.value.trim(); await persistList(); }; });
        body.querySelectorAll("[data-du]").forEach((i) => { i.onchange = async () => { book.list[+i.dataset.du].unit = i.value.trim(); await persistList(); }; });
        body.querySelectorAll("[data-del]").forEach((b) => { b.onclick = async () => { book.list.splice(+b.dataset.del, 1); await reload(); }; });
        body.querySelectorAll("[data-up]").forEach((b) => { b.onclick = async () => { const i = +b.dataset.up; [book.list[i - 1], book.list[i]] = [book.list[i], book.list[i - 1]]; await reload(); }; });
        body.querySelectorAll("[data-down]").forEach((b) => { b.onclick = async () => { const i = +b.dataset.down; [book.list[i + 1], book.list[i]] = [book.list[i], book.list[i + 1]]; await reload(); }; });

        const addLine = (line) => book.list.push(normalizeLine(line));
        const addByName = async () => {
            const inp = body.querySelector("#oq-add");
            const name = inp.value.trim();
            if (!name) return;
            const p = pantry.find((x) => x.name.trim().toLowerCase() === name.toLowerCase());
            addLine(p ? { name: p.name, unit: defaultUnit(p), pantry_item_id: p.id } : { name });
            await reload();
        };
        body.querySelector("#oq-add-btn").onclick = addByName;
        body.querySelector("#oq-add").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addByName(); } });
        const sugLine = (s) => ({ name: s.name, unit: s.unit, qty: s.qty, pantry_item_id: s.pantry_item_id, stock_factor: s.stock_factor });
        body.querySelectorAll("[data-sg]").forEach((b) => { b.onclick = async () => { addLine(sugLine(suggestions[+b.dataset.sg])); await reload(); }; });
        const all = body.querySelector("#oq-all");
        if (all) all.onclick = async () => { suggestions.forEach((s) => addLine(sugLine(s))); await reload(); };
    }

    // ---------- היסטוריה ----------
    function drawHistory(body) {
        if (!book.history.length) { body.innerHTML = '<div class="empty-state">עוד לא נשלחה אף הזמנה לספק הזה.</div>'; return; }
        body.innerHTML = book.history.map((o) => `
            <details class="card" style="padding:8px 10px;margin-bottom:6px;"><summary style="cursor:pointer;">
                <b>${escapeHtml(shortDate(o.date))}</b> · ${o.lines.length} פריטים · ${escapeHtml(VIA[o.via] || "")}</summary>
                <div style="margin-top:6px;">${o.lines.map((l) => `<div>• ${escapeHtml(l.name)} - ${escapeHtml(lineQtyText(l))}</div>`).join("")}${o.note ? `<div class="hint">${escapeHtml(o.note)}</div>` : ""}</div>
                <div class="modal-actions" style="margin-top:6px;"><button type="button" class="btn btn-danger btn-small" data-hd="${o.id}">מחק</button><button type="button" class="btn btn-primary btn-small" data-hr="${o.id}">הזמן שוב</button></div>
            </details>`).join("");
        body.querySelectorAll("[data-hd]").forEach((b) => { b.onclick = async () => { if (!(await confirmDialog("למחוק את ההזמנה מההיסטוריה?"))) return; await deleteOrder(supplier.id, +b.dataset.hd); book = await getOrderBook(supplier.id); changed(); draw(); }; });
        body.querySelectorAll("[data-hr]").forEach((b) => {
            b.onclick = async () => {
                const o = book.history.find((x) => x.id === +b.dataset.hr);
                qtys.clear();
                for (const l of o.lines) {
                    let row = book.list.find((x) => x.name.trim().toLowerCase() === l.name.trim().toLowerCase());
                    if (!row) { row = normalizeLine({ name: l.name, unit: l.unit }); book.list.push(row); }
                    qtys.set(row.key, l.qty);
                }
                note = o.note || "";
                await persistList(); // מפתחות השורות החדשות נשמרים יחד עם הרשימה
                tab = "order";
                draw();
            };
        });
    }

    if (seeded) changed();
    draw();
}
