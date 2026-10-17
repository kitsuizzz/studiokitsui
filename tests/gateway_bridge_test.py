#!/usr/bin/env python3
"""The ASGI bridge: one process, two frameworks, no sockets.

nn_gateway runs the Chat half's FastAPI app on an event loop in a daemon
thread; nn_server's handler owns the client socket and drains a queue. These
tests drive the bridge with toy ASGI apps — the scope mapping, status and
headers, streaming, a mid-stream failure, a slow client, a failed startup, and
the client-hangs-up cancellation — so the contract is pinned without a network
or a database. (The real gateway is covered by its own pytest suite and by
tests/run.sh --live, where the database is expected.)
"""

import asyncio
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import nn_gateway  # noqa: E402

FAILED = []


def check(name, fn):
    try:
        fn()
        print("  ok   " + name)
    except Exception as e:  # noqa: BLE001 — the report is the point
        FAILED.append(name)
        print("  FAIL " + name + " — " + str(e))


def need(cond, msg):
    if not cond:
        raise AssertionError(msg)


def asgi(app):
    """A toy app plus the lifespan boilerplate the bridge expects: answer the
    startup, then serve. (The real gateway is a FastAPI app, which does this
    itself.)"""

    async def wrapped(scope, receive, send):
        if scope["type"] == "lifespan":
            await receive()
            await send({"type": "lifespan.startup.complete"})
            return
        await app(scope, receive, send)

    return wrapped


def drive(bridge, method="GET", path="/", query="", headers=None, body=b""):
    """The bridge's messages, collected: (status, headers, body)."""
    status, out_headers, out = None, None, b""
    for item in bridge.request(
        method,
        path,
        query,
        headers or [],
        body,
        ("127.0.0.1", 8124),
        ("127.0.0.1", 5000),
        "http",
    ):
        if item[0] == "start":
            status, out_headers = item[1], item[2]
        else:
            out += item[1]
    return status, out_headers, out


def header(out_headers, name):
    for k, v in out_headers or []:
        if k.lower() == name.encode():
            return v.decode()
    return ""


async def app_echo(scope, receive, send):
    """Reports what it was handed, and echoes the body."""
    request = await receive()
    await send(
        {
            "type": "http.response.start",
            "status": 201,
            "headers": [
                (b"content-type", b"application/json"),
                (b"x-method", scope["method"].encode()),
                (b"x-path", scope["path"].encode()),
                (b"x-query", scope["query_string"]),
                (b"x-scheme", scope["scheme"].encode()),
                (
                    b"x-headers",
                    ",".join(k.decode() for k, _ in scope["headers"]).encode(),
                ),
            ],
        }
    )
    await send(
        {
            "type": "http.response.body",
            "body": b'{"echo": "' + request.get("body", b"") + b'"}',
        }
    )


async def app_streams(scope, receive, send, chunks=5):
    """Streams small numbered chunks, then the empty final message."""
    await send(
        {
            "type": "http.response.start",
            "status": 200,
            "headers": [(b"content-type", b"text/event-stream")],
        }
    )
    for i in range(chunks):
        await send(
            {"type": "http.response.body", "body": b"%d;" % i, "more_body": True}
        )
    await send({"type": "http.response.body", "body": b"", "more_body": False})


