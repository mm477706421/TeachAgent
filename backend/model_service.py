"""Per-account model configuration and explicit OpenAI-compatible text requests."""

import asyncio
import ipaddress
import json
import os
import threading
import time
from typing import Literal
from urllib.parse import urlsplit, urlunsplit

import httpx
from cryptography.fernet import Fernet, InvalidToken
from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator

from . import config
from .db import connect

_key_lock = threading.Lock()
PRESETS = {
    item["id"]: item
    for item in json.loads(
        (config.ROOT / "frontend/src/model-presets.json").read_text(encoding="utf-8")
    )
}


class ModelSettingsInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    provider: Literal["local", "rules", "openai"] = "local"
    preset_id: str = Field(default="custom", max_length=40)
    base_url: str = Field(default="https://api.openai.com/v1", max_length=2048)
    model: str = Field(default="", max_length=200)
    api_key: SecretStr | None = None
    clear_api_key: bool = False
    allow_external: bool = False
    timeout_seconds: int = Field(default=60, ge=5, le=120)
    temperature: float = Field(default=0.3, ge=0, le=2, allow_inf_nan=False)
    max_tokens: int = Field(default=900, ge=128, le=4096)

    @field_validator("preset_id")
    @classmethod
    def valid_preset(cls, value):
        if value != "custom" and value not in PRESETS:
            raise ValueError("未知模型预设")
        return value

    @field_validator("api_key")
    @classmethod
    def valid_key(cls, value):
        if value is not None:
            raw = value.get_secret_value()
            if len(raw) > 8192 or any(ord(c) < 32 or ord(c) > 126 for c in raw):
                raise ValueError("API Key 格式无效")
        return value


class ModelError(Exception):
    def __init__(self, message, status=502):
        super().__init__(message)
        self.status = status


def normalize_base_url(value):
    value = value.strip().rstrip("/")
    try:
        url = urlsplit(value)
        port = url.port
        if (
            not url.hostname
            or url.username
            or url.password
            or url.query
            or url.fragment
        ):
            raise ValueError()
        if any(c.isspace() or ord(c) < 32 for c in value) or "\\" in value:
            raise ValueError()
        if url.scheme not in {"http", "https"}:
            raise ValueError()
        if port is not None and port < 1:
            raise ValueError()
        path = url.path.rstrip("/")
        if path.endswith("/chat/completions"):
            path = path[: -len("/chat/completions")]
        return urlunsplit((url.scheme, url.netloc.lower(), path, "", ""))
    except ValueError as exc:
        raise ModelError(
            "Base URL 需要 HTTP 或 HTTPS 地址，且不能包含账号、查询参数或片段。",
            400,
        ) from exc


def _cipher(create=False):
    path = config.DATA / "model-settings.key"
    with _key_lock:
        if not path.exists():
            if not create:
                raise ModelError(
                    "本地密钥文件缺失，请恢复 model-settings.key 或清除已保存的 API Key 后重新配置。",
                    409,
                )
            config.DATA.mkdir(parents=True, exist_ok=True)
            try:
                fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                with os.fdopen(fd, "wb") as f:
                    f.write(Fernet.generate_key())
            except FileExistsError:
                pass
        try:
            return Fernet(path.read_bytes())
        except (ValueError, OSError) as exc:
            raise ModelError("本地模型密钥文件不可用，请联系管理员恢复。", 409) from exc


def _read(user_id):
    with connect() as db:
        row = db.execute(
            "SELECT * FROM model_settings WHERE user_id=?", (user_id,)
        ).fetchone()
    defaults = ModelSettingsInput().model_dump(exclude={"api_key", "clear_api_key"})
    return (
        ({**defaults, **json.loads(row["settings"])}, row["api_key"])
        if row
        else (defaults, "")
    )


def public_profiles(user_id):
    with connect() as db:
        rows = db.execute(
            "SELECT settings,api_key FROM model_profiles WHERE user_id=?", (user_id,)
        ).fetchall()
    return [
        {
            **json.loads(row["settings"]),
            "api_key_configured": bool(row["api_key"]),
            "local_model": config.OLLAMA_MODEL,
        }
        for row in rows
    ]


