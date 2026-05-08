import os
import json
import time
import uuid
import shutil
from pathlib import Path
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from dotenv import load_dotenv

load_dotenv()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", "/opt/procureai/uploads"))
PORT = int(os.getenv("PORT", "8899"))
MODEL_NAME = "gemini-2.5-flash"
FILES_API_URL = "https://generativelanguage.googleapis.com/upload/v1beta/files"
DB_PATH = UPLOAD_DIR / "files_db.json"

SUPPORTED_MIME_TYPES = [
    "application/pdf",
    "text/plain",
    "text/csv",
    "text/html",
    "text/markdown",
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/heic",
    "image/heif",
]


def load_db():
    if DB_PATH.exists():
        with open(DB_PATH, "r") as f:
            return json.load(f)
    return []


def save_db(files):
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(DB_PATH, "w") as f:
        json.dump(files, f, indent=2)


async def upload_to_gemini(file_path: Path, display_name: str, mime_type: str):
    if not GEMINI_API_KEY:
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY not configured")

    file_size = file_path.stat().st_size

    async with httpx.AsyncClient(timeout=600.0) as client:
        init_resp = await client.post(
            f"{FILES_API_URL}?key={GEMINI_API_KEY}",
            headers={
                "X-Goog-Upload-Protocol": "resumable",
                "X-Goog-Upload-Command": "start",
                "X-Goog-Upload-Header-Content-Length": str(file_size),
                "X-Goog-Upload-Header-Content-Type": mime_type,
                "Content-Type": "application/json",
            },
            json={"file": {"display_name": display_name}},
        )

        if init_resp.status_code != 200:
            raise HTTPException(
                status_code=502,
                detail=f"Gemini upload init failed: {init_resp.text}",
            )

        upload_url = init_resp.headers.get("x-goog-upload-url")
        if not upload_url:
            raise HTTPException(status_code=502, detail="No upload URL from Gemini")

        file_bytes = file_path.read_bytes()
        upload_resp = await client.post(
            upload_url,
            headers={
                "Content-Length": str(file_size),
                "X-Goog-Upload-Offset": "0",
                "X-Goog-Upload-Command": "upload, finalize",
            },
            content=file_bytes,
        )

        if upload_resp.status_code != 200:
            raise HTTPException(
                status_code=502,
                detail=f"Gemini upload finalize failed: {upload_resp.text}",
            )

        result = upload_resp.json()
        return result.get("file", {})


async def delete_from_gemini(file_name: str):
    if not GEMINI_API_KEY or not file_name:
        return
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            await client.delete(
                f"https://generativelanguage.googleapis.com/v1beta/{file_name}?key={GEMINI_API_KEY}"
            )
    except Exception:
        pass


@asynccontextmanager
async def lifespan(app: FastAPI):
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    yield


