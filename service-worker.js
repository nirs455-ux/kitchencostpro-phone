const CACHE_NAME = "kcp-v2";
const ASSETS = [
    "./",
    "./index.html",
    "./manifest.json",
    "./css/style.css",
    "./js/app.js",
    "./js/ui.js",
    "./js/db.js",
    "./js/constants.js",
    "./js/formulas.js",
    "./js/fuzzyMatch.js",
    "./js/export.js",
    "./js/repo/pantryRepo.js",
    "./js/repo/recipesRepo.js",
    "./js/repo/dishesRepo.js",
    "./js/repo/suppliersRepo.js",
    "./js/repo/inventoryRepo.js",
    "./js/repo/settingsRepo.js",
    "./js/repo/scanRepo.js",
    "./js/pages/pantryPage.js",
    "./js/pages/processingPage.js",
    "./js/pages/recipesPage.js",
    "./js/pages/dishesPage.js",
    "./js/pages/suppliersPage.js",
    "./js/pages/inventoryPage.js",
    "./js/pages/settingsPage.js",
    "./js/pages/scanModal.js",
    "./icons/icon-192.png",
    "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener("fetch", (event) => {
    if (event.request.method !== "GET") return;
    const url = new URL(event.request.url);
    // בקשות ל-Gemini API תמיד ישירות לרשת - לא לשמור במטמון תוצאות סריקה
    if (url.hostname.includes("generativelanguage.googleapis.com")) return;

    // קודם רשת (כדי שעדכונים יגיעו מיד), ואם אין אינטרנט - מהמטמון
    event.respondWith(
        fetch(event.request).then((response) => {
            if (response.ok && url.origin === location.origin) {
                const clone = response.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
            }
            return response;
        }).catch(() => caches.match(event.request))
    );
});
