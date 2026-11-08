// יומן הפשרות שמור כהגדרה אחת (thaw_log), ולכן נכלל בגיבוי ובשחזור. שם המבצע האחרון נשמר כברירת מחדל.
import { getSetting, setSetting } from "./settingsRepo.js";
import { normalizeLog, DEFAULT_OPERATOR } from "../thaw.js";

const KEY = "thaw_log", OP = "thaw_operator";
export async function listThaws() { return normalizeLog(await getSetting(KEY, [])); }
export async function saveThaws(list) { await setSetting(KEY, normalizeLog(list)); }
export async function getOperator() { return String((await getSetting(OP, DEFAULT_OPERATOR)) || DEFAULT_OPERATOR); }
export async function setOperator(name) { await setSetting(OP, String(name || "").trim() || DEFAULT_OPERATOR); }