async def app_big(scope, receive, send, chunks=200, size=4096):
    """A stream big enough to overflow the queue: backpressure, not loss."""
    await send({"type": "http.response.start", "status": 200, "headers": []})
    for i in range(chunks):
        await send(
            {
                "type": "http.response.body",
                "body": (b"%08d" % i) * (size // 8),
                "more_body": True,
            }
        )
    await send({"type": "http.response.body", "body": b"", "more_body": False})


async def app_races_receive(scope, receive, send):
    """Starlette's shape: the stream races receive() for a disconnect.

    The bridge must NOT claim http.disconnect once the body is spent — that
    would make Starlette tear down a live stream (the bug this pins).
    """
    torn = []

    async def watch():
        message = await receive()
        if message.get("type") == "http.disconnect":
            torn.append(True)

    watcher = asyncio.ensure_future(watch())
    try:
        await send({"type": "http.response.start", "status": 200, "headers": []})
        for i in range(3):
            await asyncio.sleep(0.02)
            await send(
                {"type": "http.response.body", "body": b"%d" % i, "more_body": True}
            )
        await asyncio.sleep(0.05)  # the watcher would have noticed
        await send({"type": "http.response.body", "body": b"", "more_body": False})
    finally:
        watcher.cancel()
    scope["state"]["torn"] = torn


async def app_fails(scope, receive, send):
    raise RuntimeError("nope")


async def app_fails_midway(scope, receive, send):
    await send({"type": "http.response.start", "status": 200, "headers": []})
    await send({"type": "http.response.body", "body": b"half", "more_body": True})
    raise RuntimeError("mid-stream")


async def app_bad_lifespan(scope, receive, send):
    if scope["type"] == "lifespan":
        await receive()
        await send({"type": "lifespan.startup.failed", "message": "no database"})


def test_the_scope_and_the_reply():
    bridge = nn_gateway._Bridge(asgi(app_echo))
    need(bridge.failure is None, "the bridge starts: %s" % (bridge.failure,))
    status, headers, body = drive(
        bridge,
        "POST",
        "/chat/auth/me%20now",
        "a=1&b=2",
        [("Host", "127.0.0.1:8124"), ("Cookie", "aistudio.account=x")],
        b"hi",
    )
    need(status == 201, "the status: %s" % status)
    need(header(headers, "content-type") == "application/json", "content-type")
    need(header(headers, "x-method") == "POST", "the method")
    need(header(headers, "x-path") == "/chat/auth/me now", "the path is decoded")
    need(header(headers, "x-query") == "a=1&b=2", "the query is raw")
    need(header(headers, "x-scheme") == "http", "the scheme")
    need("cookie" in header(headers, "x-headers"), "headers are lowercased")
    need(body == b'{"echo": "hi"}', "the body came back: %r" % body)


def test_a_stream_arrives_in_order():
    bridge = nn_gateway._Bridge(asgi(app_streams))
    status, _headers, body = drive(bridge)
    need(status == 200, "the status")
    need(body == b"0;1;2;3;4;", "every chunk, in order: %r" % body)


def test_a_slow_client_loses_nothing():
    bridge = nn_gateway._Bridge(asgi(app_big))
    status, _headers, body = drive(bridge)
    need(status == 200, "the status")
    need(len(body) == 200 * 4096, "all bytes: %d" % len(body))
    need(body.startswith(b"00000000"), "the first chunk")
    need(body[-4096:].startswith(b"00000199"), "the last chunk")


def test_receive_never_lies_about_a_disconnect():
    state = {}

    async def app(scope, receive, send):
        scope["state"] = state
        await app_races_receive(scope, receive, send)

    bridge = nn_gateway._Bridge(asgi(app))
    _status, _headers, body = drive(bridge)
    need(body == b"012", "the stream survived: %r" % body)
    need(not state.get("torn"), "receive() did not claim a disconnect")


def test_a_failure_before_the_start_reaches_the_caller():
    bridge = nn_gateway._Bridge(asgi(app_fails))
    try:
        drive(bridge)
    except RuntimeError as e:
        need("nope" in str(e), "the app's own error")
        return
    raise AssertionError("the failure did not reach the caller")


def test_a_failure_mid_stream_ends_the_reply():
    bridge = nn_gateway._Bridge(asgi(app_fails_midway))
    status, _headers, body = drive(bridge)
    need(status == 200, "the status was already sent")
    need(body == b"half", "what was sent is what arrived: %r" % body)


def test_a_failed_startup_is_reported():
    bridge = nn_gateway._Bridge(app_bad_lifespan)
    need(bridge.failure is not None, "the failure is kept")
    need("no database" in str(bridge.failure), "with its message: %s" % bridge.failure)


def test_hanging_up_cancels_the_app():
    seen = {}

    async def app(scope, receive, send):
        await send({"type": "http.response.start", "status": 200, "headers": []})
        try:
            for _ in range(1000):
                await send(
                    {
                        "type": "http.response.body",
                        "body": b"x" * 1024,
                        "more_body": True,
                    }
                )
                await asyncio.sleep(0.01)
        except asyncio.CancelledError:
            seen["cancelled"] = True
            raise

    bridge = nn_gateway._Bridge(asgi(app))
    stream = bridge.request(
        "GET", "/", "", [], b"", ("127.0.0.1", 1), ("127.0.0.1", 2), "http"
    )
    chunks = 0
    for item in stream:
        if item[0] == "start":
            continue
        chunks += 1
        if chunks >= 2:  # the client hangs up here
            break
    stream.close()
    deadline = time.time() + 5
    while time.time() < deadline and not seen.get("cancelled"):
        time.sleep(0.05)
    need(seen.get("cancelled"), "the app's task was cancelled")


check("the scope and the reply", test_the_scope_and_the_reply)
check("a stream arrives in order", test_a_stream_arrives_in_order)
check("a slow client loses nothing", test_a_slow_client_loses_nothing)
check(
    "receive() never lies about a disconnect",
    test_receive_never_lies_about_a_disconnect,
)
check(
    "a failure before the start reaches the caller",
    test_a_failure_before_the_start_reaches_the_caller,
)
check("a failure mid-stream ends the reply", test_a_failure_mid_stream_ends_the_reply)
check("a failed startup is reported", test_a_failed_startup_is_reported)
check("hanging up cancels the app", test_hanging_up_cancels_the_app)

if FAILED:
    print("gateway_bridge_test: %d failure(s): %s" % (len(FAILED), ", ".join(FAILED)))
    sys.exit(1)
print("gateway_bridge_test: all assertions passed")
