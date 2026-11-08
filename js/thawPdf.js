// טופס מעקב הפשרת מזון כקובץ PDF להדפסה (A4 לרוחב, שחור לבן), באותן עמודות כמו הטופס בנייר. רץ בדפדפן בלבד.
import { jpegsToPdf } from "./servicePdf.js";
import { dateDots } from "./serviceDoc.js";
import { foodTypeLabel } from "./thaw.js";

const COLS = [["שם ספק המוצר", 230], ["שם המוצר", 260], ["סוג המזון", 120], ["תאריך פג תוקף על פי הוראות יצרן", 160], ["תאריך תחילת ההפשרה", 160], ["שעת תחילת ההפשרה", 110], ["תאריך סיום ההפשרה", 160], ["שעת סיום ההפשרה", 110], ["טמפרטורת המזון בסיום ההפשרה", 130], ["שם המבצע", 214]];
const cells = (e) => [e.supplier, e.product, foodTypeLabel(e.foodType), e.expiry ? dateDots(e.expiry) : "", dateDots(e.startDate), e.startTime, e.endDate ? dateDots(e.endDate) : "", e.endTime, e.endTemp ? `${e.endTemp}°` : "", e.operator];

export async function renderThawPdf(rows, periodText = "") {
    const W = 1754, H = 1240, M = 50, ROW = 78, HEAD = 100;
    const cvs = [];
    let ctx, y;
    const text = (t, xr, yy, size, { bold = false, maxW = 0, align = "right" } = {}) => {
        let sz = size;
        ctx.fillStyle = "#000"; ctx.textAlign = align;
        do { ctx.font = `${bold ? "bold " : ""}${sz}px Arial, "Segoe UI", sans-serif`; sz -= 1; } while (maxW && ctx.measureText(String(t)).width > maxW && sz >= 12);
        ctx.fillText(String(t), xr, yy);
    };
    const wrapHead = (label, xr, w) => { // כותרת עמודה בשתי שורות לכל היותר
        const words = label.split(" "), lines = [""];
        ctx.font = "bold 21px Arial, sans-serif";
        for (const wd of words) { const t = (lines[lines.length - 1] + " " + wd).trim(); if (ctx.measureText(t).width > w - 16 && lines[lines.length - 1]) lines.push(wd); else lines[lines.length - 1] = t; }
        lines.slice(0, 3).forEach((l, i) => text(l, xr - 8, y + 32 + i * 26, 21, { bold: true, maxW: w - 16 }));
    };
    const grid = (top, h) => {
        ctx.strokeStyle = "#000"; ctx.lineWidth = 2;
        let x = W - M;
        ctx.beginPath(); ctx.moveTo(M, top); ctx.lineTo(W - M, top); ctx.stroke();
        for (const [, w] of COLS) { ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, top + h); ctx.stroke(); x -= w; }
        ctx.beginPath(); ctx.moveTo(M, top); ctx.lineTo(M, top + h); ctx.stroke();
    };
    const newPage = () => {
        const cv = document.createElement("canvas");
        cv.width = W; cv.height = H;
        ctx = cv.getContext("2d");
        ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
        ctx.direction = "rtl"; ctx.textBaseline = "alphabetic";
        cvs.push(cv);
        text("טופס מעקב הפשרת מזון גולמי / מוכן / דו שלבי (חצי מוכן)", W - M, M + 36, 38, { bold: true, maxW: W - 2 * M });
        if (periodText) text(periodText, W - M, M + 76, 24, { maxW: W - 2 * M });
        y = M + 100;
        let xr = W - M;
        for (const [label, w] of COLS) { wrapHead(label, xr, w); xr -= w; }
        ctx.strokeStyle = "#000"; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(M, y + HEAD); ctx.lineTo(W - M, y + HEAD); ctx.stroke();
        y += HEAD;
    };
    const perPage = Math.floor((H - M - 70 - (M + 100 + HEAD)) / ROW);
    newPage();
    let top = y, n = 0;
    const closePage = () => { grid(M + 100, HEAD + n * ROW); text("יש לשמור את התווית המקורית של אריזת היצרן עד לסיום הטיפול התרמי", W - M, H - M + 10, 26, { bold: true, maxW: W - 2 * M }); };
    for (const e of rows) {
        if (n >= perPage) { closePage(); newPage(); top = y; n = 0; }
        let xr = W - M;
        const cs = cells(e);
        COLS.forEach(([, w], i) => { if (cs[i]) text(cs[i], xr - 10, y + ROW / 2 + 10, 26, { maxW: w - 20 }); xr -= w; });
        y += ROW; n++;
        ctx.strokeStyle = "#000"; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(M, y); ctx.lineTo(W - M, y); ctx.stroke();
    }
    closePage();
    if (cvs.length > 1) cvs.forEach((cv, i) => { const c = cv.getContext("2d"); c.direction = "ltr"; c.textAlign = "center"; c.fillStyle = "#555"; c.font = "20px Arial, sans-serif"; c.fillText(`${i + 1} / ${cvs.length}`, W / 2, H - 16); });
    const jpegs = [];
    for (const cv of cvs) {
        const blob = await new Promise((res) => cv.toBlob(res, "image/jpeg", 0.92));
        jpegs.push({ data: new Uint8Array(await blob.arrayBuffer()), w: W, h: H });
    }
    return new Blob([jpegsToPdf(jpegs, 842, 595)], { type: "application/pdf" });
}
