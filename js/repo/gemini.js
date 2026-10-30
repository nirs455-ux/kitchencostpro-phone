import { AGENT_SENTINEL, agentFetch } from "../agent.js";

// קריאה ל-Gemini עם התמודדות עם עומס: ניסיון חוזר קצר באותו מודל, ואז מעבר למודל גיבוי. טהור יחסית (fetch בלבד), לשימוש כל הסריקות.
export const GEMINI_MODELS = ["gemini-3.6-flash", "gemini-2.5-flash", "gemini-2.5-flash-lite"];
const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
const DELAYS = [2000, 5000]; // המתנה בין ניסיונות באותו מודל

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// קריאה מהירה לסריקות (חשבונית, מתכון, תווית, דף ספירה): בלי "חשיבה" ארוכה לפני התשובה, ותשובת JSON ישירה.
// לכל משפחת מודלים שדה אחר: 3.x = thinkingLevel, 2.5-flash = thinkingBudget. lite כבר בלי חשיבה. מודל לא מוכר: JSON בלבד.
export function fastGenerationConfig(model) {
    const cfg = { responseMimeType: "application/json" };
    if (/^gemini-3/.test(model)) cfg.thinkingConfig = { thinkingLevel: "minimal" };
    else if (/^gemini-2.5-flash$/.test(model)) cfg.thinkingConfig = { thinkingBudget: 0 };
    return cfg;
}
export const withFast = (body, model) => ({ ...body, generationConfig: { ...(body.generationConfig || {}), ...fastGenerationConfig(model) } });

// body: אובייקט הבקשה (contents...). onRetry(info) נקרא לפני כל המתנה/מעבר מודל. מחזיר Response (תקין או האחרון שנכשל)
// networkError: אם אין חיבור בכלל אחרי כל הניסיונות - נזרקת שגיאה עם .network = true
export async function geminiFetch(apiKey, body, { onRetry, models = GEMINI_MODELS, fetchImpl = fetch, delays = DELAYS, fast = false } = {}) {
    if (apiKey === AGENT_SENTINEL) { // דרך עוזר AI: מחזיר 402 (מגבלה יומית) או 503 (עמוס); בלי לגעת במפתח בצד הלקוח
        try { return await agentFetch(fast ? { ...body, fast: true } : body, fetchImpl); } catch (e) { const err = new Error("network"); err.network = true; throw err; }
    }
    let last = null;
    let networkFailures = 0;
    for (let m = 0; m < models.length; m++) {
        let useFast = fast; // אם המודל דוחה את ההגדרות המהירות (400) - ניסיון אחד בלעדיהן, כדי שהסריקה לא תישבר
        for (let attempt = 0; attempt <= delays.length; attempt++) {
            try {
                last = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${models[m]}:generateContent?key=${apiKey}`, {
                    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(useFast ? withFast(body, models[m]) : body),
                });
            } catch (e) {
                networkFailures++;
                last = null;
                if (attempt < delays.length) { if (onRetry) onRetry({ model: models[m], attempt: attempt + 1, reason: "network" }); await sleep(delays[attempt]); continue; }
                break; // עוברים למודל הבא (אולי רק החיבור לרגע)
            }
            if (last.ok) return last;
            if (last.status === 400 && useFast) { useFast = false; attempt--; continue; }
            if (last.status === 404) break; // שם מודל לא קיים/לא זמין: מיד למודל הבא
            if (RETRY_STATUSES.has(last.status)) {
                if (attempt < delays.length) { if (onRetry) onRetry({ model: models[m], attempt: attempt + 1, reason: String(last.status) }); await sleep(delays[attempt]); continue; }
                break; // עמוס גם אחרי ניסיונות: מודל הבא
            }
            return last; // 400/403 וכו': שגיאה אמיתית (מפתח לא תקין, בקשה פגומה) - לא מחליפים מודל
        }
    }
    if (!last) { const err = new Error("network"); err.network = true; throw err; }
    return last;
}
