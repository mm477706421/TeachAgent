"""Real socket checks: first token before completion, upstream close, retry and isolation."""

import asyncio
import json
import socket
import threading
import time
import uuid
from contextlib import asynccontextmanager

import httpx
import pytest
import uvicorn

from backend import config, model_service
from backend.db import connect
from backend.main import app


@pytest.fixture
def live_app(clients):
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    server = uvicorn.Server(uvicorn.Config(app, log_level="error", lifespan="off"))
    thread = threading.Thread(
        target=server.run, kwargs={"sockets": [sock]}, daemon=True
    )
    thread.start()
    deadline = time.monotonic() + 5
    while not server.started and time.monotonic() < deadline:
        time.sleep(0.01)
    assert server.started
    yield f"http://127.0.0.1:{sock.getsockname()[1]}"
    server.should_exit = True
    thread.join(timeout=5)
    sock.close()
    assert not thread.is_alive()


@asynccontextmanager
async def provider(mode="normal", ollama=False):
    state = {"calls": [], "release": asyncio.Event(), "closed": asyncio.Event()}

    async def serve(reader, writer):
        tasks = []
        try:
            head = await reader.readuntil(b"\r\n\r\n")
            length = int(
                next(
                    line.split(b":", 1)[1]
                    for line in head.split(b"\r\n")
                    if line.lower().startswith(b"content-length:")
                )
            )
            state["calls"].append(json.loads(await reader.readexactly(length)))
            writer.write(
                b"HTTP/1.1 200 OK\r\nContent-Type: "
                + (b"application/x-ndjson" if ollama else b"text/event-stream")
                + b"\r\nConnection: close\r\n\r\n"
            )
            if mode != "before-first":
                first = json.dumps(
                    {"message": {"content": "第一段👩‍🏫"}, "done": False}
                    if ollama
                    else {
                        "choices": [{"delta": {"content": "第一段👩‍🏫"}, "index": 0}]
                    },
                    ensure_ascii=False,
                )
                # Split UTF-8 bytes and the SSE delimiter across TCP writes.
                frame = (
                    first + "\n"
                    if ollama
                    else ": heartbeat\r\n\r\ndata: " + first + "\r\n\r\n"
                ).encode()
                for byte in frame:
                    writer.write(bytes([byte]))
                    await writer.drain()
                    await asyncio.sleep(0)
            eof = asyncio.create_task(reader.read())
            release = asyncio.create_task(state["release"].wait())
            tasks = [eof, release]
            done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            if eof in done:
                state["closed"].set()
                return
            if mode == "broken":
                return
            if ollama:
                writer.write(
                    (
                        json.dumps({"message": {"content": "最终段"}, "done": True})
                        + "\n"
                    ).encode()
                )
            else:
                writer.write(
                    (
                        "data: "
                        + json.dumps(
                            {
                                "choices": [
                                    {
                                        "delta": {"content": "最终段"},
                                        "finish_reason": "stop",
                                    }
                                ]
                            }
                        )
                        + "\n\ndata: [DONE]\n\n"
                    ).encode()
                )
            await writer.drain()
        except (ConnectionError, asyncio.IncompleteReadError):
            state["closed"].set()
        finally:
            for task in tasks:
                task.cancel()
            if tasks:
                await asyncio.gather(*tasks, return_exceptions=True)
            writer.close()
            await writer.wait_closed()

    server = await asyncio.start_server(serve, "127.0.0.1", 0)
    state["url"] = f"http://127.0.0.1:{server.sockets[0].getsockname()[1]}"
    try:
        yield state
    finally:
        state["release"].set()
        server.close()
        await server.wait_closed()


def setup_chat(clients, endpoint, ollama=False):
    client = clients[0]["alice"]
    lid = client.post(
        "/api/lessons/text",
        json={"title": "流式验收", "text": "教师：为什么？请同学们讨论后回答。"},
    ).json()["id"]
    settings = (
        {"provider": "local"}
        if ollama
        else {
            "provider": "openai",
            "base_url": endpoint + "/v1",
            "model": "stream-test",
            "allow_external": True,
        }
    )
    assert client.put("/api/model-settings", json=settings).status_code == 200
    return lid, {"message": "请分析互动", "request_id": str(uuid.uuid4())}


