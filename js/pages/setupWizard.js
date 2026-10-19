// אשף הפעלה ראשוני. סדר: שפה, סוכן (מפתח Gemini), Google (ענן), תפקיד (מנהל מטבח / טבח / יצרן + קוד), מטבע, סיום וסיור.
// כל הטקסטים נשלפים מ-i18n (עברית, אנגלית, גרמנית). כל שלב ניתן לדילוג ואפשר לשנות הכול אחר כך בהגדרות.
import { getSetting, setSetting } from "../repo/settingsRepo.js";
import { COUNTRIES, CURRENCIES, countryByKey, saveLocale } from "../locale.js";
import { escapeHtml, confirmDialog } from "../ui.js";
import { isCloudAvailable, getCloudStatus } from "../cloud/cloudGlue.js";
import { runConnectFlow, fmtWhen } from "../cloud/cloudUi.js";
import { t, setLang, langDir, LANGS } from "../i18n.js";
import { hasPin, setPin, enterStaffMode, markSettingsUnlocked } from "../staff.js";
import { openTour } from "./tour.js";

const KEY_URL = "https://aistudio.google.com/apikey";

// איור סכמטי: חלון דפדפן עם כפתור מודגש במקום שבו ללחוץ. הטקסט על הכפתור כמו שמופיע באתר של Google (באנגלית).
function shot(address, lines, button, note) {
    const rows = lines.map((w, i) => `<rect x="16" y="${44 + i * 16}" width="${w}" height="7" rx="3" fill="#cfd4da"/>`).join("");
    const by = 44 + lines.length * 16 + 8;
    return `<svg viewBox="0 0 300 ${by + 56}" xmlns="http://www.w3.org/2000/svg" dir="ltr" style="width:100%;max-width:340px;display:block;margin:8px auto;border:1px solid var(--border);border-radius:10px;background:#fff;" role="img" aria-label="${escapeHtml(note)}">
        <rect width="300" height="26" fill="#eceff3"/><circle cx="12" cy="13" r="4" fill="#e06c75"/><circle cx="26" cy="13" r="4" fill="#e5c07b"/><circle cx="40" cy="13" r="4" fill="#98c379"/>
        <rect x="56" y="6" width="228" height="14" rx="7" fill="#fff" stroke="#d3d8de"/><text x="170" y="16.5" font-size="8" text-anchor="middle" fill="#555" font-family="Arial">${address}</text>
        ${rows}
        <rect x="16" y="${by}" width="150" height="30" rx="15" fill="#1a73e8"/>
        <text x="91" y="${by + 19}" font-size="11" font-weight="700" text-anchor="middle" fill="#fff" font-family="Arial">${button}</text>
        <rect x="12" y="${by - 4}" width="158" height="38" rx="19" fill="none" stroke="#e8710a" stroke-width="3" stroke-dasharray="5 3"/>
    </svg>`;
}

// שלבי ההדרכה למפתח: מספר, איור, והאם יש כפתור שפותח את האתר
const KEY_STEPS = [
    { n: 1, img: () => shot("aistudio.google.com", [200, 150, 180], "Sign in", t("a.img.signin")), link: true },
    { n: 2, img: () => shot("aistudio.google.com", [200, 170, 120], "Continue with Google", t("a.img.google")) },
    { n: 3, img: () => shot("aistudio.google.com/apikey", [160, 190, 130], "Get API key", t("a.img.getkey")) },
    { n: 4, img: () => shot("aistudio.google.com/apikey", [130, 200, 90], "Create API key", t("a.img.createkey")) },
];

function css() {
    if (document.getElementById("wiz-css")) return;
    const st = document.createElement("style");
    st.id = "wiz-css";
    st.textContent = `.wiz{position:fixed;inset:0;z-index:40;background:var(--bg);color:var(--text);display:flex;flex-direction:column;overflow:auto}
    .wiz-top{padding:14px 16px 6px;display:flex;justify-content:space-between;align-items:center;font-size:13px;color:var(--text-2)}
    .wiz-dots{display:flex;gap:6px}.wiz-dots i{width:8px;height:8px;border-radius:50%;background:var(--border)}.wiz-dots i.on{background:var(--brand)}
    .wiz-body{flex:1;padding:8px 18px 20px;max-width:520px;width:100%;margin:0 auto;text-align:start}
    .wiz h1{font-size:22px;margin:8px 0}.wiz p{line-height:1.6}
    .wiz-foot{padding:12px 18px 18px;max-width:520px;width:100%;margin:0 auto;display:flex;gap:10px}
    .wiz-foot .btn{flex:1}.wiz-opt{display:block;width:100%;text-align:start;background:var(--surface);border:2px solid var(--border);border-radius:var(--radius);padding:12px 14px;margin:8px 0;font-family:inherit;font-size:15px;color:var(--text);cursor:pointer}
    .wiz-opt.on{border-color:var(--brand);background:var(--brand-soft)}.wiz-opt small{display:block;color:var(--text-2);margin-top:3px}
    .wiz-ok{color:var(--ok);font-weight:700}.wiz-bad{color:var(--danger);font-weight:700}`;
    document.head.appendChild(st);
}

