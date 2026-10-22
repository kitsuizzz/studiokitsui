# Architecture — one app, two backends

Studio Kitsui is **one app** with two mains, **one app backend**, and **one
studio backend** (the runner). The boundaries are deliberate: the app backend
never imports torch; the runner is the only network-facing design executor;
training is the one app-side exception.

```
Browser
  one shell (ui/) — top bar, session list, Chat | Studio switch
    ├─ Studio main: the canvas
    └─ Chat main: #nn-chat, the React SPA in chat/frontend
          │ HTTP
  App backend — one process (app/server.py)
    ├─ UI/static: ui/index.html, chat/frontend/dist
    ├─ Chat gateway: chat/backend (FastAPI, in-process via app/gateway_bridge.py)
    ├─ app-side jobs: app/jobs/ (reverse, chat, python, train, weights)
    ├─ job drivers: app/jobs_api.py
    ├─ model/weight files: app/models_api.py
    ├─ task DB + orchestration: app/tasks.py
    ├─ design builder: app/design.py (GGUF/HF → canvas)
    ├─ researched specs: app/arc.py
    └─ control server: app/control.py (port 8125)
          ▲ outbound TCP, newline JSON
  Studio backend — one separate process (runner/runner.py)
    └─ inference / load / offload, using the shared runtime/
```

## Roles

| role | process | owns | must not import |
|---|---|---|---|
| **App backend** | `python -m app.server` | HTTP/UI, chat gateway bridge, tasks, app jobs, design builder, control server | `torch`, `runtime/`, `runner/` |
| **Chat gateway** | inside the app process | accounts, sealed store, OpenAI pass-through | `runtime/`, `runner/` |
| **App jobs** | child processes of the app | reverse/chat/python agents, training, weight metadata/export | the app server's internals (they use `app.tasks`/`app.arc`/`runtime`) |
| **Runner** | `runner/runner.py` on the execution machine | inference, load, offload | `app/`, `chat/` |
| **Runtime** | library, imported by the runner and the train/weights jobs | torch execution, quant kernels, tokenizers | `app/`, `runner/`, `chat/` |

The runner dials the app; the app never dials the runner. The control channel
carries `pair`, `hello`, `ping`, `run`, `load`, `offload`, progress and results.
It binds loopback by default. A fresh runner prints a one-time code and parks on
`pair`; the browser claims it at `POST /api/runner/claim`, the app issues a
per-runner token (stored hashed in `.runner_tokens.json`), and later `hello`
messages carry that token. `NNSTUDIO_RUNNER_TOKEN` remains a legacy shared-token
check, and `hello.protocol` is versioned.

## The training exception

Training is intentionally app-side:

- `app/server.py` writes a `train` task row and spawns `app/jobs/train_job.py`.
- That child process imports `runtime/nn_torch.py` and trains on the app host.
- The app **server process** still never imports torch; only the child does.
- The runner remains the backend for inference/load/offload. The Backend
  menu's machine is therefore the runner for inference; the training pane's
  run happens beside the app.

Weight metadata and export (`app/jobs/weights_job.py`) follow the same rule:
the server spawns a torch child instead of importing the runtime.

## Naming

| path | meaning |
|---|---|
| `app/` | the one app backend |
| `chat/` | the Chat half (AI Studio / chat.kitsui), vendored |
| `chat/backend/` | the Chat gateway (in-process) |
| `chat/frontend/` | the Chat SPA |
| `runtime/` | the shared torch execution library |
| `runner/` | the studio backend; the only design executor |
| `ui/` | the shell + canvas frontend (generated page) |
| `app/jobs/` | app-side workers (AI jobs + train + weights) |

`studio` remains the product name of the canvas half and the `/studio` URL;
it is not a directory name for the Chat half anymore.

## Modal

Remote — Modal is a **future runner deployment**, not a second architecture.
The menu remembers the choice, but Run stays disabled until a Modal runner
implements the same protocol. Training remains app-side regardless.

## Build and test seams

- `ui/index.html` is generated from `ui/src` by `tools/build_ui.py`;
  `tests/run.sh` checks freshness.
- `chat/frontend` is built with `VITE_BASE_PATH=chat npm run build`.
- The runner protocol is newline JSON; `app/control.py` and the runner's
  `hello` are its two sides.
- The account/session sealed-store contract (keys, AAD, records) is
  [`docs/e2e.md`](e2e.md).
- Boundary tests should reject `torch`/`runtime`/`runner` imports in
  `app/server.py` and `app`/`chat` imports in `runner/`.