async def events(response):
    assert response.status_code == 200
    assert response.headers["x-accel-buffering"] == "no"
    async for line in response.aiter_lines():
        if line.startswith("data: "):
            yield json.loads(line[6:])


def client_for(clients, url, name="alice"):
    c = clients[0][name]
    return httpx.AsyncClient(
        base_url=url,
        cookies=dict(c.cookies),
        headers={"x-csrf-token": c.headers["x-csrf-token"]},
        timeout=8,
    )


@pytest.mark.parametrize("ollama", [False, True])
def test_real_stream_first_delta_before_finish_and_completed_retry(
    clients, live_app, monkeypatch, ollama
):
    async def run():
        async with provider(ollama=ollama) as upstream:
            monkeypatch.setattr(config, "OLLAMA_URL", upstream["url"])
            lid, body = setup_chat(clients, upstream["url"], ollama)
            path = f"/api/lessons/{lid}/chat"
            async with client_for(clients, live_app) as client:
                async with client.stream(
                    "POST", path + "/stream", json=body
                ) as response:
                    stream = events(response)
                    assert (await anext(stream))["type"] == "start"
                    delta = await asyncio.wait_for(anext(stream), 3)
                    assert delta["content"] == "第一段👩‍🏫"
                    assert not upstream["release"].is_set()
                    assert upstream["calls"][0]["stream"] is True
                    # A second send and a concurrent retry cannot create duplicate turns.
                    conflict = await client.post(
                        path + "/stream", json={**body, "request_id": str(uuid.uuid4())}
                    )
                    assert conflict.status_code == 409
                    upstream["release"].set()
                    rest = [e async for e in stream]
                    assert rest[-1]["status"] == "completed"
                    assert rest[-1]["content"] == "第一段👩‍🏫最终段"
                history = (await client.get(path)).json()
                assert len(history) == 2 and history[-1]["status"] == "completed"
                result = await client.post(
                    path + "/stream",
                    json={**body, "retry": True, "expected_attempt": 1},
                )
                assert result.status_code == 200
                history = (await client.get(path)).json()
                assert len(history) == 2 and history[-1]["attempt"] == 2
                assert (
                    len(upstream["calls"][1]["messages"]) == 2
                )  # No duplicate current question.
                stale = await client.post(
                    path + "/stream",
                    json={**body, "retry": True, "expected_attempt": 1},
                )
                assert stale.status_code == 409

    asyncio.run(run())


@pytest.mark.parametrize(
    "mode,disconnect", [("normal", False), ("before-first", False), ("normal", True)]
)
def test_stop_or_browser_disconnect_closes_upstream_and_persists_partial(
    clients, live_app, mode, disconnect
):
    async def run():
        async with provider(mode) as upstream:
            lid, body = setup_chat(clients, upstream["url"])
            path = f"/api/lessons/{lid}/chat"
            async with client_for(clients, live_app) as client:
                async with client.stream(
                    "POST", path + "/stream", json=body
                ) as response:
                    stream = events(response)
                    await anext(stream)
                    if mode != "before-first":
                        assert (await anext(stream))["type"] == "delta"
                    else:
                        for _ in range(100):
                            if upstream["calls"]:
                                break
                            await asyncio.sleep(0.01)
                        assert upstream["calls"]
                    if not disconnect:
                        stopped = await client.post(
                            path + f"/{body['request_id']}/stop"
                        )
                        assert stopped.status_code == 200
                        end = [e async for e in stream]
                        assert end[-1]["status"] == "stopped"
                await asyncio.wait_for(upstream["closed"].wait(), 3)
                for _ in range(100):
                    history = (await client.get(path)).json()
                    if history[-1]["status"] == "stopped":
                        break
                    await asyncio.sleep(0.02)
                assert len(history) == 2 and history[-1]["status"] == "stopped"
                assert history[-1]["content"] == (
                    "" if mode == "before-first" else "第一段👩‍🏫"
                )
                upstream["release"].set()
                retried = await client.post(
                    path + "/stream", json={**body, "retry": True}
                )
                assert retried.status_code == 200
                history = (await client.get(path)).json()
                assert len(history) == 2 and history[-1]["status"] == "completed"

    asyncio.run(run())


