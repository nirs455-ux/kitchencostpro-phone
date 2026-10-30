// בחירה מרובה ומחיקה, אותו מנגנון בכל רשימה: כפתור "☑ בחירה", לחיצה על שורות מסמנת אותן, "מחק" מוחק את הכול באישור אחד קצר.
// attachBulk מחבר את המנגנון לרשימה שכבר מצוירת: לחיצה על שורה במצב בחירה נתפסת לפני הטיפול הרגיל של השורה (פתיחת כרטיס וכד').
import { toast, confirmDialog, escapeHtml } from "./ui.js";

// host: האלמנט שמעליו מוסיפים את שורת הכפתורים. listEl: אלמנט שמכיל את השורות (נשאר גם כשהשורות מצטיירות מחדש).
// rowSel: סלקטור של שורה. idOf(row): מזהה (או null לשורה שאי אפשר למחוק). nameOf(row): שם להצגה באישור.
// remove(ids): מוחק. refresh(): מצייר מחדש אחרי מחיקה. noun: "מתכונים", "ספקים" וכו'.
export function attachBulk({ host, listEl, rowSel, idOf, nameOf, remove, refresh, noun, verb = "מחק", done = "נמחקו" }) {
    let on = false;
    const sel = new Set();
    const bar = document.createElement("div");
    bar.className = "btn-row mgr-only";
    bar.style.margin = "6px 0";
    bar.innerHTML = '<button type="button" class="btn btn-secondary btn-small" data-b="on">☑ בחירה</button><button type="button" class="btn btn-secondary btn-small" data-b="all" style="display:none;">בחר הכול</button>';
    const sticky = document.createElement("div");
    sticky.className = "px-bulk mgr-only";
    sticky.style.display = "none";
    sticky.innerHTML = `<b data-b="n"></b><button type="button" class="btn btn-danger btn-small" data-b="del">${verb}</button><button type="button" class="btn btn-secondary btn-small" data-b="off">ביטול</button>`;
    host.insertAdjacentElement("beforebegin", bar);
    listEl.insertAdjacentElement("afterend", sticky);
    const q = (el, k) => el.querySelector(`[data-b="${k}"]`);
    const rows = () => [...listEl.querySelectorAll(rowSel)].filter((r) => idOf(r) != null);

    const mark = () => {
        q(bar, "on").style.display = on ? "none" : "";
        q(bar, "all").style.display = on ? "" : "none";
        sticky.style.display = on ? "flex" : "none";
        q(sticky, "n").textContent = sel.size ? `נבחרו ${sel.size}` : `בחר ${noun}`;
        q(sticky, "del").disabled = !sel.size;
        for (const r of rows()) r.classList.toggle("sel", on && sel.has(String(idOf(r))));
    };
    // שורות שמצטיירות מחדש מקבלות שוב את הסימון
    new MutationObserver(() => { if (on) mark(); }).observe(listEl, { childList: true, subtree: true });

    listEl.addEventListener("click", (e) => {
        if (!on) return;
        const r = e.target.closest(rowSel);
        if (!r || !listEl.contains(r)) return;
        e.preventDefault(); e.stopPropagation();
        const id = idOf(r);
        if (id == null) return;
        const k = String(id);
        if (sel.has(k)) sel.delete(k); else sel.add(k);
        mark();
    }, true);

    q(bar, "on").onclick = () => { on = true; sel.clear(); mark(); };
    q(bar, "all").onclick = () => { for (const r of rows()) sel.add(String(idOf(r))); mark(); };
    q(sticky, "off").onclick = () => { on = false; sel.clear(); mark(); };
    q(sticky, "del").onclick = async () => {
        if (!sel.size) return;
        const ids = [...sel];
        const names = nameOf ? rows().filter((r) => sel.has(String(idOf(r)))).map((r) => nameOf(r)).filter(Boolean) : [];
        const shown = names.length ? `<br><br>${names.slice(0, 6).map(escapeHtml).join(", ")}${names.length > 6 ? ` ועוד ${names.length - 6}` : ""}` : "";
        if (!(await confirmDialog(`${verb === "מחק" ? "למחוק" : "להעביר לארכיון"} ${ids.length} ${noun}?${shown}`))) return;
        try { await remove(ids); toast(`${done} ${ids.length} ${noun}`); } catch (err) { toast(err.message || "המחיקה נכשלה"); }
        on = false; sel.clear(); mark();
        await refresh();
    };
    mark();
    return { off: () => { on = false; sel.clear(); mark(); } };
}
