import io
import json
import socket
import threading
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import httpx
import pytest
from fastapi.testclient import TestClient

from backend import config, model_service
from backend.db import connect
from backend.main import app


@pytest.fixture
def compatible_server():
    state = {
        "requests": [],
        "status": 200,
        "response": {
            "choices": [{"message": {"content": "根据片段 #1，建议增加开放式提问。"}}]
        },
    }

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_POST(self):
            payload = json.loads(
                self.rfile.read(int(self.headers.get("Content-Length", 0)))
            )
            state["requests"].append(
                {
                    "path": self.path,
                    "authorization": self.headers.get("Authorization"),
                    "payload": payload,
                }
            )
            data = json.dumps(state["response"]).encode()
            self.send_response(state["status"])
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            if state["status"] == 302:
                self.send_header("Location", "/must-not-follow")
            self.end_headers()
            self.wfile.write(data)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    state["base_url"] = f"http://127.0.0.1:{server.server_port}/v1"
    yield state
    server.shutdown()
    server.server_close()
    thread.join(timeout=2)


def settings(server, **overrides):
    return {
        "provider": "openai",
        "base_url": server["base_url"],
        "model": "test-teaching-model",
        "api_key": "test-secret-ONLY-fixture",
        "allow_external": True,
        **overrides,
    }


def lesson(client):
    r = client.post(
        "/api/lessons/text",
        json={
            "title": "兼容模型验收",
            "text": "教师：今天我们学习函数。教师：为什么会变化？",
        },
    )
    assert r.status_code == 201
    return r.json()["id"]


def test_default_local_and_rule_mode_never_calls_compatible_service(
    clients, compatible_server
):
    c, _ = clients
    value = c["alice"].get("/api/model-settings").json()
    assert value["provider"] == "local" and not value["allow_external"]
    assert not value["api_key_configured"]
    assert (
        c["alice"].put("/api/model-settings", json={"provider": "rules"}).status_code
        == 200
    )
    assert (
        c["alice"]
        .post("/api/model-settings/test", json={"provider": "rules"})
        .json()["ok"]
    )
    response = c["alice"].post(
        f"/api/lessons/{lesson(c['alice'])}/chat", json={"message": "提问怎么改？"}
    )
    assert response.json()["engine"] == "local-rules"
    assert compatible_server["requests"] == []


def test_settings_are_encrypted_private_and_excluded_from_backup(
    clients, compatible_server
):
    c, ids = clients
    body = settings(compatible_server)
    r = c["alice"].put("/api/model-settings", json=body)
    assert r.status_code == 200 and r.json()["api_key_configured"]
    assert body["api_key"] not in r.text
    with connect() as db:
        row = db.execute(
            "SELECT * FROM model_settings WHERE user_id=?", (ids["alice"],)
        ).fetchone()
    assert body["api_key"] not in str(dict(row))
    assert row["api_key"].startswith("gAAAA")
    assert (config.DATA / "model-settings.key").is_file()
    assert c["bob"].get("/api/model-settings").json()["provider"] == "local"
    assert not c["admin"].get("/api/model-settings").json()["api_key_configured"]
    with zipfile.ZipFile(
        io.BytesIO(c["admin"].get(f"/api/admin/users/{ids['alice']}/backup").content)
    ) as z:
        assert "model-settings.key" not in z.namelist()
        assert "model_settings" not in z.read("manifest.json").decode()
        assert body["api_key"].encode() not in b"".join(z.read(n) for n in z.namelist())


def test_draft_connection_uses_real_http_protocol_and_does_not_save(
    clients, compatible_server
):
    c, _ = clients
    r = c["alice"].post("/api/model-settings/test", json=settings(compatible_server))
    assert r.status_code == 200, r.text
    assert r.json()["ok"] and "content" not in r.json()
    assert c["alice"].get("/api/model-settings").json()["provider"] == "local"
    request = compatible_server["requests"][0]
    assert request["path"] == "/v1/chat/completions"
    assert request["authorization"] == "Bearer test-secret-ONLY-fixture"
    assert request["payload"]["stream"] is False
    assert request["payload"]["model"] == "test-teaching-model"
    assert len(request["payload"]["messages"]) == 1
    assert "不包含课堂数据" in request["payload"]["messages"][0]["content"]


