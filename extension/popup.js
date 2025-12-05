import { createPixelArt } from "../pixel.js";

const BACKEND_CUTOUT = "http://127.0.0.1:8000/cutout";

const fileInput = document.getElementById("file-input");
const dropZone = document.getElementById("drop-zone");
const fileNameEl = document.getElementById("file-name");
const cutoutPreview = document.getElementById("cutout-preview");
const pixelCanvas = document.getElementById("pixel-canvas");
const pixelCtx = pixelCanvas.getContext("2d");
pixelCtx.imageSmoothingEnabled = false;

fileInput.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (file) {
    handleFile(file);
  }
});

["dragenter", "dragover"].forEach((evt) => {
  dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropZone.classList.add("dragging");
  });
});

["dragleave", "drop"].forEach((evt) => {
  dropZone.addEventListener(evt, (e) => {
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

// 点击上传区域时打开文件选择器
dropZone.addEventListener("click", () => {
  fileInput.click();
});

async function handleFile(file) {
  setFileName(file.name);
  try {
    const cutout = await requestCutout(file);
    renderCutout(cutout);
    const pixelResult = await createPixelArt(cutout, 16);
    renderPixel(pixelResult);
    await sendPetToActiveTab(pixelResult);
  } catch (err) {
    console.error("Cutout failed:", err);
  }
}

function setFileName(name) {
  fileNameEl.textContent = name || "No file selected";
}

async function requestCutout(file) {
  const formData = new FormData();
  formData.append("file", file);
  const resp = await fetch(BACKEND_CUTOUT, {
    method: "POST",
    body: formData,
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(txt || "Backend cutout failed");
  }
  const payload = await resp.json();
  if (!payload?.image) {
    throw new Error("No image returned");
  }
  return payload.image;
}

function renderCutout(dataUrl) {
  cutoutPreview.src = dataUrl || "";
}

function renderPixel(pixelResult) {
  const img = new Image();
  img.onload = () => {
    pixelCanvas.width = pixelResult.width;
    pixelCanvas.height = pixelResult.height;
    pixelCtx.imageSmoothingEnabled = false;
    pixelCtx.clearRect(0, 0, pixelCanvas.width, pixelCanvas.height);
    pixelCtx.drawImage(img, 0, 0, pixelCanvas.width, pixelCanvas.height);
  };
  img.src = pixelResult.dataUrl;
}

async function sendPetToActiveTab(pixelResult) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  await chrome.tabs.sendMessage(tab.id, {
    type: "TG_SET_PET",
    payload: {
      dataUrl: pixelResult.dataUrl,
      width: pixelResult.width,
      height: pixelResult.height,
      eyes: pixelResult.eyes,
      mode: "happy",
    },
  });
}
