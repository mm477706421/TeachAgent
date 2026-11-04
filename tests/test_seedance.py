import asyncio
import io
import json
import uuid
import zipfile

import httpx
import pytest
from fastapi.testclient import TestClient

from backend import config, main, seedance
from backend.db import connect
from backend.model_service import _cipher


@pytest.fixture(autouse=True)
def disable_seedance_worker(monkeypatch):
    async def idle():
        await asyncio.Event().wait()

    monkeypatch.setattr(seedance, "worker", idle)


def settings(client):
    response = client.put(
        "/api/seedance/settings",
        json={"model": "seedance-test", "api_key": "synthetic-key-not-real"},
    )
    assert response.status_code == 200
    assert "synthetic-key" not in response.text


def generate(client, **overrides):
    return client.post(
        "/api/seedance/videos",
        json={
            "request_id": str(uuid.uuid4()),
            "title": "水循环教学",
            "prompt": "展示水汽蒸发、凝结成云再降雨的科学动画。",
            "allow_external": True,
            **overrides,
        },
    )


def test_settings_are_encrypted_isolated_and_validation_never_echoes_key(clients):
    c, ids = clients
    assert TestClient(main.app).get("/api/seedance/settings").status_code == 401
    settings(c["alice"])
    assert not c["bob"].get("/api/seedance/settings").json()["api_key_configured"]
    with connect() as db:
        saved = db.execute(
            "SELECT api_key FROM seedance_settings WHERE user_id=?", (ids["alice"],)
        ).fetchone()[0]
        assert "synthetic-key" not in saved
        assert _cipher().decrypt(saved.encode()) == b"synthetic-key-not-real"
    r = c["alice"].put(
        "/api/seedance/settings", json={"model": "test", "api_key": "secret\ninvalid"}
    )
    assert r.status_code == 422 and "secret" not in r.text
    r = c["alice"].put("/api/seedance/settings", json={"model": "new-model"})
    assert r.json()["api_key_configured"]
    r = c["alice"].put(
        "/api/seedance/settings", json={"model": "new-model", "clear_api_key": True}
    )
    assert not r.json()["api_key_configured"]
    assert generate(c["alice"]).status_code == 400
    csrf = c["alice"].headers.pop("x-csrf-token")
    assert c["alice"].put("/api/seedance/settings", json={}).status_code == 403
    c["alice"].headers["x-csrf-token"] = csrf