def test_broken_stream_preserves_partial_excludes_failed_context_and_isolates_accounts(
    clients, live_app
):
    async def run():
        async with provider("broken") as upstream:
            lid, body = setup_chat(clients, upstream["url"])
            path = f"/api/lessons/{lid}/chat"
            upstream["release"].set()
            async with (
                client_for(clients, live_app) as client,
                client_for(clients, live_app, "bob") as bob,
            ):
                response = await client.post(path + "/stream", json=body)
                assert '"status": "error"' in response.text
                history = (await client.get(path)).json()
                assert history[-1]["content"] == "第一段👩‍🏫"
                assert "提前中断" in history[-1]["error"]
                for suffix in ["/stream", f"/{body['request_id']}/stop"]:
                    assert (await bob.post(path + suffix, json=body)).status_code == 404
                    assert (
                        await client.post(
                            path + suffix, json=body, headers={"x-csrf-token": "wrong"}
                        )
                    ).status_code == 403
                await client.post(
                    path + "/stream",
                    json={**body, "request_id": str(uuid.uuid4()), "message": "下一问"},
                )
                assert len(upstream["calls"][-1]["messages"]) == 2
                assert (
                    await client.post(path + "/stream", json={**body, "retry": True})
                ).status_code == 409

    asyncio.run(run())


@pytest.mark.parametrize(
    "payload,expected",
    [
        ("data: {broken}\n\n", "格式不兼容"),
        ('data: {"error":{"message":"secret"}}\n\n', "模型流返回错误"),
        ("data: [DONE]\n\n", "未返回"),
        ('data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n', "提前结束"),
        ("data: " + "x" * (1024 * 1024) + "\n\n", "大小限制"),
    ],
    ids=["invalid-json", "error", "empty", "limit", "oversized"],
)
def test_stream_protocol_errors_are_sanitized(monkeypatch, payload, expected):
    original = httpx.AsyncClient
    transport = httpx.MockTransport(
        lambda request: httpx.Response(
            200, headers={"Content-Type": "text/event-stream"}, content=payload
        )
    )
    monkeypatch.setattr(
        httpx, "AsyncClient", lambda **kwargs: original(transport=transport, **kwargs)
    )

    async def run():
        settings = model_service.ModelSettingsInput(
            provider="openai", model="test", allow_external=True
        ).model_dump()
        with pytest.raises(model_service.ModelError, match=expected) as exc:
            async for _ in model_service.stream(settings, "", []):
                pass
        assert "secret" not in str(exc.value)

    asyncio.run(run())


def test_restart_recovery_and_backup_contains_turns(clients):
    c, ids = clients
    lid, body = setup_chat(clients, "http://127.0.0.1:1")
    with connect() as db:
        db.execute(
            "INSERT INTO chat_turns(id,lesson_id,question,content,status,created) VALUES(?,?,?,?,'running',?)",
            (body["request_id"], lid, body["message"], "已收到文字", time.time()),
        )
    from fastapi.testclient import TestClient

    with TestClient(app):
        history = c["alice"].get(f"/api/lessons/{lid}/chat").json()
        assert history[-1]["status"] == "interrupted"
        assert history[-1]["content"] == "已收到文字"
    import io
    import zipfile

    response = c["admin"].get(f"/api/admin/users/{ids['alice']}/backup")
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        manifest = json.loads(archive.read("manifest.json"))
    assert manifest["chat_turns"][0]["id"] == body["request_id"]
