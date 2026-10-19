const CACHE_NAME = "kcp-v41";
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
    "./js/filters.js",
    "./js/recipeParse.js",
    "./js/invoiceParse.js",
    "./js/imageUtil.js",
    "./js/theme.js",
    "./js/pages/priceAlerts.js",
    "./js/pages/trashModal.js",
    "./js/pages/homePage.js",
    "./js/pages/filesPage.js",
    "./js/pages/ingredientPicker.js",
    "./js/pages/wastePage.js",
    "./js/repo/wasteRepo.js",
    "./js/waste.js",
    "./js/pages/setupWizard.js",
    "./js/locale.js",
    "./js/repo/scanQueue.js",
    "./js/share.js",
    "./js/docxText.js",
    "./js/allergens.js",
    "./js/bakers.js",
    "./js/eggs.js",
    "./js/qty.js",
    "./js/statusIcons.js",
    "./js/i18n.js",
    "./js/i18n/he.js",
    "./js/i18n/en.js",
    "./js/i18n/de.js",
    "./js/pages/tour.js",
    "./js/cloud/config.js",
    "./js/cloud/pack.js",
    "./js/cloud/driveApi.js",
    "./js/cloud/cloudCore.js",
    "./js/cloud/cloudGlue.js",
    "./js/cloud/cloudUi.js",
    "./js/generator.js",
    "./js/recipeLabel.js",
    "./js/fileText.js",
    "./js/filePrep.js",
    "./js/staff.js",
    "./js/errorLog.js",
    "./js/imagePicker.js",
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

// "שתף לאפליקציה": קבלת תמונה מאפליקציה אחרת (וואטסאפ, גלריה) - שומרים אותה זמנית ופותחים את האפליקציה לסריקה
self.addEventListener("fetch", (event) => {
    const reqUrl = new URL(event.request.url);
    if (event.request.method === "POST" && reqUrl.pathname.endsWith("/share-target")) {
        event.respondWith((async () => {
            try {
                const form = await event.request.formData();
                const file = form.get("image");
                if (file && file.size) {
                    const cache = await caches.open("kcp-share");
                    await cache.put("shared-image", new Response(file, { headers: { "Content-Type": file.type || "image/jpeg" } }));
                }
            } catch (e) { /* ממשיכים לפתוח את האפליקציה גם אם נכשל */ }
            return Response.redirect(new URL("./index.html#share", self.registration.scope).href, 303);
        })());
        return;
    }
    if (event.request.method !== "GET") return;
    const url = new URL(event.request.url);
    // בקשות ל-Gemini API תמיד ישירות לרשת - לא לשמור במטמון תוצאות סריקה
    // ובקשות ל-Google (Drive, התחברות) תמיד ישירות לרשת
    if (/(^|\.)(googleapis|google|gstatic)\.com$/.test(url.hostname)) return;

    // קודם רשת (כדי שעדכונים יגיעו מיד), ואם אין אינטרנט - מהמטמון
    event.respondWith(
        fetch(event.request, { cache: "no-cache" }).then((response) => {
            if (response.ok && url.origin === location.origin) {
                const clone = response.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
            }
            return response;
        }).catch(() => caches.match(event.request))
    );
});
