"""Optional iFlytek IAT adapter. Credentials stay on the deployment server."""

import asyncio
import base64
import hashlib
import hmac
import json
import os
import wave
from email.utils import formatdate
from urllib.parse import urlencode

HOST = "iat-api.xfyun.cn"
# Keep each request below both the 60-second session and 10-second silence limit.
CHUNK_SECONDS = 8


def credentials():
    values = tuple(
        os.environ.get(name, "").strip()
        for name in ("IFLYTEK_APP_ID", "IFLYTEK_API_KEY", "IFLYTEK_API_SECRET")
    )
    if not all(values):
        raise ValueError("讯飞尚未配置，请联系管理员设置 APPID、APIKey 和 APISecret。")
    return values


def ready():
    try:
        credentials()
        return True
    except ValueError:
        return False


def signed_url(api_key, api_secret, date=None):
    date = date or formatdate(usegmt=True)
    source = f"host: {HOST}\ndate: {date}\nGET /v2/iat HTTP/1.1"
    signature = base64.b64encode(
        hmac.new(api_secret.encode(), source.encode(), hashlib.sha256).digest()
    ).decode()
    auth = (
        f'api_key="{api_key}", algorithm="hmac-sha256", '
        f'headers="host date request-line", signature="{signature}"'
    )
    return f"wss://{HOST}/v2/iat?" + urlencode(
        {
            "authorization": base64.b64encode(auth.encode()).decode(),
            "date": date,
            "host": HOST,
        }
    )


def merge_result(parts, result):
    if result.get("pgs") == "rpl":
        first, last = result["rg"]
        for key in list(parts):
            if first <= key <= last:
                del parts[key]
    parts[int(result["sn"])] = "".join(
        word["cw"][0]["w"] for word in result.get("ws", []) if word.get("cw")
    )


async def recognize_chunk(pcm, creds):
    from websockets.asyncio.client import connect

    app_id, key, secret = creds
    parts = {}
    sent_bytes = 0
    # Never expose a websocket exception: it can contain the signed URL.
    try:
        async with asyncio.timeout(30):
            async with connect(
                signed_url(key, secret),
                open_timeout=10,
                close_timeout=3,
                max_size=1024 * 1024,
                proxy=None,
            ) as ws:

                async def send():
                    nonlocal sent_bytes
                    for offset in range(0, len(pcm), 1280):
                        message = {
                            "data": {
                                "status": 0 if offset == 0 else 1,
                                "format": "audio/L16;rate=16000",
                                "encoding": "raw",
                                "audio": base64.b64encode(
                                    pcm[offset : offset + 1280]
                                ).decode(),
                            }
                        }
                        if offset == 0:
                            message.update(
                                common={"app_id": app_id},
                                business={
                                    "language": "zh_cn",
                                    "domain": "iat",
                                    "accent": "mandarin",
                                    "dwa": "wpgs",
                                    "eos": 10000,
                                },
                            )
                        await ws.send(json.dumps(message))
                        sent_bytes += len(pcm[offset : offset + 1280])
                        await asyncio.sleep(0.04)
                    await ws.send(
                        json.dumps(
                            {
                                "data": {
                                    "status": 2,
                                    "format": "audio/L16;rate=16000",
                                    "encoding": "raw",
                                    "audio": "",
                                }
                            }
                        )
                    )

                async def receive():
                    while True:
                        message = json.loads(await ws.recv())
                        if message.get("code", -1) != 0:
                            # Only a numeric error code is safe to relay.
                            code = message.get("code")
                            code = code if type(code) is int else "unknown"
                            raise ValueError(
                                f"讯飞请求失败（代码 {code}），请检查听写服务权限、额度及认证配置。"
                            )
                        data = message.get("data", {})
                        if data.get("result"):
                            merge_result(parts, data["result"])
                        if data.get("status") == 2:
                            if sent_bytes < len(pcm):
                                raise RuntimeError(
                                    "Recognition ended before all audio was sent"
                                )
                            return

                sender = asyncio.create_task(send())
                receiver = asyncio.create_task(receive())
                try:
                    await asyncio.gather(sender, receiver)
                finally:
                    sender.cancel()
                    receiver.cancel()
                    await asyncio.gather(sender, receiver, return_exceptions=True)
    except ValueError as exc:
        if str(exc).startswith("讯飞请求失败（代码 "):
            raise ValueError(str(exc)) from None
        raise ValueError("讯飞返回格式异常，请联系管理员检查服务兼容性。") from None
    except Exception:
        raise ValueError(
            "讯飞连接失败或超时，请检查外网连接、服务器时间和认证配置。"
        ) from None
    return "".join(parts[key] for key in sorted(parts)).strip()


def transcribe(path, progress):
    creds = credentials()
    segments = []
    with wave.open(str(path), "rb") as audio:
        if (audio.getnchannels(), audio.getsampwidth(), audio.getframerate()) != (
            1,
            2,
            16000,
        ):
            raise ValueError("讯飞需要 16kHz 单声道 PCM16 音轨。")
        total = audio.getnframes()
        offset = 0
        while pcm := audio.readframes(16000 * CHUNK_SECONDS):
            count = len(pcm) // 2
            text = asyncio.run(recognize_chunk(pcm, creds))
            if text:
                segments.append(
                    {
                        "start": offset / 16000,
                        "end": (offset + count) / 16000,
                        "text": text,
                        "timing": "chunk",
                    }
                )
            offset += count
            progress(offset / max(total, 1))
    if not segments:
        raise ValueError("讯飞未识别出有效话语，请检查音轨、录音音量和语言。")
    return segments
