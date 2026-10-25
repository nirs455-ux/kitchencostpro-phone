// תמונה שנשלחה לאפליקציה דרך "שתף" (נשמרה זמנית על ידי ה-service worker)
export async function consumeSharedFile() {
    try {
        if (!("caches" in window)) return null;
        const cache = await caches.open("kcp-share");
        const res = await cache.match("shared-image");
        if (!res) return null;
        const blob = await res.blob();
        await cache.delete("shared-image");
        return new File([blob], "shared.jpg", { type: blob.type || "image/jpeg" });
    } catch (e) {
        return null;
    }
}