def public_settings(user_id):
    settings, encrypted = _read(user_id)
    return {
        **settings,
        "api_key_configured": bool(encrypted),
        "local_model": config.OLLAMA_MODEL,
    }


def prepare_settings(user_id, body):
    previous, encrypted = _read(user_id)
    if body.provider == "openai" and body.preset_id != previous.get(
        "preset_id", "custom"
    ):
        with connect() as db:
            profile = db.execute(
                "SELECT settings,api_key FROM model_profiles WHERE user_id=? AND preset_id=?",
                (user_id, body.preset_id),
            ).fetchone()
        previous, encrypted = (
            (json.loads(profile["settings"]), profile["api_key"])
            if profile
            else ({"base_url": ""}, "")
        )
    settings = body.model_dump(exclude={"api_key", "clear_api_key"})
    if body.provider == "openai" and body.preset_id != "custom":
        preset = PRESETS[body.preset_id]
        settings.update(base_url=preset["base_url"], model=preset["model"])
    settings["base_url"] = normalize_base_url(settings["base_url"])
    settings["model"] = settings["model"].strip()
    if body.provider == "openai":
        if not settings["model"]:
            raise ModelError("请填写服务支持的模型 ID。", 400)
        if not body.allow_external:
            raise ModelError(
                "启用兼容服务前，请确认允许向该服务发送课堂文本上下文。", 400
            )
    raw = body.api_key.get_secret_value().strip() if body.api_key is not None else ""
    if body.clear_api_key and raw:
        raise ModelError("不能同时清除并填写 API Key。", 400)
    # Never forward a previous provider's credential to a changed endpoint.
    if body.clear_api_key or settings["base_url"] != previous["base_url"]:
        encrypted = ""
    if raw:
        encrypted = _cipher(create=True).encrypt(raw.encode()).decode()
    if (
        body.provider == "openai"
        and body.preset_id != "custom"
        and not encrypted
        and not body.clear_api_key
    ):
        raise ModelError("请填写所选服务商的 API Key。", 400)
    return settings, encrypted


def save_settings(user_id, body):
    settings, encrypted = prepare_settings(user_id, body)
    with connect() as db:
        # Preserve independently encrypted credentials when switching providers.
        old = db.execute(
            "SELECT * FROM model_settings WHERE user_id=?", (user_id,)
        ).fetchone()
        if old:
            prior = json.loads(old["settings"])
            if prior["provider"] == "openai":
                db.execute(
                    "INSERT INTO model_profiles VALUES(?,?,?,?,?) ON CONFLICT(user_id,preset_id) DO UPDATE SET settings=excluded.settings,api_key=excluded.api_key,updated=excluded.updated",
                    (
                        user_id,
                        prior.get("preset_id", "custom"),
                        old["settings"],
                        old["api_key"],
                        time.time(),
                    ),
                )
        db.execute(
            "INSERT INTO model_settings VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET settings=excluded.settings,api_key=excluded.api_key,updated=excluded.updated",
            (user_id, json.dumps(settings), encrypted, time.time()),
        )
        if settings["provider"] == "openai":
            db.execute(
                "INSERT INTO model_profiles VALUES(?,?,?,?,?) ON CONFLICT(user_id,preset_id) DO UPDATE SET settings=excluded.settings,api_key=excluded.api_key,updated=excluded.updated",
                (
                    user_id,
                    settings["preset_id"],
                    json.dumps(settings),
                    encrypted,
                    time.time(),
                ),
            )
    return public_settings(user_id)


def runtime_settings(user_id):
    return _read(user_id)


def local_ollama_url():
    url = urlsplit(config.OLLAMA_URL)
    try:
        allowed = ipaddress.ip_address(url.hostname or "").is_loopback
    except ValueError:
        allowed = False
    if (
        not allowed
        or url.scheme != "http"
        or url.username
        or url.password
        or url.query
        or url.fragment
    ):
        raise ValueError("OLLAMA_URL 必须是本机回环 IP 的 HTTP 地址")
    return config.OLLAMA_URL.rstrip("/")