def test_generation_download_isolation_management_and_backup(clients, monkeypatch):
    c, ids = clients
    calls = []
    media = (
        config.ROOT / "frontend/e2e-shared/fixtures/library-sample.mp4"
    ).read_bytes()

    async def provider(method, encrypted, remote_id="", payload=None):
        calls.append((method, payload))
        if method == "POST":
            assert payload["watermark"] is True and payload["duration"] == 5
            return {"id": "task-test"}
        return {
            "status": "succeeded",
            "content": {"video_url": "https://media.volces.com/example.mp4"},
        }

    async def download(url, destination):
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(media)
        return len(media)

    monkeypatch.setattr(seedance, "provider", provider)
    monkeypatch.setattr(seedance, "download_media", download)
    settings(c["alice"])
    assert generate(c["alice"], allow_external=False).status_code == 400
    req = str(uuid.uuid4())
    r = generate(c["alice"], request_id=req)
    assert r.status_code == 201 and r.json()["status"] == "queued"
    vid = r.json()["id"]
    assert "api_key" not in r.json()
    assert generate(c["alice"], request_id=req).json()["id"] == vid
    assert len(calls) == 1  # Network retry cannot bill twice.
    assert generate(c["bob"], request_id=req).status_code == 409
    assert c["bob"].get("/api/seedance/videos").json()["total"] == 0
    assert c["alice"].delete(f"/api/seedance/videos/{vid}").status_code == 409
    assert c["admin"].get(f"/api/admin/users/{ids['alice']}/backup").status_code == 409
    # Settings changes do not invalidate an already submitted task's credential.
    c["alice"].put("/api/seedance/settings", json={"clear_api_key": True})
    row = seedance.owned(vid, ids["alice"], private=True)
    assert _cipher().decrypt(row["api_key"].encode()) == b"synthetic-key-not-real"
    asyncio.run(seedance.refresh_task(row))
    assert seedance.owned(vid, ids["alice"], private=True)["api_key"] == ""
    url = f"/api/seedance/videos/{vid}/media"
    assert c["bob"].get(url).status_code == 404
    assert c["admin"].get(url).status_code == 404
    assert TestClient(main.app).get(url).status_code == 401
    r = c["alice"].get(url, headers={"Range": "bytes=0-31"})
    assert r.status_code == 206 and r.content == media[:32]
    r = c["alice"].get(url + "?download=true")
    assert r.content == media and r.headers["content-disposition"].startswith(
        "attachment"
    )
    assert (
        c["bob"].patch(f"/api/seedance/videos/{vid}", json={"title": "no"}).status_code
        == 404
    )
    assert (
        c["alice"]
        .patch(f"/api/seedance/videos/{vid}", json={"title": "重命名科学视频"})
        .status_code
        == 200
    )
    assert c["alice"].get("/api/seedance/videos?q=重命名").json()["total"] == 1
    with zipfile.ZipFile(
        io.BytesIO(c["admin"].get(f"/api/admin/users/{ids['alice']}/backup").content)
    ) as archive:
        manifest = json.loads(archive.read("manifest.json"))
        assert manifest["generated_videos"][0]["id"] == vid
        assert "api_key" not in manifest["generated_videos"][0]
        assert archive.read(f"files/generated-videos/{vid}/video.mp4") == media
    assert c["bob"].delete(f"/api/seedance/videos/{vid}").status_code == 404
    assert c["alice"].delete(f"/api/seedance/videos/{vid}").status_code == 200
    assert c["alice"].get(url).status_code == 404
    assert not seedance.folder(ids["alice"], vid).exists()


def test_unknown_submission_and_download_retry_never_resubmit(clients, monkeypatch):
    c, ids = clients
    settings(c["alice"])

    async def uncertain(*args, **kwargs):
        raise httpx.ReadTimeout("do-not-echo-secret")

    monkeypatch.setattr(seedance, "provider", uncertain)
    row = generate(c["alice"]).json()
    assert row["status"] == "unknown" and "do-not-echo" not in row["error"]

    async def provider(method, *args, **kwargs):
        assert method == "GET"
        return {
            "status": "succeeded",
            "content": {"video_url": "https://test.volces.com/v.mp4"},
        }

    async def fail_download(*args):
        raise OSError("disk full / private-path")

    monkeypatch.setattr(seedance, "provider", provider)
    monkeypatch.setattr(seedance, "download_media", fail_download)
    seedance.update(row["id"], status="queued", remote_id="task-example")
    asyncio.run(seedance.refresh_task(seedance.owned(row["id"], ids["alice"], True)))
    row = seedance.owned(row["id"], ids["alice"])
    assert row["status"] == "download_failed" and "private-path" not in row["error"]
    url = f"/api/seedance/videos/{row['id']}/retry-download"
    assert c["bob"].post(url).status_code == 409
    assert c["alice"].post(url).json()["status"] == "queued"
    assert c["alice"].post(url).status_code == 409


def test_limits_and_provider_rejection(clients, monkeypatch):
    c, _ids = clients
    settings(c["alice"])

    async def reject(*args, **kwargs):
        response = httpx.Response(401, request=httpx.Request("POST", seedance.ENDPOINT))
        raise httpx.HTTPStatusError(
            "secret payload", request=response.request, response=response
        )

    monkeypatch.setattr(seedance, "provider", reject)
    assert generate(c["alice"]).json()["status"] == "failed"

    async def accept(*args, **kwargs):
        return {"id": "task-ok"}

    monkeypatch.setattr(seedance, "provider", accept)
    assert generate(c["alice"], duration=60).status_code == 422
    for _ in range(3):
        assert generate(c["alice"]).status_code == 201
    assert generate(c["alice"]).status_code == 409


