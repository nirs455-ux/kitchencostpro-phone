// ספירת מלאי בלי הקלדה: דף ספירה להדפסה, צילום דף שמולא בכתב יד, והקראה בקול.
// כל אחד מהם רק ממלא את שדות הספירה במסך (apply), והמשתמש בודק ולוחץ "שמירת ספירה" כרגיל.
import { openModal, closeModal, escapeHtml } from "../ui.js";
import { openImagePicker } from "../imagePicker.js";
import { getAgentKey } from "../agent.js";
import { scanCountSheet } from "../repo/scanRepo.js";
import { countSheetHtml, parseCountAnswer, parseSpoken, suspicious, spokenQty } from "../countAssist.js";

const fmt = (n) => String(+Number(n).toFixed(3));

// ---------- דף ספירה להדפסה ----------
export function openCountSheet(rows, date) {
    const cats = [...new Set(rows.map((r) => r.cat))];
    const ov = openModal(`
        <h2>🖨️ דף ספירה להדפסה</h2>
        <div class="muted" style="margin-bottom:8px;">דף עם כל המוצרים לפי הסדר, ועמודה ריקה לכתיבת הכמות. מדפיסים, סופרים בעט, ואז מצלמים את הדף ("📷 צילום דף"). בחר אילו קבוצות להדפיס:</div>
        <div class="chips" id="cs-cats">${cats.map((c) => `<span class="chip active" data-c="${escapeHtml(c)}">${escapeHtml(c)}</span>`).join("")}</div>
        <div class="error-msg"></div>
        <div class="modal-actions"><button type="button" class="btn btn-secondary" id="cs-cancel">סגור</button><button type="button" class="btn btn-primary" id="cs-print">🖨️ הדפס / שמור PDF</button></div>`);
    ov.querySelectorAll("#cs-cats .chip").forEach((c) => { c.onclick = () => c.classList.toggle("active"); });
    ov.querySelector("#cs-cancel").onclick = closeModal;
    ov.querySelector("#cs-print").onclick = () => {
        const sel = new Set([...ov.querySelectorAll("#cs-cats .chip.active")].map((c) => c.dataset.c));
        const err = ov.querySelector(".error-msg");
        if (!sel.size) { err.textContent = "בחר לפחות קבוצה אחת"; err.style.display = "block"; return; }
        const html = countSheetHtml(rows, { date: date.split("-").reverse().join("/"), cats: sel });
        const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
        const w = window.open(url, "_blank");
        if (!w) { err.textContent = "הדפדפן חסם את פתיחת הדף. אפשר חלונות קופצים לאתר ונסה שוב."; err.style.display = "block"; return; }
        setTimeout(() => URL.revokeObjectURL(url), 120000);
    };
}

