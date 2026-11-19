import httpx
import pytest
from fastapi.testclient import TestClient
from test_model_settings import compatible_server  # noqa: F401

from backend import main, model_service, seedance
from backend.db import connect


def test_onboarding_is_private_and_considers_saved_profiles(clients):
    c, ids = clients
    path = "/api/model-settings/onboarding"
    assert TestClient(main.app).get(path).status_code == 401
    assert c["alice"].get(path).json() == {"needs_api_key": True}
    assert c["admin"].get(path).json() == {"needs_api_key": True}
    c["alice"].put(
        "/api/seedance/settings",
        json={"model": "seedance-fixture", "api_key": "private-fixture-key"},
    )
    assert c["alice"].get(path).json() == {"needs_api_key": False}
    assert c["bob"].get(path).json() == {"needs_api_key": True}
    c["alice"].put("/api/seedance/settings", json={"clear_api_key": True})
    assert c["alice"].get(path).json() == {"needs_api_key": True}
    model_service.save_settings(
        ids["alice"],
        model_service.ModelSettingsInput(
            provider="openai",
            preset_id="deepseek",
            api_key="saved-fixture-key",
            allow_external=True,
        ),
    )
    model_service.save_settings(
        ids["alice"], model_service.ModelSettingsInput(provider="rules")
    )
    assert c["alice"].get(path).json() == {"needs_api_key": False}
    assert c["bob"].get(path).json() == {"needs_api_key": True}


def test_chat_verifies_real_stream_before_saving_and_redacts_failures(clients, request):
    c, ids = clients
    upstream = request.getfixturevalue("compatible_server")
    body = {
        "provider": "openai",
        "base_url": upstream["base_url"],
        "model": "fixture-model",
        "api_key": "verified-fixture-key",
        "allow_external": True,
    }
    upstream["status"] = 401
    endpoint = "/api/model-settings/verify-and-save"
    response = c["alice"].post(endpoint, json=body)
    assert response.status_code == 502
    assert "verified-fixture-key" not in response.text
    assert c["alice"].get("/api/model-settings/onboarding").json()["needs_api_key"]
    with connect() as db:
        assert (
            db.execute(
                "SELECT count(*) FROM model_settings WHERE user_id=?", (ids["alice"],)
            ).fetchone()[0]
            == 0
        )
        assert (
            db.execute(
                "SELECT count(*) FROM model_profiles WHERE user_id=?", (ids["alice"],)
            ).fetchone()[0]
            == 0
        )
    upstream["status"] = 200
    result = c["alice"].post(endpoint, json=body)
    assert result.status_code == 200
    assert (
        result.json()["api_key_configured"]
        and "verified-fixture-key" not in result.text
    )
    call = upstream["requests"][-1]
    assert call["payload"]["stream"] is True
    assert len(call["payload"]["messages"]) == 1
    assert "连接测试" in call["payload"]["messages"][0]["content"]
    assert call["authorization"] == "Bearer verified-fixture-key"
    assert c["bob"].get("/api/model-settings/onboarding").json()["needs_api_key"]
    upstream["status"] = 403
    result = c["alice"].post(
        endpoint,
        json={**body, "api_key": "invalid-replacement-key", "model": "changed-model"},
    )
    assert result.status_code == 502
    settings, encrypted = model_service.runtime_settings(ids["alice"])
    assert settings["model"] == "fixture-model"
    assert (
        model_service._cipher().decrypt(encrypted.encode()) == b"verified-fixture-key"
    )
    upstream["status"] = 200
    upstream["response"] = {"choices": []}
    assert c["alice"].post(endpoint, json=body).status_code == 502


