// ערכת עיצוב: נשמרת בהגדרות, ומשתקפת גם ב-localStorage כדי שתיטען לפני הציור הראשון.
import { getSetting, setSetting } from "./repo/settingsRepo.js";

const THEME_COLORS = { "": "#a8541b", warm: "#b5532a", clean: "#ffffff", dark: "#14171c" };

export function setThemeNow(key) {
    if (key) document.documentElement.setAttribute("data-theme", key);
    else document.documentElement.removeAttribute("data-theme");
    try { localStorage.setItem("kcp_theme", key || ""); } catch (e) { /* בלי localStorage - ממשיכים */ }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", THEME_COLORS[key] || THEME_COLORS[""]);
}

export async function applyTheme() {
    setThemeNow((await getSetting("theme")) || "");
}

export async function chooseTheme(key) {
    await setSetting("theme", key);
    setThemeNow(key);
}