// ---------- צילום דף שמולא בכתב יד ----------
export function openCountPhoto(rows, apply) {
    const pending = new Map(); // id -> { row, qty, uncertain }
    const unmatched = [];
    const pickPage = () => openImagePicker({
        title: "צילום דף ספירה",
        hint: "צלם את הדף ישר מלמעלה, באור טוב, כך שכל העמודות נראות (אפשר דף אחד בכל צילום). הכתב צריך להיות ברור. תראה את מה שנקרא ותאשר לפני שזה עובר לספירה.",
        onFile: scan,
    });
    async function scan(file) {
        openModal('<div style="text-align:center;padding:24px;color:#666;">קורא את הדף...</div>');
        let parsed;
        try {
            parsed = parseCountAnswer(await scanCountSheet(await getAgentKey(), file), rows);
        } catch (e) {
            closeModal();
            const ov = openModal(`<h2>שגיאה בקריאת הדף</h2><div class="error-msg" style="display:block;">${escapeHtml(e.message)}</div><div class="modal-actions"><button class="btn btn-secondary" id="cp-close">סגור</button><button class="btn btn-primary" id="cp-retry">צלם שוב</button></div>`);
            ov.querySelector("#cp-close").onclick = closeModal;
            ov.querySelector("#cp-retry").onclick = () => { closeModal(); pickPage(); };
            return;
        }
        for (const m of parsed.matched) pending.set(m.row.id, m);
        unmatched.push(...parsed.unmatched);
        review();
    }
    function review() {
        const list = [...pending.values()].sort((a, b) => a.row.n - b.row.n);
        const ov = openModal(`
            <h2>📷 מה נקרא מהדף</h2>
            <div class="muted" style="margin-bottom:8px;">${list.length ? `נקראו ${list.length} מוצרים. תקן מה שלא נכון (⚠️ = כדאי לבדוק).` : "לא נקרא אף מוצר. נסה לצלם שוב קרוב וברור יותר."}</div>
            <div id="cp-list">${list.map((m) => {
                const warn = m.uncertain || suspicious(m.qty, m.row.expected);
                return `<div class="inv-item"><div class="inv-info"><div class="px-name">${warn ? "⚠️ " : ""}${escapeHtml(m.row.name)}</div><div class="px-meta">צפוי: ${m.row.expected == null ? "-" : fmt(m.row.expected)} ${escapeHtml(m.row.unit)}</div></div><input type="text" inputmode="decimal" class="count-input" data-id="${m.row.id}" value="${fmt(m.qty)}"></div>`;
            }).join("")}</div>
            ${unmatched.length ? `<div class="muted" style="margin-top:8px;">לא זוהו: ${unmatched.map((u) => `${escapeHtml(u.name)} (${fmt(u.qty)})`).join(", ")}</div>` : ""}
            <div class="error-msg"></div>
            <div class="modal-actions" style="flex-wrap:wrap;"><button type="button" class="btn btn-secondary" id="cp-cancel">ביטול</button><button type="button" class="btn btn-secondary" id="cp-more">📷 עוד עמוד</button><button type="button" class="btn btn-primary" id="cp-ok" ${list.length ? "" : "disabled"}>✅ העבר לספירה</button></div>`);
        const sync = () => ov.querySelectorAll(".count-input").forEach((i) => { const m = pending.get(+i.dataset.id); const n = parseFloat(String(i.value).replace(",", ".")); if (m && !Number.isNaN(n)) m.qty = n; });
        ov.querySelector("#cp-cancel").onclick = closeModal;
        ov.querySelector("#cp-more").onclick = () => { sync(); pickPage(); };
        ov.querySelector("#cp-ok").onclick = () => {
            sync();
            apply(new Map([...pending.values()].map((m) => [m.row.id, m.qty])));
            closeModal();
        };
    }
    pickPage();
}