@pytest.mark.parametrize(
    "status,payload",
    [
        (401, {}),
        (403, {}),
        (429, {}),
        (500, {}),
        (302, {}),
        (200, {"error": "private-key-must-not-leak"}),
        (200, {"items": "invalid"}),
        (200, {"items": [], "error": "private-key-must-not-leak"}),
    ],
)
def test_seedance_rejects_invalid_checks_without_overwriting(
    clients, monkeypatch, status, payload
):
    c, ids = clients
    c["alice"].put(
        "/api/seedance/settings",
        json={"model": "old-model", "api_key": "existing-fixture-key"},
    )
    calls = []
    original = httpx.AsyncClient

    def handle(request):
        calls.append(request)
        assert request.method == "GET"
        assert str(request.url).startswith(seedance.ENDPOINT)
        assert request.url.params["page_size"] == "1"
        assert request.headers["Authorization"] == "Bearer private-key-must-not-leak"
        return httpx.Response(
            status,
            json=payload,
            headers={"Location": "https://example.com/not-followed"},
        )

    monkeypatch.setattr(
        seedance.httpx,
        "AsyncClient",
        lambda **kw: original(transport=httpx.MockTransport(handle), **kw),
    )
    response = c["alice"].post(
        "/api/seedance/settings/verify-and-save",
        json={"model": "new-model", "api_key": "private-key-must-not-leak"},
    )
    assert (
        response.status_code == 502 and "private-key-must-not-leak" not in response.text
    )
    assert len(calls) == 1
    with connect() as db:
        row = db.execute(
            "SELECT * FROM seedance_settings WHERE user_id=?", (ids["alice"],)
        ).fetchone()
    assert row["model"] == "old-model"
    assert (
        model_service._cipher().decrypt(row["api_key"].encode())
        == b"existing-fixture-key"
    )


def test_seedance_test_and_save_is_isolated_encrypted_and_does_not_generate(
    clients, monkeypatch
):
    c, ids = clients
    original = httpx.AsyncClient
    calls = []

    def handle(request):
        calls.append(request.method)
        assert (
            request.method == "GET"
            and request.headers["Authorization"] == "Bearer verified-video-key"
        )
        return httpx.Response(200, json={"items": [], "total": 0})

    monkeypatch.setattr(
        seedance.httpx,
        "AsyncClient",
        lambda **kw: original(transport=httpx.MockTransport(handle), **kw),
    )
    response = c["alice"].post(
        "/api/seedance/settings/verify-and-save",
        json={"model": "seedance-model", "api_key": "verified-video-key"},
    )
    assert response.status_code == 200 and response.json()["api_key_configured"]
    assert "verified-video-key" not in response.text
    with connect() as db:
        raw = db.execute(
            "SELECT api_key FROM seedance_settings WHERE user_id=?", (ids["alice"],)
        ).fetchone()[0]
        assert raw != "verified-video-key"
        assert model_service._cipher().decrypt(raw.encode()) == b"verified-video-key"
        assert db.execute("SELECT count(*) FROM generated_videos").fetchone()[0] == 0
    assert (
        c["alice"]
        .post(
            "/api/seedance/settings/verify-and-save", json={"model": "seedance-model"}
        )
        .status_code
        == 200
    )
    assert calls == ["GET", "GET"]
    assert (
        c["bob"]
        .post(
            "/api/seedance/settings/verify-and-save", json={"model": "seedance-model"}
        )
        .status_code
        == 400
    )
    assert (
        c["alice"]
        .post(
            "/api/seedance/settings/verify-and-save",
            json={"model": "", "api_key": "bad"},
        )
        .status_code
        == 400
    )
    token = c["alice"].headers.pop("x-csrf-token")
    assert (
        c["alice"]
        .post(
            "/api/seedance/settings/verify-and-save", json={"model": "seedance-model"}
        )
        .status_code
        == 403
    )
    c["alice"].headers["x-csrf-token"] = token


def test_seedance_timeout_is_safe_and_keeps_onboarding_pending(clients, monkeypatch):
    c, _ = clients
    original = httpx.AsyncClient

    def handle(request):
        raise httpx.ReadTimeout("private-key-must-not-leak", request=request)

    monkeypatch.setattr(
        seedance.httpx,
        "AsyncClient",
        lambda **kw: original(transport=httpx.MockTransport(handle), **kw),
    )
    r = c["alice"].post(
        "/api/seedance/settings/verify-and-save",
        json={"model": "seedance-model", "api_key": "private-key-must-not-leak"},
    )
    assert r.status_code == 502 and "private-key-must-not-leak" not in r.text
    assert c["alice"].get("/api/model-settings/onboarding").json()["needs_api_key"]
