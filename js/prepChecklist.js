// צ'קליסט הכנות להדפסה ולשליחה לטבחים. טהור (בלי DOM/DB) כדי שאפשר לבדוק ב-Node.
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const dateText = (iso) => String(iso || "").split("-").reverse().join("/");

// lines: [{ label, qty, done }] ; head: { title, date, guests }
export function checklistText({ title = "", date = "", guests = "" } = {}, lines = []) {
    const out = [`*${title || "הכנות"}*${date ? ` - ${dateText(date)}` : ""}${guests ? ` (${guests} סועדים)` : ""}`, ""];
    for (const l of lines) out.push(`${l.done ? "☑" : "☐"} ${l.label} - ${l.qty}`);
    return out.join("\n");
}

// דף A4 להדפסה: תיבת סימון, משימה, כמות, ועמודה לשם הטבח. משימות שכבר בוצעו מוצגות מסומנות.
export function checklistHtml({ title = "", date = "", guests = "" } = {}, lines = []) {
    const rows = lines.map((l, i) => `<tr><td class="n">${i + 1}</td><td class="bx">${l.done ? "✔" : ""}</td><td class="nm">${esc(l.label)}</td><td class="q">${esc(l.qty)}</td><td class="who"></td></tr>`).join("");
    return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>${esc(title || "הכנות")}</title><style>
@page{size:A4;margin:10mm}
body{font-family:Arial,"Segoe UI",sans-serif;font-size:14px;color:#000;margin:0}
h1{font-size:20px;margin:0 0 4px}.sub{margin:0 0 8px;font-size:12px}
table{width:100%;border-collapse:collapse}
td,th{border:1px solid #000;padding:0 6px;height:10mm}
th{background:#eee;font-size:12px;height:7mm}
td.n{width:9mm;text-align:center}
td.bx{width:12mm;text-align:center;font-size:18px}
td.nm{font-weight:700}
td.q{width:34mm;text-align:center;font-weight:700}
td.who{width:36mm}
tr{page-break-inside:avoid}
</style></head><body>
<h1>${esc(title || "הכנות")}</h1><div class="sub">תאריך: ${esc(dateText(date)) || "____________"}${guests ? ` &nbsp; סועדים: ${esc(guests)}` : ""} &nbsp; מסמנים ✔ כשהמשימה הושלמה</div>
<table><thead><tr><th>#</th><th>בוצע</th><th>משימה</th><th>כמות</th><th>מי מכין</th></tr></thead><tbody>${rows}</tbody></table>
<script>window.onload=function(){setTimeout(function(){window.print()},300)}</script>
</body></html>`;
}
