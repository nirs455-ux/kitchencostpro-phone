// עזרי UI משותפים - מודאלים, טוסט, יצירת אלמנטים מ-HTML.

export function h(html) {
    const t = document.createElement("template");
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
}

export function toast(msg) {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove("show"), 2200);
}

let currentModalCleanup = null;

export function openModal(innerHtml, { onClose } = {}) {
    closeModal();
    const root = document.getElementById("modal-root");
    const overlay = h(`<div class="modal-overlay open"><div class="modal">${innerHtml}</div></div>`);
    overlay.addEventListener("click", (e) => {
        if (e.target === overlay) closeModal();
    });
    root.appendChild(overlay);
    currentModalCleanup = onClose || null;
    return overlay;
}

export function closeModal() {
    const root = document.getElementById("modal-root");
    root.innerHTML = "";
    if (currentModalCleanup) {
        try { currentModalCleanup(); } catch (e) { /* ignore */ }
        currentModalCleanup = null;
    }
}

export function confirmDialog(message) {
    return new Promise((resolve) => {
        const overlay = openModal(`
            <h2>אישור</h2>
            <p>${message}</p>
            <div class="modal-actions">
                <button class="btn btn-secondary" id="confirm-no">ביטול</button>
                <button class="btn btn-danger" id="confirm-yes">אישור</button>
            </div>
        `);
        overlay.querySelector("#confirm-no").onclick = () => { closeModal(); resolve(false); };
        overlay.querySelector("#confirm-yes").onclick = () => { closeModal(); resolve(true); };
    });
}

export function showError(container, message) {
    const el = container.querySelector(".error-msg");
    if (!el) return;
    el.textContent = message;
    el.style.display = "block";
}

export function clearError(container) {
    const el = container.querySelector(".error-msg");
    if (el) el.style.display = "none";
}

export function money(v) {
    return `₪${(Number(v) || 0).toFixed(2)}`;
}

export function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
}
