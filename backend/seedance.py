"""Account-scoped Ark Seedance tasks with durable polling and local video storage."""
# FastAPI resolves these dependency defaults rather than evaluating them per call.
# ruff: noqa: B008

import asyncio
import contextlib
import ipaddress
import logging
import re
import shutil
import socket
import time
import uuid
from typing import Literal
from urllib.parse import urlsplit

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator

from . import config
from .db import audit, connect
from .model_service import _cipher

ENDPOINT = "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks"
ACTIVE = {"submitting", "queued", "running", "downloading"}
PUBLIC = "id,user_id,title,prompt,model,ratio,duration,status,remote_id,error,size,created,updated,provider"
MAX_VIDEO_BYTES = 512 * 1024 * 1024


class Settings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    model: str = Field(default="", max_length=160, pattern=r"^[a-zA-Z0-9._-]*$")
    api_key: SecretStr | None = None
    clear_api_key: bool = False

    @field_validator("api_key")
    @classmethod
    def valid_key(cls, value):
        if value is not None:
            raw = value.get_secret_value()
            if len(raw) > 8192 or any(ord(c) < 33 or ord(c) > 126 for c in raw):
                raise ValueError("API Key 格式无效")
        return value


class Generation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: uuid.UUID
    title: str = Field(min_length=1, max_length=120)
    prompt: str = Field(min_length=10, max_length=4000)
    ratio: Literal["16:9", "9:16", "1:1"] = "16:9"
    duration: Literal[5, 10] = 5
    allow_external: bool = False

    @field_validator("title", "prompt")
    @classmethod
    def trim(cls, value):
        value = value.strip()
        if not value or any(ord(c) < 32 and c not in "\n\t" for c in value):
            raise ValueError("内容不能为空或包含控制字符")
        return value


class Rename(BaseModel):
    title: str = Field(min_length=1, max_length=120)


def folder(user_id, video_id):
    return config.DATA / "users" / user_id / "generated-videos" / video_id


def owned(video_id, user_id, private=False):
    with connect() as db:
        row = db.execute(
            f"SELECT {'*' if private else PUBLIC} FROM generated_videos WHERE id=? AND user_id=?",
            (video_id, user_id),
        ).fetchone()
    if row is None:
        raise HTTPException(404, "生成视频不存在")
    return dict(row)


def update(video_id, **values):
    values["updated"] = time.time()
    with connect() as db:
        db.execute(
            "UPDATE generated_videos SET "
            + ",".join(f"{k}=?" for k in values)
            + " WHERE id=?",
            [*values.values(), video_id],
        )


async def provider(method, encrypted, remote_id="", payload=None):
    if remote_id and not re.fullmatch(r"[A-Za-z0-9_-]{1,200}", remote_id):
        raise ValueError("Invalid remote task identifier")
    raw = _cipher().decrypt(encrypted.encode()).decode()
    async with httpx.AsyncClient(
        timeout=40, follow_redirects=False, trust_env=False
    ) as client:
        response = await client.request(
            method,
            ENDPOINT + ("/" + remote_id if remote_id else ""),
            headers={"Authorization": "Bearer " + raw},
            json=payload,
        )
        response.raise_for_status()
        return response.json()


def provider_error(exc):
    # Upstream bodies/URLs can echo prompts, signed media URLs or credentials.
    if isinstance(exc, httpx.HTTPStatusError):
        code = exc.response.status_code
        if code in (401, 403):
            return "Seedance 鉴权失败，请检查 API Key、模型权限和地域。"
        if code == 429:
            return "Seedance 请求限流或额度不足，请检查方舟控制台。"
        if code == 400:
            return "Seedance 拒绝了参数，请检查模型是否支持所选时长和比例。"
    return "暂时无法连接 Seedance，请检查网络或方舟控制台任务状态。"


