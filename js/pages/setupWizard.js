// אשף הפעלה: מסך אחד קל, רק שפה ומטבע (מדינה). שאר ההגדרות (ענן, מפתח אישי, תפקיד, קוד) נמצאות בהגדרות, ואפשר לשנות הכול שם.
// הטקסטים נשלפים מ-i18n (עברית, אנגלית, גרמנית).
import { getSetting, setSetting } from "../repo/settingsRepo.js";
import { COUNTRIES, CURRENCIES, countryByKey, saveLocale } from "../locale.js";
import { escapeHtml } from "../ui.js";
import { t, setLang, langDir, LANGS } from "../i18n.js";

function css() {
    if (document.getElementById("wiz-css")) return;
    const st = document.createElement("style");
    st.id = "wiz-css";
    st.textContent = `.wiz{position:fixed;inset:0;z-index:40;background:var(--bg);color:var(--text);display:flex;flex-direction:column;overflow:auto}
    .wiz-top{padding:14px 16px 6px;display:flex;justify-content:space-between;align-items:center;font-size:13px;color:var(--text-2)}
    .wiz-x{border:none;background:none;color:var(--text-2);font-size:20px;cursor:pointer;padding:4px 8px}
    .wiz-body{flex:1;padding:8px 18px 20px;max-width:520px;width:100%;margin:0 auto;text-align:start}
    .wiz h1{font-size:24px;margin:14px 0 6px}.wiz p{line-height:1.6;margin:0 0 10px}
    .wiz-foot{padding:12px 18px 22px;max-width:520px;width:100%;margin:0 auto;display:flex;gap:10px}
    .wiz-foot .btn{flex:1}.wiz-opt{display:block;width:100%;text-align:start;background:var(--surface);border:2px solid var(--border);border-radius:var(--radius);padding:12px 14px;margin:8px 0;font-family:inherit;font-size:16px;color:var(--text);cursor:pointer}
    .wiz-opt.on{border-color:var(--brand);background:var(--brand-soft)}`;
    document.head.appendChild(st);
}

// opts.onDone נקרא בסיום (או ביציאה). startStep נשמר לתאימות לאחור ואינו בשימוש.
export async function openSetupWizard({ onDone } = {}) {
    css();
    const startLang = (await getSetting("language")) || "he";
    const state = {
        lang: startLang,
        country: (await getSetting("country")) || "IL",
        currency: (await getSetting("currency")) || "ILS",
        units: (await getSetting("units")) || "metric",
    };
    const root = document.createElement("div");
    root.className = "wiz";
    document.body.appendChild(root);
    setLang(state.lang);

    const close = async (save) => {
        if (save) await saveLocale({ country: state.country, currency: state.currency, units: state.units, language: state.lang });
        await setSetting("setup_done", true);
        if (!(await getSetting("role"))) await setSetting("role", "manager");
        root.remove();
        window.dispatchEvent(new CustomEvent("kcp-status-refresh"));
        if (state.lang !== startLang) { location.reload(); return; } // כדי שכל הממשק יעבור לשפה החדשה
        if (onDone) onDone(state);
    };

    const draw = () => {
        root.dir = langDir(state.lang);
        root.innerHTML = `<div class="wiz-top"><span></span><button type="button" class="wiz-x" id="w-exit" aria-label="${t("w.exit.label")}">✕</button></div>
            <div class="wiz-body">
                <h1>${t("w1.title")}</h1><p class="muted">${t("w1.sub")}</p>
                ${LANGS.map((l) => `<button type="button" class="wiz-opt ${state.lang === l.key ? "on" : ""}" data-lang="${l.key}"><b>${escapeHtml(l.name)}</b></button>`).join("")}
                <div class="field" style="margin-top:14px;"><label>${t("c.country")}</label><select id="w-country">${COUNTRIES.map((x) => `<option value="${x.key}" ${x.key === state.country ? "selected" : ""}>${t(`country.${x.key}`)}</option>`).join("")}</select></div>
                <div class="field"><label>${t("c.currency")}</label><select id="w-cur">${Object.keys(CURRENCIES).map((k) => `<option value="${k}" ${k === state.currency ? "selected" : ""}>${t(`cur.${k}`)}</option>`).join("")}</select></div>
            </div>
            <div class="wiz-foot"><button type="button" class="btn btn-primary" id="w-go">${t("w1.go")}</button></div>`;
        const q = (s) => root.querySelector(s);
        q("#w-exit").onclick = () => close(false);
        q("#w-go").onclick = () => close(true);
        root.querySelectorAll("[data-lang]").forEach((o) => { o.onclick = () => { state.lang = o.dataset.lang; setLang(state.lang); draw(); }; });
        q("#w-country").onchange = (e) => { const c = countryByKey(e.target.value); state.country = c.key; state.currency = c.currency; state.units = c.units; draw(); };
        q("#w-cur").onchange = (e) => { state.currency = e.target.value; };
    };
    draw();
}
