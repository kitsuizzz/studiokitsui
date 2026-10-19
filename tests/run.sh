#!/usr/bin/env bash
# nnstudio's offline suite: JS syntax, the UI harness, the pure GGUF->canvas
# builder, the torch engine, HTML balance and py_compile. Pass --live to also
# smoke the app and run a real agent against it.
set -u
cd "$(dirname "$0")/.."
PY=.venv/bin/python
fail=0
step() { printf '%-34s' "$1"; }
ok()   { echo "ok"; }
bad()  { echo "FAIL"; fail=1; }

step "extract the UI script"
sed -n '/^<script>$/,/^<\/script>$/p' ui/index.html | sed '1d;$d' > /tmp/nnstudio_ui_script.js && ok || bad

step "node --check"
node --check /tmp/nnstudio_ui_script.js >/dev/null && ok || bad

step "ui harness (DOM stub)"
node tests/ui_boot.js >/tmp/nnstudio_ui_harness.log 2>&1 && ok || { bad; tail -25 /tmp/nnstudio_ui_harness.log; }

step "vision templates (UI docs -> engine)"
$PY tests/vision_templates_test.py >/tmp/nnstudio_vision_templates.log 2>&1 && ok || { bad; tail -15 /tmp/nnstudio_vision_templates.log; }

step "diffusers gate (tiny UNet)"
$PY tests/diffusers_unet_test.py >/tmp/nnstudio_diffusers.log 2>&1 && ok || { bad; tail -15 /tmp/nnstudio_diffusers.log; }

step "GGUF -> canvas builder"
$PY tests/gguf_canvas_test.py >/tmp/nnstudio_gguf_canvas.log 2>&1 && ok || { bad; tail -15 /tmp/nnstudio_gguf_canvas.log; }

step "HF -> canvas builder"
$PY tests/hf_canvas_test.py >/tmp/nnstudio_hf_canvas.log 2>&1 && ok || { bad; tail -15 /tmp/nnstudio_hf_canvas.log; }

step "spec conformance (the gate)"
$PY tests/spec_conformance_test.py >/tmp/nnstudio_spec_conformance.log 2>&1 && ok || { bad; tail -25 /tmp/nnstudio_spec_conformance.log; }

step "reverse job (stubbed agent)"
$PY tests/reverse_job_test.py >/tmp/nnstudio_reverse_job.log 2>&1 && ok || { bad; tail -20 /tmp/nnstudio_reverse_job.log; }

step "chat job (stubbed agent)"
$PY tests/chat_job_test.py >/tmp/nnstudio_chat_job.log 2>&1 && ok || { bad; tail -20 /tmp/nnstudio_chat_job.log; }

step "brand (the logo, in both UIs)"
$PY tests/brand_test.py >/tmp/nnstudio_brand.log 2>&1 && ok || { bad; tail -15 /tmp/nnstudio_brand.log; }

step "studio account crypto (Chat's KDF)"
node tests/studio_crypto_test.js >/tmp/nnstudio_studio_crypto.log 2>&1 && ok || { bad; tail -15 /tmp/nnstudio_studio_crypto.log; }

step "the session seam (bundled for Node)"
studio/frontend/node_modules/.bin/esbuild studio/frontend/src/lib/canvasLink.ts --bundle --platform=node --format=cjs --define:import.meta.env.BASE_URL='"/chat/"' --outfile=/tmp/nnstudio_canvas_link_bundle.cjs >/tmp/nnstudio_canvas_link_build.log 2>&1 && ok || { bad; tail -15 /tmp/nnstudio_canvas_link_build.log; }

step "the session seam (the Chat half's view of the canvas)"
node tests/canvas_link_test.js >/tmp/nnstudio_canvas_link.log 2>&1 && ok || { bad; tail -15 /tmp/nnstudio_canvas_link.log; }

step "gateway bridge (in-process)"
$PY tests/gateway_bridge_test.py >/tmp/nnstudio_gateway_bridge.log 2>&1 && ok || { bad; tail -15 /tmp/nnstudio_gateway_bridge.log; }

step "torch engine (the agent's)"
$PY tests/nn_torch_test.py >/tmp/nnstudio_nn_torch.log 2>&1 && ok || { bad; tail -20 /tmp/nnstudio_nn_torch.log; }