async def download_media(url, destination):
    parsed = urlsplit(url)
    hostname = parsed.hostname or ""
    if (
        parsed.scheme != "https"
        or parsed.username
        or parsed.password
        or parsed.port not in (None, 443)
        or "\\" in url
        or not any(
            hostname.endswith("." + suffix)
            for suffix in (
                "volces.com",
                "volccdn.com",
                "byteimg.com",
                "bytecdn.cn",
                "ibytedtos.com",
            )
        )
    ):
        raise ValueError("Unsupported Seedance media host")
    addresses = await asyncio.to_thread(socket.getaddrinfo, hostname, 443)
    if not addresses or any(
        not ipaddress.ip_address(a[4][0]).is_global for a in addresses
    ):
        raise ValueError("Non-public media host")
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(".part")
    try:
        async with (
            httpx.AsyncClient(
                timeout=60, follow_redirects=False, trust_env=False
            ) as client,
            client.stream("GET", url) as response,
        ):
            response.raise_for_status()
            if response.status_code != 200:
                raise ValueError("Media download was redirected or partial")
            length = int(response.headers.get("content-length", "0"))
            if length > MAX_VIDEO_BYTES:
                raise ValueError("Video too large")
            size = 0
            with temporary.open("wb") as output:
                async for chunk in response.aiter_bytes(1024 * 256):
                    size += len(chunk)
                    if size > MAX_VIDEO_BYTES:
                        raise ValueError("Video too large")
                    output.write(chunk)
        with temporary.open("rb") as source:
            header = source.read(32)
        if size < 12 or header[4:8] != b"ftyp":
            raise ValueError("Provider did not return MP4")
        temporary.replace(destination)
        return size
    finally:
        temporary.unlink(missing_ok=True)


async def refresh_task(row):
    # Historical media stays accessible; retired providers must never reach Seedance.
    if row.get("provider", "seedance") != "seedance":
        return
    try:
        data = await provider("GET", row["api_key"], row["remote_id"])
        status = data.get("status")
        if status in ("queued", "running"):
            update(row["id"], status=status, error="")
        elif status == "succeeded":
            update(row["id"], status="downloading", error="")
            try:
                size = await asyncio.wait_for(
                    download_media(
                        data["content"]["video_url"],
                        folder(row["user_id"], row["id"]) / "video.mp4",
                    ),
                    timeout=300,
                )
            except Exception:  # noqa: BLE001 - redact signed URLs and filesystem errors
                update(
                    row["id"],
                    status="download_failed",
                    error="成片下载失败；可重试下载，不会重新生成或重复计费。",
                )
            else:
                update(row["id"], status="succeeded", size=size, error="", api_key="")
        elif status in ("failed", "cancelled", "expired"):
            update(
                row["id"],
                status="failed",
                error="云端任务失败、取消或已过期，请在方舟控制台查看原因。",
                api_key="",
            )
        else:
            update(row["id"], error="云端状态暂不可识别，稍后自动重查。")
    except Exception as exc:  # noqa: BLE001 - never persist upstream exception bodies
        pause = (
            isinstance(exc, httpx.HTTPStatusError)
            and exc.response.status_code in (400, 401, 403, 404)
        ) or time.time() - row["created"] > 86400
        update(
            row["id"],
            **({"status": "attention"} if pause else {}),
            error=provider_error(exc)
            + (" 自动查询已暂停；修正设置后可重新查询原任务。" if pause else ""),
        )


async def worker():
    while True:
        try:
            with connect() as db:
                rows = db.execute(
                    "SELECT * FROM generated_videos WHERE provider='seedance' AND status IN ('queued','running','downloading') ORDER BY updated LIMIT 4"
                ).fetchall()
            await asyncio.gather(*(refresh_task(dict(row)) for row in rows))
        except Exception as exc:  # noqa: BLE001 - durable queue must survive transient faults
            # Keep the durable queue alive after a transient database/network failure.
            logging.getLogger(__name__).warning(
                "Seedance queue iteration failed (%s)", type(exc).__name__
            )
        await asyncio.sleep(15)


@contextlib.asynccontextmanager
async def lifecycle():
    with connect() as db:
        db.execute(
            "UPDATE generated_videos SET status='unknown',error='提交时服务中断，是否计费未知。请先核对方舟控制台，勿直接重复生成。' WHERE provider='seedance' AND status='submitting'"
        )
        db.execute(
            "UPDATE generated_videos SET status='failed', api_key='', "
            "error='原视频生成服务已停用，请使用 Seedance 创建新任务。' "
            "WHERE provider != 'seedance' AND status NOT IN ('succeeded','failed')"
        )
    task = asyncio.create_task(worker())
    try:
        yield
    finally:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task


