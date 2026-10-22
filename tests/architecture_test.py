#!/usr/bin/env python3
"""The two-backend boundary: the app must stay light, the runner separate.

These are import-graph checks, not behaviour checks. They catch the easy
regression: a `torch` import drifting into the app server, or the runner
reaching back into `app/`/`chat/`.
"""

import ast
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FAILED = []


def check(name, fn):
    try:
        fn()
        print("  ok   " + name)
    except AssertionError as e:
        FAILED.append(name)
        print("  FAIL " + name + " — " + str(e))


def modules(path):
    """Every module name imported by one Python file (`from a.b import c` → a.b)."""
    with open(path, encoding="utf-8") as f:
        tree = ast.parse(f.read(), filename=path)
    out = set()
    for n in ast.walk(tree):
        if isinstance(n, ast.Import):
            for a in n.names:
                out.add(a.name)
        elif isinstance(n, ast.ImportFrom):
            if n.level:
                continue  # a relative import inside its package
            if n.module:
                out.add(n.module)
    return out


def banned(path, prefixes):
    mods = modules(os.path.join(ROOT, path))
    hits = sorted(
        m for m in mods if any(m == p or m.startswith(p + ".") for p in prefixes)
    )
    assert not hits, "%s imports %s" % (path, ", ".join(hits))


def app_server_is_light():
    banned("app/server.py", ("torch", "runtime", "runner", "chat"))


def app_modules_are_light():
    for path in (
        "app/design.py",
        "app/arc.py",
        "app/tasks.py",
        "app/gateway_bridge.py", "app/control.py",
                 "app/jobs_api.py", "app/models_api.py",
        "app/jobs/reverse_job.py",
        "app/jobs/reverse_model.py",
        "app/jobs/chat_job.py",
        "app/jobs/agent_job.py",
    ):
        banned(path, ("torch", "runtime", "runner", "chat"))


def runtime_is_standalone():
    for name in os.listdir(os.path.join(ROOT, "runtime")):
        if name.endswith(".py"):
            banned("runtime/" + name, ("app", "runner", "chat"))


def shared_is_standalone():
    for name in os.listdir(os.path.join(ROOT, "shared")):
        if name.endswith(".py"):
            banned("shared/" + name, ("app", "runtime", "runner", "chat", "torch"))


def runner_is_standalone():
    for base, _dirs, files in os.walk(os.path.join(ROOT, "runner")):
        for name in files:
            if name.endswith(".py"):
                rel = os.path.relpath(os.path.join(base, name), ROOT)
                banned(rel, ("app", "chat"))


def chat_gateway_is_standalone():
    for base, _dirs, files in os.walk(os.path.join(ROOT, "chat", "backend", "gateway")):
        for name in files:
            if name.endswith(".py"):
                rel = os.path.relpath(os.path.join(base, name), ROOT)
                banned(rel, ("app", "runtime", "runner", "torch"))


def training_is_the_torch_exception():
    # The two app-side jobs that need the runtime are explicitly allowed.
    assert "runtime" in modules(os.path.join(ROOT, "app/jobs/train_job.py"))
    assert "runtime" in modules(os.path.join(ROOT, "app/jobs/weights_job.py"))


def run_script_uses_the_package():
    with open(os.path.join(ROOT, "run.sh"), encoding="utf-8") as f:
        text = f.read()
    assert "-m app.server" in text, "run.sh does not start app.server as a module"


check("the app server never imports torch/runtime/runner/chat", app_server_is_light)
check("the other app modules stay light", app_modules_are_light)
check("runtime/ imports no app code", runtime_is_standalone)
check("shared/ imports no app code", shared_is_standalone)
check("runner/ imports no app or chat code", runner_is_standalone)
check("the chat gateway stands alone", chat_gateway_is_standalone)
check(
    "training and weights are the app-side runtime exception",
    training_is_the_torch_exception,
)
check("run.sh starts the app package", run_script_uses_the_package)

if FAILED:
    print("architecture_test: %d failure(s): %s" % (len(FAILED), ", ".join(FAILED)))
    sys.exit(1)
print("architecture_test: all assertions passed")
