import time
import uuid

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
