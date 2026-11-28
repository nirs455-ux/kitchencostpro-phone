// תג "מבצע" קטן ליד מוצר בחשבונית. לחיצה פותחת את פרטי המבצע, לחיצה נוספת סוגרת.
import { escapeHtml, cur } from "../ui.js";

export const promoBadge = () => '<button type="button" class="promo-badge" data-promo-badge aria-expanded="false">🏷 מבצע</button>';

export const promoDetails = (p) => `<div class="promo-details" hidden>
    <div>${p.names.map((n) => escapeHtml(n)).join(", ")}</div>
    <div class="card-row"><span>הנחה</span><span>${cur()}${p.amount.toFixed(2)}</span></div>
    <div class="card-row"><span>מחיר יחידה</span><span>${cur()}${p.unitPrice.toFixed(2)}</span></div>
    <div class="card-row"><b>מחיר יחידה לאחר הנחה</b><b>${cur()}${p.netUnitPrice.toFixed(2)}</b></div>
</div>`;

// התג והפרטים נמצאים באותו מיכל (שורה בסריקה או תא בטבלה)
export function bindPromoBadges(root) {
    root.querySelectorAll("[data-promo-badge]").forEach((b) => {
        b.onclick = (e) => {
            e.stopPropagation();
            const box = (b.closest("td") || b.closest(".item-row-inputs")).querySelector(".promo-details");
            box.hidden = !box.hidden;
            b.setAttribute("aria-expanded", String(!box.hidden));
        };
    });
}