def test_http_hostname_can_be_saved_tested_and_used_for_chat(
    clients, compatible_server, monkeypatch
):
    c, _ = clients
    resolve = socket.getaddrinfo

    def local_test_dns(host, *args, **kwargs):
        if host in {"model.school.test", b"model.school.test"}:
            host = "127.0.0.1"
        return resolve(host, *args, **kwargs)

    # Real HTTP requests under a non-loopback hostname, resolved only in this test.
    monkeypatch.setattr(socket, "getaddrinfo", local_test_dns)
    body = settings(
        compatible_server,
        base_url=compatible_server["base_url"].replace(
            "127.0.0.1", "model.school.test"
        ),
    )
    saved = c["alice"].put("/api/model-settings", json=body)
    assert saved.status_code == 200, saved.text
    assert saved.json()["base_url"] == body["base_url"]
    body.pop("api_key")
    tested = c["alice"].post("/api/model-settings/test", json=body)
    assert tested.status_code == 200 and tested.json()["ok"]
    reply = c["alice"].post(
        f"/api/lessons/{lesson(c['alice'])}/chat", json={"message": "如何改善互动？"}
    )
    assert reply.status_code == 200 and reply.json()["engine"].startswith("openai:")
    assert len(compatible_server["requests"]) == 2
    for request in compatible_server["requests"]:
        assert request["authorization"] == "Bearer test-secret-ONLY-fixture"
        assert request["path"] == "/v1/chat/completions"


def test_online_chat_sends_only_owner_context_and_retains_history(
    clients, compatible_server
):
    c, _ = clients
    lid = lesson(c["alice"])
    c["alice"].put("/api/model-settings", json=settings(compatible_server))
    assert c["alice"].get("/api/system").json()["local_only"] is False
    for question in ["如何改善？", "给我具体步骤"]:
        reply = c["alice"].post(f"/api/lessons/{lid}/chat", json={"message": question})
        assert reply.status_code == 200, reply.text
        assert reply.json()["engine"] == "openai:test-teaching-model"
    last = compatible_server["requests"][-1]["payload"]
    assert [m["role"] for m in last["messages"]] == [
        "system",
        "user",
        "assistant",
        "user",
    ]
    assert "今天我们学习函数" in last["messages"][0]["content"]
    assert "image_url" not in json.dumps(last) and "audio" not in last
    assert (
        c["bob"].post(f"/api/lessons/{lid}/chat", json={"message": "越权"}).status_code
        == 404
    )
    assert len(compatible_server["requests"]) == 2
    assert len(c["alice"].get(f"/api/lessons/{lid}/chat").json()) == 4


def test_preserve_replace_clear_and_endpoint_change_never_leaks_old_key(
    clients, compatible_server
):
    c, _ = clients
    body = settings(compatible_server)
    c["alice"].put("/api/model-settings", json=body)
    body.pop("api_key")
    assert c["alice"].put("/api/model-settings", json=body).json()["api_key_configured"]
    c["alice"].post("/api/model-settings/test", json=body)
    assert (
        compatible_server["requests"][-1]["authorization"]
        == "Bearer test-secret-ONLY-fixture"
    )
    body["api_key"] = "replacement-fixture"
    c["alice"].put("/api/model-settings", json=body)
    body.pop("api_key")
    c["alice"].post("/api/model-settings/test", json=body)
    assert (
        compatible_server["requests"][-1]["authorization"]
        == "Bearer replacement-fixture"
    )
    body["base_url"] = compatible_server["base_url"] + "/other"
    c["alice"].post("/api/model-settings/test", json=body)
    assert compatible_server["requests"][-1]["authorization"] is None
    assert (
        not c["alice"]
        .put("/api/model-settings", json=body)
        .json()["api_key_configured"]
    )
    c["alice"].put("/api/model-settings", json=settings(compatible_server))
    assert (
        not c["alice"]
        .put(
            "/api/model-settings",
            json={**settings(compatible_server, api_key=None), "clear_api_key": True},
        )
        .json()["api_key_configured"]
    )


