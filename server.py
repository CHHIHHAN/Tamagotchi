import base64
import io
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from rembg import remove
from PIL import Image

app = FastAPI(title="Pixel Tamagotchi Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health_check():
    return {"status": "ok"}


@app.post("/cutout")
async def cutout(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(status_code=400, detail="文件名为空")

    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="文件内容为空")

    try:
        result_bytes = remove(file_bytes)
    except Exception as exc:  # pragma: no cover - rembg 错误直接透传
        raise HTTPException(status_code=500, detail=f"rembg 处理失败: {exc}") from exc

    cutout_png = ensure_png(result_bytes)
    encoded = base64.b64encode(cutout_png).decode("utf-8")
    filename = f"{Path(file.filename).stem}_cutout.png"

    return {"filename": filename, "image": f"data:image/png;base64,{encoded}"}


def ensure_png(image_bytes: bytes) -> bytes:
    """确保 rembg 输出为透明 PNG。"""
    with Image.open(io.BytesIO(image_bytes)) as img:
        rgba = img.convert("RGBA")
        buffer = io.BytesIO()
        rgba.save(buffer, format="PNG")
        return buffer.getvalue()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=True)
