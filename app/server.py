#!/usr/bin/env python3
"""Studio Kitsui's app backend — the UI, its model list, tasks and run dispatch.

The canvas itself lives in the browser; the design runs on the separate studio
runner. This process stays light: it never imports torch or the runtime.
It has to
  * serve the one-page UI (`/`),
  * list the local GGUFs (`GET /api/models`) — the GGUF node's form reads it,
  * build a canvas from a model header (`POST /api/gguf/canvas`, lock-free),
  * answer the GPU badge (`GET /api/gpu`, straight from nvidia-smi).

    python3 -m app.server [--host 127.0.0.1] [--port 8124]
"""

import argparse
import json
import math
import os
import re
import signal
import socket
import ssl
import subprocess
import sys
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

APP_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(APP_DIR)
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from app import design as nn_engine  # the GGUF/HF -> canvas builder
from app import arc as nn_arc  # the researched-repo database
from app import gateway_bridge as nn_gateway  # the Chat gateway, in-process
from app import tasks as nn_tasks  # the AI jobs' task rows
from app import control  # the runner control channel
from app import jobs_api  # app-side job drivers
from app import models_api  # model/weight file APIs


def load_env(path=None):
    """The repo's .env seeds os.environ — KEY=VALUE lines, a real environment
    always wins. It is where the app's own settings live (the gateway reads the
    same file through its own settings), and the file is git-ignored."""
    path = path or os.path.join(ROOT, ".env")
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, val = line.partition("=")
                val = val.strip().strip('"').strip("'")
                if key.strip():
                    os.environ.setdefault(key.strip(), val)
    except OSError:
        pass


load_env()  # the repo's .env seeds the app's settings first
UI = os.path.join(ROOT, "ui", "index.html")
DOCS = os.path.join(ROOT, "ui", "docs.html")
BLOB_DIR = os.path.join(ROOT, "datasets", "blobs")  # media, content-addressed
BLOB_OK = {
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".avif",
    ".bmp",
    ".mp4",
    ".webm",
    ".ogv",
    ".mov",
    ".m4v",
}
BLOB_MIME = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".bmp": "image/bmp",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".ogv": "video/ogg",
    ".mov": "video/quicktime",
    ".m4v": "video/mp4",
}
BLOB_ID = __import__("re").compile(r"^[0-9a-f]{8,64}\.[a-z0-9]{2,5}$")


# The Chat half (chat.kitsui): its built SPA lives under chat/frontend/dist
# and is served at /chat. Its API — accounts, the E2E store, the OpenAI
# pass-through — is the gateway (chat/backend), which runs inside this very
# process behind app/gateway_bridge.py: /chat/auth/*, /chat/v1/* and
# /chat/healthz never leave the server. NNSTUDIO_CHAT_WEB moves the SPA;
# NNSTUDIO_CHAT_WEB is the old name, still read for an existing deployment.
CHAT_WEB = os.path.abspath(
    os.environ.get("NNSTUDIO_CHAT_WEB")
    or os.environ.get("NNSTUDIO_CHAT_WEB")
    or os.path.join(ROOT, "chat", "frontend", "dist")
)
CHAT_MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json",
    ".map": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".otf": "font/otf",
    ".txt": "text/plain; charset=utf-8",
}


