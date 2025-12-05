import { TamagotchiAnimator } from "../animation.js";

function initOverlay() {
  if (document.getElementById("tg-overlay-root")) return;

  const root = document.createElement("div");
  root.id = "tg-overlay-root";
  root.innerHTML = `
    <div class="tg-floating" id="tg-floating">
      <canvas id="tg-floating-canvas" width="16" height="16"></canvas>
    </div>
  `;
  document.body.appendChild(root);

  const floating = root.querySelector("#tg-floating");
  const floatingCanvas = root.querySelector("#tg-floating-canvas");
  const floatingAnimator = new TamagotchiAnimator(floatingCanvas);

  // default bottom-right
  const margin = 32; // a bit away from the edge
  let pos = {
    x: window.innerWidth - floatingCanvas.width * 6 - margin, // scaled display ~6x
    y: window.innerHeight - floatingCanvas.height * 6 - margin,
  };
  applyPosition(floating, pos);
  enableDrag(floating, pos);
  installReactions(floating, floatingAnimator);

  window.addEventListener("message", async (event) => {
    const data = event.data;
    if (!data || data.type !== "TG_SET_PET") return;
    const payload = data.payload || {};
    try {
      const { dataUrl, width = 16, height = 16, eyes, mode = "happy" } = payload;
      if (!dataUrl) return;
      const imageData = await getImageDataFromUrl(dataUrl, width, height);
      floatingAnimator.setSprite({ imageData, eyes });
      floatingAnimator.setMode("calm");
      showFloating(floating);
    } catch (err) {
      console.error("Failed to set pet:", err);
    }
  });
}

function enableDrag(floatingEl, pos) {
  let dragging = false;
  let offsetX = 0;
  let offsetY = 0;

  floatingEl.addEventListener("mousedown", (e) => {
    dragging = true;
    floatingEl.style.cursor = "grabbing";
    offsetX = e.clientX - pos.x;
    offsetY = e.clientY - pos.y;
    e.preventDefault();
  });

  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    pos.x = e.clientX - offsetX;
    pos.y = e.clientY - offsetY;
    clampPosition(pos);
    applyPosition(floatingEl, pos);
  });

  window.addEventListener("mouseup", () => {
    if (!dragging) return;
    dragging = false;
    floatingEl.style.cursor = "grab";
  });
}

function clampPosition(pos) {
  pos.x = Math.max(0, Math.min(pos.x, window.innerWidth - 96));
  pos.y = Math.max(0, Math.min(pos.y, window.innerHeight - 96));
}

function applyPosition(el, pos) {
  el.style.right = "auto";
  el.style.bottom = "auto";
  el.style.left = `${pos.x}px`;
  el.style.top = `${pos.y}px`;
}

function installReactions(floatingEl, animator) {
  const state = {
    currentMode: "calm",
    lastMouseMove: performance.now(),
    lastActivity: performance.now(),
    lastPetClick: 0,
    petHovering: false,
  };

  const PET_RADIUS = 100;
  const DOUBLE_CLICK_WINDOW = 450;
  const INACTIVITY_MS = 25000;
  const CLOSE_ZONE = { top: 0, right: 120, height: 120 }; // near top-right corner

  const setMode = (mode) => {
    if (state.currentMode === mode) return;
    state.currentMode = mode;
    animator.setMode(mode);
  };

  const onPetClick = (event) => {
    const now = performance.now();
    const isDouble = now - state.lastPetClick <= DOUBLE_CLICK_WINDOW;
    state.lastPetClick = now;
    state.lastActivity = now;

    if (isDouble) {
      setMode("excited");
      return;
    }

    // single click => happy
    setMode("happy");
  };

  const onPetMouseMove = () => {
    state.petHovering = true;
    state.lastActivity = performance.now();
  };

  const onPetMouseLeave = () => {
    state.petHovering = false;
  };

  floatingEl.addEventListener("click", onPetClick);
  floatingEl.addEventListener("mousemove", onPetMouseMove);
  floatingEl.addEventListener("mouseleave", onPetMouseLeave);

  window.addEventListener("mousemove", (e) => {
    const now = performance.now();
    state.lastMouseMove = now;
    state.lastActivity = now;

    // excited if recently clicked and staying near pet
    const rect = floatingEl.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const dist = Math.hypot(e.clientX - centerX, e.clientY - centerY);
    if (now - state.lastPetClick < 1500 && dist <= PET_RADIUS) {
      setMode("excited");
      return;
    }

    // sad if near close button area (top-right)
    const nearClose =
      e.clientY <= CLOSE_ZONE.height &&
      e.clientX >= window.innerWidth - CLOSE_ZONE.right;
    if (nearClose) {
      setMode("sad");
      return;
    }
  });

  window.addEventListener("click", (e) => {
    // clicks outside pet => calm
    if (!floatingEl.contains(e.target)) {
      setMode("calm");
    }
  });

  window.addEventListener("keydown", () => {
    if (!state.petHovering) {
      setMode("wink");
    }
    state.lastActivity = performance.now();
  });

  // inactivity watcher -> sleepy
  setInterval(() => {
    const now = performance.now();
    if (now - state.lastActivity >= INACTIVITY_MS) {
      setMode("sleepy");
    }
  }, 1000);
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

function startCursorFollow(floatingEl) {
  // Deprecated: no-op (pet is pinned bottom-right)
}

function showFloating(floatingEl) {
  if (!floatingEl) return;
  floatingEl.classList.add("active");
}

initOverlay();
