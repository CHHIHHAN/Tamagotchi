import { createPixelArt } from "./pixel.js";
import { TamagotchiAnimator } from "./animation.js";

const form = document.getElementById("upload-form");
const fileInput = document.getElementById("asset");
const dropZone = document.getElementById("drop-zone");
const fileName = document.getElementById("file-name");
const statusEl = document.getElementById("status");
const originalPreview = document.getElementById("original-preview");
const cutoutPreview = document.getElementById("cutout-preview");
const pixelPreview = document.getElementById("pixel-preview");
const animationCanvas = document.getElementById("animation-canvas");
const moodSelect = document.getElementById("mood-select");
const submitButton = form.querySelector("button[type=submit]");

const animator = new TamagotchiAnimator(animationCanvas);
const downloadState = { filename: "tamagotchi.png" };
let currentFile = null;
const OPENAI_ENDPOINT = "https://api.openai.com/v1/images/edits";

function deriveApiBase() {
    if (window.API_BASE_URL) {
        return window.API_BASE_URL;
    }
    const isHttp = window.location.protocol.startsWith("http");
    const samePort = window.location.port === "8000";
    if (isHttp && samePort) {
        return window.location.origin;
    }
    return "http://127.0.0.1:8000";
}

const API_BASE_URL = deriveApiBase().replace(/\/$/, "");

function updateStatus(message, type = "info") {
    statusEl.textContent = message;
    statusEl.dataset.state = type;
}

function updateFileName(name) {
    fileName.textContent = name ?? "No file selected";
}

function readFilePreview(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// 所有抠图请求统一走后端 /cutout；API Key 仅存放在后端 .env 内，前端不暴露
async function requestCutout(file) {
    return requestLocalCutout(file);
}

function getOpenAIKey() {
    return (
        window.OPENAI_API_KEY ||
        localStorage.getItem("tamagotchi_openai_key") ||
        null
    );
}

async function requestGptCutout(file, apiKey) {
    const formData = new FormData();
    formData.append("model", "gpt-image-1");
    formData.append("image", file);
    formData.append(
        "prompt",
        "Remove the background and output a transparent PNG of the main subject. Keep the subject untouched; only make the background fully transparent."
    );
    formData.append("size", "1024x1024");
    formData.append("response_format", "b64_json");

    const response = await fetch(OPENAI_ENDPOINT, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${apiKey}`,
        },
        body: formData,
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(text || "GPT cutout request failed");
    }

    const payload = await response.json();
    const base64 = payload?.data?.[0]?.b64_json;
    if (!base64) {
        throw new Error("GPT cutout did not return image data");
    }
    return `data:image/png;base64,${base64}`;
}

async function requestLocalCutout(file) {
    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch(`${API_BASE_URL}/cutout`, {
        method: "POST",
        body: formData,
    });

    if (!response.ok) {
        const message = await response.text();
        throw new Error(message || "Cutout request failed");
    }

    const payload = await response.json();
    if (!payload?.image) {
        throw new Error("No cutout image returned");
    }
    return payload.image;
}

async function handleFile(file) {
    currentFile = file;
    updateFileName(file ? file.name : null);

    if (!file) {
        originalPreview.src = "";
        return;
    }

    try {
        const preview = await readFilePreview(file);
        originalPreview.src = preview;
    } catch (err) {
        console.error(err);
        updateStatus("Unable to preview this file", "error");
    }
}

async function onSubmit(event) {
    event.preventDefault();
    if (!currentFile) {
        updateStatus("Please choose an image", "error");
        return;
    }

    submitButton.disabled = true;
    updateStatus("Uploading and removing background...", "progress");

    try {
        const cutoutDataUrl = await requestCutout(currentFile);
        cutoutPreview.src = cutoutDataUrl;
        updateStatus("Cutout complete, creating pixel pet...", "progress");

        const pixelResult = await createPixelArt(cutoutDataUrl, 16);
        pixelPreview.src = pixelResult.dataUrl;
        const baseName = currentFile?.name?.replace(/\.[^.]+$/, "") || "tamagotchi";
        downloadState.filename = `${baseName}_pixel.png`;
        pixelPreview.dataset.filename = downloadState.filename;
        pixelPreview.title = `Click to download ${downloadState.filename}`;

        await prepareAnimationSprite(pixelResult);
        updateStatus("All done! Click the pixel pet to download, then pick an emotion.", "success");
    } catch (err) {
        console.error(err);
        updateStatus(err.message || "Processing failed", "error");
    } finally {
        submitButton.disabled = false;
    }
}

async function prepareAnimationSprite(pixelResult) {
    const imageData = await getImageDataFromUrl(pixelResult.dataUrl, pixelResult.width, pixelResult.height);
    animator.setSprite({ imageData, eyes: pixelResult.eyes });
    animator.setMode(moodSelect.value);
    moodSelect.disabled = false;
}

function getImageDataFromUrl(src, width = 16, height = 16) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => {
            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d");
            ctx.imageSmoothingEnabled = false;
            ctx.clearRect(0, 0, width, height);
            ctx.drawImage(image, 0, 0, width, height);
            resolve(ctx.getImageData(0, 0, width, height));
        };
        image.onerror = reject;
        image.src = src;
    });
}

function attachDragAndDrop() {
    ["dragenter", "dragover"].forEach(evt => {
        dropZone.addEventListener(evt, e => {
            e.preventDefault();
            dropZone.classList.add("dragging");
        });
    });

    ["dragleave", "drop"].forEach(evt => {
        dropZone.addEventListener(evt, e => {
            e.preventDefault();
            if (evt === "drop") {
                const file = e.dataTransfer?.files?.[0];
                if (file) {
                    handleFile(file);
                }
            }
            dropZone.classList.remove("dragging");
        });
    });
}

function handlePixelDownload() {
    if (!pixelPreview?.src) {
        return;
    }
    const link = document.createElement("a");
    link.href = pixelPreview.src;
    link.download = downloadState.filename || "tamagotchi.png";
    document.body.appendChild(link);
    link.click();
    link.remove();
}

fileInput.addEventListener("change", event => {
    const file = event.target.files?.[0];
    if (file) {
        handleFile(file);
    }
});

moodSelect.addEventListener("change", () => {
    animator.setMode(moodSelect.value);
});

pixelPreview.addEventListener("click", handlePixelDownload);
form.addEventListener("submit", onSubmit);
attachDragAndDrop();
moodSelect.disabled = true;
updateStatus("Waiting for upload", "idle");