def test_configuration_requires_auth_csrf_consent_and_validation_hides_secrets(
    clients, compatible_server
):
    c, _ = clients
    with TestClient(app) as client:
        assert client.get("/api/model-settings").status_code == 401
    body = settings(compatible_server, allow_external=False)
    assert c["alice"].put("/api/model-settings", json=body).status_code == 400
    secret = "invalid-secret\nwith-newline"
    r = c["alice"].put(
        "/api/model-settings", json=settings(compatible_server, api_key=secret)
    )
    assert r.status_code == 422 and "invalid-secret" not in r.text
    assert (
        c["alice"]
        .put("/api/model-settings", json=settings(compatible_server, user_id="bob"))
        .status_code
        == 422
    )
    csrf = c["alice"].headers.pop("x-csrf-token")
    for method, path in [
        ("PUT", "/api/model-settings"),
        ("POST", "/api/model-settings/test"),
    ]:
        assert (
            c["alice"]
            .request(method, path, json=settings(compatible_server))
            .status_code
            == 403
        )
    c["alice"].headers["x-csrf-token"] = csrf
    assert not compatible_server["requests"]


@pytest.mark.parametrize(
    "url",
    [
        "ftp://example.com/v1",
        "http://key@example.com/v1",
        "https://key@example.com/v1",
        "https://example.com/v1?key=secret",
        "file:///etc/passwd",
        "https://example.com/v1#fragment",
        "https://example.com:99999/v1",
        "https://exa mple.com/v1",
    ],
)
def test_bad_endpoint_is_rejected(url):
    with pytest.raises(model_service.ModelError):
        model_service.normalize_base_url(url)


@pytest.mark.parametrize("status", [401, 403, 404, 429, 500, 302])
def test_remote_failure_is_explicit_sanitized_and_does_not_save_chat(
    clients, compatible_server, status
):
    c, _ = clients
    lid = lesson(c["alice"])
    c["alice"].put("/api/model-settings", json=settings(compatible_server))
    compatible_server["status"] = status
    compatible_server["response"] = {"error": {"message": "test-secret-ONLY-fixture"}}
    response = c["alice"].post(f"/api/lessons/{lid}/chat", json={"message": "分析"})
    assert response.status_code == 502
    assert "test-secret-ONLY-fixture" not in response.text
    assert c["alice"].get(f"/api/lessons/{lid}/chat").json() == []
    assert len(compatible_server["requests"]) == 1


def test_timeout_and_empty_model_response(clients, compatible_server, monkeypatch):
    c, _ = clients
    compatible_server["response"] = {"choices": [{"message": {"content": ""}}]}
    assert (
        c["alice"]
        .post("/api/model-settings/test", json=settings(compatible_server))
        .status_code
        == 502
    )

    async def timeout(*args, **kwargs):
        raise httpx.ReadTimeout("must not expose provider details")

    monkeypatch.setattr(httpx.AsyncClient, "send", timeout)
    response = c["alice"].post(
        "/api/model-settings/test", json=settings(compatible_server)
    )
    assert response.status_code == 504
    assert "must not expose" not in response.text


def test_lost_encryption_key_fails_closed_and_can_be_cleared(
    clients, compatible_server
):
    c, _ = clients
    c["alice"].put("/api/model-settings", json=settings(compatible_server))
    (config.DATA / "model-settings.key").unlink()
    response = c["alice"].post(
        "/api/model-settings/test", json=settings(compatible_server, api_key=None)
    )
    assert response.status_code == 409
    assert not compatible_server["requests"]
    assert (
        c["alice"]
        .put(
            "/api/model-settings",
            json=settings(compatible_server, api_key=None, clear_api_key=True),
        )
        .status_code
        == 200
    )


def test_local_ollama_success_path(clients, compatible_server, monkeypatch):
    c, _ = clients
    monkeypatch.setattr(
        config, "OLLAMA_URL", compatible_server["base_url"].removesuffix("/v1")
    )
    compatible_server["response"] = {"message": {"content": "本机模型回答"}}
    response = c["alice"].post(
        f"/api/lessons/{lesson(c['alice'])}/chat", json={"message": "建议"}
    )
    assert response.status_code == 200
    assert response.json()["engine"].startswith("ollama:")
    assert compatible_server["requests"][0]["path"] == "/api/chat"
