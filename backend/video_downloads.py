"""Private URL downloads with public-IP pinning, bounded redirects and media validation."""

# ruff: noqa: B008
import asyncio
import contextlib
import http.client
import ipaddress
import math
import shutil
import socket
import ssl
import time
import uuid
from html.parser import HTMLParser
from urllib.parse import quote, urljoin, urlsplit

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from . import config
from .db import audit, connect
from .model_service import _cipher
from .pipeline import probe_media

LIMIT = 1024 * 1024 * 1024
PUBLIC = "id,title,status,size,error,created"


def folder(user, vid):
    return config.DATA / "users" / user / "video-downloads" / vid


def validate_url(url):
    p = urlsplit(url)
    if (
        p.scheme not in ("http", "https")
        or not p.hostname
        or p.username
        or p.password
        or "\\" in url
        or any(ord(c) < 33 for c in url)
    ):
        raise ValueError("仅支持不含登录信息的 HTTP/HTTPS 视频地址")
    return p


def open_public(url):
    p = validate_url(url)
    port = p.port or (443 if p.scheme == "https" else 80)
    addresses = socket.getaddrinfo(p.hostname, port, type=socket.SOCK_STREAM)
    if not addresses or any(
        not ipaddress.ip_address(a[4][0]).is_global for a in addresses
    ):
        raise ValueError(
            "网址下载不允许访问本机、内网或云元数据地址；内网资源请使用共享视频库上传"
        )
    # Connect to the validated IP, retain the original hostname for HTTP Host and TLS.
    connection = http.client.HTTPConnection(p.hostname, port, timeout=20)
    try:
        connection.sock = socket.create_connection(
            (addresses[0][4][0], port), timeout=20
        )
        if p.scheme == "https":
            connection.sock = ssl.create_default_context().wrap_socket(
                connection.sock, server_hostname=p.hostname
            )
        connection.request(
            "GET",
            quote(p.path or "/", safe="/%:@")
            + ("?" + quote(p.query, safe="=&%/:?@,+;") if p.query else ""),
            headers={"User-Agent": "TeachAgent/1.6", "Accept-Encoding": "identity"},
        )
        return connection, connection.getresponse()
    except BaseException:
        connection.close()
        raise


class VideoHTML(HTMLParser):
    def __init__(self):
        super().__init__()
        self.urls = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag in ("video", "source") and attrs.get("src"):
            self.urls.append(attrs["src"])
        if (
            tag == "meta"
            and attrs.get("property")
            in ("og:video", "og:video:url", "og:video:secure_url")
            and attrs.get("content")
        ):
            self.urls.append(attrs["content"])


def fetch_video(url, target, progress):
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix(".part")
    deadline = time.monotonic() + 600
    parsed_page = False
    try:
        for _ in range(6):
            connection, response = open_public(url)
            try:
                if response.status in (301, 302, 303, 307, 308):
                    location = response.getheader("location")
                    if not location:
                        raise ValueError("重定向地址无效")
                    url = urljoin(url, location)
                    continue
                if response.status != 200:
                    raise ValueError("视频站点未允许下载，请检查链接是否公开或已过期")
                if "text/html" in response.getheader("content-type", "").lower():
                    if parsed_page:
                        raise ValueError(
                            "页面未提供可下载视频，请复制实际 MP4 或 WebM 地址"
                        )
                    content = response.read(1024 * 1024 + 1)
                    if len(content) > 1024 * 1024:
                        raise ValueError("页面过大，请提供视频直链")
                    parser = VideoHTML()
                    parser.feed(content.decode("utf-8", errors="replace"))
                    if not parser.urls:
                        raise ValueError(
                            "页面需要登录、脚本或平台解析，请提供公开 MP4/WebM 直链"
                        )
                    url = urljoin(url, parser.urls[0])
                    parsed_page = True
                    continue
                if int(response.getheader("content-length", "0")) > LIMIT:
                    raise ValueError("视频超过 1 GiB 限制")
                size = 0
                with temporary.open("wb") as output:
                    while True:
                        if time.monotonic() > deadline:
                            raise ValueError("下载超时，请使用较小的视频")
                        chunk = response.read(262144)
                        if not chunk:
                            break
                        size += len(chunk)
                        if size > LIMIT:
                            raise ValueError("视频超过 1 GiB 限制")
                        output.write(chunk)
                        progress(size)
                with temporary.open("rb") as stream:
                    head = stream.read(16)
                if head[4:8] != b"ftyp" and not head.startswith(b"\x1aE\xdf\xa3"):
                    raise ValueError("地址返回的不是 MP4/WebM 视频")
                info = probe_media(temporary)
                duration = float(info["format"]["duration"])
                if (
                    not math.isfinite(duration)
                    or not 0 < duration <= 21600
                    or not any(s.get("codec_type") == "video" for s in info["streams"])
                ):
                    raise ValueError("无法验证视频或视频超过 6 小时")
                temporary.replace(target)
                return size
            finally:
                connection.close()
        raise ValueError("重定向次数过多，请提供最终视频地址")
    finally:
        temporary.unlink(missing_ok=True)


