"""App-side job drivers — the only path that turns a task row into a process.

These run beside the app backend: the AI jobs (reverse/python/chat) and the
app-side training and weight jobs. The runner is not involved here.
"""
import json
import os
import shutil
import subprocess
import sys
import time

from app import arc as nn_arc
from app import tasks as nn_tasks

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


# ---------------------------------------------------------------- reverse jobs
# `build canvas` on a repo without an `hf_arc` row starts the reverse-model
# agent in the background (app/jobs/reverse_job.py), keyed by the repo; the app
# polls the status file and paints the checklist on the box. Only the job's
# own gates land a row in the database — the agent's say-so never does.
def reverse_status(repo):
    """The job's status for one repo, or None while it has not started."""
    try:
        with open(nn_arc.state_path(repo, ".json"), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def reverse_find(family):
    """The live job of a family, for callers that only know the family."""
    try:
        names = os.listdir(nn_arc.state_dir())
    except OSError:
        return None
    for name in sorted(names):
        if not name.endswith(".json") or name.endswith(".todos.json"):
            continue
        try:
            with open(os.path.join(nn_arc.state_dir(), name), encoding="utf-8") as f:
                st = json.load(f)
        except (OSError, ValueError):
            continue
        if st.get("family") == family and not st.get("done"):
            return st
    return None


def spawn_detached(cmd, log, slug):
    """Run one job so it outlives the app.

    A detached child is not enough when the app runs under systemd: restarting
    the service kills every process in its cgroup (KillMode=control-group),
    even one in its own session — and only the task being deleted may stop a
    job. A transient unit is its own cgroup, so the job keeps going; without
    systemd, fall back to a plain detached child.
    """
    os.makedirs(os.path.dirname(log), exist_ok=True)
    if os.environ.get("INVOCATION_ID") and shutil.which("systemd-run"):
        unit = "nnstudio-%s-%d" % ((slug or "job")[:40], int(time.time()))
        runner = ["systemd-run", "--user", "--collect", "--quiet",
                  "--unit", unit, "--working-directory", ROOT,
                  "--property=StandardOutput=append:%s" % log,
                  "--property=StandardError=append:%s" % log]
        for key in ("NNSTUDIO_REVERSE_AGENT", "NNSTUDIO_REVERSE_MODEL",
                    "NNSTUDIO_REVERSE_BASE_URL", "NNSTUDIO_REVERSE_API_KEY",
                    "NNSTUDIO_ARC_STATE_DIR", "NNSTUDIO_ARC_DB",
                    "NNSTUDIO_TASKS_DB",
                    "HF_TOKEN", "HUGGING_FACE_HUB_TOKEN"):
            if os.environ.get(key):
                runner += ["--setenv=%s=%s" % (key, os.environ[key])]
        rc = 1
        try:
            p = subprocess.Popen(runner + ["--"] + cmd, cwd=ROOT,
                                 stdout=subprocess.DEVNULL,
                                 stderr=subprocess.DEVNULL)
            rc = p.wait(timeout=10)                 # systemd-run exits once up
        except subprocess.TimeoutExpired:
            return                                  # starting; assume it is up
        except OSError:
            rc = 1
        if rc == 0:
            return                                  # the transient unit is up
    with open(log, "ab") as out:
        subprocess.Popen(cmd, cwd=ROOT, stdout=out, stderr=subprocess.STDOUT,
                         start_new_session=True)


def spawn_reverse(repo, family, task_id=None):
    """The reverse driver: research one HF repo, gated by the job's own gates."""
    cmd = [sys.executable, os.path.join(ROOT, "app", "jobs", "reverse_job.py"),
           repo, "--family", family]
    log = nn_arc.state_path(repo, ".log")
    if task_id:
        cmd += ["--task", task_id]
        row = nn_tasks.get(task_id)          # the durable stream the box tails
        if row and row.get("log"):
            log = row["log"]
    spawn_detached(cmd, log, "reverse-" + nn_arc.repo_slug(repo))


def signal_task(task, sig):
    """Signal everything that runs one task: the wrapper's process group first
    (it owns its agent), then the agent's own session group."""
    for key in ("pid", "agent_pid"):
        pid = (task or {}).get(key)
        if not pid:
            continue
        try:
            os.killpg(os.getpgid(int(pid)), sig)
        except OSError:
            try:
                os.kill(int(pid), sig)
            except OSError:
                pass


def fire_reverse(task):
    """Turn one task row into a running job — the only firing path there is.

    The family is resolved **inside the wrapper**, never here: whatever goes
    wrong (a gated repo without a token, an unreachable hub) then lands in the
    task's own stream, where the box shows it — not in a pre-spawn refusal
    nobody can see."""
    repo = nn_arc.canonical(str((task.get("params") or {}).get("repo") or ""))
    family = str((task.get("meta") or {}).get("family") or "").strip()
    try:
        have = bool(repo and nn_arc.get(repo))     # the library already answered
    except Exception:  # noqa: BLE001 — a broken row must not block the ask
        have = False
    if have:
        nn_tasks.update(task["id"], status="done", outcome="ok", finished=time.time(),
                        phase="done",
                        meta=dict(task.get("meta") or {}, arc=True,
                                  note="already in the library — nothing to reverse"))
        return True, None
    try:
        spawn_reverse(repo, family, task_id=task["id"])
    except OSError as e:
        nn_tasks.update(task["id"], status="done", outcome="failed",
                        finished=time.time(),
                        meta=dict(task.get("meta") or {},
                                  error="could not start the job: %s" % e))
        return False, "could not start the job: %s" % e
    return True, None


def fire_agent(task):
    """The general-purpose driver: one prompt, one agent, its stream teed."""
    prompt = str((task.get("params") or {}).get("prompt") or "").strip()
    if not prompt:
        nn_tasks.update(task["id"], status="done", outcome="failed",
                        finished=time.time(),
                        meta=dict(task.get("meta") or {}, error="the task has no prompt"))
        return False, "the task has no prompt"
    log = task.get("log") or nn_tasks.log_file(task["id"])
    cmd = [sys.executable, os.path.join(ROOT, "app", "jobs", "agent_job.py"),
           "--task", task["id"], "--prompt", prompt]
    try:
        spawn_detached(cmd, log, "agent-" + task["id"])
    except OSError as e:
        nn_tasks.update(task["id"], status="done", outcome="failed",
                        finished=time.time(),
                        meta=dict(task.get("meta") or {},
                                  error="could not start the job: %s" % e))
        return False, "could not start the job: %s" % e
    return True, None


def fire_chat(task):
    """One conversational turn: the message, the agent in its session,
    streamed. The session comes from the previous turn's meta (the runner
    mirrors it in), so follow-ups remember the conversation."""
    p = task.get("params") or {}
    msg = str(p.get("message") or "").strip()
    if not msg:
        nn_tasks.update(task["id"], status="done", outcome="failed",
                        finished=time.time(),
                        meta=dict(task.get("meta") or {},
                                  error="the turn has no message"))
        return False, "the turn has no message"
    log = task.get("log") or nn_tasks.log_file(task["id"])
    cmd = [sys.executable, os.path.join(ROOT, "app", "jobs", "chat_job.py"),
           "--task", task["id"], "--message", msg]
    if p.get("session"):
        cmd += ["--session", str(p["session"])]
    if p.get("repo"):
        cmd += ["--repo", str(p["repo"])]
    try:
        spawn_detached(cmd, log, "chat-" + task["id"])
    except OSError as e:
        nn_tasks.update(task["id"], status="done", outcome="failed",
                        finished=time.time(),
                        meta=dict(task.get("meta") or {},
                                  error="could not start the job: %s" % e))
        return False, "could not start the job: %s" % e
    return True, None


def fire_train(task):
    """The training driver: a design on disk in, checkpointed steps out."""
    p = task.get("params") or {}
    design = str(p.get("design") or "")
    if not design or not os.path.isfile(design):
        why = "the task has no design to train"
        nn_tasks.update(task["id"], status="done", outcome="failed",
                        finished=time.time(),
                        meta=dict(task.get("meta") or {}, error=why))
        return False, why
    log = task.get("log") or nn_tasks.log_file(task["id"])
    cmd = [sys.executable, os.path.join(ROOT, "app", "jobs", "train_job.py"),
           "--task", task["id"], "--design", design,
           "--name", str(p.get("name") or task["id"])]
    for flag, key in (("--checkpoint", "checkpoint"), ("--batch", "batch"),
                      ("--lr", "lr"), ("--steps", "steps"),
                      ("--save-every", "save_every"),
                      ("--eval-every", "eval_every"),
                      ("--optimizer", "optimizer"),
                      ("--weight-decay", "weight_decay"),
                      ("--clip", "clip"),
                      ("--temperature", "temperature"),
                      ("--max-tokens", "max_tokens"),
                      ("--n-samples", "n_samples")):
        if p.get(key) not in (None, ""):
            cmd += [flag, str(p[key])]
    try:
        spawn_detached(cmd, log, "train-" + task["id"])
    except OSError as e:
        nn_tasks.update(task["id"], status="done", outcome="failed",
                        finished=time.time(),
                        meta=dict(task.get("meta") or {},
                                  error="could not start the job: %s" % e))
        return False, "could not start the job: %s" % e
    return True, None


def train_cmd_file(task_id):
    return os.path.join(ROOT, "agents", task_id + ".cmd")


def fire_task(task):
    """Turn one task row into a running job — the only firing path there is."""
    t = (task or {}).get("type")
    if t == "reverse":
        return fire_reverse(task)
    if t == "python":
        return fire_agent(task)
    if t == "chat":
        return fire_chat(task)
    if t == "train":
        return fire_train(task)
    return False, "unknown task type: %s" % t
