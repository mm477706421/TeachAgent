import asyncio
import io
import json
import uuid

import pytest

from backend import (
    config,
    local_video,
    model_service,
    seedance,
    video_downloads,
)
from backend.db import connect


@pytest.fixture(autouse=True)
def no_workers(monkeypatch):
    async def idle():
        await asyncio.Event().wait()

    monkeypatch.setattr(seedance, "worker", idle)
    monkeypatch.setattr(video_downloads, "worker", idle)


def test_local_compute_configuration_submission_and_result(clients, monkeypatch):
    c, ids = clients
    workflow = {
        "1": {
            "class_type": "TextEncode",
            "inputs": {
                "text": "__PROMPT__",
                "frames": "__FRAMES__",
                "width": "__WIDTH__",
            },
        }
    }
    r = c["alice"].put(
        "/api/local-video/settings",
        json={
            "base_url": "http://gpu.school:8188",
            "workflow": json.dumps(workflow),
            "api_key": "teacher-local-test",
        },
    )
    assert r.status_code == 200 and r.json()["configured"]
    assert "teacher-local-test" not in r.text
    assert not c["bob"].get("/api/local-video/settings").json()["configured"]
    r = c["alice"].put(
        "/api/local-video/settings",
        json={
            "base_url": "http://gpu.school:8188",
            "workflow": "{}",
            "api_key": "do-not-echo",
        },
    )
    assert r.status_code == 422 and "do-not-echo" not in r.text
    calls = []

    async def request(base, key, method, path, payload=None):
        calls.append((method, path))
        assert base == "http://gpu.school:8188"
        if method == "POST":
            assert payload["prompt"]["1"]["inputs"]["frames"] == 81
            assert payload["prompt"]["1"]["inputs"]["width"] == 832
            return {"prompt_id": "local-job-123"}
        return {
            "local-job-123": {
                "status": {"completed": True},
                "outputs": {
                    "8": {
                        "gifs": [
                            {"filename": "class.mp4", "type": "output", "subfolder": ""}
                        ]
                    }
                },
            }
        }

    monkeypatch.setattr(local_video, "request", request)
    body = {
        "request_id": str(uuid.uuid4()),
        "title": "历史故事",
        "prompt": "依据课堂材料生成一个历史故事片段。",
        "allow_external": True,
    }
    r = c["alice"].post("/api/local-video/videos", json=body)
    assert r.status_code == 201 and r.json()["provider"] == "comfyui"
    vid = r.json()["id"]
    assert c["alice"].post("/api/local-video/videos", json=body).json()["id"] == vid
    assert len(calls) == 1
    content = (
        config.ROOT / "frontend/e2e-shared/fixtures/library-sample.mp4"
    ).read_bytes()

    async def download(row, media, path):
        assert media["filename"] == "class.mp4"
        path.parent.mkdir(parents=True)
        path.write_bytes(content)
        return len(content)

    monkeypatch.setattr(local_video, "download", download)
    asyncio.run(seedance.refresh_task(seedance.owned(vid, ids["alice"], True)))
    assert (
        c["alice"].get(f"/api/seedance/videos/{vid}/media?download=true").content
        == content
    )
    assert c["bob"].get(f"/api/seedance/videos/{vid}/media").status_code == 404
    assert seedance.owned(vid, ids["alice"], True)["api_key"] == ""
    c["alice"].put(
        "/api/local-video/settings",
        json={"base_url": "http://other-gpu:8188", "workflow": json.dumps(workflow)},
    )
    assert not c["alice"].get("/api/local-video/settings").json()["api_key_configured"]


def test_workflow_binding_is_json_data_and_download_paths_are_restricted(tmp_path):
    body = seedance.Generation(
        request_id=uuid.uuid4(),
        title="story",
        prompt='课程故事中的文字 "quote" 和 \\ 保持原样',
        duration=10,
    )
    result = local_video.expand(
        json.dumps({"1": {"inputs": {"text": "__PROMPT__", "frames": "__FRAMES__"}}}),
        body,
    )
    assert result["1"]["inputs"]["text"] == body.prompt
    assert result["1"]["inputs"]["frames"] == 161
    with pytest.raises(ValueError):
        asyncio.run(
            local_video.download(
                {}, {"filename": "../../secret.mp4"}, tmp_path / "output.mp4"
            )
        )


