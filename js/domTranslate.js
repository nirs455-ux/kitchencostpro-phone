// תרגום הממשק בזמן ריצה: מחליף את הטקסט העברי שמוצג בדף (טקסט, placeholder, title, aria-label) לשפה שנבחרה.
// בעברית לא עושה כלום. טקסט שאינו במילון (שמות מוצרים, מתכונים וכו') נשאר כמו שהוא.
import { makeTranslator } from "./i18nCore.js";

let observer = null;
let translate = null;
let busy = false;
const ATTRS = ["placeholder", "title", "aria-label", "alt"];
const SKIP = new Set(["SCRIPT", "STYLE", "TEXTAREA", "IFRAME", "CODE"]);

function doNode(root) {
    if (!translate || !root) return;
    if (root.nodeType === 3) { const v = translate(root.nodeValue); if (v !== root.nodeValue) root.nodeValue = v; return; }
    if (root.nodeType !== 1 || SKIP.has(root.tagName)) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
        acceptNode: (n) => (n.nodeType === 1 && SKIP.has(n.tagName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    const nodes = [];
    for (let n = walker.currentNode; n; n = walker.nextNode()) nodes.push(n);
    for (const n of nodes) {
        if (n.nodeType === 3) { const v = translate(n.nodeValue); if (v !== n.nodeValue) n.nodeValue = v; }
        else for (const a of ATTRS) { if (n.hasAttribute && n.hasAttribute(a)) { const v = translate(n.getAttribute(a)); if (v !== n.getAttribute(a)) n.setAttribute(a, v); } }
    }
}

export async function initDomTranslate(lang, dir = "ltr") {
    if (observer) { observer.disconnect(); observer = null; }
    translate = null;
    const html = document.documentElement;
    html.lang = lang;
    if (lang === "he") { html.dir = "rtl"; return; }
    let dict;
    try { dict = (await import(`./i18n/ui-${lang}.js`)).default; } catch (e) { return; }
    translate = makeTranslator(dict);
    html.dir = dir;
    doNode(document.body);
    document.title = translate(document.title);
    observer = new MutationObserver((muts) => {
        if (busy) return;
        busy = true;
        try {
            for (const m of muts) {
                if (m.type === "childList") m.addedNodes.forEach((n) => doNode(n));
                else if (m.type === "characterData") doNode(m.target);
                else if (m.type === "attributes") { const v = translate(m.target.getAttribute(m.attributeName)); if (v !== m.target.getAttribute(m.attributeName)) m.target.setAttribute(m.attributeName, v); }
            }
        } finally { busy = false; observer.takeRecords(); }
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    // הודעות מערכת של הדפדפן (confirm/alert)
    if (!window.__kcpDialogsWrapped) {
        window.__kcpDialogsWrapped = true;
        const c = window.confirm.bind(window), a = window.alert.bind(window);
        window.confirm = (m) => c(translate ? translate(String(m)) : m);
        window.alert = (m) => a(translate ? translate(String(m)) : m);
    }
}

export function translateNow(text) { return translate ? translate(text) : text; }
