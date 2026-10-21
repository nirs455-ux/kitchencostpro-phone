// תשתית תרגום: כל טקסט של האשף והסיור נשלף לפי מפתח ושפה. שפות: עברית (מקור), אנגלית, גרמנית.
// שאר האפליקציה עדיין בעברית ותתורגם בהדרגה (ראה "חלקי" ב-LANGS).
import he from "./i18n/he.js";
import en from "./i18n/en.js";
import de from "./i18n/de.js";
import { getSetting } from "./repo/settingsRepo.js";

export const DICT = { he, en, de };
// partial = התרגום עדיין ראשוני בשפה הזאת (מוצג ליד השם באשף). dir = כיוון הכתיבה של שכבות האשף והסיור
export const LANGS = [
    { key: "he", name: "עברית", dir: "rtl", partial: false },
    { key: "en", name: "English", dir: "ltr", partial: false },
    { key: "de", name: "Deutsch", dir: "ltr", partial: true },
];

let current = "he";
export function setLang(l) { current = DICT[l] ? l : "he"; }
export function getLang() { return current; }
export function langDir(l = current) { return (LANGS.find((x) => x.key === l) || LANGS[0]).dir; }

// t("key", { n: 2 }): מחזיר את הטקסט בשפה הנוכחית, ואם חסר - בעברית, ואם גם שם חסר - את המפתח עצמו
export function t(key, vars = {}) {
    const raw = (DICT[current] && DICT[current][key]) ?? DICT.he[key] ?? key;
    return String(raw).replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
}

export async function initLang() {
    setLang((await getSetting("language")) || "he");
}
