"""Teacher-managed ComfyUI video generation. No local GPU/model is installed here."""

# ruff: noqa: B008
import json
import re
import time
from urllib.parse import urlsplit

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator

from . import seedance
from .db import audit, connect
from .model_service import _cipher


class LocalSettings(BaseModel):
    base_url: str = Field(max_length=500)
    workflow: str = Field(min_length=2, max_length=200000)
    api_key: str = Field(default="", max_length=8192)
    clear_api_key: bool = False

    @field_validator("base_url")
    @classmethod
    def url(cls, value):
        value = value.strip().rstrip("/")
        u = urlsplit(value)
        if (
            u.scheme not in ("http", "https")
            or not u.hostname
            or u.username
            or u.password
            or u.query
            or u.fragment
            or u.path not in ("", "/")
            or "\\" in value
            or any(c.isspace() for c in value)
            or u.hostname.startswith("169.254.")
            or u.hostname in ("metadata.google.internal",)
        ):
            raise ValueError("请填写 ComfyUI 服务根地址，不包含路径或登录信息")
        return value

    @field_validator("api_key")
    @classmethod
    def key(cls, value):
        if value and any(ord(c) < 33 or ord(c) > 126 for c in value):
            raise ValueError("密钥格式无效")
        return value

    @field_validator("workflow")
    @classmethod
    def workflow_json(cls, value):
        obj = json.loads(value)
        if (
            not isinstance(obj, dict)
            or not obj
            or len(obj) > 500
            or "__PROMPT__" not in value
        ):
            raise ValueError("需要含 __PROMPT__ 的 ComfyUI API 工作流")
        if any(
            not isinstance(n, dict)
            or "class_type" not in n
            or not isinstance(n.get("inputs"), dict)
            for n in obj.values()
        ):
            raise ValueError("请导出 API 格式，而非画布工作流格式")
        return value


def headers(key):
    return (
        {"Authorization": "Bearer " + _cipher().decrypt(key.encode()).decode()}
        if key
        else {}
    )


def expand(workflow, body):
    width, height = {"16:9": (832, 480), "9:16": (480, 832), "1:1": (640, 640)}[
        body.ratio
    ]
    values = {
        "__PROMPT__": body.prompt,
        "__DURATION__": body.duration,
        "__FRAMES__": body.duration * 16 + 1,
        "__FPS__": 16,
        "__WIDTH__": width,
        "__HEIGHT__": height,
    }

    def visit(item):
        if isinstance(item, str):
            if item in values:
                return values[item]
            return item.replace("__PROMPT__", body.prompt)
        if isinstance(item, list):
            return [visit(x) for x in item]
        if isinstance(item, dict):
            return {k: visit(v) for k, v in item.items()}
        return item

    return visit(json.loads(workflow))


async def request(base, key, method, path, payload=None):
    async with httpx.AsyncClient(
        timeout=40, trust_env=False, follow_redirects=False
    ) as client:
        response = await client.request(
            method, base + path, headers=headers(key), json=payload
        )
        response.raise_for_status()
        return response.json()


async def poll(row):
    data = await request(
        row["base_url"], row["api_key"], "GET", "/history/" + row["remote_id"]
    )
    entry = data.get(row["remote_id"])
    if not entry:
        if time.time() - row["created"] > 86400:
            raise ValueError("Local task history unavailable after 24 hours")
        return {"status": "running"}
    state = entry.get("status", {})
    if state.get("status_str") == "error":
        return {"status": "failed"}
    if not state.get("completed"):
        return {"status": "running"}
    for output in entry.get("outputs", {}).values():
        for group in ("videos", "gifs", "images"):
            for media in output.get(group, []):
                if str(media.get("filename", "")).lower().endswith(".mp4"):
                    return {"status": "succeeded", "content": {"local_media": media}}
    return {"status": "failed"}