def _request(settings, encrypted, messages, streaming=False):
    online = settings["provider"] == "openai"
    headers = {}
    if online:
        if not settings["allow_external"]:
            raise ModelError("尚未允许向兼容服务发送课堂文本。", 400)
        url = normalize_base_url(settings["base_url"]) + "/chat/completions"
        if encrypted:
            try:
                raw = _cipher().decrypt(encrypted.encode()).decode()
            except InvalidToken as exc:
                raise ModelError(
                    "API Key 无法解密，请清除后重新配置或恢复原始密钥文件。", 409
                ) from exc
            headers["Authorization"] = "Bearer " + raw
        payload = {
            "model": settings["model"],
            "messages": messages,
            "stream": streaming,
            "temperature": settings["temperature"],
            "max_tokens": settings["max_tokens"],
        }
        engine = "openai:" + settings["model"]
    else:
        try:
            url = local_ollama_url() + "/api/chat"
        except ValueError as exc:
            raise ModelError("本机 Ollama 地址配置无效。", 400) from exc
        payload = {
            "model": config.OLLAMA_MODEL,
            "messages": messages,
            "stream": streaming,
            "options": {
                "temperature": settings["temperature"],
                "num_predict": settings["max_tokens"],
            },
        }
        engine = "ollama:" + config.OLLAMA_MODEL
    return online, url, headers, payload, engine


async def complete(settings, encrypted, messages):
    online, url, headers, payload, engine = _request(settings, encrypted, messages)
    try:
        async with asyncio.timeout(settings["timeout_seconds"]):
            async with httpx.AsyncClient(
                timeout=settings["timeout_seconds"],
                trust_env=False,
                follow_redirects=False,
            ) as client:
                async with client.stream(
                    "POST", url, json=payload, headers=headers
                ) as response:
                    if response.status_code in (401, 403):
                        raise ModelError(
                            "模型服务认证失败，请检查 API Key 和访问权限。"
                        )
                    if response.status_code == 404:
                        raise ModelError(
                            "模型或接口不存在，请检查 Base URL 和模型 ID。"
                        )
                    if response.status_code == 429:
                        raise ModelError(
                            "模型服务限流或额度不足，请稍后重试并检查配额。"
                        )
                    if 300 <= response.status_code < 400:
                        raise ModelError("模型服务返回重定向，请直接配置最终接口地址。")
                    response.raise_for_status()
                    data = bytearray()
                    async for chunk in response.aiter_bytes():
                        data.extend(chunk)
                        if len(data) > 1024 * 1024:
                            raise ModelError("模型响应超过大小限制。")
                    result = json.loads(data)
        answer = (
            result["choices"][0]["message"]["content"]
            if online
            else result["message"]["content"]
        )
        if not isinstance(answer, str) or not answer.strip():
            raise ValueError()
        return {"content": answer.strip(), "engine": engine}
    except (TimeoutError, httpx.TimeoutException) as exc:
        raise ModelError("模型请求超时，请稍后重试或调整超时设置。", 504) from exc
    except httpx.HTTPError as exc:
        raise ModelError("无法完成模型请求，请检查服务地址、网络与服务状态。") from exc
    except (ValueError, KeyError, IndexError, TypeError) as exc:
        raise ModelError(
            "模型响应格式不兼容或回答为空，需要非流式 Chat Completions 响应。"
        ) from exc


