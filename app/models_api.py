"""Model and weight-file APIs — the app-side listing, metadata and export.

The app server never imports torch. Weight metadata/export run in
`app/jobs/weights_job.py`; this module only lists files, resolves paths and
spawns that child.
"""
import json
import os
import re
import subprocess
import sys

from app import design as nn_engine
from shared import nn_tokenizers

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODELS_DIR = os.path.join(ROOT, "models")
WEIGHTS_DIR = os.path.join(ROOT, "weights")
WEIGHT_EXTS = (".gguf", ".safetensors", ".pt", ".pth", ".bin")


def run_weights_job(action, timeout=120, **payload):
    """Run one weight job in a child process and return its JSON answer."""
    cmd = [sys.executable, os.path.join(ROOT, "app", "jobs", "weights_job.py")]
    req = json.dumps(dict(action=action, **payload))
    try:
        p = subprocess.run(cmd, input=req, text=True, capture_output=True,
                           cwd=ROOT, timeout=timeout)
    except subprocess.TimeoutExpired:
        raise RuntimeError("the weight job timed out")
    if p.returncode != 0 and not (p.stdout or "").strip():
        raise RuntimeError((p.stderr or "the weight job failed").strip()[-600:])
    try:
        return json.loads(p.stdout)
    except ValueError:
        raise RuntimeError((p.stderr or p.stdout or "the weight job gave no answer").strip()[-600:])


def hf_tokenizer_meta(repo):
    """nn_tokenizers' metadata — stdlib only, so no torch is dragged in."""
    return nn_tokenizers.tokenizer_meta(repo)


def weight_path(text):
    """A design's relative path ('weights/x.pt') resolves against the repo."""
    p = str(text or "").strip()
    if p and not os.path.isabs(p):
        p = os.path.join(ROOT, p)
    return p


def list_weight_files():
    """Every weight file the app can offer: models/ and weights/."""
    out = []
    for base, label in ((MODELS_DIR, "models"), (WEIGHTS_DIR, "weights")):
        try:
            names = sorted(os.listdir(base))
        except OSError:
            continue
        for name in names:
            if not name.lower().endswith(WEIGHT_EXTS):
                continue
            full = os.path.join(base, name)
            if not os.path.isfile(full):
                continue
            try:
                size = os.path.getsize(full)
            except OSError:
                size = 0
            out.append({"name": name, "path": label + "/" + name,
                        "kind": os.path.splitext(name)[1].lstrip(".").lower(),
                        "size_mb": round(size / 2 ** 20)})
    return out


def safe_name(text, fallback="nnstudio-weights"):
    s = re.sub(r"[^A-Za-z0-9._-]+", "-", str(text or "").strip()).strip("-._")
    return s[:60] or fallback

def list_models():
    """Every local .gguf, in the shape the UI reads. The engine classifies each
    one by its own header — a text model or a vision encoder (mmproj) — so the
    folder and the file's name decide nothing."""
    return nn_engine.local_models()
