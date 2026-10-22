#!/usr/bin/env python3
"""The Chat half's gateway, inside the app's own process.

Studio Kitsui is one server. app/server.py owns the app; the Chat gateway
(chat/backend — the FastAPI app that holds accounts, the end-to-end encrypted
store, and the OpenAI pass-through) runs inside this process, behind a small
ASGI bridge. /chat/auth/*, /chat/v1/* and /chat/healthz are answered
by the gateway directly: no second process, no socket between the halves.

The bridge is deliberately small:

  * one event loop, in one daemon thread, started at app startup, so the
    gateway's lifespan (database warm-up, the shared upstream client) runs
    exactly once;
  * each request becomes a task on that loop, and its ASGI messages ride a
    queue to the thread that owns the client socket (nn_server's handler);
  * a client that hangs up cancels the task, so the upstream call is aborted
    rather than left running;
  * a slow client blocks only its own request — the loop hands the full queue
    to the default executor instead of stalling the other requests.
"""

import asyncio
import logging
import os
import queue
import sys
import threading
import urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BACKEND = os.path.join(ROOT, "chat", "backend")

_bridge = None
_bridge_error = None
_bridge_lock = threading.Lock()


class GatewayUnavailable(RuntimeError):
    """The gateway is not running: dependencies missing, or startup failed.

    The caller answers 503 with this message — the canvas keeps working
    without the Chat half.
    """


class _Bridge:
    """The event loop, the lifespan, and one generator per request."""

    def __init__(self, app):
        self.app = app
        self.loop = asyncio.new_event_loop()
        self.failure = None
        self._started = threading.Event()
        self.thread = threading.Thread(
            target=self._run, name="gateway-loop", daemon=True
        )
        self.thread.start()
        if not self._started.wait(timeout=30) and self.failure is None:
            self.failure = RuntimeError("the gateway did not start within 30s")

    # ---- the loop thread --------------------------------------------------
    def _run(self):
        asyncio.set_event_loop(self.loop)
        started = self.loop.create_future()

        def on_started(fut):
            if fut.exception() is not None:
                self.failure = fut.exception()
            self._started.set()

        started.add_done_callback(on_started)
        self.loop.create_task(self._lifespan(started))
        self.loop.run_forever()

    async def _lifespan(self, started):
        """Run the ASGI lifespan once; 'startup.complete' releases the app."""
        first = True

        async def receive():
            # The first message starts the app; after that Starlette waits
            # here for the shutdown message. The process exits long before one
            # would arrive, and the loop is closed with it.
            nonlocal first
            if first:
                first = False
                return {"type": "lifespan.startup"}
            return await self.loop.create_future()

        async def send(message):
            kind = message["type"]
            if kind == "lifespan.startup.complete" and not started.done():
                started.set_result(None)
            elif kind == "lifespan.startup.failed" and not started.done():
                started.set_exception(
                    RuntimeError(
                        message.get("message") or "the gateway's startup failed"
                    )
                )

        try:
            await self.app(
                {"type": "lifespan", "asgi": {"version": "3.0"}}, receive, send
            )
        except BaseException as e:  # noqa: BLE001 — a failed startup is reported, not raised
            if not started.done():
                started.set_exception(e)

    # ---- one request ------------------------------------------------------
    def request(self, method, path, query, headers, body, server, client, scheme):
        """One HTTP request through the app.

        Yields ``("start", status, headers)`` once, then ``("body", chunk)``
        for each piece. The caller iterates until it stops; closing the
        generator (the client hung up) cancels the ASGI task, which aborts
        the upstream call with it.
        """
        messages = queue.Queue(maxsize=64)
        loop = self.loop
        sent_body = False

        async def receive():
            nonlocal sent_body
            if not sent_body:
                sent_body = True
                return {"type": "http.request", "body": body or b"", "more_body": False}
            # The body is spent. Claiming a disconnect here would make
            # Starlette tear down a live stream (it races receive() against
            # the response body), so this blocks instead: a real hang-up
            # closes this generator from the handler side, which cancels the
            # task — and with it the upstream call.
            return await loop.create_future()

        async def push(item):
            try:
                messages.put_nowait(item)
            except queue.Full:
                # A slow client: the loop stays free while this request's
                # queue drains (draining is the handler thread's job).
                await loop.run_in_executor(None, messages.put, item)

        async def send(message):
            kind = message["type"]
            if kind == "http.response.start":
                await push(("start", message["status"], message.get("headers") or []))
            elif kind == "http.response.body":
                await push(
                    (
                        "body",
                        bytes(message.get("body") or b""),
                        bool(message.get("more_body")),
                    )
                )

        scope = {
            "type": "http",
            "asgi": {"version": "3.0", "spec_version": "2.3"},
            "http_version": "1.1",
            "method": method,
            "scheme": scheme,
            "path": urllib.parse.unquote(path),
            "raw_path": path.encode("latin-1", "replace"),
            "query_string": query.encode("latin-1", "replace"),
            "root_path": "",
            "headers": [
                (
                    str(k).lower().encode("latin-1", "replace"),
                    str(v).encode("latin-1", "replace"),
                )
                for k, v in headers
            ],
            "server": server,
            "client": client,
        }

        async def run():
            try:
                await self.app(scope, receive, send)
            except Exception as e:  # noqa: BLE001 — handed to the caller
                # Before the response starts this becomes a 502 the client can
                # read; mid-stream the reply simply ends here, so leave a line
                # behind for whoever wonders why it was cut short.
                logging.getLogger("nnstudio.gateway").error(
                    "the gateway's %s %s failed: %r", method, path, e
                )
                await push(("error", e))

        future = asyncio.run_coroutine_threadsafe(run(), loop)
        started = False
        try:
            while True:
                kind, *rest = messages.get()
                if kind == "start":
                    started = True
                    yield ("start", rest[0], rest[1])
                elif kind == "body":
                    chunk, more = rest
                    if chunk:
                        yield ("body", chunk)
                    if not more:
                        break
                else:  # the app raised
                    if not started:
                        raise rest[0]
                    break
        finally:
            future.cancel()


def _configure_logging():
    """The gateway's startup lines (upstream, accounts) are worth seeing; a
    process that configured logging already keeps its own settings."""
    if not logging.getLogger().handlers:
        logging.basicConfig(
            level=logging.INFO,
            format="%(asctime)s %(name)s: %(message)s",
            datefmt="%H:%M:%S",
        )


def start():
    """Start the gateway (idempotent). Raises GatewayUnavailable when it cannot."""
    global _bridge, _bridge_error
    with _bridge_lock:
        if _bridge is not None:
            return _bridge
        if _bridge_error is not None:
            raise GatewayUnavailable(_bridge_error)
        _configure_logging()
        if BACKEND not in sys.path:
            sys.path.insert(0, BACKEND)
        try:
            from gateway.main import app as gateway_app
        except Exception as e:  # noqa: BLE001 — a missing dependency, a broken import
            _bridge_error = "the gateway could not be imported (%s)" % (e,)
            raise GatewayUnavailable(_bridge_error)
        bridge = _Bridge(gateway_app)
        if bridge.failure is not None:
            _bridge_error = "the gateway did not start (%s)" % (bridge.failure,)
            raise GatewayUnavailable(_bridge_error)
        _bridge = bridge
        return bridge


def bridge():
    """The running bridge, started on first use."""
    return _bridge if _bridge is not None else start()
