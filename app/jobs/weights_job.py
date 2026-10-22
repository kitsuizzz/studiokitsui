#!/usr/bin/env python3
"""Weight metadata and weight export, outside the app server process.

The app server never imports torch. These two operations need the runtime to
read a GGUF/tensor list or to materialise a design's weights, so they run as
an app-side child process, like the training job. The request is JSON on
stdin; the answer is JSON on stdout.

    {"action": "tensors", "file": "/abs/weights/model.gguf"}
    {"action": "export", "canvas": {...}, "path": "/abs/weights/x.safetensors",
     "fmt": "safetensors"}
"""
import json
import os
import sys


ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from runtime import nn_torch  # noqa: E402  — torch belongs to this child only


def safe(obj):
    """JSON has no NaN/Infinity; the forms show null instead."""
    if isinstance(obj, float):
        return obj if obj == obj and abs(obj) != float("inf") else None
    if isinstance(obj, dict):
        return {k: safe(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [safe(v) for v in obj]
    return obj


def main():
    try:
        req = json.load(sys.stdin)
        action = str(req.get("action") or "")
        if action == "tensors":
            out = nn_torch.file_tensors(req.get("file") or "")
        elif action == "export":
            out = nn_torch.export_weights(req.get("canvas") or {},
                                          req.get("path") or "",
                                          str(req.get("fmt") or "safetensors"))
        else:
            raise ValueError("unknown action: %s" % action)
        print(json.dumps(safe(out), allow_nan=False))
    except Exception as e:  # noqa: BLE001 — the parent turns this into a form error
        print(json.dumps({"ok": False, "error": str(e)}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
