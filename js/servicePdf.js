// דוח סרוויס כקובץ PDF אמיתי, בלי ספרייה: הדפדפן מצייר את הדף (עברית וכיווניות מטופלות על ידו) ל-canvas,
// והעמודים נארזים ל-PDF. כך הקובץ נראה אותו דבר בכל מקום (טלפון, דרייב, מייל). הטקסט בתוכו תמונה, לא ניתן לסימון.
import { n2, unitOf, amt, dateDots } from "./serviceDoc.js";

// jpegs: [{ data: Uint8Array של JPEG, w, h }]. מחזיר Uint8Array של PDF. טהור (נבדק ב-Node)
export function jpegsToPdf(jpegs, pw = 595, ph = 842) {
    const enc = new TextEncoder();
    const chunks = [];
    let len = 0;
    const push = (x) => { const b = typeof x === "string" ? enc.encode(x) : x; chunks.push(b); len += b.length; };
    const offs = [];
    const obj = (num, parts) => { offs[num] = len; push(`${num} 0 obj\n`); for (const p of parts) push(p); push("\nendobj\n"); };
    const n = jpegs.length;
    push("%PDF-1.4\n");
    obj(1, ["<< /Type /Catalog /Pages 2 0 R >>"]);
    obj(2, [`<< /Type /Pages /Kids [${jpegs.map((_, i) => `${3 + 3 * i} 0 R`).join(" ")}] /Count ${n} >>`]);
    jpegs.forEach((j, i) => {
        const page = 3 + 3 * i, content = 4 + 3 * i, img = 5 + 3 * i;
        obj(page, [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 ${img} 0 R >> >> /Contents ${content} 0 R >>`]);
        const stream = `q ${pw} 0 0 ${ph} 0 0 cm /Im0 Do Q`;
        obj(content, [`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`]);
        obj(img, [`<< /Type /XObject /Subtype /Image /Width ${j.w} /Height ${j.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${j.data.length} >>\nstream\n`, j.data, "\nendstream"]);
    });
    const count = 3 + 3 * n;
    const xref = len;
    push(`xref\n0 ${count}\n0000000000 65535 f \n`);
    for (let i = 1; i < count; i++) push(`${String(offs[i]).padStart(10, "0")} 00000 n \n`);
    push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    const out = new Uint8Array(len);
    let p = 0;
    for (const c of chunks) { out.set(c, p); p += c.length; }
    return out;
}

// מצייר את הסיכום (serviceSummary) לעמודי A4 ומחזיר Blob מסוג PDF. רץ בדפדפן בלבד
export async function renderServicePdf(s) {
    const W = 1240, H = 1754, M = 70, PAD = 8;
    const cols = [["נתח", 260], ["יצא לסרוויס", 140], ["חזר מסרוויס", 140], ["פחת", 120], ["נזרק", 120], ["צריכה בפועל", 170], ["לסועד", 150]];
    const cvs = [];
    let ctx, y;
    const newPage = () => {
        const cv = document.createElement("canvas");
        cv.width = W; cv.height = H;
        ctx = cv.getContext("2d");
        ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
        ctx.direction = "rtl"; ctx.textAlign = "right"; ctx.textBaseline = "alphabetic";
        cvs.push(cv);
        y = M + 44;
    };
    const text = (t, x, size, { bold = false, color = "#000", maxW = 0 } = {}) => {
        let sz = size;
        ctx.fillStyle = color;
        do { ctx.font = `${bold ? "bold " : ""}${sz}px Arial, "Segoe UI", sans-serif`; sz -= 1; } while (maxW && ctx.measureText(String(t)).width > maxW && sz >= 13);
        ctx.fillText(String(t), x, y);
    };
    const line = (w = 1, color = "#bbb") => { ctx.fillStyle = color; ctx.fillRect(M, y, W - 2 * M, w); };
    const tableHead = () => {
        let xr = W - M;
        for (const [label, w] of cols) { text(label, xr - PAD, 22, { bold: true, maxW: w - 2 * PAD }); xr -= w; }
        y += 12; line(3, "#000"); y += 40;
    };

    newPage();
    text(s.title || "דוח סרוויס", W - M, 46, { bold: true, maxW: W - 2 * M });
    y += 40;
    const sub = [[s.weekday, dateDots(s.date)].filter(Boolean).join(" · "), s.guests ? `סועדים: ${s.seat1 || 0} + ${s.seat2 || 0} = ${s.guests}` : "", s.diets || ""].filter(Boolean).join(" · ");
    text(sub, W - M, 28, { color: "#555", maxW: W - 2 * M });
    y += 56;
    tableHead();

    for (const x of s.rows) {
        if (y > H - M - 260) { newPage(); tableHead(); }
        const r = x.res;
        const per = !r || r.perGuest == null ? "" : x.cnt ? `${n2(r.perGuest)} יחידות` : `${Math.round(r.perGuest)} גרם`;
        const cells = r
            ? [x.name, amt(r.out, x), amt(r.back, x), amt(r.shrink, x), amt(r.thrown, x), `${n2(r.eaten)} ${unitOf(x)}`, per]
            : [x.name, "אין נתונים", "", "", "", "", ""];
        let xr = W - M;
        cols.forEach(([, w], i) => { if (cells[i]) text(cells[i], xr - PAD, 26, { bold: i === 5, maxW: w - 2 * PAD, color: r || i < 1 ? "#000" : "#777" }); xr -= w; });
        y += 16; line(1); y += 42;
    }
    if (s.hasData) {
        if (y > H - M - 180) newPage();
        y += 10;
        text(`סה"כ צריכה בפועל ${n2(s.totals.eaten)} ק"ג${s.perGuestG ? ` · ${Math.round(s.perGuestG)} גרם לסועד` : ""}${s.totals.thrown > 0 ? ` · סה"כ נזרק ${n2(s.totals.thrown)} ק"ג` : ""}`, W - M, 30, { bold: true, maxW: W - 2 * M });
        y += 46;
        if (s.costPerDiner) text(`עלות בשר לסועד ${n2(s.costPerDiner)} ₪${s.foodCostPct ? ` · ${n2(s.foodCostPct)}% מהמחיר לסועד` : ""}`, W - M, 28, { maxW: W - 2 * M });
    }
    if (cvs.length > 1) cvs.forEach((cv, i) => { const c = cv.getContext("2d"); c.direction = "ltr"; c.textAlign = "center"; c.fillStyle = "#777"; c.font = "20px Arial, sans-serif"; c.fillText(`${i + 1} / ${cvs.length}`, W / 2, H - 30); });

    const jpegs = [];
    for (const cv of cvs) {
        const blob = await new Promise((res) => cv.toBlob(res, "image/jpeg", 0.92));
        jpegs.push({ data: new Uint8Array(await blob.arrayBuffer()), w: W, h: H });
    }
    return new Blob([jpegsToPdf(jpegs)], { type: "application/pdf" });
}
