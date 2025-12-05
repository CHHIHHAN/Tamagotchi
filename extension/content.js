(function injectTamagotchiOverlay() {
  if (window.__tamagotchiOverlayInjected) return;
  window.__tamagotchiOverlayInjected = true;

  const script = document.createElement("script");
  script.type = "module";
  script.src = chrome.runtime.getURL("extension/overlay.js");
  document.documentElement.appendChild(script);
})();

// 监听页面发送的 cutout 请求，由内容脚本调用后端，绕过页面 CSP
window.addEventListener("message", async (event) => {
  const data = event.data;
  if (!data || data.type !== "TG_CUTOUT_REQUEST") return;
  const { id, buffer, filename, mime } = data;
  try {
    const blob = new Blob([new Uint8Array(buffer)], { type: mime || "image/png" });
    const file = new File([blob], filename || "image.png", { type: blob.type });
    const formData = new FormData();
    formData.append("file", file);

    const resp = await fetch("http://127.0.0.1:8000/cutout", {
      method: "POST",
      body: formData,
    });
    if (!resp.ok) {
      const msg = await resp.text();
      throw new Error(msg || "后端抠图请求失败");
    }
    const payload = await resp.json();
    window.postMessage({ type: "TG_CUTOUT_RESPONSE", id, ok: true, image: payload?.image }, "*");
  } catch (err) {
    window.postMessage({ type: "TG_CUTOUT_RESPONSE", id, ok: false, error: err?.message || String(err) }, "*");
  }
});

// Receive pet updates from popup and forward to overlay inside the page
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "TG_SET_PET") {
    window.postMessage({ type: "TG_SET_PET", payload: message.payload }, "*");
    sendResponse?.({ ok: true });
  }
});
