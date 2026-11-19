import asyncio
import io
import json
import uuid

import pytest

from backend import (
    config,
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


def test_retired_video_endpoints_are_removed(clients):
    c, _ = clients
    for method, path in [
        ("get", "/api/local-video/settings"),
        ("put", "/api/local-video/settings"),
        ("post", "/api/local-video/videos"),
    ]:
        assert getattr(c["alice"], method)(path).status_code in (404, 405)


def test_legacy_media_preserved_and_never_sent_to_seedance(clients, monkeypatch):
    c, ids = clients

    async def forbidden(*args, **kwargs):
        pytest.fail("Retired provider reached Seedance")

    monkeypatch.setattr(seedance, "provider", forbidden)
    content = (
        config.ROOT / "frontend/e2e-shared/fixtures/library-sample.mp4"
    ).read_bytes()
    video_ids = []
    with connect() as db:
        for status in [
            "succeeded",
            "running",
            "download_failed",
            "attention",
            "submitting",
        ]:
            vid = uuid.uuid4().hex
            video_ids.append(vid)
            db.execute(
                "INSERT INTO generated_videos "
                "(id,user_id,title,prompt,model,ratio,duration,status,remote_id,api_key,created,updated,provider) "
                "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    vid,
                    ids["alice"],
                    "历史视频",
                    "描述",
                    "old",
                    "16:9",
                    5,
                    status,
                    "legacy-remote-id",
                    "legacy-key",
                    1,
                    1,
                    "comfyui",
                ),
            )
    path = seedance.folder(ids["alice"], video_ids[0]) / "video.mp4"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    for vid in video_ids:
        asyncio.run(seedance.refresh_task(seedance.owned(vid, ids["alice"], True)))
        assert (
            c["alice"].post(f"/api/seedance/videos/{vid}/retry-download").status_code
            == 409
        )

    assert (
        c["alice"]
        .post(
            "/api/seedance/videos",
            json={
                "request_id": str(uuid.UUID(video_ids[0])),
                "title": "新任务",
                "prompt": "依据课堂内容生成一段教学视频。",
                "allow_external": True,
            },
        )
        .status_code
        == 409
    )

    async def restart():
        async with seedance.lifecycle():
            pass

    asyncio.run(restart())
    for vid in video_ids[1:]:
        row = seedance.owned(vid, ids["alice"], True)
        assert row["status"] == "failed" and row["api_key"] == ""
    vid = video_ids[0]
    assert (
        c["alice"].get(f"/api/seedance/videos/{vid}/media?download=true").content
        == content
    )
    assert c["bob"].get(f"/api/seedance/videos/{vid}/media").status_code == 404
    assert (
        c["alice"]
        .patch(f"/api/seedance/videos/{vid}", json={"title": "保留的视频"})
        .status_code
        == 200
    )
    assert c["alice"].delete(f"/api/seedance/videos/{vid}").status_code == 200


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