def test_download_queue_private_management_and_media_validation(clients, monkeypatch):
    c, _ids = clients
    content = (
        config.ROOT / "frontend/e2e-shared/fixtures/library-sample.mp4"
    ).read_bytes()

    class Response:
        status = 200

        def __init__(self):
            self.content = io.BytesIO(content)

        def getheader(self, name, default=""):
            return str(len(content)) if name == "content-length" else default

        def read(self, n):
            return self.content.read(n)

    class Connection:
        def close(self):
            pass

    monkeypatch.setattr(
        video_downloads, "open_public", lambda url: (Connection(), Response())
    )
    monkeypatch.setattr(
        video_downloads,
        "probe_media",
        lambda path: {"format": {"duration": 2}, "streams": [{"codec_type": "video"}]},
    )
    body = {
        "title": "资源库视频",
        "url": "https://resources.school.example/lesson.mp4?token=signed-private",
        "allow_download": True,
    }
    assert (
        c["alice"]
        .post("/api/video-downloads", json={**body, "allow_download": False})
        .status_code
        == 400
    )
    r = c["alice"].post("/api/video-downloads", json=body)
    assert r.status_code == 201
    vid = r.json()["id"]
    assert "signed-private" not in c["alice"].get("/api/video-downloads").text
    assert c["bob"].get("/api/video-downloads").json() == []
    assert c["alice"].delete(f"/api/video-downloads/{vid}").status_code == 409
    with connect() as db:
        row = db.execute("SELECT * FROM video_downloads WHERE id=?", (vid,)).fetchone()
    assert "signed-private" not in row["source"]
    video_downloads.process(dict(row))
    assert c["alice"].get(f"/api/video-downloads/{vid}/media").content == content
    assert c["bob"].get(f"/api/video-downloads/{vid}/media").status_code == 404
    assert c["bob"].delete(f"/api/video-downloads/{vid}").status_code == 404
    assert c["alice"].delete(f"/api/video-downloads/{vid}").status_code == 200


def test_url_private_network_rejection_and_html_resolution(monkeypatch, tmp_path):
    monkeypatch.setattr(
        video_downloads.socket,
        "getaddrinfo",
        lambda *a, **k: [(2, 1, 6, "", ("127.0.0.1", 80))],
    )
    with pytest.raises(ValueError, match="内网"):
        video_downloads.open_public("https://public-looking.example/video.mp4")
    for url in [
        "file:///etc/passwd",
        "https://user:secret@example.com/a",
        "http://example.com/\nsecret",
    ]:
        with pytest.raises(ValueError):
            video_downloads.validate_url(url)
    parser = video_downloads.VideoHTML()
    parser.feed('<html><video><source src="/media/a.mp4"></video></html>')
    assert parser.urls == ["/media/a.mp4"]
    content = b"this is not a video"

    class Response:
        status = 200

        def __init__(self):
            self.content = io.BytesIO(content)

        def getheader(self, *args):
            return ""

        def read(self, n):
            return self.content.read(n)

    class Connection:
        def close(self):
            pass

    monkeypatch.setattr(
        video_downloads, "open_public", lambda url: (Connection(), Response())
    )
    with pytest.raises(ValueError):
        video_downloads.fetch_video(
            "https://example.com/file", tmp_path / "video", lambda n: None
        )
    assert not (tmp_path / "video").exists()


def test_science_models_validation_isolation_and_ai_consent(clients, monkeypatch):
    c, _ids = clients
    body = {"title": "单摆", "description": "单摆，摆长为 2，初始角度为 12。"}
    result = c["alice"].post("/api/simulations/interpret", json=body)
    assert result.status_code == 200
    spec = result.json()["spec"]
    assert spec["params"]["length"] == 2 and spec["params"]["angle"] == 12
    converted = c["alice"].post(
        "/api/simulations/interpret",
        json={**body, "description": "单摆，摆长为 50 cm，初始角度为 12°。"},
    )
    assert converted.json()["spec"]["params"]["length"] == 0.5
    assert (
        c["alice"]
        .post(
            "/api/simulations/interpret",
            json={**body, "description": "地球的气候分布情况"},
        )
        .status_code
        == 422
    )
    assert (
        c["alice"]
        .post(
            "/api/simulations",
            json={**body, "spec": {"kind": "pendulum", "params": {"length": -1}}},
        )
        .status_code
        == 422
    )
    vid = c["alice"].post("/api/simulations", json={**body, "spec": spec}).json()["id"]
    assert c["bob"].get("/api/simulations").json() == []
    assert c["bob"].delete(f"/api/simulations/{vid}").status_code == 404
    monkeypatch.setattr(
        model_service, "_read", lambda user: ({"provider": "openai"}, "encrypted")
    )

    async def complete(*args):
        return {
            "content": json.dumps({"kind": "spring", "params": {"mass": 2}}),
            "engine": "teacher-model",
        }

    monkeypatch.setattr(model_service, "complete", complete)
    assert (
        c["alice"]
        .post("/api/simulations/interpret", json={**body, "use_ai": True})
        .status_code
        == 400
    )
    r = c["alice"].post(
        "/api/simulations/interpret",
        json={**body, "use_ai": True, "allow_external": True},
    )
    assert (
        r.json()["spec"]["params"]["mass"] == 2
        and r.json()["engine"] == "teacher-model"
    )
    assert c["alice"].delete(f"/api/simulations/{vid}").status_code == 200