def test_media_validation_streaming_and_size_limit(tmp_path, monkeypatch):
    actual = httpx.AsyncClient
    received = []
    media = b"\x00\x00\x00\x18ftypmp42" + bytes(50)

    def handler(request):
        received.append(request)
        assert "authorization" not in request.headers
        return httpx.Response(200, content=media)

    monkeypatch.setattr(
        seedance.socket, "getaddrinfo", lambda *args: [(2, 1, 6, "", ("8.8.8.8", 443))]
    )
    monkeypatch.setattr(
        seedance.httpx,
        "AsyncClient",
        lambda **kwargs: actual(transport=httpx.MockTransport(handler), **kwargs),
    )
    target = tmp_path / "video.mp4"
    assert asyncio.run(
        seedance.download_media("https://media.volces.com/a.mp4?signature=test", target)
    ) == len(media)
    assert target.read_bytes() == media
    for url in [
        "http://media.volces.com/a",
        "https://127.0.0.1/a",
        "https://volces.com.evil.test/a",
        "https://user:pass@media.volces.com/a",
    ]:
        with pytest.raises(ValueError):
            asyncio.run(seedance.download_media(url, target))
    assert len(received) == 1
    monkeypatch.setattr(seedance, "MAX_VIDEO_BYTES", 20)
    with pytest.raises(ValueError):
        asyncio.run(seedance.download_media("https://media.volces.com/a", target))
    assert not target.with_suffix(".part").exists()
    monkeypatch.setattr(
        seedance.socket,
        "getaddrinfo",
        lambda *args: [(2, 1, 6, "", ("127.0.0.1", 443))],
    )
    with pytest.raises(ValueError):
        asyncio.run(seedance.download_media("https://media.volces.com/a", target))


def test_official_provider_protocol_and_paused_query_recovery(clients, monkeypatch):
    c, ids = clients
    settings(c["alice"])
    actual = httpx.AsyncClient
    calls = []

    def handler(request):
        calls.append(request)
        assert request.headers["authorization"] == "Bearer synthetic-key-not-real"
        assert str(request.url).startswith(
            "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks"
        )
        if request.method == "POST":
            payload = json.loads(request.content)
            assert payload["content"][0]["type"] == "text"
            assert payload["ratio"] == "16:9"
            return httpx.Response(200, json={"id": "task-contract"})
        return httpx.Response(403, json={"error": "must-not-be-stored"})

    monkeypatch.setattr(
        seedance.httpx,
        "AsyncClient",
        lambda **kwargs: actual(transport=httpx.MockTransport(handler), **kwargs),
    )
    row = generate(c["alice"]).json()
    assert row["status"] == "queued"
    asyncio.run(seedance.refresh_task(seedance.owned(row["id"], ids["alice"], True)))
    row = seedance.owned(row["id"], ids["alice"])
    assert row["status"] == "attention" and "must-not" not in row["error"]
    c["alice"].put(
        "/api/seedance/settings",
        json={"model": "test", "api_key": "replacement-synthetic-key"},
    )
    assert (
        c["alice"].post(f"/api/seedance/videos/{row['id']}/retry-download").status_code
        == 200
    )
    updated = seedance.owned(row["id"], ids["alice"], True)
    assert updated["remote_id"] == "task-contract"
    assert (
        _cipher().decrypt(updated["api_key"].encode()) == b"replacement-synthetic-key"
    )
    assert [r.method for r in calls] == ["POST", "GET"]


def test_restart_preserves_remote_tasks_and_marks_uncertain_submissions(
    clients, monkeypatch
):
    c, ids = clients
    settings(c["alice"])

    async def accept(*args, **kwargs):
        return {"id": "task-durable"}

    monkeypatch.setattr(seedance, "provider", accept)
    first = generate(c["alice"]).json()
    second = generate(c["alice"]).json()
    seedance.update(second["id"], status="submitting", remote_id=None)

    async def restart():
        async with seedance.lifecycle():
            assert seedance.owned(first["id"], ids["alice"])["status"] == "queued"
            assert (
                seedance.owned(first["id"], ids["alice"])["remote_id"] == "task-durable"
            )
            assert seedance.owned(second["id"], ids["alice"])["status"] == "unknown"

    asyncio.run(restart())
