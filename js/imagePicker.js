// בורר תמונה/קובץ: מצלמה בתוך האפליקציה (עם חזרה לקלט capture אם לא זמינה) וגלריה/קבצים.
import { openModal, closeModal } from "./ui.js";

export function openImagePicker({ title, hint, onFile }) {
    const overlay = openModal(`
        <h2>${title}</h2>
        <div class="hint" style="margin-bottom:10px;">${hint}</div>
        <div class="btn-row">
            <button type="button" class="btn btn-accent" id="pick-camera">📷 צלם</button>
            <button type="button" class="btn btn-secondary" id="pick-gallery">🖼️ בחר מהגלריה / קבצים</button>
        </div>
        <input type="file" id="pick-file-camera" accept="image/*" capture="environment" style="display:none">
        <input type="file" id="pick-file-gallery" accept="image/*,.pdf" style="display:none">
        <div class="modal-actions"><button type="button" class="btn btn-secondary" id="pick-cancel">ביטול</button></div>
    `);

    const choose = (file) => {
        if (!file) return;
        closeModal();
        onFile(file);
    };
    overlay.querySelector("#pick-cancel").onclick = closeModal;
    overlay.querySelector("#pick-gallery").onclick = () => overlay.querySelector("#pick-file-gallery").click();
    overlay.querySelector("#pick-file-camera").addEventListener("change", (e) => choose(e.target.files[0]));
    overlay.querySelector("#pick-file-gallery").addEventListener("change", (e) => choose(e.target.files[0]));

    overlay.querySelector("#pick-camera").onclick = async () => {
        const fallback = () => overlay.querySelector("#pick-file-camera").click();
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return fallback();
        let stream;
        try {
            stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
        } catch (e) {
            return fallback();
        }
        const cam = document.createElement("div");
        cam.style.cssText = "position:fixed;inset:0;z-index:100;background:#000;display:flex;flex-direction:column;";
        cam.innerHTML = `
            <video autoplay playsinline muted style="flex:1;min-height:0;width:100%;object-fit:contain;"></video>
            <div style="display:flex;gap:10px;padding:14px;background:#111;">
                <button type="button" class="btn btn-secondary" style="flex:1;" id="cam-cancel">ביטול</button>
                <button type="button" class="btn btn-primary" style="flex:2;" id="cam-shoot">📸 צלם</button>
            </div>`;
        document.body.appendChild(cam);
        const video = cam.querySelector("video");
        video.srcObject = stream;
        const stop = () => { stream.getTracks().forEach((t) => t.stop()); cam.remove(); };
        cam.querySelector("#cam-cancel").onclick = stop;
        cam.querySelector("#cam-shoot").onclick = () => {
            if (!video.videoWidth) return;
            const canvas = document.createElement("canvas");
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            canvas.getContext("2d").drawImage(video, 0, 0);
            canvas.toBlob((blob) => {
                stop();
                if (blob) choose(new File([blob], "recipe.jpg", { type: "image/jpeg" }));
            }, "image/jpeg", 0.92);
        };
    };
}
