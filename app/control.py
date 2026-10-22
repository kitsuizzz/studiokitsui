"""The runner control channel — one stateful TCP connection per studio backend.

The runner dials the app, says hello with its machine specs, then answers
`run`, `load`, `offload`, heartbeat and progress messages. This module owns
the connection registry, the heartbeat, and the welcome/hello checks; the app
server owns the HTTP endpoints that dispatch to `local_runner()`.

The channel is loopback by default. `NNSTUDIO_RUNNER_TOKEN` adds a shared
token to `hello`, and `hello.protocol` is versioned.
"""

import hashlib
import hmac
import json
import os
import re
import secrets
import socket
import socketserver
import threading
import time
import uuid

PROTOCOL = 1
RUNNER_TOKEN = ""  # set by app.server.main(); a shared legacy token, when set

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOKENS_FILE = os.path.join(ROOT, ".runner_tokens.json")
PAIR_TTL = 30 * 60  # the runner's code lives this long
PAIR_MAX_ATTEMPTS = 10  # wrong codes, per pending code
PAIR_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O or 1/I

_RUNNERS = {}
_RUNNER_LOCK = threading.Lock()
RUNNER_TIMEOUT = 45  # no word for this long: the connection is stale

# A runner that is not paired yet: its socket stays open, waiting for a browser
# to enter the code it printed. The server never stores the code itself.
_PAIRS = {}
_TOKENS = None  # token hash -> {name, created}
_TOKEN_LOCK = threading.Lock()
_CLAIMS = {}  # client ip -> recent claim times
_CLAIMS_LOCK = threading.Lock()


class Runner:
    def __init__(self, conn, addr, name=None):
        self.conn = conn
        self.addr = addr
        self.f = conn.makefile("rwb")
        self.cid = uuid.uuid4().hex[:12]  # this connection, not this machine
        self.name = name
        self.specs = {}
        self.usage = None  # RAM/VRAM, pushed by the runner
        self.progress = None  # the running design's data-flow order
        self.since = time.time()
        self.last_seen = time.time()
        self.busy = 0  # a load or a run is in flight
        self._pending = {}
        self._lock = threading.Lock()
        self.alive = True

    def send(self, obj):
        with self._lock:
            self.f.write((json.dumps(obj) + "\n").encode())
            self.f.flush()

    def request(self, obj, timeout=1800):
        """Send one command and wait for its result (runs in an HTTP thread).
        While in flight the runner is `busy`: the heartbeat will not drop a
        connection that is simply thinking."""
        rid = uuid.uuid4().hex[:12]
        box = {"event": threading.Event(), "reply": None}
        self._pending[rid] = box
        self.busy += 1
        try:
            try:
                self.send(dict(obj, id=rid))
            except (OSError, ValueError):
                self._pending.pop(rid, None)
                return None
            box["event"].wait(timeout)
            self._pending.pop(rid, None)
            return box["reply"]
        finally:
            self.busy -= 1

    def on_message(self, msg):
        self.last_seen = time.time()
        kind = msg.get("type")
        if kind == "usage":
            self.usage = msg.get("usage") or None
            return
        if kind == "progress":
            if self.progress is None or self.progress.get("id") != msg.get("id"):
                self.progress = {"id": msg.get("id"), "nodes": [], "done": 0}
            if msg.get("step") is not None:
                step = int(msg["step"])
                if self.progress.get("step") != step:
                    self.progress["step"] = step  # a new forward pass
                    self.progress["nodes"] = []  # re-walks: the marks restart
            self.progress["nodes"].extend(msg.get("nodes") or [])
            if msg.get("load"):
                self.progress["load"] = msg["load"]  # a compile's bytes landed
            if msg.get("note"):
                self.progress["note"] = msg["note"]  # e.g. a huggingface download
            self.progress["done"] = int(msg.get("done") or len(self.progress["nodes"]))
            return
        if kind == "result" and msg.get("id") in self._pending:
            box = self._pending[msg["id"]]
            box["reply"] = msg
            box["event"].set()

    def close(self):
        self.alive = False
        try:
            self.conn.shutdown(socket.SHUT_RDWR)  # wake the reader thread
        except OSError:
            pass
        try:
            self.f.close()
        except (OSError, ValueError):
            pass
        try:
            self.conn.close()
        except OSError:
            pass