def router_for(current_user):
    router = APIRouter(prefix="/api/seedance", tags=["教学视频生成"])

    @router.get("/settings")
    def settings(user=Depends(current_user)):
        with connect() as db:
            row = db.execute(
                "SELECT * FROM seedance_settings WHERE user_id=?", (user["id"],)
            ).fetchone()
        return {
            "model": row["model"] if row else "",
            "api_key_configured": bool(row and row["api_key"]),
            "endpoint": ENDPOINT,
        }

    @router.put("/settings")
    def save_settings(body: Settings, user=Depends(current_user)):
        with connect() as db:
            previous = db.execute(
                "SELECT api_key FROM seedance_settings WHERE user_id=?", (user["id"],)
            ).fetchone()
            encrypted = previous[0] if previous else ""
            if body.clear_api_key:
                encrypted = ""
            elif body.api_key and body.api_key.get_secret_value():
                encrypted = (
                    _cipher(create=True)
                    .encrypt(body.api_key.get_secret_value().encode())
                    .decode()
                )
            db.execute(
                "INSERT INTO seedance_settings VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET model=excluded.model,api_key=excluded.api_key,updated=excluded.updated",
                (user["id"], body.model, encrypted, time.time()),
            )
        audit(user["id"], "seedance_settings", user["id"])
        return settings(user)

    @router.post("/settings/verify-and-save")
    async def verify_settings(body: Settings, user=Depends(current_user)):
        if body.clear_api_key or not body.model.strip():
            raise HTTPException(400, "请填写 Seedance 模型 ID 和 API Key 后测试")
        raw = body.api_key.get_secret_value() if body.api_key else ""
        if not raw:
            with connect() as db:
                row = db.execute(
                    "SELECT api_key FROM seedance_settings WHERE user_id=?",
                    (user["id"],),
                ).fetchone()
            if not row or not row[0]:
                raise HTTPException(400, "请先填写 Seedance API Key")
            raw = _cipher().decrypt(row[0].encode()).decode()
        # Listing checks authorization without submitting a paid generation task.
        try:
            async with httpx.AsyncClient(
                timeout=20, follow_redirects=False, trust_env=False
            ) as client:
                response = await client.get(
                    ENDPOINT,
                    params={"page_size": 1},
                    headers={"Authorization": "Bearer " + raw},
                )
                response.raise_for_status()
                data = response.json()
                if (
                    not isinstance(data, dict)
                    or data.get("error")
                    or not isinstance(data.get("items"), list)
                ):
                    raise TypeError("Invalid task listing")
        except Exception as exc:  # noqa: BLE001 - never expose provider bodies or credentials
            raise HTTPException(502, provider_error(exc)) from None
        # Persist the exact key that passed verification, not a later edited credential.
        return save_settings(Settings(model=body.model.strip(), api_key=raw), user)

    @router.get("/videos")
    def listing(
        q: str = Query("", max_length=120),
        offset: int = Query(0, ge=0),
        user=Depends(current_user),
    ):
        with connect() as db:
            params = (user["id"], q.strip())
            where = " FROM generated_videos WHERE user_id=? AND instr(lower(title || ' ' || prompt),lower(?))>0"
            total = db.execute("SELECT count(*)" + where, params).fetchone()[0]
            rows = db.execute(
                "SELECT "
                + PUBLIC
                + where
                + " ORDER BY created DESC,id DESC LIMIT 12 OFFSET ?",
                (*params, offset),
            ).fetchall()
        return {"items": [dict(r) for r in rows], "total": total}

    @router.post("/videos", status_code=201)
    async def create(body: Generation, user=Depends(current_user)):
        if not body.allow_external:
            raise HTTPException(400, "请确认向 Seedance 发送提示词并承担供应商生成费用")
        video_id = body.request_id.hex
        with connect() as db:
            db.execute("BEGIN IMMEDIATE")
            existing = db.execute(
                "SELECT user_id,provider FROM generated_videos WHERE id=?", (video_id,)
            ).fetchone()
            if existing:
                if existing[0] != user["id"] or existing[1] != "seedance":
                    raise HTTPException(409, "请求编号冲突，请刷新重试")
                return owned(video_id, user["id"])
            setting = db.execute(
                "SELECT * FROM seedance_settings WHERE user_id=?", (user["id"],)
            ).fetchone()
            if not setting or not setting["model"] or not setting["api_key"]:
                raise HTTPException(400, "请先保存 Seedance 模型 ID 和 API Key")
            count = db.execute(
                "SELECT count(*) FROM generated_videos WHERE user_id=? AND status IN ('submitting','queued','running','downloading')",
                (user["id"],),
            ).fetchone()[0]
            if count >= 3:
                raise HTTPException(409, "最多同时生成 3 个视频，请等待已有任务完成")
            db.execute(
                "INSERT INTO generated_videos(id,user_id,title,prompt,model,ratio,duration,status,api_key,created,updated) VALUES(?,?,?,?,?,?,?,'submitting',?,?,?)",
                (
                    video_id,
                    user["id"],
                    body.title,
                    body.prompt,
                    setting["model"],
                    body.ratio,
                    body.duration,
                    setting["api_key"],
                    time.time(),
                    time.time(),
                ),
            )
        try:
            result = await provider(
                "POST",
                setting["api_key"],
                payload={
                    "model": setting["model"],
                    "content": [{"type": "text", "text": body.prompt}],
                    "ratio": body.ratio,
                    "duration": body.duration,
                    "watermark": True,
                },
            )
            remote_id = result.get("id", "")
            if not isinstance(remote_id, str) or not re.fullmatch(
                r"[A-Za-z0-9_-]{1,200}", remote_id
            ):
                raise ValueError("Missing task id")
            update(video_id, remote_id=remote_id, status="queued")
        except Exception as exc:  # noqa: BLE001 - uncertain submission must never be retried automatically
            rejected = (
                isinstance(exc, httpx.HTTPStatusError)
                and 400 <= exc.response.status_code < 500
                and exc.response.status_code != 408
            )
            update(
                video_id,
                status="failed" if rejected else "unknown",
                error=provider_error(exc)
                + (
                    ""
                    if rejected
                    else " 提交结果未知，请核对方舟控制台，勿直接重复生成。"
                ),
            )
        audit(user["id"], "seedance_generate", video_id)
        return owned(video_id, user["id"])

    @router.post("/videos/{video_id}/retry-download")
    def retry(video_id: str, user=Depends(current_user)):
        with connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute(
                "SELECT * FROM generated_videos WHERE id=? AND user_id=?",
                (video_id, user["id"]),
            ).fetchone()
            if row and row["provider"] != "seedance":
                raise HTTPException(409, "原视频生成服务已停用；已保存的成片仍可下载")
            if row and row["status"] == "attention":
                setting = db.execute(
                    "SELECT api_key FROM seedance_settings WHERE user_id=?",
                    (user["id"],),
                ).fetchone()
                if not setting or not setting[0]:
                    raise HTTPException(400, "请先配置有效的 Seedance 凭据")
                db.execute(
                    "UPDATE generated_videos SET api_key=? WHERE id=?",
                    (setting[0], video_id),
                )
            cursor = db.execute(
                "UPDATE generated_videos SET status='queued',error='',updated=? WHERE id=? AND user_id=? AND status IN ('download_failed','attention')",
                (time.time(), video_id, user["id"]),
            )
            if cursor.rowcount != 1:
                raise HTTPException(409, "仅下载失败或查询暂停的任务可以重新查询")
        return owned(video_id, user["id"])

    @router.get("/videos/{video_id}/media")
    def media(video_id: str, download: bool = False, user=Depends(current_user)):
        row = owned(video_id, user["id"])
        path = folder(user["id"], video_id) / "video.mp4"
        if row["status"] != "succeeded" or not path.is_file():
            raise HTTPException(404, "成片尚未保存到本地")
        filename = re.sub(r'[\\/:*?"<>|\x00-\x1f]', "_", row["title"]) + ".mp4"
        return FileResponse(
            path,
            media_type="video/mp4",
            filename=filename,
            content_disposition_type="attachment" if download else "inline",
        )

    @router.patch("/videos/{video_id}")
    def rename(video_id: str, body: Rename, user=Depends(current_user)):
        owned(video_id, user["id"])
        if not body.title.strip():
            raise HTTPException(400, "名称不能为空")
        update(video_id, title=body.title.strip())
        return owned(video_id, user["id"])

    @router.delete("/videos/{video_id}")
    def delete(video_id: str, user=Depends(current_user)):
        with connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute(
                "SELECT status FROM generated_videos WHERE id=? AND user_id=?",
                (video_id, user["id"]),
            ).fetchone()
            if not row:
                raise HTTPException(404, "生成视频不存在")
            if row[0] in ACTIVE:
                raise HTTPException(409, "任务进行中，请完成后再删除")
            shutil.rmtree(folder(user["id"], video_id), ignore_errors=True)
            db.execute(
                "DELETE FROM generated_videos WHERE id=? AND user_id=?",
                (video_id, user["id"]),
            )
        audit(user["id"], "seedance_delete", video_id)
        return {"ok": True}

    return router
