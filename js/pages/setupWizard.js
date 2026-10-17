// אשף הפעלה ראשוני: מסך אחרי מסך, כל שלב ניתן לדילוג והכול ניתן לשינוי אחר כך בהגדרות.
// שלב 1 = מפתח Gemini (עם הדרכה ואיורים), שלב 2 = חשבון ענן (עוד לא קיים - מוצג כ"בקרוב"), ואז מדינה/מטבע/יחידות וסוג משתמש.
import { getSetting, setSetting } from "../repo/settingsRepo.js";
import { COUNTRIES, CURRENCIES, LANGUAGES, countryByKey, saveLocale } from "../locale.js";
import { escapeHtml, toast } from "../ui.js";

const KEY_URL = "https://aistudio.google.com/apikey";

// איור סכמטי: חלון דפדפן עם כפתור מודגש במקום שבו ללחוץ. הטקסט על הכפתור כמו שמופיע באתר של Google.
function shot(address, lines, button, note) {
    const rows = lines.map((t, i) => `<rect x="16" y="${44 + i * 16}" width="${t}" height="7" rx="3" fill="#cfd4da"/>`).join("");
    const by = 44 + lines.length * 16 + 8;
    return `<svg viewBox="0 0 300 ${by + 56}" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:340px;display:block;margin:8px auto;border:1px solid var(--border);border-radius:10px;background:#fff;" role="img" aria-label="${escapeHtml(note)}">
        <rect width="300" height="26" fill="#eceff3"/><circle cx="12" cy="13" r="4" fill="#e06c75"/><circle cx="26" cy="13" r="4" fill="#e5c07b"/><circle cx="40" cy="13" r="4" fill="#98c379"/>
        <rect x="56" y="6" width="228" height="14" rx="7" fill="#fff" stroke="#d3d8de"/><text x="170" y="16.5" font-size="8" text-anchor="middle" fill="#555" font-family="Arial">${address}</text>
        ${rows}
        <rect x="16" y="${by}" width="150" height="30" rx="15" fill="#1a73e8"/>
        <text x="91" y="${by + 19}" font-size="11" font-weight="700" text-anchor="middle" fill="#fff" font-family="Arial">${button}</text>
        <rect x="12" y="${by - 4}" width="158" height="38" rx="19" fill="none" stroke="#e8710a" stroke-width="3" stroke-dasharray="5 3"/>
    </svg>`;
}

const KEY_STEPS = [
    { title: "1. פותחים את האתר של Google", text: "לוחצים על הכפתור למטה, ונפתח אתר בשם Google AI Studio בלשונית חדשה. אחרי שתסיים שם, חוזרים לכאן.",
      img: shot("aistudio.google.com", [200, 150, 180], "Sign in", "מסך התחברות"), link: true },
    { title: "2. מתחברים עם חשבון Google", text: "מתחברים עם חשבון Gmail שלך (אפשר גם חשבון חדש). אם מבקשים לאשר תנאים, מאשרים.",
      img: shot("aistudio.google.com", [200, 170, 120], "Continue with Google", "התחברות עם Google") },
    { title: "3. לוחצים על Get API key", text: "בצד האתר או בתפריט יש כפתור בשם <b dir=\"ltr\">Get API key</b> (קבלת מפתח). אם אתה לא רואה אותו, פתח את התפריט (שלושה פסים) למעלה.",
      img: shot("aistudio.google.com/apikey", [160, 190, 130], "Get API key", "כפתור Get API key") },
    { title: "4. יוצרים מפתח ומעתיקים", text: "לוחצים <b dir=\"ltr\">Create API key</b>, ואם מבקשים לבחור פרויקט - בוחרים <b dir=\"ltr\">Create API key in new project</b>. המפתח הוא טקסט ארוך שמתחיל ב-AIza. לוחצים על אייקון ההעתקה.",
      img: shot("aistudio.google.com/apikey", [130, 200, 90], "Create API key", "כפתור Create API key") },
];