def runner_public(a):
    return {
        "name": a.name,
        "remote": "%s:%s" % a.addr,
        "since": int(a.since),
        "last_seen": int(a.last_seen),
        "specs": a.specs,
        "usage": a.usage,
    }


def local_runner():
    """The runner run/load goes to the one that connected last.

    A freshly attached runner takes over — starting one next to the systemd
    service means *that* one answers, and when it exits the service (still
    alive) answers again. Usage pings keep every runner's last_seen fresh, so
    connection time, not activity, decides."""
    with _RUNNER_LOCK:
        alive = [a for a in _RUNNERS.values() if a.alive]
    return max(alive, key=lambda a: a.since) if alive else None


def backend_info():
    a = local_runner()
    pub = runner_public(a) if a else None
    # `runner` is the name; `agent` stays as an alias for one release so an
    # older shell (or a script) does not lose the connection object.
    return {
        "ok": True,
        "local": {"connected": a is not None, "runner": pub, "agent": pub},
    }


def set_token(token):
    global RUNNER_TOKEN
    RUNNER_TOKEN = str(token or "")


# ---- runner pairing: a code the runner prints, a browser claims it ----------


def _load_tokens():
    try:
        with open(TOKENS_FILE, encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _save_tokens(tokens):
    try:
        tmp = TOKENS_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(tokens, f, indent=2, sort_keys=True)
        os.chmod(tmp, 0o600)
        os.replace(tmp, TOKENS_FILE)
    except OSError:
        pass


def _tokens():
    global _TOKENS
    if _TOKENS is None:
        _TOKENS = _load_tokens()
    return _TOKENS


def _token_hash(token):
    return hashlib.sha256(str(token or "").encode()).hexdigest()


def _token_ok(token):
    if not token:
        return False
    with _TOKEN_LOCK:
        return _token_hash(token) in _tokens()


def _issue_token(name):
    token = "rt_" + secrets.token_urlsafe(32)
    with _TOKEN_LOCK:
        tokens = _tokens()
        tokens[_token_hash(token)] = {
            "name": str(name or ""),
            "created": int(time.time()),
        }
        _save_tokens(tokens)
    return token


def _normalize_code(code):
    """The runner prints ABCD-EFGH; accept it with or without the hyphen."""
    text = re.sub(r"[^A-Z0-9]", "", str(code or "").upper())
    if len(text) != 8 or any(ch not in PAIR_ALPHABET for ch in text):
        return None
    return text


def _pair_hash(code):
    # Domain-separate pairing codes from long-lived runner tokens.
    return hashlib.sha256(("pair:" + code).encode()).hexdigest()


class _Pair:
    def __init__(self, runner, code_hash):
        self.runner = runner
        self.code_hash = code_hash
        self.created = time.time()
        self.expires = self.created + PAIR_TTL
        self.event = threading.Event()
        self.token = ""
        self.error = ""
        self.attempts = 0


def register_pair(runner, code):
    code = _normalize_code(code)
    if not code:
        return None
    pair = _Pair(runner, _pair_hash(code))
    with _RUNNER_LOCK:
        _PAIRS[pair.code_hash] = pair
    return pair


def _allow_claim(ip):
    now = time.time()
    key = str(ip or "?")
    with _CLAIMS_LOCK:
        recent = [t for t in _CLAIMS.get(key, []) if now - t < 60]
        if len(recent) >= 10:
            _CLAIMS[key] = recent
            return False
        recent.append(now)
        _CLAIMS[key] = recent
    return True


def claim_pair(code, ip=""):
    """A browser claims the runner that printed this code.

    The code is single-use and short-lived; the runner's socket stays open
    until this runs, then receives its long-lived runner token."""
    if not _allow_claim(ip):
        return {
            "ok": False,
            "rate": True,
            "error": "too many connection attempts — wait a minute",
        }
    code = _normalize_code(code)
    if not code:
        return {"ok": False, "error": "enter the 8-character code the runner printed"}
    key = _pair_hash(code)
    with _RUNNER_LOCK:
        pair = _PAIRS.get(key)
        if pair is None:
            return {
                "ok": False,
                "error": "that code is not live — check the runner's console",
            }
        if time.time() > pair.expires:
            _PAIRS.pop(key, None)
            pair.error = "expired"
            pair.event.set()
            return {
                "ok": False,
                "error": "that code expired — the runner will print a new one",
            }
        pair.attempts += 1
        if pair.attempts > PAIR_MAX_ATTEMPTS:
            _PAIRS.pop(key, None)
            pair.error = "too many attempts"
            pair.event.set()
            return {
                "ok": False,
                "error": "too many attempts — the runner will print a new code",
            }
        token = _issue_token(pair.runner.name)
        pair.token = token
        pair.event.set()
        _PAIRS.pop(key, None)
        public = runner_public(pair.runner)
    return {"ok": True, "runner": public}


def heartbeat_loop():
    while True:
        time.sleep(15)
        now = time.time()
        with _RUNNER_LOCK:
            for key, pair in list(_PAIRS.items()):
                if not pair.event.is_set() and now > pair.expires:
                    _PAIRS.pop(key, None)
                    pair.error = "expired"
                    pair.event.set()
        for key, a in list(_RUNNERS.items()):
            if a.busy <= 0 and now - a.last_seen > RUNNER_TIMEOUT:
                a.close()  # its reader wakes on shutdown
                with _RUNNER_LOCK:
                    _RUNNERS.pop(key, None)
                continue
            try:
                a.send({"type": "ping", "t": now})
            except (OSError, ValueError):
                a.close()
                with _RUNNER_LOCK:
                    _RUNNERS.pop(key, None)


class ControlHandler(socketserver.BaseRequestHandler):
    """One runner connection: pair or authenticate, then serve until it hangs up."""

    def handle(self):
        self.request.settimeout(15)
        runner = Runner(self.request, self.client_address)
        try:
            line = runner.f.readline()
            if not line:
                return
            hello = json.loads(line)
        except (OSError, ValueError):
            runner.close()
            return
        if hello.get("protocol") not in (None, PROTOCOL):
            runner.close()
            return
        runner.name = str(hello.get("name") or self.client_address[0])
        runner.specs = hello.get("specs") or {}
        kind = hello.get("type")
        if kind == "pair":
            pair = register_pair(runner, hello.get("code"))
            if pair is None:
                try:
                    runner.send(
                        {"type": "error", "error": "a pairing code is required"}
                    )
                except (OSError, ValueError):
                    pass
                runner.close()
                return
            self.request.settimeout(None)
            try:
                runner.send({"type": "pair-wait", "ttl": PAIR_TTL})
                while not pair.event.wait(1.0):
                    if not runner.alive:
                        return
                    if time.time() > pair.expires:
                        pair.error = "expired"
                        pair.event.set()
                if pair.error or not pair.token:
                    try:
                        runner.send(
                            {
                                "type": "pair-expired",
                                "error": pair.error or "pairing failed",
                            }
                        )
                    except (OSError, ValueError):
                        pass
                    return
                runner.send(
                    {
                        "type": "paired",
                        "token": pair.token,
                        "app": "nnstudio",
                        "protocol": PROTOCOL,
                    }
                )
            except (OSError, ValueError):
                return
            finally:
                with _RUNNER_LOCK:
                    _PAIRS.pop(pair.code_hash, None)
            self._serve_runner(runner)
            return
        if kind != "hello":
            runner.close()
            return
        token = str(hello.get("token") or "")
        if not (
            (RUNNER_TOKEN and hmac.compare_digest(token, RUNNER_TOKEN))
            or _token_ok(token)
        ):
            try:
                runner.send(
                    {
                        "type": "error",
                        "error": "unauthorized \u2014 use the runner's pairing code",
                    }
                )
            except (OSError, ValueError):
                pass
            runner.close()
            return
        self._serve_runner(runner)

    def _serve_runner(self, runner):
        self.request.settimeout(None)
        with _RUNNER_LOCK:
            _RUNNERS[runner.cid] = runner  # one entry per connection:
            # same-named machines coexist
        try:
            runner.send({"type": "welcome", "app": "nnstudio", "protocol": PROTOCOL})
            while True:
                line = runner.f.readline()
                if not line:
                    break
                try:
                    runner.on_message(json.loads(line))
                except ValueError:
                    continue
        except (OSError, ValueError):
            pass
        finally:
            with _RUNNER_LOCK:
                _RUNNERS.pop(runner.cid, None)
            runner.close()


class ControlServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


# Old names: the wire/API used "agent" for what is now the runner. Keep the
# aliases while the UI/tests move; new code uses the runner names.
Agent = Runner
agent_public = runner_public
local_agent = local_runner
_AGENTS = _RUNNERS
