// בחירת "איך המוצר נקנה" בשתי אפשרויות: קילו או יחידה, ומתג "נוזל" ליד קילו.
// הערך השמור לא משתנה: select מוסתר ממשיך להחזיק weight / liter / unit, וכל הלוגיקה הקיימת קוראת אותו כרגיל.
export function bindUnitChoice(hiddenSelect) {
    if (!hiddenSelect || hiddenSelect.dataset.uc) return;
    hiddenSelect.dataset.uc = "1";
    const wrap = document.createElement("div");
    wrap.className = "uc-wrap";
    wrap.innerHTML = `<select class="uc-kind"><option value="kg">לפי משקל, קילו</option><option value="unit">לפי יחידה</option></select>
        <label class="checkbox-field uc-liq"><input type="checkbox" class="uc-liquid"><span>נוזל, מחיר לליטר</span></label>`;
    hiddenSelect.insertAdjacentElement("beforebegin", wrap);
    hiddenSelect.style.display = "none";
    const kind = wrap.querySelector(".uc-kind"), liq = wrap.querySelector(".uc-liquid"), liqLabel = wrap.querySelector(".uc-liq");
    const fromHidden = () => {
        const v = hiddenSelect.value;
        kind.value = v === "unit" ? "unit" : "kg";
        liq.checked = v === "liter";
        liqLabel.style.display = v === "unit" ? "none" : "";
    };
    const toHidden = () => {
        const v = kind.value === "unit" ? "unit" : liq.checked ? "liter" : "weight";
        if (hiddenSelect.value !== v) { hiddenSelect.value = v; hiddenSelect.dispatchEvent(new Event("change", { bubbles: true })); }
        liqLabel.style.display = v === "unit" ? "none" : "";
    };
    kind.addEventListener("change", toHidden);
    liq.addEventListener("change", toHidden);
    hiddenSelect.addEventListener("change", fromHidden);
    fromHidden();
}