def json_safe(obj):
    """What the browser receives: a NaN/±inf float becomes null. They are not
    JSON — Python writes them as Infinity, and JSON.parse refuses at the minus
    sign of -Infinity ("No number after minus sign in JSON at position …")."""
    if isinstance(obj, float):
        return obj if math.isfinite(obj) else None
    if isinstance(obj, dict):
        return {k: json_safe(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [json_safe(v) for v in obj]
    return obj


# The app server never imports torch. Weight metadata and export need the
# runtime, so they run as an app-side child process (app/jobs/weights_job.py),
# like training. The tokenizer metadata is stdlib-only and may be imported
# directly from the runtime package.
# The badge is polled every 15 s; nvidia-smi takes ~50 ms, so cache it for a
# beat to keep the poll free.
_GPU = {"time": 0.0, "data": None}
_GPU_LOCK = threading.Lock()
GPU_TTL = 2.0


def _apple_gpu():
    """(chip name, unified memory in MiB) on an Apple Silicon mac — the gpu
    there is the chip's own metal device, so this is what a badge can
    honestly report; (None, None) anywhere else."""
    if sys.platform != "darwin":
        return None, None

    def sysctl(name):
        try:
            q = subprocess.run(
                ["sysctl", "-n", name], capture_output=True, text=True, timeout=5
            )
            return q.stdout.strip() if q.returncode == 0 else ""
        except (OSError, subprocess.SubprocessError):
            return ""

    chip = sysctl("machdep.cpu.brand_string")
    if not chip.startswith("Apple"):
        return None, None
    try:
        mib = int(sysctl("hw.memsize")) // 2**20
    except ValueError:
        mib = None
    return chip + " \u00b7 metal", mib


def gpu_info():
    """The badge's numbers: name, memory, utilization, temperature —
    straight from nvidia-smi, or the Apple chip's metal device when there
    is none."""
    now = time.time()
    with _GPU_LOCK:
        if _GPU["data"] is not None and now - _GPU["time"] < GPU_TTL:
            return _GPU["data"]
    info = {
        "cuda": False,
        "name": None,
        "total_mib": None,
        "free_mib": None,
        "used_mib": None,
        "util_pct": None,
        "temp_c": None,
    }
    try:
        q = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=name,memory.total,memory.used,memory.free,"
                "utilization.gpu,temperature.gpu",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if q.returncode == 0 and q.stdout.strip():
            parts = [p.strip() for p in q.stdout.strip().splitlines()[0].split(",")]

            def num(i):
                try:
                    return int(float(parts[i]))
                except (ValueError, IndexError):
                    return None

            info = {
                "cuda": True,
                "name": parts[0] or None,
                "total_mib": num(1),
                "used_mib": num(2),
                "free_mib": num(3),
                "util_pct": num(4),
                "temp_c": num(5),
            }
    except (OSError, subprocess.SubprocessError):
        pass
    if not info["cuda"]:
        name, total = _apple_gpu()
        if name:
            info["name"] = name
            info["apple"] = True
            info["unified"] = True  # its memory is the system's
            info["total_mib"] = total
    with _GPU_LOCK:
        _GPU["time"] = now
        _GPU["data"] = info
    return info


class WebServer(ThreadingHTTPServer):
    """The HTTP server — and, when a certificate is given, HTTPS on the very
    same port. The first byte of a connection says which: 0x16 is a TLS
    handshake, a method letter is plain HTTP. So http://localhost stays what
    it always was, while a device that trusted the local CA can use
    https://<address> for the same app — and WebCrypto, which only lives on a
    secure origin, comes alive there."""

    tls_ctx = None

    def get_request(self):
        conn, addr = self.socket.accept()
        if self.tls_ctx is not None:
            try:
                if conn.recv(1, socket.MSG_PEEK) == b"\x16":
                    conn = self.tls_ctx.wrap_socket(conn, server_side=True)
            except OSError:  # a bad handshake, a probe: no news
                try:
                    conn.close()
                except OSError:
                    pass
                raise OSError("dropped during the TLS peek")
        return conn, addr


class Handler(BaseHTTPRequestHandler):
    server_version = "nnstudio"

    def log_message(self, fmt, *args):  # keep the journal quiet
        pass

    def _send(self, code, body, ctype="application/json; charset=utf-8", extra=None):
        if isinstance(body, str):
            body = body.encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():  # e.g. the session cookie
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass  # the client hung up mid-answer: fine

    def _json(self, obj, code=200, extra=None):
        self._send(code, json.dumps(json_safe(obj)), extra=extra)

    # ---- the account: the Chat half's gateway owns it ------------------------
    # Accounts, sessions and the encrypted store live in the gateway
    # (chat/backend, run in-process by app/gateway_bridge.py): /chat/auth/* is the
    # one account for both halves of the app, and this server keeps no user
    # state of its own.

    # ---- the Chat half: the SPA under /chat, the gateway in-process ---------
    def _chat(self, path):
        """True when the path belongs to the Chat half: its built files under
        /chat, and its API — /chat/auth/*, /chat/v1/*, /chat/healthz — answered
        in-process by the gateway behind app/gateway_bridge.py."""
        if path in ("/chat", "/chat/"):
            # The one shared shell page. It mounts the built chat app (found
            # through /chat/.vite/manifest.json) in its chat main area, so the
            # top bar and left menu are the same DOM across a half switch.
            self._chat_file(UI)
            return True
        if path in ("/chat/index.html", "/chat/index.htm"):
            # The built standalone page (the docker/nginx build) is not the
            # app's door here: /chat is the one shared shell. Send the old
            # address there, so no full-screen, shell-less landing survives.
            self._send(302, b"", "text/plain; charset=utf-8", {"Location": "/chat"})
            return True
        if (
            path.startswith("/chat/v1/")
            or path.startswith("/chat/auth/")
            or path == "/chat/healthz"
        ):
            self._chat_gateway(path[len("/chat") :])
            return True
        if path.startswith("/chat/"):
            rel = urllib.parse.unquote(path[len("/chat/") :])
            full = os.path.normpath(os.path.join(CHAT_WEB, rel))
            if full != CHAT_WEB and not full.startswith(CHAT_WEB + os.sep):
                self._json({"ok": False, "error": "no such file"}, 404)
                return True
            if os.path.isfile(full):
                self._chat_file(full)
            else:
                self._chat_file(UI)
            return True
        return False

    def _chat_file(self, full):
        mime = CHAT_MIME.get(
            os.path.splitext(full)[1].lower(), "application/octet-stream"
        )
        try:
            with open(full, "rb") as f:
                body = f.read()
        except OSError as e:
            self._json({"ok": False, "error": str(e)}, 404)
            return
        self._send(200, body, mime)

    def _chat_gateway(self, upstream_path):
        """The Chat half's API — /auth/*, /v1/*, /healthz — answered in-process
        by the gateway (FastAPI) through nn_gateway's ASGI bridge. The reply is
        streamed, so an SSE completion is never buffered whole; a client that
        hangs up cancels the upstream call with it."""
        q = urlparse(self.path).query
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except (TypeError, ValueError):
            n = 0
        body = self.rfile.read(n) if n > 0 else b""
        headers = [
            (k, v)
            for k, v in self.headers.items()
            if k.lower()
            not in (
                "connection",
                "keep-alive",
                "host",
                "transfer-encoding",
                "content-length",
                "expect",
            )
        ]
        headers.append(
            (
                "X-Forwarded-For",
                self.client_address[0] if self.client_address else "127.0.0.1",
            )
        )
        if body:
            headers.append(("Content-Length", str(len(body))))
        scheme = "https" if isinstance(self.connection, ssl.SSLSocket) else "http"
        answered = False
        stream = None
        try:
            stream = nn_gateway.bridge().request(
                self.command,
                upstream_path,
                q,
                headers,
                body,
                self.server.server_address,
                self.client_address,
                scheme,
            )
            for item in stream:
                if item[0] == "start":
                    answered = True
                    self.send_response(item[1])
                    for k, v in item[2]:
                        name = k.decode("latin-1")
                        if name.lower() in (
                            "connection",
                            "keep-alive",
                            "transfer-encoding",
                            "content-length",
                        ):
                            continue  # the body ends at the socket's close
                        self.send_header(name, v.decode("latin-1"))
                    self.send_header("Connection", "close")
                    self.end_headers()
                    self.close_connection = True
                else:
                    self.wfile.write(item[1])
                    self.wfile.flush()
        except nn_gateway.GatewayUnavailable as e:
            if not answered:  # nothing sent yet: a clean answer
                self._json({"ok": False, "error": str(e)}, 503)
        except Exception as e:  # noqa: BLE001 — the app's own error, the app shows it
            if not answered:
                try:
                    self._json(
                        {"ok": False, "error": "the gateway failed (%s)" % e}, 502
                    )
                except Exception:  # noqa: BLE001 — headers may be out already
                    pass
        finally:
            if stream is not None:
                try:
                    stream.close()  # the client is done: cancel the task
                except Exception:  # noqa: BLE001
                    pass

    def do_GET(self):
        path = urlparse(self.path).path
        if self._chat(path):
            return
        if path in ("/", "/index.html", "/studio", "/studio/"):
            try:
                with open(UI, "rb") as f:
                    body = f.read()
            except OSError as e:
                self._json({"ok": False, "error": str(e)}, 500)
                return
            self._send(200, body, "text/html; charset=utf-8")
            return
        if path == "/api/blob":
            q = parse_qs(urlparse(self.path).query)
            bid = str((q.get("id") or [""])[0]).strip().lower()
            if not BLOB_ID.match(bid) or os.path.splitext(bid)[1] not in BLOB_OK:
                self._json({"ok": False, "error": "not a blob id"}, 400)
                return
            p = os.path.join(BLOB_DIR, bid)
            try:
                with open(p, "rb") as fh:
                    body = fh.read()
            except OSError:
                self._json({"ok": False, "error": "no such blob"}, 404)
                return
            self._send(
                200,
                body,
                BLOB_MIME.get(os.path.splitext(bid)[1], "application/octet-stream"),
            )
            return
        if path == "/api/dataset":
            q = parse_qs(urlparse(self.path).query)
            f = str((q.get("path") or [""])[0]).strip()
            if not f:
                self._json({"ok": False, "error": "a file path is required"}, 400)
                return
            p = f if os.path.isabs(f) else os.path.join(ROOT, f)
            try:
                with open(p, encoding="utf-8") as fh:
                    raw = fh.read(2_000_000)  # a preview, not the whole file
            except OSError as e:
                self._json({"ok": False, "error": "cannot read %s: %s" % (f, e)}, 404)
                return
            fmt = str((q.get("format") or [""])[0]).strip()
            rows = []
            more = False
            if fmt == "csv":
                import csv as _csv
                import io as _io

                rd = _csv.reader(_io.StringIO(raw))
                cols = next(rd, []) or []
                for r in rd:
                    if len(rows) >= 500:
                        more = True
                        break
                    if not r or not any(x.strip() for x in r):
                        continue
                    rows.append([str(x) for x in r])
                self._json(
                    {
                        "ok": True,
                        "file": f,
                        "format": "csv",
                        "cols": [str(c) for c in cols],
                        "rows": rows,
                        "more": more,
                    }
                )
                return
            cols = ["prompt", "completion"]
            for line in raw.splitlines():
                if not line.strip():
                    continue
                if len(rows) >= 500:
                    more = True
                    break
                if line.strip().startswith("{"):
                    try:
                        o = json.loads(line)
                    except ValueError:
                        o = None
                    if isinstance(o, dict):
                        comp = o.get("completion")
                        if comp is None:
                            comp = o.get("output")
                        rows.append(
                            [
                                str(o.get("prompt") or ""),
                                "" if comp is None else str(comp),
                            ]
                        )
                        continue
                a, sep, b = line.partition("\t")
                rows.append([a, b if sep else ""])
            self._json(
                {
                    "ok": True,
                    "file": f,
                    "format": "tsv",
                    "cols": cols,
                    "rows": rows,
                    "more": more,
                }
            )
            return
        if path in ("/docs", "/docs.html"):
            try:
                with open(DOCS, "rb") as f:
                    body = f.read()
            except OSError as e:
                self._json({"ok": False, "error": str(e)}, 500)
                return
            self._send(200, body, "text/html; charset=utf-8")
            return
        if path == "/api/models":
            self._json({"models": models_api.list_models()})
            return
        if path == "/api/gpu":
            self._json(gpu_info())
            return
        if path == "/api/backend":
            self._json(control.backend_info())
            return
        if path == "/api/run/progress":
            runner = control.local_runner()
            self._json({"ok": True, "progress": runner.progress if runner else None})
            return
        if path == "/api/tasks":
            self._tasks_list()
            return
        if path == "/api/tasks/state":
            q = parse_qs(urlparse(self.path).query)
            tid = str((q.get("task") or [""])[0]).strip()
            try:
                with open(
                    os.path.join(ROOT, "agents", tid + ".state.json"), encoding="utf-8"
                ) as fh:
                    self._json({"ok": True, "state": json.load(fh)})
            except (OSError, ValueError):
                self._json({"ok": True, "state": None})
            return
        if path == "/api/tasks/log":
            q = parse_qs(urlparse(self.path).query)
            self._tasks_log(
                str((q.get("task") or [""])[0]).strip(),
                int((q.get("pos") or ["0"])[0] or 0),
            )
            return
        if path == "/api/reverse/status":
            q = parse_qs(urlparse(self.path).query)
            repo = nn_arc.canonical(str((q.get("repo") or [""])[0]).strip())
            family = str((q.get("family") or [""])[0]).strip()
            st = jobs_api.reverse_status(repo) if repo else None
            if st is None and family:
                st = jobs_api.reverse_find(family)
            if st is None and repo:
                arc = bool(nn_arc.get(repo))  # never started: the DB answers
                st = {
                    "repo": repo,
                    "family": family or None,
                    "phase": "done" if arc else "none",
                    "done": arc,
                    "ok": arc,
                    "arc": arc,
                }
            if st is None:
                self._json({"ok": False, "error": "repo or family is required"}, 400)
                return
            if "arc" not in st:
                st["arc"] = bool(nn_arc.get(st.get("repo") or repo or ""))
            if not st.get("done") and not st.get("arc"):
                pid = st.get("pid")
                gone = False
                if pid:
                    try:
                        os.kill(int(pid), 0)  # the wrapper still alive?
                    except (OSError, ValueError):
                        gone = True
                elif time.time() - (st.get("updated") or 0) > 300:
                    gone = True
                if gone and time.time() - (st.get("updated") or 0) > 30:
                    st = dict(
                        st,
                        stale=True,
                        done=True,
                        ok=False,
                        detail="the job is gone \u2014 load the repo again to retry",
                    )
            self._json(
                {
                    "ok": True,
                    "repo": st.get("repo"),
                    "family": st.get("family"),
                    "status": st,
                }
            )
            return
        if path == "/api/weights":
            self._json({"ok": True, "files": models_api.list_weight_files()})
            return
        if path == "/api/weights/meta":
            q = parse_qs(urlparse(self.path).query)
            target = models_api.weight_path((q.get("file") or [""])[0])
            try:
                out = models_api.run_weights_job("tensors", file=target)
                if out.get("ok") is False:
                    self._json(out, 400)
                    return
                out["ok"] = True
                self._json(out)
            except Exception as e:  # noqa: BLE001 — the form shows the message
                self._json({"ok": False, "error": str(e)}, 400)
            return
        if path == "/api/tokenizer":
            q = parse_qs(urlparse(self.path).query)
            repo = (q.get("repo") or [""])[0]
            try:
                out = models_api.hf_tokenizer_meta(repo)
                out["ok"] = True
                self._json(out)
            except Exception as e:  # noqa: BLE001 — the form shows the message
                self._json({"ok": False, "error": str(e)}, 400)
            return
        if path == "/favicon.ico":
            self._send(204, b"", "image/x-icon")
            return
        self._json({"ok": False, "error": "not found"}, 404)

    def _blob_post(self, length):
        """Bytes in, an id out: the store is content-addressed, so the same
        file uploaded twice is one blob and the table only carries its id."""
        if length <= 0 or length > 64 * 1024 * 1024:
            self._json({"ok": False, "error": "file must be 1..64 MB"}, 400)
            return
        q = parse_qs(urlparse(self.path).query)
        name = str((q.get("name") or [""])[0]).strip() or "data.bin"
        ext = os.path.splitext(name)[1].lower()
        if ext not in BLOB_OK:
            self._json(
                {
                    "ok": False,
                    "error": "only images and videos (png jpg gif webp "
                    "avif bmp mp4 webm ogv mov m4v)",
                },
                400,
            )
            return
        body = self.rfile.read(length)
        import hashlib

        bid = hashlib.sha256(body).hexdigest() + ext
        os.makedirs(BLOB_DIR, exist_ok=True)
        p = os.path.join(BLOB_DIR, bid)
        existed = os.path.isfile(p)
        if not existed:
            with open(p, "wb") as fh:
                fh.write(body)
        self._json({"ok": True, "id": bid, "bytes": len(body), "existed": existed})

    def _unpack_post(self, length):
        """A packed table comes home: data.csv in, media back in the store."""
        if length <= 0 or length > 256 * 1024 * 1024:
            self._json({"ok": False, "error": "archive must be 1..256 MB"}, 400)
            return
        import io as _io
        import zipfile as _zip

        raw = self.rfile.read(length)
        try:
            zf = _zip.ZipFile(_io.BytesIO(raw))
        except Exception as e:  # noqa: BLE001
            self._json({"ok": False, "error": "not a zip: %s" % e}, 400)
            return
        csv_text = ""
        saved = 0
        os.makedirs(BLOB_DIR, exist_ok=True)
        for zi in zf.infolist():
            base = os.path.basename(zi.filename)
            if zi.filename.endswith(".csv") and not csv_text:
                csv_text = zf.read(zi).decode("utf-8", "replace")
            elif (
                zi.filename.startswith("blobs/")
                and BLOB_ID.match(base)
                and zi.file_size <= 64 * 1024 * 1024
            ):
                if os.path.splitext(base)[1] not in BLOB_OK:
                    continue
                p = os.path.join(BLOB_DIR, base)
                if not os.path.isfile(p):
                    with open(p, "wb") as fh:
                        fh.write(zf.read(zi))
                saved += 1
        if not csv_text:
            self._json({"ok": False, "error": "the archive holds no data.csv"}, 400)
            return
        self._json({"ok": True, "csv": csv_text, "blobs": saved})

    def do_PUT(self):
        path = urlparse(self.path).path
        if self._chat(path):
            return
        self._json({"ok": False, "error": "not found"}, 404)

    def do_DELETE(self):
        path = urlparse(self.path).path
        if self._chat(path):
            return
        self._json({"ok": False, "error": "not found"}, 404)

    def do_POST(self):
        path = urlparse(self.path).path
        if self._chat(path):
            return
        length = int(self.headers.get("Content-Length") or 0)
        if path == "/api/blob":
            self._blob_post(length)
            return
        if path == "/api/dataset/unpack":
            self._unpack_post(length)
            return
        try:
            data = json.loads(self.rfile.read(length) or b"{}")
        except ValueError:
            data = {}
        if path == "/api/model/study":
            source = str(data.get("repo") or data.get("source") or "").strip()
            if not source:
                self._json(
                    {
                        "ok": False,
                        "error": "a repo id, URL or local folder is required",
                    },
                    400,
                )
                return
            try:
                out = nn_engine.study_model(source)
            except Exception as e:  # noqa: BLE001 — the form shows the message
                out = {"ok": False, "error": str(e)}
            self._json(out, 200 if out.get("ok") else 400)
            return
        if path == "/api/gguf/canvas":
            model = str(data.get("model") or "").strip()
            repo = str(data.get("repo") or "").strip()
            mmproj = str(data.get("mmproj") or "").strip()
            if not model and not repo:
                self._json({"ok": False, "error": "model or repo is required"}, 400)
                return
            try:
                out = (
                    nn_engine.hf_canvas(repo)
                    if repo
                    else nn_engine.gguf_canvas(model, mmproj=mmproj or None)
                )
                self._json(out)  # headers only, no weights
            except Exception as e:  # noqa: BLE001 — the form shows the message
                self._json({"ok": False, "error": str(e)}, 400)
            return
        if path == "/api/reverse":  # compat alias: the one firing path
            self._tasks_create(
                {
                    "type": "reverse",
                    "params": {"repo": data.get("repo"), "family": data.get("family")},
                }
            )
            return
        if path == "/api/reverse/cancel":  # compat alias, by repo
            repo = nn_arc.canonical(str(data.get("repo") or "").strip())
            if not repo:
                self._json({"ok": False, "error": "a repo id is required"}, 400)
                return
            task = nn_tasks.find_active("reverse", {"repo": repo}) if repo else None
            if not task:
                self._json({"ok": True, "cancelled": False})
                return
            self._tasks_cmd(
                {
                    "task": task["id"],
                    "cmd": "cancel",
                    "reason": str(data.get("reason") or "stopped"),
                }
            )
            return
        if path == "/api/dataset/pack":
            import io as _io
            import zipfile as _zip

            csv_text = str(data.get("csv") or "")
            if not csv_text:
                self._json({"ok": False, "error": "no csv to pack"}, 400)
                return
            buf = _io.BytesIO()
            zf = _zip.ZipFile(buf, "w", _zip.ZIP_DEFLATED)
            zf.writestr("data.csv", csv_text)
            for bid in (data.get("blobs") or [])[:2000]:
                bid = str(bid).strip().lower()
                if not BLOB_ID.match(bid) or os.path.splitext(bid)[1] not in BLOB_OK:
                    continue
                p = os.path.join(BLOB_DIR, bid)
                if os.path.isfile(p):
                    with open(p, "rb") as fh:
                        zf.writestr("blobs/" + bid, fh.read())
            zf.close()
            self._send(200, buf.getvalue(), "application/zip")
            return
        if path == "/api/tasks":
            self._tasks_create(data)
            return
        if path == "/api/tasks/cmd":
            self._tasks_cmd(data)
            return
        if path == "/api/runner/claim":
            ip = (self.client_address or ("", 0))[0]
            out = control.claim_pair(str(data.get("code") or ""), ip)
            status = 200 if out.get("ok") else (429 if out.get("rate") else 404)
            self._json(out, status)
            return
        if path == "/api/run":
            self._run(data)
            return
        if path == "/api/load":
            self._load(data)
            return
        if path == "/api/offload":
            self._offload()
            return
        if path == "/api/weights/export":
            self._weights_export(data)
            return
        self._json({"ok": False, "error": "not found"}, 404)

    # ---- the whole design, on the user's backend ---------------------------
    def _run(self, data):
        canvas = data.get("canvas")
        if not isinstance(canvas, dict) or not canvas.get("nodes"):
            self._json({"ok": False, "error": "no canvas in the request"}, 400)
            return
        runner = control.local_runner()
        if runner is None:
            self._json(
                {
                    "ok": False,
                    "error": "no backend connected \u2014 Backend \u2192 Local",
                },
                409,
            )
            return
        runner.progress = None  # a fresh data-flow for this run
        reply = runner.request(
            {
                "type": "run",
                "canvas": canvas,
                "feeds": data.get("feeds") or {},
                "mode": str(data.get("mode") or "inference"),
                "generate": int(data.get("generate") or 0),
                "temperature": float(
                    0.8 if data.get("temperature") is None else data.get("temperature")
                ),
                "input": data.get("input"),
                "output": data.get("output"),
                "seed": int(data.get("seed") or 1),
            }
        )
        if reply is None:
            self._json(
                {"ok": False, "error": "the backend did not answer (or is gone)"}, 504
            )
            return
        if not reply.get("ok"):
            self._json(
                {
                    "ok": False,
                    "error": reply.get("error") or "the run failed",
                    "box": reply.get("box"),
                    "nid": reply.get("nid"),
                },
                400,
            )
            return
        out = reply.get("result") or {}
        out["backend"] = runner.name
        self._json(out)

    # ---- load the weights: the whole design, kept warm on the backend -------
    def _load(self, data):
        canvas = data.get("canvas")
        if not isinstance(canvas, dict) or not canvas.get("nodes"):
            self._json({"ok": False, "error": "no canvas in the request"}, 400)
            return
        runner = control.local_runner()
        if runner is None:
            self._json(
                {
                    "ok": False,
                    "error": "no backend connected \u2014 Backend \u2192 Local",
                },
                409,
            )
            return
        reply = runner.request(
            {
                "type": "load",
                "canvas": canvas,
                "mode": str(data.get("mode") or "inference"),
                "checkpoint": str(data.get("checkpoint") or ""),
            },
            timeout=3600,
        )
        if reply is None:
            self._json(
                {"ok": False, "error": "the backend did not answer (or is gone)"}, 504
            )
            return
        if not reply.get("ok"):
            self._json(
                {
                    "ok": False,
                    "error": reply.get("error") or "the load failed",
                    "box": reply.get("box"),
                    "nid": reply.get("nid"),
                },
                400,
            )
            return
        out = reply.get("result") or {}
        out["ok"] = True
        out["backend"] = runner.name
        self._json(out)

    # ---- offload: let the backend drop every model and cache ----------------
    def _offload(self):
        runner = control.local_runner()
        if runner is None:
            self._json(
                {
                    "ok": False,
                    "error": "no backend connected \u2014 Backend \u2192 Local",
                },
                409,
            )
            return
        reply = runner.request({"type": "offload"}, timeout=300)
        if reply is None:
            self._json(
                {"ok": False, "error": "the backend did not answer (or is gone)"}, 504
            )
            return
        if not reply.get("ok"):
            self._json(
                {"ok": False, "error": reply.get("error") or "the offload failed"}, 400
            )
            return
        out = reply.get("result") or {}
        out["ok"] = True
        out["backend"] = runner.name
        self._json(out)

    # ---- agent tasks: the AI agents' work, as the app sees it --------------
    # The task is the entity — created only by an agent box, managed only by
    # agent boxes. Nothing else in the app fires or stops one.
    def _tasks_list(self):
        try:
            nn_tasks.reconcile()
            tasks = nn_tasks.list()
        except Exception as e:  # noqa: BLE001 — the list must never explode
            self._json({"ok": False, "error": str(e)}, 500)
            return
        self._json({"ok": True, "tasks": tasks})

    def _tasks_log(self, tid, pos):
        task = nn_tasks.get(tid) if tid else None
        if not task:
            self._json({"ok": False, "error": "no such task"}, 404)
            return
        path = task.get("log") or nn_tasks.log_file(tid)
        items, end = [], max(0, int(pos or 0))
        try:
            size = os.path.getsize(path)
            end = min(end, size)
            with open(path, "r", encoding="utf-8", errors="replace") as f:
                f.seek(end)
                data = f.read()
            lines = data.split("\n")
            lines.pop()  # the last line may be half-written
            end += sum(len(l) + 1 for l in lines)
            items = nn_tasks.fold_log(lines, uid=str(end))[:400]
        except OSError:
            pass
        self._json({"ok": True, "task": tid, "items": items, "pos": end})

    def _tasks_create(self, data):
        t = str(data.get("type") or "reverse").strip()
        params = data.get("params") if isinstance(data.get("params"), dict) else {}
        if t == "train":
            design = data.get("design")
            if isinstance(design, dict) and design.get("nodes"):
                os.makedirs(os.path.join(ROOT, "agents"), exist_ok=True)
                dpath = os.path.join(
                    ROOT, "agents", "train-design-%d.json" % int(time.time() * 1000)
                )
                with open(dpath, "w", encoding="utf-8") as fh:
                    json.dump(design, fh)
                params = dict(params, design=dpath, name=str(data.get("name") or t))
        if t == "reverse":
            repo = nn_arc.canonical(str(params.get("repo") or "").strip())
            if not repo:
                self._json({"ok": False, "error": "a repo id is required"}, 400)
                return
            params = dict(params, repo=repo)
        if t == "chat":
            msg = str(params.get("message") or "").strip()
            if not msg:
                self._json({"ok": False, "error": "a message is required"}, 400)
                return
            params = dict(params, message=msg)
            if params.get("repo"):
                params["repo"] = nn_arc.canonical(str(params["repo"]).strip())
        # a conversation's turns are history: never joined, never
        # reused — a chat turn goes straight to a fresh row
        if t != "chat":
            try:
                joined = nn_tasks.find_active(t, params)  # one active ask per repo
            except Exception as e:  # noqa: BLE001
                self._json({"ok": False, "error": str(e)}, 500)
                return
            if joined:
                self._json({"ok": True, "task": joined, "joined": True})
                return
            prior = nn_tasks.find_finished(t, params)  # an earlier attempt: retry it
            if prior:
                meta = dict(prior.get("meta") or {})
                meta.pop("error", None)
                meta.pop("reason", None)
                task = nn_tasks.update(
                    prior["id"],
                    status="running",
                    outcome=None,
                    phase="queued",
                    finished=None,
                    pid=None,
                    agent_pid=None,
                    todo=[],
                    meta=meta,
                )
                try:  # the stream starts over clean
                    open(task["log"], "w", encoding="utf-8").close()
                except OSError:
                    pass
                ok, why = jobs_api.fire_task(task)
                if not ok:
                    self._json(
                        {"ok": False, "error": why, "task": nn_tasks.get(task["id"])},
                        400,
                    )
                    return
                self._json(
                    {"ok": True, "task": nn_tasks.get(task["id"]), "joined": True}
                )
                return
        try:
            task = nn_tasks.create(t, params)
        except ValueError as e:
            self._json({"ok": False, "error": str(e)}, 400)
            return
        ok, why = jobs_api.fire_task(task)  # the one firing path
        if not ok:
            self._json(
                {"ok": False, "error": why, "task": nn_tasks.get(task["id"])}, 400
            )
            return
        self._json({"ok": True, "task": nn_tasks.get(task["id"])})

    def _tasks_cmd(self, data):
        tid = str(data.get("task") or "").strip()
        cmd = str(data.get("cmd") or "").strip()
        task = nn_tasks.get(tid)
        if not task:
            self._json({"ok": False, "error": "no such task"}, 404)
            return
        live = task.get("status") in ("running", "paused")
        meta = dict(task.get("meta") or {})
        if cmd == "pause":
            if task.get("status") == "running":
                jobs_api.signal_task(task, signal.SIGSTOP)
                meta["pause_at"] = time.time()
                task = nn_tasks.update(tid, status="paused", meta=meta)
        elif cmd == "resume":
            if task.get("status") == "paused":
                jobs_api.signal_task(task, signal.SIGCONT)
                meta.pop("pause_at", None)
                task = nn_tasks.update(tid, status="running", meta=meta)
        elif cmd == "cancel":
            if live:
                jobs_api.signal_task(
                    task, signal.SIGCONT
                )  # a stopped task must wake to die
                jobs_api.signal_task(task, signal.SIGTERM)
            meta["reason"] = str(data.get("reason") or "stopped by you")
            task = nn_tasks.update(
                tid, status="cancelled", meta=meta, finished=time.time()
            )
        elif cmd in ("save", "detach") and task.get("type") == "train":
            try:
                with open(jobs_api.train_cmd_file(tid), "w", encoding="utf-8") as fh:
                    json.dump({"cmd": cmd}, fh)
            except OSError as e:
                self._json({"ok": False, "error": str(e)}, 500)
                return
            task = nn_tasks.get(tid)
        elif cmd == "resume" and task.get("type") == "train":
            state = {}
            try:
                with open(
                    os.path.join(ROOT, "agents", tid + ".state.json"), encoding="utf-8"
                ) as fh:
                    state = json.load(fh)
            except (OSError, ValueError):
                pass
            ckpt = state.get("saved_at")
            if not ckpt:
                self._json({"ok": False, "error": "no checkpoint to resume from"}, 400)
                return
            meta.pop("reason", None)
            meta.pop("error", None)
            params = dict(task.get("params") or {}, checkpoint=ckpt)
            task = nn_tasks.update(
                tid,
                status="running",
                outcome=None,
                phase="queued",
                finished=None,
                pid=None,
                agent_pid=None,
                meta=meta,
                params=params,
            )
            ok, why = jobs_api.fire_train(task)
            if not ok:
                self._json({"ok": False, "error": why, "task": nn_tasks.get(tid)}, 400)
                return
            task = nn_tasks.get(tid)
        elif cmd == "restart":
            if live:
                jobs_api.signal_task(task, signal.SIGCONT)
                jobs_api.signal_task(task, signal.SIGTERM)
            meta.pop("reason", None)
            meta.pop("pause_at", None)
            meta.pop("error", None)
            task = nn_tasks.update(
                tid,
                status="running",
                outcome=None,
                phase="queued",
                finished=None,
                pid=None,
                agent_pid=None,
                todo=[],
                meta=meta,
            )
            ok, why = jobs_api.fire_task(task)
            if not ok:
                self._json({"ok": False, "error": why, "task": nn_tasks.get(tid)}, 400)
                return
            task = nn_tasks.get(tid)
        elif cmd == "delete":
            if live:
                jobs_api.signal_task(task, signal.SIGCONT)
                jobs_api.signal_task(task, signal.SIGTERM)
            nn_tasks.delete(tid, purge=bool(data.get("purge")))
            self._json({"ok": True, "deleted": tid})
            return
        else:
            self._json({"ok": False, "error": "unknown command: %s" % cmd}, 400)
            return
        self._json({"ok": True, "task": task, "changed": True})

    # ---- export the design's weights: one pt / safetensors file ------------
    def _weights_export(self, data):
        canvas = data.get("canvas")
        if not isinstance(canvas, dict) or not canvas.get("nodes"):
            self._json({"ok": False, "error": "no canvas in the request"}, 400)
            return
        fmt = (
            "pt"
            if str(data.get("format") or "").lower() in ("pt", "pytorch", ".pt")
            else "safetensors"
        )
        name = models_api.safe_name(data.get("name"))
        try:
            os.makedirs(models_api.WEIGHTS_DIR, exist_ok=True)
            path = os.path.join(models_api.WEIGHTS_DIR, name + "." + fmt)
            t0 = time.time()
            out = models_api.run_weights_job(
                "export", timeout=3600, canvas=canvas, path=path, fmt=fmt
            )
            if out.get("ok") is False:
                self._json(out, 400)
                return
            out["ok"] = True
            out["ms"] = int((time.time() - t0) * 1000)
            out["path"] = "weights/" + name + "." + fmt  # what the design stores
            self._json(out)
        except Exception as e:  # noqa: BLE001 — the form shows the message
            self._json({"ok": False, "error": str(e)}, 400)


def main():
    ap = argparse.ArgumentParser(description="nnstudio — the training canvas")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8124)
    ap.add_argument("--control-port", type=int, default=8125)
    ap.add_argument(
        "--control-host",
        default="127.0.0.1",
        help="where runners dial in (loopback by default)",
    )
    ap.add_argument(
        "--runner-token",
        default=os.environ.get("NNSTUDIO_RUNNER_TOKEN", ""),
        help="require this token in the runner's hello",
    )
    ap.add_argument(
        "--tls-cert", default="", help="serve https too (tools/tls_local.sh makes one)"
    )
    ap.add_argument("--tls-key", default="")
    args = ap.parse_args()
    control.set_token(args.runner_token)
    try:
        nn_tasks.reconcile()  # a task whose process is gone is done
    except Exception:  # noqa: BLE001 — the list repairs itself on read too
        pass
    try:
        nn_gateway.start()  # the Chat half's gateway, this process
    except nn_gateway.GatewayUnavailable as e:
        print("nnstudio: the Chat half's gateway is down — %s" % (e,), flush=True)
    ctl = control.ControlServer(
        (args.control_host, args.control_port), control.ControlHandler
    )
    threading.Thread(
        target=ctl.serve_forever, daemon=True, name="nnstudio-control"
    ).start()
    threading.Thread(
        target=control.heartbeat_loop, daemon=True, name="nnstudio-heartbeat"
    ).start()
    server = WebServer((args.host, args.port), Handler)
    tls = ""
    if args.tls_cert or args.tls_key:
        try:
            ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            ctx.load_cert_chain(args.tls_cert, args.tls_key or None)
            server.tls_ctx = ctx
            tls = " and https"
        except (OSError, ssl.SSLError) as e:  # the app still runs over http
            print(
                "nnstudio: the certificate could not be loaded (%s)" % (e,), flush=True
            )
    print(
        "nnstudio on http%s://%s:%d (runners on %s:%d)"
        % (
            "(s)" if tls else "",
            args.host,
            args.port,
            args.control_host,
            args.control_port,
        ),
        flush=True,
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