function css() {
    if (document.getElementById("wiz-css")) return;
    const st = document.createElement("style");
    st.id = "wiz-css";
    st.textContent = `.wiz{position:fixed;inset:0;z-index:2000;background:var(--bg);color:var(--text);display:flex;flex-direction:column;overflow:auto}
    .wiz-top{padding:14px 16px 6px;display:flex;justify-content:space-between;align-items:center;font-size:13px;color:var(--text-2)}
    .wiz-dots{display:flex;gap:6px}.wiz-dots i{width:8px;height:8px;border-radius:50%;background:var(--border)}.wiz-dots i.on{background:var(--brand)}
    .wiz-body{flex:1;padding:8px 18px 20px;max-width:520px;width:100%;margin:0 auto}
    .wiz h1{font-size:22px;margin:8px 0}.wiz p{line-height:1.6}
    .wiz-foot{padding:12px 18px 18px;max-width:520px;width:100%;margin:0 auto;display:flex;gap:10px}
    .wiz-foot .btn{flex:1}.wiz-opt{display:block;width:100%;text-align:right;background:var(--surface);border:2px solid var(--border);border-radius:var(--radius);padding:12px 14px;margin:8px 0;font-family:inherit;font-size:15px;color:var(--text);cursor:pointer}
    .wiz-opt.on{border-color:var(--brand);background:var(--brand-soft)}.wiz-opt small{display:block;color:var(--text-2);margin-top:3px}
    .wiz-ok{color:var(--ok);font-weight:700}.wiz-bad{color:var(--danger);font-weight:700}`;
    document.head.appendChild(st);
}

