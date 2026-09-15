import io
import json
import time
import uuid
import zipfile

import pytest
from fastapi.testclient import TestClient

from backend import config
from backend.db import connect, init_db, password_hash
from backend.main import app


@pytest.fixture
def clients(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DATA", tmp_path)
    monkeypatch.setattr(config, "OLLAMA_URL", "http://127.0.0.1:1")
    init_db()
    ids = {}
    with connect() as db:
        for username, role in [
            ("admin", "admin"),
            ("alice", "teacher"),
            ("bob", "teacher"),
        ]:
            uid = uuid.uuid4().hex
            ids[username] = uid
            db.execute(
                "INSERT INTO users VALUES(?,?,?,?,?,?)",
                (
                    uid,
                    username,
                    username,
                    password_hash("Test-password-123"),
                    role,
                    time.time(),
                ),
            )
    with TestClient(app):
        result = {}
        for name in ids:
            client = TestClient(app)
            login = client.post(
                "/api/auth/login",
                json={"username": name, "password": "Test-password-123"},
            )
            assert login.status_code == 200
            client.headers["x-csrf-token"] = login.json()["csrf"]
            result[name] = client
        yield result, ids
        for client in result.values():
            client.close()


def import_lesson(client):
    response = client.post(
        "/api/lessons/text",
        json={
            "title": "测试课堂",
            "subject": "数学",
            "class_name": "三班",
            "text": "教师：今天我们学习函数。\n教师：那么，为什么图像是曲线？\n学生：我的观察是曲线对称。\n教师：请独立完成练习。",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_end_to_end_text_report_chat_and_delete(clients):
    c, _ = clients
    lesson = import_lesson(c["alice"])
    lid = lesson["id"]
    assert lesson["status"] == "completed"
    assert lesson["analysis"]["metrics"]["questions"] == 1
    assert lesson["analysis"]["metrics"]["labeled_student_segments"] == 1
    assert lesson["analysis"]["segments"][0]["timing"] == "estimated"
    assert c["alice"].get("/api/lessons").json()[0]["id"] == lid
    for format in ["md", "html", "json"]:
        response = c["alice"].get(f"/api/lessons/{lid}/report?format={format}")
        assert response.status_code == 200
        assert "测试课堂" in response.text
        assert "attachment" in response.headers["content-disposition"]
    reply = c["alice"].post(
        f"/api/lessons/{lid}/chat", json={"message": "为什么互动少，如何改进？"}
    )
    assert reply.status_code == 200
    assert reply.json()["engine"] == "local-rules"
    assert "片段 #" in reply.json()["content"]
    assert len(c["alice"].get(f"/api/lessons/{lid}/chat").json()) == 2
    assert c["alice"].delete(f"/api/lessons/{lid}").status_code == 200
    assert c["alice"].get(f"/api/lessons/{lid}").status_code == 404


def test_cross_account_isolation_every_resource(clients):
    c, _ = clients
    lid = import_lesson(c["alice"])["id"]
    assert c["bob"].get("/api/lessons").json() == []
    for account in ["bob", "admin"]:
        for suffix in ["", "/report", "/chat", "/media", "/frames/001.jpg"]:
            assert c[account].get(f"/api/lessons/{lid}{suffix}").status_code == 404
        assert (
            c[account]
            .post(f"/api/lessons/{lid}/chat", json={"message": "hello"})
            .status_code
            == 404
        )
        assert c[account].post(f"/api/lessons/{lid}/retry").status_code == 404
        assert c[account].delete(f"/api/lessons/{lid}").status_code == 404
    assert c["bob"].get("/api/admin/users").status_code == 403
    assert c["bob"].get("/api/admin/audit").status_code == 403


def test_login_csrf_origin_and_password_invalidation(clients):
    c, _ = clients
    with TestClient(app) as anonymous:
        assert anonymous.get("/api/lessons").status_code == 401
        assert (
            anonymous.post(
                "/api/auth/login", json={"username": "alice", "password": "incorrect"}
            ).status_code
            == 401
        )
    csrf = c["alice"].headers.pop("x-csrf-token")
    assert c["alice"].post("/api/lessons/example").status_code == 403
    c["alice"].headers["x-csrf-token"] = csrf
    assert (
        c["alice"]
        .post("/api/lessons/example", headers={"origin": "https://evil.example"})
        .status_code
        == 403
    )
    response = c["alice"].post(
        "/api/auth/password",
        json={
            "old_password": "Test-password-123",
            "new_password": "Changed-password-456",
        },
    )
    assert response.status_code == 200
    assert c["alice"].get("/api/auth/me").status_code == 401
    assert (
        c["alice"]
        .post(
            "/api/auth/login",
            json={"username": "alice", "password": "Changed-password-456"},
        )
        .status_code
        == 200
    )


def test_admin_backup_contains_only_requested_account_no_auth_secrets(clients):
    c, ids = clients
    alice = import_lesson(c["alice"])
    bob = import_lesson(c["bob"])
    assert c["alice"].get(f"/api/admin/users/{ids['alice']}/backup").status_code == 403
    result = c["admin"].get(f"/api/admin/users/{ids['alice']}/backup")
    assert result.status_code == 200
    with zipfile.ZipFile(io.BytesIO(result.content)) as z:
        manifest = json.loads(z.read("manifest.json"))
        assert manifest["user"]["id"] == ids["alice"]
        assert len(manifest["lessons"]) == 1
        assert manifest["lessons"][0]["id"] == alice["id"]
        assert all(bob["id"] not in name for name in z.namelist())
        assert "password" not in manifest["user"]
        assert "sessions" not in manifest
        assert f"files/{alice['id']}/analysis.json" in z.namelist()
    assert any(
        a["action"] == "backup_user" for a in c["admin"].get("/api/admin/audit").json()
    )


def test_create_user_rejects_invalid_and_duplicate(clients):
    c, _ = clients
    data = {
        "username": "newteacher",
        "name": "新教师",
        "password": "Valid-password-123",
    }
    assert c["alice"].post("/api/admin/users", json=data).status_code == 403
    assert c["admin"].post("/api/admin/users", json=data).status_code == 201
    assert c["admin"].post("/api/admin/users", json=data).status_code == 409
    assert (
        c["admin"]
        .post("/api/admin/users", json={**data, "username": "../bad"})
        .status_code
        == 400
    )


def test_upload_validation_size_and_failure(clients, monkeypatch):
    c, _ = clients
    monkeypatch.setattr(config, "MAX_UPLOAD", 10)
    data = {"title": "视频测试"}
    assert (
        c["alice"]
        .post("/api/lessons/upload", data=data, files={"file": ("bad.exe", b"123")})
        .status_code
        == 400
    )
    assert (
        c["alice"]
        .post("/api/lessons/upload", data=data, files={"file": ("bad.mp4", b"")})
        .status_code
        == 400
    )
    assert (
        c["alice"]
        .post("/api/lessons/upload", data=data, files={"file": ("big.mp4", b"x" * 11)})
        .status_code
        == 413
    )
    assert c["alice"].get("/api/lessons").json() == []
    monkeypatch.setattr(config, "FFPROBE", "teachagent-nonexistent-ffprobe")
    result = c["alice"].post(
        "/api/lessons/upload", data=data, files={"file": ("valid.mp4", b"12345")}
    )
    assert result.status_code == 201
    lid = result.json()["id"]
    for _ in range(50):
        lesson = c["alice"].get(f"/api/lessons/{lid}").json()
        if lesson["status"] == "failed":
            break
        time.sleep(0.02)
    assert lesson["status"] == "failed"
    assert "媒体处理失败" in lesson["error"]


def test_example_labeled_and_html_escaped(clients):
    c, _ = clients
    example = c["alice"].post("/api/lessons/example").json()
    assert example["example"] == 1
    response = c["alice"].post(
        "/api/lessons/text",
        json={"title": "<script>alert(1)</script>", "text": "教师：请思考为什么。"},
    )
    lid = response.json()["id"]
    report = c["alice"].get(f"/api/lessons/{lid}/report?format=html")
    assert "<script>alert(1)</script>" not in report.text
    assert "&lt;script&gt;" in report.text


def test_login_rate_limit_persisted(clients):
    with TestClient(app) as client:
        for _ in range(10):
            response = client.post(
                "/api/auth/login", json={"username": "missing", "password": "wrong"}
            )
            assert response.status_code in {401, 429}
        assert (
            client.post(
                "/api/auth/login", json={"username": "missing", "password": "wrong"}
            ).status_code
            == 429
        )


def test_ollama_accepts_loopback_only_and_refuses_redirects(monkeypatch):
    from backend.main import local_ollama_url

    for value in [
        "https://api.example.com",
        "http://192.168.1.2:11434",
        "http://localhost:11434",
        "http://user:pass@127.0.0.1:11434",
    ]:
        monkeypatch.setattr(config, "OLLAMA_URL", value)
        with pytest.raises(ValueError):
            local_ollama_url()
    monkeypatch.setattr(config, "OLLAMA_URL", "http://127.0.0.1:11434")
    assert local_ollama_url() == "http://127.0.0.1:11434"
