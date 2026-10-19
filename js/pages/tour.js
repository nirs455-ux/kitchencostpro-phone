// סיור באפליקציה: כרטיס לכל דף (מה הוא ולמה הוא משמש), לפי תפקיד. הטקסטים ב-i18n (עברית, אנגלית, גרמנית).
import { t, langDir, getLang, setLang } from "../i18n.js";
import { getSetting } from "../repo/settingsRepo.js";

// אילו דפים מוצגים לכל תפקיד (בסדר הצגה)
export const TOUR_PAGES = {
    manager: ["home", "pantry", "recipes", "dishes", "suppliers", "files", "settings"],
    producer: ["home", "pantry", "recipes", "suppliers", "files", "producer", "settings"],
    cook: ["cookRecipes", "cookWaste", "cookCount"],
};

export function tourPagesFor(role) {
    return TOUR_PAGES[role] || TOUR_PAGES.manager;
}

function css() {
    if (document.getElementById("tour-css")) return;
    const st = document.createElement("style");
    st.id = "tour-css";
    st.textContent = `.tour{position:fixed;inset:0;z-index:45;background:var(--bg);color:var(--text);display:flex;flex-direction:column;overflow:auto}
    .tour-top{padding:14px 16px 6px;display:flex;justify-content:space-between;align-items:center;font-size:13px;color:var(--text-2)}
    .tour-card{flex:1;display:flex;flex-direction:column;justify-content:center;max-width:520px;width:100%;margin:0 auto;padding:10px 22px;text-align:start}
    .tour-card h1{font-size:30px;margin:0 0 12px}.tour-card p{font-size:17px;line-height:1.7}
    .tour-dots{display:flex;gap:6px}.tour-dots i{width:8px;height:8px;border-radius:50%;background:var(--border)}.tour-dots i.on{background:var(--brand)}
    .tour-foot{padding:12px 18px 18px;max-width:520px;width:100%;margin:0 auto;display:flex;gap:10px}.tour-foot .btn{flex:1}`;
    document.head.appendChild(st);
}

// role: manager | producer | cook. onDone נקרא בסיום או בדילוג.
export async function openTour({ role = "manager", onDone } = {}) {
    css();
    setLang((await getSetting("language")) || getLang());
    const pages = tourPagesFor(role);
    const root = document.createElement("div");
    root.className = "tour";
    document.body.appendChild(root);
    let i = 0;
    const close = () => { root.remove(); if (onDone) onDone(); };

    const draw = () => {
        const p = pages[i];
        const last = i === pages.length - 1;
        root.dir = langDir();
        root.innerHTML = `<div class="tour-top"><span>${t("tour.title")} · ${t("tour.progress", { n: i + 1, total: pages.length })}</span><span class="tour-dots">${pages.map((_, k) => `<i class="${k <= i ? "on" : ""}"></i>`).join("")}</span></div>
            <div class="tour-card"><h1>${t(`tour.${p}.t`)}</h1><p>${t(`tour.${p}.d`)}</p></div>
            <div class="tour-foot">${i > 0 ? `<button type="button" class="btn btn-secondary" id="t-prev">${t("tour.prev")}</button>` : ""}${last ? "" : `<button type="button" class="btn btn-secondary" id="t-skip">${t("tour.skip")}</button>`}<button type="button" class="btn btn-primary" id="t-next">${last ? t("tour.done") : t("tour.next")}</button></div>`;
        root.querySelector("#t-next").onclick = () => { if (last) close(); else { i += 1; draw(); } };
        const prev = root.querySelector("#t-prev");
        if (prev) prev.onclick = () => { i -= 1; draw(); };
        const skip = root.querySelector("#t-skip");
        if (skip) skip.onclick = close;
    };
    draw();
}