async def stream(settings, encrypted, messages):
    """Yield provider deltas immediately; closing the generator closes the HTTP stream."""
    online, url, headers, payload, engine = _request(
        settings, encrypted, messages, streaming=True
    )
    received = False
    finished = False

    def decode(data):
        nonlocal received, finished
        if online and data == "[DONE]":
            finished = True
            return ""
        value = json.loads(data)
        if value.get("error"):
            raise ModelError("模型流返回错误，请检查服务状态后重试。")
        if online:
            choices = value.get("choices", [])
            if not choices:
                return ""  # Usage-only or keepalive frame.
            choice = next((c for c in choices if c.get("index", 0) == 0), None)
            if choice is None:
                return ""
            delta = choice.get("delta", {}).get("content") or ""
            reason = choice.get("finish_reason")
            if reason in {"length", "content_filter", "tool_calls", "function_call"}:
                raise ModelError(
                    "模型提前结束回答（长度限制、内容过滤或工具调用），请调整设置后重试。"
                )
            finished = reason is not None
        else:
            delta = value.get("message", {}).get("content", "")
            finished = value.get("done") is True
            if value.get("done_reason") == "length":
                raise ModelError("模型达到输出长度限制，请调整设置后重试。")
        if not isinstance(delta, str):
            raise ValueError()
        received = received or bool(delta.strip())
        return delta

    try:
        async with asyncio.timeout(settings["timeout_seconds"]):
            async with httpx.AsyncClient(
                timeout=settings["timeout_seconds"],
                trust_env=False,
                follow_redirects=False,
            ) as client:
                async with client.stream(
                    "POST", url, json=payload, headers=headers
                ) as response:
                    if response.status_code in (401, 403):
                        raise ModelError(
                            "模型服务认证失败，请检查 API Key 和访问权限。"
                        )
                    if response.status_code == 404:
                        raise ModelError(
                            "模型或接口不存在，请检查 Base URL 和模型 ID。"
                        )
                    if response.status_code == 429:
                        raise ModelError(
                            "模型服务限流或额度不足，请稍后重试并检查配额。"
                        )
                    if 300 <= response.status_code < 400:
                        raise ModelError("模型服务返回重定向，请直接配置最终接口地址。")
                    response.raise_for_status()
                    if online and "text/event-stream" not in response.headers.get(
                        "content-type", ""
                    ):
                        raise ModelError(
                            "接口未返回 SSE 流，请使用支持 stream=true 的 Chat Completions 服务。"
                        )
                    buffer, event, size = "", [], 0
                    async for chunk in response.aiter_text():
                        size += len(chunk.encode("utf-8"))
                        if size > 1024 * 1024:
                            raise ModelError("模型响应超过大小限制。")
                        buffer += chunk
                        while "\n" in buffer:
                            line, buffer = buffer.split("\n", 1)
                            line = line.rstrip("\r")
                            if online:
                                if line.startswith("data:"):
                                    event.append(line[5:].removeprefix(" "))
                                if line or not event:
                                    continue
                                data, event = "\n".join(event), []
                            else:
                                if not line.strip():
                                    continue
                                data = line
                            delta = decode(data)
                            if delta:
                                yield {"content": delta, "engine": engine}
                            if finished:
                                break
                        if finished:
                            break
                    # Ollama may terminate the last JSON line without a newline.
                    if not online and buffer.strip() and not finished:
                        delta = decode(buffer)
                        if delta:
                            yield {"content": delta, "engine": engine}
                    if not finished:
                        raise ModelError("模型连接提前中断，回答尚未完成，请重试。")
                    if not received:
                        raise ModelError(
                            "模型未返回可显示的回答，请检查模型是否支持文本对话。"
                        )
    except (TimeoutError, httpx.TimeoutException) as exc:
        raise ModelError("模型请求超时，请稍后重试或调整超时设置。", 504) from exc
    except httpx.HTTPError as exc:
        raise ModelError(
            "模型连接中断，请检查服务地址、网络与服务状态后重试。"
        ) from exc
    except (ValueError, KeyError, IndexError, TypeError, AttributeError) as exc:
        raise ModelError(
            "模型流响应格式不兼容，请使用 SSE Chat Completions 或 Ollama 流式接口。"
        ) from exc


async def test_connection(user_id, body):
    settings, encrypted = prepare_settings(user_id, body)
    started = time.monotonic()
    if settings["provider"] == "rules":
        return {
            "ok": True,
            "engine": "local-rules",
            "latency_ms": 0,
            "message": "规则模式已就绪，无需网络。",
        }
    async for _ in stream(
        settings,
        encrypted,
        [
            {
                "role": "user",
                "content": "请只回复 OK。这是一条连接测试，不包含课堂数据。",
            }
        ],
    ):
        pass
    return {
        "ok": True,
        "engine": ("openai:" + settings["model"])
        if settings["provider"] == "openai"
        else "ollama:" + config.OLLAMA_MODEL,
        "latency_ms": round((time.monotonic() - started) * 1000),
        "message": "连接成功，已收到有效流式回答。此测试未保存配置。",
    }