app = FastAPI(title="ProcureAI Backend", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health():
    return {"status": "ok", "model": MODEL_NAME}


@app.get("/api/files")
async def list_files():
    files = load_db()
    safe = []
    for f in files:
        safe.append({
            "id": f["id"],
            "display_name": f["display_name"],
            "mime_type": f["mime_type"],
            "size_bytes": f["size_bytes"],
            "uploaded_at": f["uploaded_at"],
            "gemini_uri": f.get("gemini_uri", ""),
            "gemini_expiration": f.get("gemini_expiration", ""),
        })
    return {"files": safe}


@app.post("/api/upload")
async def upload_file(file: UploadFile = File(...)):
    if file.content_type not in SUPPORTED_MIME_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f'Format "{file.filename}" ({file.content_type}) tidak didukung Gemini. Gunakan: PDF, TXT, CSV, HTML, MD, atau gambar (PNG/JPG/WebP).',
        )

    file_id = str(uuid.uuid4())
    ext = Path(file.filename or "file").suffix
    local_filename = f"{file_id}{ext}"
    local_path = UPLOAD_DIR / local_filename

    with open(local_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    size_bytes = local_path.stat().st_size

    try:
        uploaded = await upload_to_gemini(local_path, file.filename or "document", file.content_type)
    except Exception:
        local_path.unlink(missing_ok=True)
        raise

    file_info = {
        "id": file_id,
        "display_name": file.filename or "document",
        "mime_type": file.content_type,
        "size_bytes": size_bytes,
        "local_path": str(local_path),
        "gemini_name": uploaded.get("name", ""),
        "gemini_uri": uploaded.get("uri", ""),
        "gemini_expiration": uploaded.get("expirationTime", ""),
        "uploaded_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }

    files = load_db()
    files.append(file_info)
    save_db(files)

    return {
        "id": file_id,
        "display_name": file_info["display_name"],
        "mime_type": file_info["mime_type"],
        "size_bytes": size_bytes,
        "gemini_uri": file_info["gemini_uri"],
        "gemini_expiration": file_info["gemini_expiration"],
        "uploaded_at": file_info["uploaded_at"],
    }


@app.delete("/api/files/{file_id}")
async def delete_file(file_id: str):
    files = load_db()
    target = None
    for f in files:
        if f["id"] == file_id:
            target = f
            break

    if not target:
        raise HTTPException(status_code=404, detail="File not found")

    await delete_from_gemini(target.get("gemini_name", ""))

    local_path = Path(target["local_path"])
    if local_path.exists():
        local_path.unlink()

    files = [f for f in files if f["id"] != file_id]
    save_db(files)
    return {"status": "deleted"}


@app.post("/api/chat")
async def chat(payload: dict):
    user_message = payload.get("message", "")
    if not user_message:
        raise HTTPException(status_code=400, detail="Message is required")

    if not GEMINI_API_KEY:
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY not configured")

    files = load_db()
    updated = False

    for i, f in enumerate(files):
        exp_str = f.get("gemini_expiration", "")
        if not exp_str:
            continue
        try:
            from datetime import datetime
            exp_time = datetime.fromisoformat(exp_str.replace("Z", "+00:00")).timestamp()
            if time.time() >= exp_time:
                local_path = Path(f["local_path"])
                if local_path.exists():
                    uploaded = await upload_to_gemini(
                        local_path, f["display_name"], f["mime_type"]
                    )
                    files[i]["gemini_name"] = uploaded.get("name", "")
                    files[i]["gemini_uri"] = uploaded.get("uri", "")
                    files[i]["gemini_expiration"] = uploaded.get("expirationTime", "")
                    updated = True
        except Exception:
            continue

    if updated:
        save_db(files)

    kb_context = ""
    if files:
        kb_context = f"\nAnda memiliki akses ke {len(files)} dokumen referensi yang sudah di-upload oleh user. Gunakan informasi dari dokumen tersebut untuk menjawab pertanyaan."

    system_prompt = (
        "Anda adalah ahli pengadaan (Procurement Expert) hulu migas Indonesia berdasarkan PTK-007 Revisi 05.\n"
        'Gaya bahasa: Santai, informatif, panggil user "Arief".\n'
        f"Fokus pada solusi yang sesuai aturan hukum dan pedoman SCM.{kb_context}"
    )

    parts = []
    for f in files:
        uri = f.get("gemini_uri", "")
        mime = f.get("mime_type", "")
        if uri:
            parts.append({"fileData": {"fileUri": uri, "mimeType": mime}})

    image_data = payload.get("image_base64")
    image_mime = payload.get("image_mime_type")
    if image_data and image_mime:
        parts.append({"inlineData": {"mimeType": image_mime, "data": image_data}})

    parts.append({"text": user_message})

    request_payload = {
        "contents": [{"role": "user", "parts": parts}],
        "systemInstruction": {"parts": [{"text": system_prompt}]},
    }

    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL_NAME}:generateContent?key={GEMINI_API_KEY}",
            json=request_payload,
            headers={"Content-Type": "application/json"},
        )

    if resp.status_code != 200:
        err = resp.json()
        detail = err.get("error", {}).get("message", "Gagal konek ke Gemini.")
        raise HTTPException(status_code=502, detail=detail)

    data = resp.json()
    answer = (
        data.get("candidates", [{}])[0]
        .get("content", {})
        .get("parts", [{}])[0]
        .get("text", "Maaf Rief, gue agak pusing bacanya. Bisa diulang?")
    )

    return {"response": answer}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT)