// ---------- הקראה בקול ----------
export function openCountVoice(rows, apply) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
        const ov = openModal('<h2>🎤 הקראה בקול</h2><div class="error-msg" style="display:block;">הדפדפן הזה לא תומך בזיהוי דיבור. בטלפון אנדרואיד פתח את האפליקציה ב-Chrome.</div><div class="modal-actions"><button class="btn btn-secondary" id="cv-x">סגור</button></div>');
        ov.querySelector("#cv-x").onclick = closeModal;
        return;
    }
    const entries = []; // { text, name, qty, row }
    let listening = false;
    let rec = null;
    let mute = false; // בזמן הקראה בחזרה לא מקשיבים, כדי שלא נשמע את עצמנו
    let note = "";
    let interim = "";
    const ov = openModal(`
        <h2>🎤 הקראה בקול</h2>
        <div class="muted" style="margin-bottom:6px;">לחץ על המיקרופון ואמור שם מוצר וכמות, למשל: "עגבניות ארבע וחצי". אפשר ברצף, כל מוצר במשפט נפרד. הידיים נשארות פנויות.</div>
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;"><button type="button" class="btn btn-primary" id="cv-mic" style="flex:1;font-size:18px;">🎤 התחל להקשיב</button></div>
        <label style="display:flex;gap:6px;align-items:center;margin-bottom:8px;font-size:14px;"><input type="checkbox" id="cv-tts" checked> להקריא בחזרה מה שהבנתי</label>
        <div id="cv-live" class="muted" style="min-height:22px;"></div>
        <div id="cv-note" class="error-msg"></div>
        <div id="cv-list" style="max-height:38vh;overflow:auto;"></div>
        <div class="modal-actions"><button type="button" class="btn btn-secondary" id="cv-cancel">ביטול</button><button type="button" class="btn btn-primary" id="cv-ok">✅ העבר לספירה</button></div>`,
        { onClose: () => { listening = false; try { rec && rec.abort(); } catch (e) { /* ignore */ } try { speechSynthesis.cancel(); } catch (e) { /* ignore */ } } });
    const $ = (s) => ov.querySelector(s);

    function drawLive() { $("#cv-live").textContent = interim ? `שומע: ${interim}` : ""; const n = $("#cv-note"); n.textContent = note; n.style.display = note ? "block" : "none"; }
    function drawList() {
        $("#cv-list").innerHTML = entries.length ? entries.map((e, i) => `<div class="inv-item" data-i="${i}">
            <div class="inv-info">${e.row ? `<div class="px-name">${escapeHtml(e.row.name)}</div>` : `<select class="cv-pick"><option value="">? ${escapeHtml(e.name || "לא זוהה")} - בחר מוצר</option>${rows.map((r) => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join("")}</select>`}
                <div class="px-meta">${e.row ? `צפוי: ${e.row.expected == null ? "-" : fmt(e.row.expected)} ${escapeHtml(e.row.unit)}` : "לא זיהיתי את המוצר"} <a href="#" class="cv-del" style="margin-inline-start:8px;">✕ מחק</a></div></div>
            <input type="text" inputmode="decimal" class="count-input cv-qty" value="${fmt(e.qty)}"></div>`).join("") : '<div class="muted">עוד לא נקלט כלום.</div>';
        $("#cv-list").querySelectorAll(".inv-item").forEach((el) => {
            const e = entries[+el.dataset.i];
            el.querySelector(".cv-qty").oninput = (ev) => { const n = parseFloat(String(ev.target.value).replace(",", ".")); if (!Number.isNaN(n)) e.qty = n; };
            el.querySelector(".cv-del").onclick = (ev) => { ev.preventDefault(); entries.splice(+el.dataset.i, 1); drawList(); };
            const pick = el.querySelector(".cv-pick");
            if (pick) pick.onchange = () => { e.row = rows.find((r) => String(r.id) === pick.value) || null; drawList(); };
        });
    }
    function speak(text) {
        if (!$("#cv-tts").checked || !("speechSynthesis" in window)) return;
        try {
            speechSynthesis.cancel();
            const u = new SpeechSynthesisUtterance(text);
            u.lang = "he-IL";
            mute = true;
            u.onend = u.onerror = () => setTimeout(() => { mute = false; }, 400);
            speechSynthesis.speak(u);
        } catch (e) { mute = false; }
    }
    function handle(text) {
        const p = parseSpoken(text, rows);
        if (p.qty == null) { note = `לא הבנתי כמות: "${p.text}". אמור שם מוצר ואז מספר.`; drawLive(); return; }
        note = "";
        let qty = p.qty;
        if (p.grams && p.row && p.row.unit === "יח'") qty = p.qty * 1000; // "גרם" ליחידות אינו הגיוני: משאירים כפי שנאמר
        entries.unshift({ text: p.text, name: p.name, qty, row: p.row });
        drawList(); drawLive();
        speak(p.row ? `${p.row.name}, ${spokenQty(qty)}` : `לא זיהיתי את ${p.name}`);
    }
    function start() {
        rec = new SR();
        rec.lang = "he-IL"; rec.continuous = true; rec.interimResults = true;
        rec.onresult = (e) => {
            if (mute) return;
            interim = "";
            for (let i = e.resultIndex; i < e.results.length; i++) {
                const t = e.results[i][0].transcript;
                if (e.results[i].isFinal) handle(t); else interim += t;
            }
            drawLive();
        };
        rec.onerror = (e) => {
            if (e.error === "not-allowed" || e.error === "service-not-allowed") { listening = false; note = "אין הרשאה למיקרופון. אפשר אותה בהגדרות האתר ב-Chrome."; }
            else if (e.error === "network") { listening = false; note = "זיהוי הדיבור צריך חיבור לאינטרנט."; }
            else if (e.error === "audio-capture") { listening = false; note = "לא נמצא מיקרופון."; }
            setMic(); drawLive();
        };
        rec.onend = () => { interim = ""; drawLive(); if (listening) setTimeout(() => { if (listening) { try { start(); } catch (e) { listening = false; setMic(); } } }, 250); };
        rec.start();
    }
    function setMic() { const b = $("#cv-mic"); b.textContent = listening ? "⏹ עצור" : "🎤 התחל להקשיב"; b.className = `btn ${listening ? "btn-accent" : "btn-primary"}`; }
    $("#cv-mic").onclick = () => {
        if (listening) { listening = false; try { rec.stop(); } catch (e) { /* ignore */ } setMic(); return; }
        note = ""; listening = true; setMic(); drawLive();
        try { start(); } catch (e) { listening = false; setMic(); note = "לא הצלחתי להפעיל את המיקרופון."; drawLive(); }
    };
    $("#cv-cancel").onclick = closeModal;
    $("#cv-ok").onclick = () => {
        const out = new Map();
        for (const e of [...entries].reverse()) if (e.row) out.set(e.row.id, e.qty); // האחרון שנאמר גובר
        if (!out.size) { note = "אין עדיין מוצר מזוהה להעברה."; drawLive(); return; }
        apply(out);
        closeModal();
    };
    drawList(); drawLive();
}