step "native quant kernels (gguf)"
$PY tests/nn_quant_test.py >/tmp/nnstudio_nn_quant.log 2>&1 && ok || { bad; tail -20 /tmp/nnstudio_nn_quant.log; }

step "json boundary (no NaN/inf)"
$PY tests/json_safe_test.py >/tmp/nnstudio_json_safe.log 2>&1 && ok || { bad; tail -15 /tmp/nnstudio_json_safe.log; }

step "agent tasks (db + stream)"
$PY tests/nn_tasks_test.py >/tmp/nnstudio_nn_tasks.log 2>&1 && ok || { bad; tail -20 /tmp/nnstudio_nn_tasks.log; }

step "html balance"
$PY - <<'PY'
from html.parser import HTMLParser
VOID = {'area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'}
class P(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True); self.stack=[]; self.errors=[]
    def handle_starttag(self, tag, attrs):
        if tag not in VOID: self.stack.append((tag, self.getpos()))
    def handle_endtag(self, tag):
        if tag in VOID: return
        if not self.stack: self.errors.append("stray </%s>" % tag); return
        top, pos = self.stack.pop()
        if top != tag: self.errors.append("</%s> closes <%s> at %s" % (tag, top, pos))
for f in ('ui/index.html', 'ui/docs.html'):
    p = P(); p.feed(open(f, encoding='utf-8').read())
    if p.stack: p.errors.append(f + " unclosed: " + ", ".join("<%s>" % t for t, _ in p.stack))
    if p.errors:
        print("\n".join(f + ": " + e for e in p.errors))
        raise SystemExit(1)
PY
[ $? -eq 0 ] && ok || bad

step "py_compile"
$PY -m py_compile nn_engine.py nn_server.py nn_gateway.py nn_arc.py tools/reverse_job.py tools/reverse_model.py tools/quant_bench.py tools/train_job.py tools/chat_job.py tools/backend_check.py agent/nnstudio_agent.py agent/nn_torch.py agent/nn_quant.py && ok || bad

if [ "${1:-}" = "--live" ]; then
  step "live app"
  G=$(curl -s -m 10 localhost:8124/api/gpu | head -c 80)
  M=$(curl -s -m 10 localhost:8124/api/models | head -c 80)
  case "$G$M" in *'"cuda"'*'"models"'*) ok;; *) bad;; esac

  step "live chat half (the SPA)"
  C=$(curl -s -m 10 localhost:8124/chat)
  A=$(printf '%s' "$C" | grep -o '/chat/assets/[^"]*\.js' | head -1)
  CODE=""
  [ -n "$A" ] && CODE=$(curl -s -o /dev/null -w '%{http_code}' -m 10 "localhost:8124$A")
  if printf '%s' "$C" | grep -q '<html' && [ "$CODE" = "200" ]; then
    ok
  else
    bad; echo "    assets=${A:-none} status=${CODE:-none} (a build without VITE_BASE_PATH=chat emits /assets/… and serves blank — see studio/README.md)"
  fi

  step "live landing (the door and /studio)"
  D=$(curl -s -m 10 localhost:8124/ | grep -c "bxAtDoor")
  T=$(curl -s -m 10 localhost:8124/studio | grep -c "bxAtDoor")
  if [ "$D" -ge 1 ] && [ "$T" -ge 1 ]; then
    ok
  else
    bad; echo "    door=$D studio=$T"
  fi

  step "live chat gateway (in-process)"
  H=$(curl -s -m 10 localhost:8124/chat/healthz | head -c 40)
  case "$H" in *'"ok":true'*) ok;; *) bad;; esac

  step "live chat account (signup, store, signout)"
  node tests/live_account_test.js >/tmp/nnstudio_live_account.log 2>&1 && ok || { bad; tail -12 /tmp/nnstudio_live_account.log; }

  step "live gateway suite (needs MariaDB)"
  if (cd studio/backend && ../../.venv/bin/python -m pytest -q >/tmp/nnstudio_gateway_suite.log 2>&1); then
    ok
  elif grep -q "MariaDB is not reachable" /tmp/nnstudio_gateway_suite.log; then
    echo "ok  (MariaDB is down — the suite is skipped)"
  else
    bad; tail -20 /tmp/nnstudio_gateway_suite.log
  fi

  step "live agent + run"
  $PY tests/agent_test.py >/tmp/nnstudio_agent_live.log 2>&1 && ok || { bad; tail -20 /tmp/nnstudio_agent_live.log; }
fi
exit $fail
