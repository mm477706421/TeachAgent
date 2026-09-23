"""Exercise baseline/upgrade/rollback using an isolated synthetic database only."""

import io
import json
import os
from pathlib import Path
import sys
import time

root, phase = Path(sys.argv[1]).resolve(), sys.argv[2]
assert "upgrade-fixture" in os.environ["TEACHAGENT_DATA"]
sys.path.insert(0, str(root))
from fastapi.testclient import TestClient
from backend.db import connect, init_db, password_hash
from backend.main import app

init_db()
with connect() as db:
    if not db.execute("SELECT 1 FROM users WHERE username='admin'").fetchone():
        db.execute(
            "INSERT INTO users VALUES(?,?,?,?,?,?)",
            (
                "fixture",
                "admin",
                "Fixture",
                password_hash("Fixture-upgrade-123"),
                "admin",
                time.time(),
            ),
        )
with TestClient(app) as client:
    response = client.post(
        "/api/auth/login", json={"username": "admin", "password": "Fixture-upgrade-123"}
    )
    assert response.status_code == 200
    user = response.json()["user"]
    client.headers["X-CSRF-Token"] = response.json()["csrf"]
    lessons = client.get("/api/lessons").json()
    if not lessons:
        lessons = [
            client.post(
                "/api/lessons/text",
                json={
                    "title": "Upgrade fixture",
                    "text": "教师：今天学习。学生：为什么？教师：总结。",
                },
            ).json()
        ]
    report = client.get(f"/api/lessons/{lessons[0]['id']}/report")
    assert report.status_code == 200
    if phase == "MODIFIED":
        from docx import Document

        assert report.content.startswith(b"PK")
        Document(io.BytesIO(report.content))
        assert user["is_superadmin"] is True
        value = client.put(
            "/api/model-settings",
            json={
                "provider": "openai",
                "preset_id": "deepseek",
                "api_key": "fixture-key",
                "allow_external": True,
            },
        )
        assert value.status_code == 200 and value.json()["model"] == "deepseek-chat"
        assert client.get("/api/model-settings/profiles").status_code == 200
        result = "default=docx; superadmin=true; preset=deepseek-chat; lessons=1"
    else:
        assert report.headers["content-type"].startswith("text/markdown")
        assert not user.get("is_superadmin", False)
        assert client.get("/api/model-settings/profiles").status_code == 404
        settings = client.get("/api/model-settings").json()
        settings.pop("api_key_configured")
        settings.pop("local_model")
        settings["provider"] = "rules"
        assert client.put("/api/model-settings", json=settings).status_code == 200
        result = (
            "default=md; superadmin=false; presets=404; lessons=1; settings-save=200"
        )
    print(json.dumps({"phase": phase, "result": result, "exit_status": 0}))