// בודק שהמפתח עובד בלי לצרוך מכסה: רשימת המודלים. מחזיר { ok, code, msg } (msg בשפה הנוכחית)
export async function testGeminiKey(key) {
    key = (key || "").trim();
    const out = (ok, code, vars) => ({ ok, code, msg: t(`a.res.${code}`, vars) });
    if (!key) return out(false, "empty");
    if (!/^AIza[0-9A-Za-z_-]{20,}$/.test(key)) return out(false, "format");
    try {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=1&key=${encodeURIComponent(key)}`);
        if (r.ok) return out(true, "ok");
        if (r.status === 400 || r.status === 403) return out(false, "rejected");
        if (r.status === 429) return out(true, "busy");
        return out(false, "error", { code: r.status });
    } catch (e) {
        return out(false, "offline");
    }
}

// opts.onDone נקרא בסיום. האשף לא נסגר בלחיצה בחוץ, ואפשר לדלג על כל שלב.
export async function openSetupWizard({ onDone, startStep = 0 } = {}) {
    css();
    const state = {
        step: startStep, keyStep: 0, sub: "choose",
        lang: (await getSetting("language")) || "he",
        key: (await getSetting("gemini_api_key")) || "",
        role: (await getSetting("role")) || "",
        country: (await getSetting("country")) || "IL",
        currency: (await getSetting("currency")) || "ILS",
        units: (await getSetting("units")) || "metric",
        keyResult: null, keySaved: false, pinSet: await hasPin(), recovery: "", pinErr: "",
        cloudAvailable: await isCloudAvailable(),
    };
    const root = document.createElement("div");
    root.className = "wiz";
    document.body.appendChild(root);
    setLang(state.lang);

    const STEP_KEYS = ["w.s.lang", "w.s.agent", "w.s.google", "w.s.role", "w.s.currency", "w.s.done"];
    const saveKey = async () => { if (state.key.trim()) { await setSetting("gemini_api_key", state.key.trim()); state.keySaved = true; } };

    const finish = async () => {
        await setSetting("setup_done", true);
        await setSetting("role", state.role || "manager");
        root.remove();
        if (onDone) onDone(state);
        if (state.role === "cook") enterStaffMode(); // טבח: מעבר למצב נעול (טעינה מחדש)
    };

    const draw = () => {
        const s = state.step;
        root.dir = langDir(state.lang);
        let body = "", nextLabel = t("common.next"), back = s > 0, skip = false, showNext = true;

        if (s === 0) {
            body = `<h1>${t("w.lang.title")}</h1><p class="muted">${t("w.lang.sub")}</p>
                ${LANGS.map((l) => `<button type="button" class="wiz-opt ${state.lang === l.key ? "on" : ""}" data-lang="${l.key}"><b>${escapeHtml(l.name)}</b>${l.partial ? `<small>${t("w.lang.partial")}</small>` : ""}</button>`).join("")}
                ${state.lang !== "he" ? `<div class="hint-warn">${t("w.lang.note")}</div>` : ""}`;
            back = false;
        } else if (s === 1) {
            const inGuide = state.keyStep < KEY_STEPS.length;
            if (inGuide) {
                const ks = KEY_STEPS[state.keyStep];
                body = `<h1>${t("a.title")}</h1><p class="muted">${t("a.intro", { n: state.keyStep + 1, total: KEY_STEPS.length + 1 })}</p>
                    <h3>${t(`a.s${ks.n}.title`)}</h3><p>${t(`a.s${ks.n}.text`)}</p>${ks.img()}
                    ${ks.link ? `<a class="btn btn-accent btn-big btn-block" href="${KEY_URL}" target="_blank" rel="noopener" style="text-align:center;text-decoration:none;display:block;">${t("a.link")}</a>` : ""}`;
                skip = true;
            } else {
                body = `<h1>${t("a.paste.title")}</h1><p class="muted">${t("a.paste.step", { n: KEY_STEPS.length + 1, total: KEY_STEPS.length + 1 })}</p>
                    <p>${t("a.paste.text")}</p>
                    <div class="field"><input type="text" id="w-key" value="${escapeHtml(state.key)}" placeholder="AIza..." autocomplete="off" autocapitalize="off" spellcheck="false" dir="ltr"></div>
                    <button type="button" class="btn btn-secondary btn-block" id="w-test">${t("a.paste.test")}</button>
                    <div id="w-result" style="margin:10px 0;min-height:22px;">${state.keyResult ? `<span class="${state.keyResult.ok ? "wiz-ok" : "wiz-bad"}">${escapeHtml(state.keyResult.msg)}</span>` : ""}</div>
                    <div class="hint-warn">${t("a.billing")}</div>`;
                skip = true;
            }
            back = true;
        } else if (s === 2) {
            const cs = getCloudStatus();
            if (state.cloudAvailable === false) {
                body = `<h1>${t("g.title")}</h1><p>${t("g.unavailable")}</p><div class="hint-warn">${t("g.manualBackup")}</div>`;
            } else if (cs.enabled) {
                body = `<h1>${t("g.title")}</h1><p class="wiz-ok">${t("g.connected")}</p><p>${t("g.connectedText", { when: escapeHtml(fmtWhen(cs.lastBackup)) })}</p>`;
            } else {
                body = `<h1>${t("g.title")}</h1><p>${t("g.text")}</p><p class="muted">${t("g.privacy")}</p>
                    <button type="button" class="btn btn-primary btn-big btn-block" id="w-cloud">${t("g.btn")}</button>`;
                skip = true;
            }
        } else if (s === 3) {
            if (state.sub === "choose") {
                const opts = ["manager", "cook", "producer"];
                body = `<h1>${t("r.title")}</h1><p class="muted">${t("r.sub")}</p>
                    ${opts.map((k) => `<button type="button" class="wiz-opt ${state.role === k ? "on" : ""}" data-role="${k}"><b>${t(`r.${k}.name`)}</b><small>${t(`r.${k}.desc`)}</small></button>`).join("")}
                    ${state.role === "cook" && !state.pinSet ? `<div class="hint-warn">${t("r.cook.needPin")}</div>` : ""}`;
                showNext = !!state.role;
            } else if (state.sub === "pin") {
                const required = state.role === "cook";
                body = `<h1>${t("p.title")}</h1><p>${required ? t("p.textRequired") : t("p.textOptional")}</p>
                    <div class="field"><label>${t("p.new")}</label><input type="password" inputmode="numeric" autocomplete="off" id="w-pin1" maxlength="8"></div>
                    <div class="field"><label>${t("p.again")}</label><input type="password" inputmode="numeric" autocomplete="off" id="w-pin2" maxlength="8"></div>
                    <div class="error-msg" style="display:${state.pinErr ? "block" : "none"};">${escapeHtml(state.pinErr)}</div>`;
                skip = !required;
            } else {
                body = `<h1>${t("p.rec.title")}</h1><div class="card" style="text-align:center;"><div class="stat-big" style="letter-spacing:3px;" dir="ltr">${escapeHtml(state.recovery)}</div></div>
                    <div class="hint-warn">${t("p.rec.text")}</div>`;
                nextLabel = t("p.rec.done");
                back = false;
            }
        } else if (s === 4) {
            const c = countryByKey(state.country);
            const list = t(`c.al.${c.allergens}`);
            body = `<h1>${t("c.title")}</h1><p class="muted">${t("c.sub")}</p>
                <div class="field"><label>${t("c.country")}</label><select id="w-country">${COUNTRIES.map((x) => `<option value="${x.key}" ${x.key === state.country ? "selected" : ""}>${t(`country.${x.key}`)}</option>`).join("")}</select></div>
                <div class="field"><label>${t("c.currency")}</label><select id="w-cur">${Object.keys(CURRENCIES).map((k) => `<option value="${k}" ${k === state.currency ? "selected" : ""}>${t(`cur.${k}`)}</option>`).join("")}</select></div>
                <div class="field"><label>${t("c.units")}</label><select id="w-units"><option value="metric" ${state.units === "metric" ? "selected" : ""}>${t("c.metric")}</option><option value="imperial" ${state.units === "imperial" ? "selected" : ""}>${t("c.imperial")}</option></select></div>
                <div class="hint">${state.units === "imperial" ? t("c.hintImperial") : ""}${t("c.hintAllergens", { list })}</div>`;
        } else {
            body = `<h1>${t("f.title")}</h1><p>${state.keySaved ? t("f.keySaved") : t("f.keyMissing")}</p><p>${t("f.text")}</p>`;
            nextLabel = t("f.tour");
            back = false;
            skip = true;
        }

        const skipLabel = s === 5 ? t("f.skip") : t("common.skip");
        root.innerHTML = `<div class="wiz-top"><span style="display:flex;align-items:center;"><button type="button" class="wiz-x" id="w-exit" aria-label="${t("w.exit.label")}">✕</button>${t(STEP_KEYS[s])}</span><span class="wiz-dots">${STEP_KEYS.map((_, i) => `<i class="${i <= s ? "on" : ""}"></i>`).join("")}</span></div>
            <div class="wiz-body">${body}</div>
            <div class="wiz-foot">${back ? `<button type="button" class="btn btn-secondary" id="w-back">${t("common.back")}</button>` : ""}${skip ? `<button type="button" class="btn btn-secondary" id="w-skip">${skipLabel}</button>` : ""}${showNext ? `<button type="button" class="btn btn-primary" id="w-next">${nextLabel}</button>` : ""}</div>`;

        const q = (sel) => root.querySelector(sel);
        // יציאה בכל שלב: האשף נסגר ולא נפתח שוב לבד (אפשר להפעיל מההגדרות)
        q("#w-exit").onclick = async () => {
            if (!(await confirmDialog(escapeHtml(t("w.exit.text"))))) return;
            await setSetting("setup_done", true);
            root.remove();
            window.dispatchEvent(new CustomEvent("kcp-status-refresh"));
            if (onDone) onDone(state);
        };
        const go = (n) => { state.step = n; state.sub = "choose"; draw(); };

        const goNext = async () => {
            if (s === 1 && state.keyStep < KEY_STEPS.length) { state.keyStep += 1; draw(); return; }
            if (s === 1) await saveKey();
            if (s === 3) {
                if (state.sub === "choose") {
                    if (state.pinSet) { go(4); return; } // כבר יש קוד: אין מה להגדיר
                    state.sub = "pin"; state.pinErr = ""; draw(); return;
                }
                if (state.sub === "pin") {
                    const p1 = q("#w-pin1").value, p2 = q("#w-pin2").value;
                    if (!/^\d{4,8}$/.test(p1)) { state.pinErr = t("p.err.len"); draw(); return; }
                    if (p1 !== p2) { state.pinErr = t("p.err.match"); draw(); return; }
                    state.recovery = await setPin(p1);
                    markSettingsUnlocked();
                    state.pinSet = true; state.sub = "recovery"; draw(); return;
                }
                go(4); return; // אחרי קוד השחזור
            }
            if (s === 4) await saveLocale({ country: state.country, currency: state.currency, units: state.units, language: state.lang });
            if (s === 5) { openTour({ role: state.role || "manager", onDone: finish }); return; }
            go(s + 1);
        };
        const nextBtn = q("#w-next");
        if (nextBtn) nextBtn.onclick = goNext;
        const b = q("#w-back");
        if (b) b.onclick = () => {
            if (s === 1 && state.keyStep > 0) { state.keyStep -= 1; draw(); return; }
            if (s === 3 && state.sub !== "choose") { state.sub = "choose"; draw(); return; }
            const prev = s - 1;
            if (prev === 1) state.keyStep = KEY_STEPS.length;
            go(prev);
        };
        const sk = q("#w-skip");
        if (sk) sk.onclick = async () => {
            if (s === 1) state.keyStep = 0;
            if (s === 3 && state.sub === "pin") { go(4); return; } // מנהל/יצרן דילג על הקוד
            if (s === 5) { await finish(); return; }
            go(s + 1);
        };

        root.querySelectorAll("[data-lang]").forEach((o) => { o.onclick = async () => { state.lang = o.dataset.lang; setLang(state.lang); await setSetting("language", state.lang); draw(); }; });
        root.querySelectorAll("[data-role]").forEach((o) => { o.onclick = () => { state.role = o.dataset.role; draw(); }; });
        const cloudBtn = q("#w-cloud");
        if (cloudBtn) cloudBtn.onclick = async () => {
            const res = await runConnectFlow();
            if (res === "restored") { await setSetting("setup_done", true); root.remove(); if (onDone) onDone(state); return; } // הנתונים וההגדרות חזרו מהענן
            draw();
        };
        if (s === 1 && state.keyStep >= KEY_STEPS.length) {
            const inp = q("#w-key");
            inp.oninput = () => { state.key = inp.value; state.keyResult = null; q("#w-result").textContent = ""; };
            q("#w-test").onclick = async () => {
                q("#w-result").textContent = t("a.paste.testing");
                state.key = inp.value;
                state.keyResult = await testGeminiKey(state.key);
                if (state.keyResult.ok) await saveKey();
                q("#w-result").innerHTML = `<span class="${state.keyResult.ok ? "wiz-ok" : "wiz-bad"}">${escapeHtml(state.keyResult.msg)}</span>`;
            };
        }
        if (s === 4) {
            const country = q("#w-country"), curSel = q("#w-cur"), units = q("#w-units");
            country.onchange = () => { const c = countryByKey(country.value); state.country = c.key; state.currency = c.currency; state.units = c.units; draw(); };
            curSel.onchange = () => { state.currency = curSel.value; };
            units.onchange = () => { state.units = units.value; draw(); };
        }
    };
    draw();
}
