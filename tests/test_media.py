import json
import shutil
import socket
import subprocess
import time

import pytest

from backend import config, pipeline
from backend.db import connect


def wait_for_lesson(client, lesson_id, timeout=45):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        row = client.get(f"/api/lessons/{lesson_id}").json()
        if row["status"] in {"failed", "completed"}:
            return row
        time.sleep(0.05)
    pytest.fail("Local media pipeline exceeded validation timeout")


@pytest.fixture
def short_video(tmp_path):
    if not shutil.which(config.FFMPEG):
        pytest.skip("FFmpeg is required for real media validation")
    path = tmp_path / "sample.mp4"
    subprocess.run(
        [
            config.FFMPEG,
            "-nostdin",
            "-y",
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=c=green:s=320x180:r=10",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:sample_rate=16000",
            "-t",
            "2",
            "-c:v",
            "mpeg4",
            "-c:a",
            "aac",
            str(path),
        ],
        check=True,
        capture_output=True,
        timeout=30,
    )
    return path


def test_missing_model_short_clip_extracts_frame_and_supports_range_playback(
    clients, short_video, monkeypatch, tmp_path
):
    c, ids = clients
    monkeypatch.setattr(config, "MODEL", tmp_path / "absent-model")
    response = c["alice"].post(
        "/api/lessons/upload",
        data={"title": "短视频"},
        files={"file": ("short.mp4", short_video.read_bytes(), "video/mp4")},
    )
    assert response.status_code == 201
    lid = response.json()["id"]
    result = wait_for_lesson(c["alice"], lid)
    assert result["status"] == "failed" and "模型" in result["error"]
    assert len(result["frames"]) >= 1
    assert (pipeline.lesson_dir(ids["alice"], lid) / "audio.wav").stat().st_size > 0
    frame = c["alice"].get(f"/api/lessons/{lid}/frames/001.jpg")
    assert frame.status_code == 200 and frame.content.startswith(b"\xff\xd8")
    media = c["alice"].get(f"/api/lessons/{lid}/media", headers={"Range": "bytes=0-99"})
    assert media.status_code == 206 and len(media.content) == 100
    assert media.content == short_video.read_bytes()[:100]
    assert c["alice"].get(f"/api/lessons/{lid}/report").status_code == 409
    assert c["alice"].delete(f"/api/lessons/{lid}").status_code == 200
    assert not pipeline.lesson_dir(ids["alice"], lid).exists()


def test_video_without_audio_has_clear_error(clients, short_video, tmp_path):
    c, _ = clients
    silent = tmp_path / "no-audio.mp4"
    subprocess.run(
        [
            config.FFMPEG,
            "-nostdin",
            "-y",
            "-v",
            "error",
            "-i",
            str(short_video),
            "-an",
            "-c:v",
            "copy",
            str(silent),
        ],
        check=True,
        capture_output=True,
        timeout=30,
    )
    r = c["alice"].post(
        "/api/lessons/upload",
        data={"title": "无音轨"},
        files={"file": ("no-audio.mp4", silent.read_bytes())},
    )
    result = wait_for_lesson(c["alice"], r.json()["id"])
    assert result["status"] == "failed" and "没有音轨" in result["error"]


def test_queued_guards_backup_delete_chat_report_and_retry(clients, monkeypatch):
    from backend import main

    c, ids = clients
    submitted = []
    monkeypatch.setattr(main, "submit", submitted.append)
    r = c["alice"].post(
        "/api/lessons/upload",
        data={"title": "排队课堂"},
        files={"file": ("queued.mp4", b"queued-fixture")},
    )
    lid = r.json()["id"]
    assert r.json()["status"] == "queued" and submitted == [lid]
    assert c["alice"].delete(f"/api/lessons/{lid}").status_code == 409
    assert c["alice"].get(f"/api/lessons/{lid}/report").status_code == 409
    assert (
        c["alice"]
        .post(f"/api/lessons/{lid}/chat", json={"message": "分析"})
        .status_code
        == 409
    )
    assert c["admin"].get(f"/api/admin/users/{ids['alice']}/backup").status_code == 409
    assert c["alice"].post(f"/api/lessons/{lid}/retry").status_code == 409
    with connect() as db:
        db.execute("UPDATE lessons SET status='failed' WHERE id=?", (lid,))
    assert c["alice"].post(f"/api/lessons/{lid}/retry").status_code == 200
    assert submitted == [lid, lid]
    assert c["alice"].get(f"/api/lessons/{lid}").json()["status"] == "queued"


@pytest.mark.skipif(
    not config.model_ready()
    or not (config.ROOT / ".data/smoke-video.mp4").is_file()
    or not shutil.which(config.FFMPEG),
    reason="Requires prepared local Whisper and synthetic speech fixture; no downloads in tests",
)
def test_actual_offline_asr_upload_to_report(clients, monkeypatch):
    from backend import main

    c, _ = clients
    attempts = []
    submitted = []
    monkeypatch.setattr(main, "submit", submitted.append)

    def deny_connection(self, address):
        attempts.append(address)
        raise RuntimeError("ASR network access is disabled during validation")

    monkeypatch.setattr(pipeline, "_model", None)
    video = config.ROOT / ".data/smoke-video.mp4"
    started = time.monotonic()
    r = c["alice"].post(
        "/api/lessons/upload",
        data={"title": "真实离线转写验收"},
        files={"file": ("speech.mp4", video.read_bytes())},
    )
    assert r.status_code == 201
    lid = r.json()["id"]
    assert submitted == [lid]
    # Block networking only during media/ASR processing. Windows TestClient
    # needs a loopback socket pair to create its asyncio event loop.
    with monkeypatch.context() as offline:
        offline.setattr(socket.socket, "connect", deny_connection)
        pipeline.process(lid)
    result = wait_for_lesson(c["alice"], lid, 90)
    assert result["status"] == "completed", result.get("error")
    assert result["analysis"]["metrics"]["segments"] > 0
    assert result["frames"] and result["has_video"]
    assert c["alice"].get(f"/api/lessons/{lid}/report?format=json").status_code == 200
    assert not attempts
    (config.ROOT / ".data/full-asr-validation.json").write_text(
        json.dumps(
            {
                "duration": result["duration"],
                "elapsed_seconds": round(time.monotonic() - started, 2),
                "metrics": result["analysis"]["metrics"],
                "network_attempts": len(attempts),
                "frames": len(result["frames"]),
            }
        ),
        encoding="utf-8",
    )
