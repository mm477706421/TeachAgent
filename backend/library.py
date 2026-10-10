"""An explicitly shared video library, independent of private classroom analyses."""

import math
import shutil
import time
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from starlette.concurrency import run_in_threadpool

from . import config
from .db import audit, connect
from .pipeline import probe_media

MIME = {
    ".mp4": "video/mp4",
    ".m4v": "video/mp4",
    ".mov": "video/quicktime",
    ".webm": "video/webm",
    ".mkv": "video/x-matroska",
    ".avi": "video/x-msvideo",
}


def directory(user_id, video_id):
    return config.DATA / "users" / user_id / "shared-videos" / video_id


def router_for(current_user):
    router = APIRouter(prefix="/api/library", tags=["共享视频库"])

    @router.get("")
    def listing(
        q: str = Query("", max_length=120),
        mine: bool = False,
        offset: int = Query(0, ge=0),
        user=Depends(current_user),
    ):
        params = []
        where = []
        if mine:
            where.append("v.user_id=?")
            params.append(user["id"])
        if q.strip():
            # Literal substring matching, without SQL LIKE wildcard surprises.
            where.append(
                "(instr(lower(v.title || ' ' || v.subject || ' ' || u.name),lower(?))>0)"
            )
            params.append(q.strip())
        source = " FROM library_videos v JOIN users u ON u.id=v.user_id"
        if where:
            source += " WHERE " + " AND ".join(where)
        with connect() as db:
            total = db.execute("SELECT COUNT(*)" + source, params).fetchone()[0]
            rows = db.execute(
                "SELECT v.*,u.name AS owner_name"
                + source
                + " ORDER BY v.created DESC,v.id DESC LIMIT 12 OFFSET ?",
                [*params, offset],
            ).fetchall()
        return {"items": [dict(row) for row in rows], "total": total, "page_size": 12}

    @router.post("/upload", status_code=201)
    async def upload(
        title: str = Form(..., min_length=1, max_length=120),
        subject: str = Form("综合", max_length=40),
        description: str = Form("", max_length=2000),
        allow_school_share: bool = Form(False),
        file: UploadFile = File(...),
        user=Depends(current_user),
    ):
        folder = None
        saved = False
        try:
            if not allow_school_share:
                raise HTTPException(
                    400, "请确认将该视频共享给本校所有已登录教师浏览和下载"
                )
            if not title.strip():
                raise HTTPException(400, "请填写视频名称")
            filename = Path((file.filename or "").replace("\\", "/")).name
            if (
                Path(filename).suffix.lower() not in MIME
                or len(filename) > 240
                or any(ord(ch) < 32 for ch in filename)
            ):
                raise HTTPException(400, "请选择 MP4、MOV、MKV、AVI、WebM 或 M4V 视频")
            video_id = uuid.uuid4().hex
            folder = config.DATA / "library-uploads" / video_id
            folder.mkdir(parents=True)
            path = folder / "source.video"
            size = 0
            with path.open("wb") as target:
                while chunk := await file.read(1024 * 1024):
                    size += len(chunk)
                    if size > config.MAX_UPLOAD:
                        raise HTTPException(413, "视频超过服务器上传大小限制")
                    target.write(chunk)
            if not size:
                raise HTTPException(400, "视频文件为空")
            with path.open("rb") as source:
                header = source.read(16)
            # Do not pass disguised playlists or webpages to a media resolver.
            recognized = (
                header.startswith(b"\x1a\x45\xdf\xa3")
                or (header[:4] == b"RIFF" and header[8:12] == b"AVI ")
                or header[4:8] in {b"ftyp", b"moov", b"mdat", b"wide", b"free", b"skip"}
            )
            if not recognized:
                raise HTTPException(400, "文件内容不是受支持的视频，请选择真实视频文件")
            try:
                info = await run_in_threadpool(probe_media, path)
                duration = float(info["format"]["duration"])
                if not any(
                    stream.get("codec_type") == "video" for stream in info["streams"]
                ):
                    raise ValueError()
                if not math.isfinite(duration) or not 0 < duration <= 21600:
                    raise ValueError()
            except Exception:
                raise HTTPException(
                    400,
                    "无法验证视频，请使用未损坏、时长不超过 6 小时的视频；若持续失败，请联系管理员检查媒体工具。",
                ) from None
            created = time.time()
            destination = directory(user["id"], video_id)
            destination.parent.mkdir(parents=True, exist_ok=True)
            folder.rename(destination)
            folder = destination
            with connect() as db:
                db.execute(
                    "INSERT INTO library_videos VALUES(?,?,?,?,?,?,?,?,?)",
                    (
                        video_id,
                        user["id"],
                        title.strip(),
                        subject.strip() or "综合",
                        description.strip(),
                        filename,
                        size,
                        duration,
                        created,
                    ),
                )
                db.execute(
                    "INSERT INTO audit(actor,action,target,created) VALUES(?,?,?,?)",
                    (user["id"], "share_video", video_id, created),
                )
            saved = True
            return {"id": video_id, "title": title.strip(), "filename": filename}
        finally:
            await file.close()
            if folder is not None and not saved:
                shutil.rmtree(folder, ignore_errors=True)

    def get_video(video_id):
        with connect() as db:
            row = db.execute(
                "SELECT * FROM library_videos WHERE id=?", (video_id,)
            ).fetchone()
        if not row:
            raise HTTPException(404, "共享视频不存在或已被删除")
        return row

    @router.get("/{video_id}/media")
    def media(video_id: str, download: bool = False, user=Depends(current_user)):
        row = get_video(video_id)
        path = directory(row["user_id"], row["id"]) / "source.video"
        if not path.is_file():
            raise HTTPException(404, "视频文件不可用，请联系上传者或管理员")
        return FileResponse(
            path,
            media_type=MIME.get(Path(row["filename"]).suffix.lower(), "video/mp4"),
            filename=row["filename"] if download else None,
        )

    @router.delete("/{video_id}")
    def remove(video_id: str, user=Depends(current_user)):
        row = get_video(video_id)
        if row["user_id"] != user["id"] and user["role"] != "admin":
            raise HTTPException(403, "只能删除自己上传的共享视频")
        # A failed filesystem delete keeps the visible entry available for retry.
        folder = directory(row["user_id"], row["id"])
        if folder.exists():
            try:
                shutil.rmtree(folder)
            except OSError:
                raise HTTPException(
                    409, "视频正在使用或文件无法删除，请稍后重试"
                ) from None
        with connect() as db:
            db.execute("DELETE FROM library_videos WHERE id=?", (video_id,))
        audit(user["id"], "delete_shared_video", video_id)
        return {"ok": True}

    return router
