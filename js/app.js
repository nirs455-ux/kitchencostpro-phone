import { renderPantryPage } from "./pages/pantryPage.js";
import { renderProcessingPage } from "./pages/processingPage.js";
import { renderRecipesPage } from "./pages/recipesPage.js";
import { renderDishesPage } from "./pages/dishesPage.js";
import { renderSuppliersPage } from "./pages/suppliersPage.js";
import { renderInventoryPage } from "./pages/inventoryPage.js";
import { renderSettingsPage } from "./pages/settingsPage.js";

const PAGES = {
    pantry: { title: "מזווה", render: renderPantryPage },
    processing: { title: "עיבוד", render: renderProcessingPage },
    recipes: { title: "מתכונים", render: renderRecipesPage },
    dishes: { title: "מנות ורווחיות", render: renderDishesPage },
    suppliers: { title: "ספקים וחשבוניות", render: renderSuppliersPage },
    inventory: { title: "ספירת מלאי", render: renderInventoryPage },
    settings: { title: "הגדרות", render: renderSettingsPage },
};

const view = document.getElementById("view");
const pageTitle = document.getElementById("page-title");
const navButtons = document.querySelectorAll("#bottom-nav button");

async function navigate(pageKey) {
    if (!PAGES[pageKey]) pageKey = "pantry";
    location.hash = pageKey;
    navButtons.forEach((b) => b.classList.toggle("active", b.dataset.page === pageKey));
    pageTitle.textContent = "KitchenCostPro - " + PAGES[pageKey].title;
    view.innerHTML = '<div class="empty-state">טוען...</div>';
    try {
        await PAGES[pageKey].render(view);
    } catch (e) {
        console.error(e);
        view.innerHTML = `<div class="empty-state">שגיאה בטעינת הדף: ${e.message}</div>`;
    }
}

navButtons.forEach((btn) => {
    btn.addEventListener("click", () => navigate(btn.dataset.page));
});

window.addEventListener("hashchange", () => {
    const key = location.hash.replace("#", "");
    if (PAGES[key]) navigate(key);
});

navigate(location.hash.replace("#", "") || "pantry");

if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
        navigator.serviceWorker.register("service-worker.js").catch(() => {});
    });
}