def process(row):
    def progress(size):
        with connect() as db:
            db.execute(
                "UPDATE video_downloads SET size=? WHERE id=?", (size, row["id"])
            )

    try:
        url = _cipher().decrypt(row["source"].encode()).decode()
        size = fetch_video(
            url, folder(row["user_id"], row["id"]) / "source.video", progress
        )
        status, error = "completed", ""
    except Exception as exc:  # noqa: BLE001 - upstream URLs and errors may contain signed tokens
        size = 0
        status = "failed"
        error = (
            str(exc)
            if isinstance(exc, ValueError)
            and str(exc).startswith(
                ("视频", "地址", "页面", "仅支持", "网址", "重定向", "下载", "无法")
            )
            else "下载失败，请检查公开链接、服务器网络与磁盘空间。"
        )
    with connect() as db:
        db.execute(
            "UPDATE video_downloads SET status=?,error=?,size=?,source='' WHERE id=?",
            (status, error, size, row["id"]),
        )


async def worker():
    while True:
        with connect() as db:
            row = db.execute(
                "SELECT * FROM video_downloads WHERE status='queued' ORDER BY created LIMIT 1"
            ).fetchone()
            if row:
                db.execute(
                    "UPDATE video_downloads SET status='downloading' WHERE id=?",
                    (row["id"],),
                )
        if row:
            await asyncio.to_thread(process, dict(row))
        await asyncio.sleep(2)


@contextlib.asynccontextmanager
async def lifecycle():
    with connect() as db:
        db.execute(
            "UPDATE video_downloads SET status='failed',error='服务重启中断下载，请重新提交网址',source='' WHERE status='downloading'"
        )
    task = asyncio.create_task(worker())
    try:
        yield
    finally:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task


class Download(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    url: str = Field(min_length=8, max_length=4096)
    allow_download: bool = False


def router_for(current_user):
    router = APIRouter(prefix="/api/video-downloads", tags=["网址下载"])

    @router.get("")
    def listing(user=Depends(current_user)):
        with connect() as db:
            return [
                dict(r)
                for r in db.execute(
                    "SELECT "
                    + PUBLIC
                    + " FROM video_downloads WHERE user_id=? ORDER BY created DESC LIMIT 100",
                    (user["id"],),
                )
            ]

    @router.post("", status_code=201)
    def create(body: Download, user=Depends(current_user)):
        if not body.allow_download:
            raise HTTPException(400, "请确认有权下载该视频")
        try:
            validate_url(body.url)
        except ValueError:
            raise HTTPException(400, "请提供有效的 HTTP/HTTPS 公开视频地址") from None
        if not body.title.strip():
            raise HTTPException(400, "请填写名称")
        vid = uuid.uuid4().hex
        with connect() as db:
            db.execute("BEGIN IMMEDIATE")
            if (
                db.execute(
                    "SELECT count(*) FROM video_downloads WHERE user_id=? AND status IN ('queued','downloading')",
                    (user["id"],),
                ).fetchone()[0]
                >= 3
            ):
                raise HTTPException(409, "最多同时提交 3 个下载任务")
            secret = _cipher(create=True).encrypt(body.url.encode()).decode()
            db.execute(
                "INSERT INTO video_downloads(id,user_id,title,source,status,created) VALUES(?,?,?,?,'queued',?)",
                (vid, user["id"], body.title.strip(), secret, time.time()),
            )
        audit(user["id"], "url_video_download", vid)
        return {"id": vid, "status": "queued"}

    def owned(vid, user):
        with connect() as db:
            row = db.execute(
                "SELECT * FROM video_downloads WHERE id=? AND user_id=?",
                (vid, user["id"]),
            ).fetchone()
        if not row:
            raise HTTPException(404, "下载记录不存在")
        return row

    @router.get("/{vid}/media")
    def media(vid: str, download: bool = True, user=Depends(current_user)):
        row = owned(vid, user)
        path = folder(user["id"], vid) / "source.video"
        if row["status"] != "completed" or not path.exists():
            raise HTTPException(404, "视频尚未下载完成")
        with path.open("rb") as f:
            webm = f.read(4) == b"\x1aE\xdf\xa3"
        return FileResponse(
            path,
            media_type="video/webm" if webm else "video/mp4",
            filename="教学视频-" + vid[:8] + (".webm" if webm else ".mp4"),
            content_disposition_type="attachment" if download else "inline",
        )

    @router.delete("/{vid}")
    def delete(vid: str, user=Depends(current_user)):
        with connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = owned(vid, user)
            if row["status"] in ("queued", "downloading"):
                raise HTTPException(409, "下载进行中，请完成后再删除")
            shutil.rmtree(folder(user["id"], vid), ignore_errors=True)
            db.execute(
                "DELETE FROM video_downloads WHERE id=? AND user_id=?",
                (vid, user["id"]),
            )
        return {"ok": True}

    return router