// בודק שהמפתח עובד בלי לצרוך מכסה: רשימת המודלים. מחזיר { ok, msg }
export async function testGeminiKey(key) {
    key = (key || "").trim();
    if (!key) return { ok: false, msg: "לא הוזן מפתח." };
    if (!/^AIza[0-9A-Za-z_-]{20,}$/.test(key)) return { ok: false, msg: "זה לא נראה כמו מפתח של Google (הוא מתחיל ב-AIza ואין בו רווחים). בדוק שהעתקת את כולו." };
    try {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=1&key=${encodeURIComponent(key)}`);
        if (r.ok) return { ok: true, msg: "המפתח עובד ✓" };
        if (r.status === 400 || r.status === 403) return { ok: false, msg: "Google דחתה את המפתח. ודא שהעתקת אותו נכון, או צור מפתח חדש." };
        if (r.status === 429) return { ok: true, msg: "המפתח תקין (Google עמוסה כרגע, זה לא משפיע)." };
        return { ok: false, msg: `Google החזירה שגיאה (${r.status}). נסה שוב בעוד רגע.` };
    } catch (e) {
        return { ok: false, msg: "אין חיבור לאינטרנט כרגע. אפשר לדלג ולהזין את המפתח מאוחר יותר בהגדרות." };
    }
}

// opts.onDone נקרא בסיום. האשף לא נסגר בלחיצה בחוץ, ואפשר לדלג על כל שלב.
export async function openSetupWizard({ onDone } = {}) {
    css();
    const state = {
        step: 0, keyStep: 0,
        key: (await getSetting("gemini_api_key")) || "",
        country: (await getSetting("country")) || "IL",
        currency: (await getSetting("currency")) || "ILS",
        units: (await getSetting("units")) || "metric",
        language: (await getSetting("language")) || "he",
        userType: (await getSetting("user_type")) || "",
        keyResult: null, keySaved: false,
    };
    const root = document.createElement("div");
    root.className = "wiz";
    document.body.appendChild(root);
    const STEPS = ["ברוך הבא", "מפתח Gemini", "חשבון ענן", "מדינה ושפה", "סוג העסק", "סיום"];

    const finish = async () => {
        await setSetting("setup_done", true);
        root.remove();
        if (onDone) onDone(state);
    };
    const saveKey = async () => { if (state.key.trim()) { await setSetting("gemini_api_key", state.key.trim()); state.keySaved = true; } };

    const draw = () => {
        const s = state.step;
        let body = "", next = "המשך", back = s > 0, skip = false;
        if (s === 0) {
            body = `<h1>ברוך הבא ל-KitchenCostPro 👋</h1><p>כמה שאלות קצרות להתאים את האפליקציה אליך. אפשר לדלג על כל שלב, ולשנות הכול אחר כך בהגדרות.</p>
                <p class="muted">הנתונים שלך נשמרים בטלפון הזה. כדי לסרוק חשבוניות ומתכונים מתמונה צריך מפתח חינמי מ-Google, וניקח אותו יחד בשלב הבא.</p>`;
            next = "בואו נתחיל";
        } else if (s === 1) {
            const ks = KEY_STEPS[state.keyStep];
            const inGuide = state.keyStep < KEY_STEPS.length;
            if (inGuide) {
                body = `<h1>מפתח Gemini</h1><p class="muted">המפתח מאפשר לאפליקציה לקרוא חשבוניות ומתכונים מתמונה. זה לוקח 2 דקות. (צעד ${state.keyStep + 1} מתוך ${KEY_STEPS.length + 1})</p>
                    <h3>${ks.title}</h3><p>${ks.text}</p>${ks.img}
                    ${ks.link ? `<a class="btn btn-accent btn-big btn-block" href="${KEY_URL}" target="_blank" rel="noopener" style="text-align:center;text-decoration:none;display:block;">פתח את Google AI Studio ↗</a>` : ""}`;
                next = "הבא";
                skip = true;
            } else {
                body = `<h1>מדביקים את המפתח</h1><p class="muted">צעד ${KEY_STEPS.length + 1} מתוך ${KEY_STEPS.length + 1}</p>
                    <p>מדביקים את המפתח שהעתקת, ולוחצים "בדוק".</p>
                    <div class="field"><input type="text" id="w-key" value="${escapeHtml(state.key)}" placeholder="AIza..." autocomplete="off" autocapitalize="off" spellcheck="false" dir="ltr"></div>
                    <button type="button" class="btn btn-secondary btn-block" id="w-test">בדוק שהמפתח עובד</button>
                    <div id="w-result" style="margin:10px 0;min-height:22px;">${state.keyResult ? `<span class="${state.keyResult.ok ? "wiz-ok" : "wiz-bad"}">${escapeHtml(state.keyResult.msg)}</span>` : ""}</div>
                    <div class="hint-warn">💡 מומלץ אחר כך להפעיל חיוב בחשבון ה-Google Cloud ולהגדיר התראת תקציב קטנה: בלי חיוב יש הגבלה על מספר הסריקות, והשרת נתקע בקלות. אפשר להוסיף בכל זמן.</div>`;
                next = "המשך";
                skip = true;
            }
            back = true;
        } else if (s === 2) {
            body = `<h1>חשבון ענן ☁️</h1><p>בקרוב: חיבור לחשבון Google שלך ושמירה אוטומטית של הנתונים והתמונות בתיקייה בשם KitchenCostPro בדרייב, וסנכרון בין כמה מכשירים.</p>
                <div class="hint-warn">את השלב הזה עוד לא הפעלנו. בינתיים אפשר לייצא גיבוי ידני מההגדרות. נחבר אותך לענן ברגע שהוא יהיה מוכן.</div>`;
            next = "המשך";
        } else if (s === 3) {
            const c = countryByKey(state.country);
            body = `<h1>מדינה ושפה</h1><p class="muted">קובעת מטבע, יחידות וסוג האלרגנים שיוצגו במתכונים.</p>
                <div class="field"><label>שפה</label><select id="w-lang">${LANGUAGES.map((l) => `<option value="${l.key}" ${l.key === state.language ? "selected" : ""} ${l.ready ? "" : "disabled"}>${l.label}${l.ready ? "" : " (בקרוב)"}</option>`).join("")}</select></div>
                <div class="field"><label>מדינה</label><select id="w-country">${COUNTRIES.map((x) => `<option value="${x.key}" ${x.key === state.country ? "selected" : ""}>${x.name}</option>`).join("")}</select></div>
                <div class="field"><label>מטבע</label><select id="w-cur">${Object.entries(CURRENCIES).map(([k, v]) => `<option value="${k}" ${k === state.currency ? "selected" : ""}>${v.label}</option>`).join("")}</select></div>
                <div class="field"><label>יחידות</label><select id="w-units"><option value="metric" ${state.units === "metric" ? "selected" : ""}>גרמים וקילוגרמים</option><option value="imperial" ${state.units === "imperial" ? "selected" : ""}>אונקיות וליברות (בקרוב)</option></select></div>
                <div class="hint">${state.units === "imperial" ? "התצוגה באונקיות וליברות עוד לא מוכנה, בינתיים המסכים יציגו גרמים." : ""}אלרגנים ייקבעו לפי המדינה (${c.allergens === "il" ? "רשימת ישראל" : c.allergens === "us" ? "רשימת ארה\"ב" : "רשימת אירופה"}) ויופיעו רק במתכונים ובמודול היצרן.</div>`;
        } else if (s === 4) {
            const opts = [["new", "מסעדה חדשה", "מתחילים מהמזווה ומוסיפים חשבוניות ומתכונים."],
                ["existing", "מסעדה שכבר עובדת", "נסרוק חשבוניות אחרונות ונעשה ספירת פתיחה אחת."],
                ["producer", "יצרן קטן (מוצרים באריזה)", "בהמשך יופיע מודול יצרן: תוויות, אלרגנים וערכים תזונתיים."]];
            body = `<h1>איזה סוג עסק?</h1><p class="muted">רק כדי להציע לך את הצעד הבא. אפשר לשנות.</p>
                ${opts.map(([k, t, d]) => `<button type="button" class="wiz-opt ${state.userType === k ? "on" : ""}" data-ut="${k}"><b>${t}</b><small>${d}</small></button>`).join("")}`;
            skip = true;
        } else {
            const next1 = state.userType === "existing" ? "הצעד הבא שלך: סרוק חשבונית אחרונה (בבית: \"סרוק חשבונית\"), ואחרי כמה חשבוניות עשה ספירת פתיחה בלשונית \"ספירת מלאי\" במזווה."
                : state.userType === "producer" ? "הצעד הבא שלך: הוסף חומרי גלם למזווה ובנה מתכון. מודול היצרן יופיע בהמשך."
                : "הצעד הבא שלך: הוסף חומרי גלם למזווה, או סרוק חשבונית ראשונה.";
            body = `<h1>מוכן! 🎉</h1><p>${state.keySaved ? "המפתח נשמר." : "לא הוזן מפתח - אפשר להוסיף אותו בהגדרות כשתרצה."}</p><p>${next1}</p>`;
            next = "סיום";
            back = false;
        }
        root.innerHTML = `<div class="wiz-top"><span>${STEPS[s]}</span><span class="wiz-dots">${STEPS.map((_, i) => `<i class="${i <= s ? "on" : ""}"></i>`).join("")}</span></div>
            <div class="wiz-body">${body}</div>
            <div class="wiz-foot">${back ? '<button type="button" class="btn btn-secondary" id="w-back">חזרה</button>' : ""}${skip ? '<button type="button" class="btn btn-secondary" id="w-skip">דלג</button>' : ""}<button type="button" class="btn btn-primary" id="w-next">${next}</button></div>`;

        const q = (sel) => root.querySelector(sel);
        const goNext = async () => {
            if (s === 1 && state.keyStep >= KEY_STEPS.length) await saveKey();
            if (s === 1 && state.keyStep < KEY_STEPS.length) { state.keyStep += 1; draw(); return; }
            if (s === 3) await saveLocale(state);
            if (s === 4 && state.userType) await setSetting("user_type", state.userType);
            if (s === 5) { await finish(); return; }
            state.step += 1;
            draw();
        };
        q("#w-next").onclick = goNext;
        const b = q("#w-back");
        if (b) b.onclick = () => {
            if (s === 1 && state.keyStep > 0) { state.keyStep -= 1; draw(); } else { state.step -= 1; if (state.step === 1) state.keyStep = KEY_STEPS.length; draw(); }
        };
        const sk = q("#w-skip");
        if (sk) sk.onclick = () => { if (s === 1) state.keyStep = 0; state.step = s + 1; draw(); };
        if (s === 1 && state.keyStep >= KEY_STEPS.length) {
            const inp = q("#w-key");
            inp.oninput = () => { state.key = inp.value; state.keyResult = null; q("#w-result").textContent = ""; };
            q("#w-test").onclick = async () => {
                q("#w-result").textContent = "בודק...";
                state.key = inp.value;
                state.keyResult = await testGeminiKey(state.key);
                if (state.keyResult.ok) await saveKey();
                q("#w-result").innerHTML = `<span class="${state.keyResult.ok ? "wiz-ok" : "wiz-bad"}">${escapeHtml(state.keyResult.msg)}</span>`;
            };
        }
        if (s === 3) {
            const country = q("#w-country"), curSel = q("#w-cur"), units = q("#w-units"), lang = q("#w-lang");
            lang.onchange = () => { state.language = lang.value; };
            country.onchange = () => { const c = countryByKey(country.value); state.country = c.key; state.currency = c.currency; state.units = c.units; draw(); };
            curSel.onchange = () => { state.currency = curSel.value; };
            units.onchange = () => { state.units = units.value; draw(); };
        }
        if (s === 4) root.querySelectorAll("[data-ut]").forEach((o) => { o.onclick = () => { state.userType = o.dataset.ut; draw(); }; });
    };
    draw();
}
