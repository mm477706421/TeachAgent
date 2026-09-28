import asyncio
import base64
import hashlib
import hmac
import json
import wave
from urllib.parse import parse_qs, urlsplit

import pytest

from backend import iflytek_asr as asr
from backend import main
from backend import config, pipeline
from test_media import short_video  # noqa: F401


def test_signature_and_dynamic_correction():
    date = "Tue, 01 Jan 2030 00:00:00 GMT"
    query = parse_qs(urlsplit(asr.signed_url("test-key", "test-secret", date)).query)
    auth = base64.b64decode(query["authorization"][0]).decode()
    expected = base64.b64encode(
        hmac.new(
            b"test-secret",
            f"host: iat-api.xfyun.cn\ndate: {date}\nGET /v2/iat HTTP/1.1".encode(),
            hashlib.sha256,
        ).digest()
    ).decode()
    assert f'signature="{expected}"' in auth
    assert query["date"] == [date]
    parts = {0: "今天", 1: "错误", 2: "文本"}
    asr.merge_result(
        parts, {"sn": 3, "pgs": "rpl", "rg": [1, 2], "ws": [{"cw": [{"w": "学习"}]}]}
    )
    assert "".join(parts.values()) == "今天学习"


def test_websocket_frames_and_sanitized_errors(monkeypatch):
    import websockets.asyncio.client

    class Socket:
        def __init__(self):
            self.frames = []
            self.done = asyncio.Event()

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        async def send(self, data):
            self.frames.append(json.loads(data))
            if self.frames[-1]["data"]["status"] == 2:
                self.done.set()

        async def recv(self):
            await self.done.wait()
            return json.dumps(
                {
                    "code": 0,
                    "data": {
                        "status": 2,
                        "result": {"sn": 0, "ws": [{"cw": [{"w": "你好"}]}]},
                    },
                }
            )

    socket = Socket()
    monkeypatch.setattr(websockets.asyncio.client, "connect", lambda *a, **k: socket)
    assert (
        asyncio.run(asr.recognize_chunk(b"\0" * 1600, ("app", "key", "secret")))
        == "你好"
    )
    assert [f["data"]["status"] for f in socket.frames] == [0, 1, 2]
    assert socket.frames[0]["business"]["eos"] == 10000
    assert (
        b"".join(base64.b64decode(f["data"]["audio"]) for f in socket.frames)
        == b"\0" * 1600
    )

    def fail(*args, **kwargs):
        raise RuntimeError("secret signed URL MUST NEVER LEAK")

    monkeypatch.setattr(websockets.asyncio.client, "connect", fail)
    with pytest.raises(ValueError) as caught:
        asyncio.run(asr.recognize_chunk(b"\0\0", ("app", "key", "secret")))
    assert "secret" not in str(caught.value)
    assert caught.value.__suppress_context__


def test_long_audio_is_partitioned_with_honest_timing(tmp_path, monkeypatch):
    monkeypatch.setattr(asr, "credentials", lambda: ("app", "key", "secret"))
    sizes = []

    async def recognize(pcm, creds):
        sizes.append(len(pcm))
        return "合成测试"

    monkeypatch.setattr(asr, "recognize_chunk", recognize)
    path = tmp_path / "audio.wav"
    with wave.open(str(path), "wb") as out:
        out.setparams((1, 2, 16000, 0, "NONE", "NONE"))
        out.writeframes(b"\0\0" * 16000 * 17)
    progress = []
    result = asr.transcribe(path, progress.append)
    assert sizes == [256000, 256000, 32000]
    assert [(s["start"], s["end"], s["timing"]) for s in result] == [
        (0, 8, "chunk"),
        (8, 16, "chunk"),
        (16, 17, "chunk"),
    ]
    assert progress[-1] == 1


def test_upload_consent_provider_snapshot_and_isolation(clients, monkeypatch):
    c, _ = clients
    monkeypatch.setattr(main, "submit", lambda *args: None)
    monkeypatch.setattr(asr, "ready", lambda: True)
    files = {"file": ("test.mp4", b"synthetic")}
    data = {"title": "云端测试", "asr_provider": "iflytek"}
    assert (
        c["alice"].post("/api/lessons/upload", data=data, files=files).status_code
        == 400
    )

    data["allow_cloud_audio"] = "true"
    response = c["alice"].post("/api/lessons/upload", data=data, files=files)
    assert response.status_code == 201
    lesson = response.json()
    assert lesson["asr_provider"] == "iflytek"
    assert c["bob"].get(f"/api/lessons/{lesson['id']}").status_code == 404
    response = c["alice"].post(
        "/api/lessons/upload", data={"title": "默认本地"}, files=files
    )
    assert response.json()["asr_provider"] == "local"
    monkeypatch.setattr(asr, "ready", lambda: False)
    assert (
        c["alice"].post("/api/lessons/upload", data=data, files=files).status_code
        == 400
    )


def test_cloud_pipeline_without_local_model_and_retry(
    clients, monkeypatch, short_video, tmp_path
):
    c, _ = clients
    monkeypatch.setattr(main, "submit", lambda *args: None)
    monkeypatch.setattr(config, "MODEL", tmp_path / "absent")
    monkeypatch.setattr(asr, "ready", lambda: True)
    calls = []

    def transcribe(path, progress):
        assert path.is_file()
        calls.append(path)
        progress(1)
        return [
            {
                "start": 0,
                "end": 2,
                "text": "今天我们学习，谁来解释？",
                "timing": "chunk",
            }
        ]

    monkeypatch.setattr(asr, "transcribe", transcribe)
    response = c["alice"].post(
        "/api/lessons/upload",
        data={
            "title": "云端管线",
            "asr_provider": "iflytek",
            "allow_cloud_audio": "true",
        },
        files={"file": ("synthetic.mp4", short_video.read_bytes())},
    )
    assert response.status_code == 201
    lesson_id = response.json()["id"]
    pipeline.process(lesson_id)
    result = c["alice"].get(f"/api/lessons/{lesson_id}").json()
    assert result["status"] == "completed"
    assert result["analysis"]["asr_provider"] == "iflytek"
    assert result["analysis"]["segments"][0]["timing"] == "chunk"
    assert "8 秒" in result["analysis"]["limitations"][-1]
    assert len(calls) == 1

    def failure(*args):
        raise ValueError("讯飞连接失败")

    monkeypatch.setattr(asr, "transcribe", failure)
    pipeline.process(lesson_id)
    assert c["alice"].get(f"/api/lessons/{lesson_id}").json()["status"] == "failed"
    assert c["alice"].post(f"/api/lessons/{lesson_id}/retry").status_code == 200
    assert (
        c["alice"].get(f"/api/lessons/{lesson_id}").json()["asr_provider"] == "iflytek"
    )