async def download(row, media, destination):
    name = media.get("filename", "")
    subfolder = media.get("subfolder", "")
    if (
        not name
        or any(c in name for c in ("/", "\\"))
        or ".." in subfolder.replace("\\", "/").split("/")
        or subfolder.startswith(("/", "\\"))
        or media.get("type", "output") != "output"
    ):
        raise ValueError("Invalid output filename")
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(".part")
    try:
        async with (
            httpx.AsyncClient(
                timeout=60, trust_env=False, follow_redirects=False
            ) as client,
            client.stream(
                "GET",
                row["base_url"] + "/view",
                headers=headers(row["api_key"]),
                params={"filename": name, "subfolder": subfolder, "type": "output"},
            ) as response,
        ):
            response.raise_for_status()
            if response.status_code != 200:
                raise ValueError("Unexpected video response")
            size = 0
            with temporary.open("wb") as target:
                async for chunk in response.aiter_bytes(262144):
                    size += len(chunk)
                    if size > seedance.MAX_VIDEO_BYTES:
                        raise ValueError("Video too large")
                    target.write(chunk)
        with temporary.open("rb") as source:
            if source.read(12)[4:8] != b"ftyp":
                raise ValueError("Output must be MP4")
        temporary.replace(destination)
        return size
    finally:
        temporary.unlink(missing_ok=True)


def router_for(current_user):
    router = APIRouter(prefix="/api/local-video", tags=["本地视频算力"])

    @router.get("/settings")
    def settings(user=Depends(current_user)):
        with connect() as db:
            row = db.execute(
                "SELECT * FROM local_video_settings WHERE user_id=?", (user["id"],)
            ).fetchone()
        return {
            "base_url": row["base_url"] if row else "",
            "workflow": row["workflow"] if row else "",
            "api_key_configured": bool(row and row["api_key"]),
            "configured": bool(row),
        }

    @router.put("/settings")
    def save(body: LocalSettings, user=Depends(current_user)):
        with connect() as db:
            row = db.execute(
                "SELECT * FROM local_video_settings WHERE user_id=?", (user["id"],)
            ).fetchone()
            key = row["api_key"] if row and row["base_url"] == body.base_url else ""
            if body.clear_api_key:
                key = ""
            elif body.api_key:
                key = _cipher(create=True).encrypt(body.api_key.encode()).decode()
            db.execute(
                "INSERT INTO local_video_settings VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET base_url=excluded.base_url,workflow=excluded.workflow,api_key=excluded.api_key,updated=excluded.updated",
                (user["id"], body.base_url, body.workflow, key, time.time()),
            )
        return settings(user)

    @router.post("/videos", status_code=201)
    async def generate(body: seedance.Generation, user=Depends(current_user)):
        if not body.allow_external:
            raise HTTPException(400, "请确认把描述发送到你配置的本地算力服务")
        vid = body.request_id.hex
        with connect() as db:
            db.execute("BEGIN IMMEDIATE")
            old = db.execute(
                "SELECT user_id FROM generated_videos WHERE id=?", (vid,)
            ).fetchone()
            if old:
                if old[0] != user["id"]:
                    raise HTTPException(409, "请求编号冲突")
                return seedance.owned(vid, user["id"])
            setting = db.execute(
                "SELECT * FROM local_video_settings WHERE user_id=?", (user["id"],)
            ).fetchone()
            if not setting:
                raise HTTPException(400, "请先配置本地 ComfyUI 地址和 API 工作流")
            if (
                db.execute(
                    "SELECT count(*) FROM generated_videos WHERE user_id=? AND status IN ('submitting','queued','running','downloading')",
                    (user["id"],),
                ).fetchone()[0]
                >= 3
            ):
                raise HTTPException(409, "最多同时处理 3 个任务")
            db.execute(
                "INSERT INTO generated_videos(id,user_id,title,prompt,model,ratio,duration,status,api_key,created,updated,provider,base_url) VALUES(?,?,?,?,?,?,?,'submitting',?,?,?,'comfyui',?)",
                (
                    vid,
                    user["id"],
                    body.title,
                    body.prompt,
                    "ComfyUI",
                    body.ratio,
                    body.duration,
                    setting["api_key"],
                    time.time(),
                    time.time(),
                    setting["base_url"],
                ),
            )
        try:
            result = await request(
                setting["base_url"],
                setting["api_key"],
                "POST",
                "/prompt",
                {"prompt": expand(setting["workflow"], body), "client_id": vid},
            )
            remote = result.get("prompt_id", "")
            if not isinstance(remote, str) or not re.fullmatch(
                r"[a-zA-Z0-9_-]{1,200}", remote
            ):
                raise ValueError("No prompt id")
            seedance.update(vid, status="queued", remote_id=remote)
        except Exception:  # noqa: BLE001 - do not expose upstream credentials or workflow
            seedance.update(
                vid,
                status="unknown",
                error="本地工作流提交未获确认，请先查看 ComfyUI 队列与错误，勿重复提交。",
            )
        audit(user["id"], "local_video_generate", vid)
        return seedance.owned(vid, user["id"])

    return router
