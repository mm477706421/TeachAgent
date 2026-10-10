import io
import json
import zipfile

from fastapi.testclient import TestClient

from backend import config, main, library
from backend.db import connect
from test_media import short_video  # noqa: F401


def share(client, video, **fields):
    return client.post(
        "/api/library/upload",
        data={
            "title": "三角形探究",
            "subject": "数学",
            "description": "观察学生解释",
            "allow_school_share": "true",
            **fields,
        },
        files={"file": ("课堂片段.mp4", video)},
    )


def test_shared_upload_preview_download_permissions_and_backup(clients, short_video):
    c, ids = clients
    content = short_video.read_bytes()
    anonymous = TestClient(main.app)
    assert anonymous.get("/api/library").status_code == 401
    assert share(c["alice"], content, allow_school_share="false").status_code == 400
    r = share(c["alice"], content)
    assert r.status_code == 201, r.text
    lid = r.json()["id"]
    assert c["alice"].get("/api/lessons").json() == []
    listing = c["bob"].get("/api/library").json()
    assert listing["total"] == 1
    assert listing["items"][0]["owner_name"] == "alice"
    assert c["bob"].get("/api/library?mine=true").json()["total"] == 0
    assert c["alice"].get("/api/library?mine=true").json()["total"] == 1
    assert c["bob"].get("/api/library", params={"q": "数学"}).json()["total"] == 1
    assert c["bob"].get("/api/library", params={"q": "%"}).json()["total"] == 0
    url = f"/api/library/{lid}/media"
    assert anonymous.get(url).status_code == 401
    preview = c["bob"].get(url, headers={"Range": "bytes=0-99"})
    assert preview.status_code == 206 and preview.content == content[:100]
    download = c["bob"].get(url + "?download=true")
    assert download.content == content
    assert download.headers["content-disposition"].startswith("attachment;")
    assert c["bob"].delete(f"/api/library/{lid}").status_code == 403
    with zipfile.ZipFile(
        io.BytesIO(c["admin"].get(f"/api/admin/users/{ids['alice']}/backup").content)
    ) as z:
        manifest = json.loads(z.read("manifest.json"))
        assert manifest["shared_videos"][0]["id"] == lid
        assert z.read(f"files/shared-videos/{lid}/source.video") == content
    with zipfile.ZipFile(
        io.BytesIO(c["admin"].get(f"/api/admin/users/{ids['bob']}/backup").content)
    ) as z:
        assert json.loads(z.read("manifest.json"))["shared_videos"] == []
        assert not any(lid in name for name in z.namelist())
    assert c["alice"].delete(f"/api/library/{lid}").status_code == 200
    assert c["bob"].get(url).status_code == 404
    assert not library.directory(ids["alice"], lid).exists()
    lid = share(c["alice"], content).json()["id"]
    assert c["admin"].delete(f"/api/library/{lid}").status_code == 200


def test_shared_upload_validation_cleanup_and_csrf(clients, short_video, monkeypatch):
    c, ids = clients
    assert share(c["alice"], b"").status_code == 400
    assert share(c["alice"], b"not really video").status_code == 400
    assert share(c["alice"], short_video.read_bytes(), title=" ").status_code == 400
    monkeypatch.setattr(config, "MAX_UPLOAD", 10)
    assert share(c["alice"], b"x" * 11).status_code == 413
    assert c["alice"].get("/api/library").json()["total"] == 0
    assert not list((config.DATA / "library-uploads").glob("*/source.video"))
    c["alice"].headers.pop("x-csrf-token")
    assert share(c["alice"], b"test").status_code == 403


def test_library_pagination_and_private_classroom_isolation(clients, monkeypatch):
    c, ids = clients
    monkeypatch.setattr(main, "submit", lambda _: None)
    r = c["alice"].post(
        "/api/lessons/upload",
        data={"title": "私人视频"},
        files={"file": ("private.mp4", b"private")},
    )
    private_id = r.json()["id"]
    assert (
        c["bob"].get(f"/api/lessons/{private_id}/media?download=true").status_code
        == 404
    )
    assert c["bob"].get("/api/library").json()["total"] == 0
    with connect() as db:
        for i in range(13):
            db.execute(
                "INSERT INTO library_videos VALUES(?,?,?,?,?,?,?,?,?)",
                (
                    f"test-{i}",
                    ids["alice"],
                    f"共享测试 {i}",
                    "综合",
                    "",
                    "video.mp4",
                    100,
                    2,
                    i,
                ),
            )
    first = c["bob"].get("/api/library").json()
    second = c["bob"].get("/api/library?offset=12").json()
    assert first["total"] == second["total"] == 13
    assert len(first["items"]) == 12 and len(second["items"]) == 1
    assert {item["id"] for item in first["items"]}.isdisjoint(
        item["id"] for item in second["items"]
    )
