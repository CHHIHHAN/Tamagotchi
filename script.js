const FASTAPI_ENDPOINT =
  (window.FASTAPI_URL && window.FASTAPI_URL.replace(/\/$/, "")) ||
  "http://127.0.0.1:8000/cutout";

document.getElementById("analyzeBtn").onclick = async () => {
  const file = document.getElementById("fileInput").files[0];
  if (!file) return alert("请先上传一张图片");

  const resizedBase64 = await resizeImage(file, 256);
  updatePreview(resizedBase64);

  const resultDiv = document.getElementById("result");
  resultDiv.innerText = "正在调用 FastAPI...";

  try {
    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch(FASTAPI_ENDPOINT, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(message || `FastAPI 接口错误：${response.status}`);
    }

    const data = await response.json();
    console.log("FastAPI 响应:", data);
    resultDiv.innerText = JSON.stringify(data, null, 2);
  } catch (err) {
    console.error("Request failed:", err);
    resultDiv.innerText = "Error: Failed to fetch from server.\n" + err;
  }
};

async function resizeImage(file, maxSize) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const scale = maxSize / Math.max(img.width, img.height);
      const canvas = document.createElement("canvas");
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;

      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      const base64 = canvas
        .toDataURL("image/jpeg", 0.7)
        .replace(/^data:image\/jpeg;base64,/, "");

      resolve(base64);
    };

    img.src = URL.createObjectURL(file);
  });
}

function updatePreview(base64) {
  const preview = document.getElementById("resizedPreview");
  if (!preview) return;
  preview.src = `data:image/jpeg;base64,${base64}`;
  preview.style.opacity = "1";
}
