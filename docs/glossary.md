# Glossary

The product and the code use a few overloaded words. This is the one place
they are pinned down.

| term | means | path |
|---|---|---|
| **app backend** | the one HTTP process: UI, API, chat gateway bridge, tasks, app-side jobs, design builder, control server | `app/server.py` |
| **Chat half** | AI Studio / chat.kitsui: the conversation main, its SPA, its FastAPI gateway | `chat/` |
| **Studio** | the canvas half and the `/studio` address. It is a product name, not the `studio/` directory (that was renamed `chat/`) | `ui/`, `runner/` |
| **canvas** | one design: boxes, wires, saved as JSON | `ui/src/js`, `app/design.py` |
| **session** | a conversation and the canvas it is bound to; one row in the sidebar | `ui/src/js/90-tabs-session.js`, `chat/frontend/src/lib/canvasLink.ts` |
| **runner** | the studio backend: the separate process that executes inference, load and offload on the design machine | `runner/runner.py` |
| **runtime** | the shared torch execution library used by the runner and by app-side training/weights jobs | `runtime/` |
| **AI agent / job** | an AI worker task — reverse, chat, python — or the canvas box that views it. This is **not** the runner | `app/jobs/`, `app/tasks.py`, the `agent` box kind |
| **app-side job** | a child process the app starts: reverse, chat, python, training, weight metadata/export | `app/jobs/` |
| **Modal** | a future deployment of the same runner, not a separate backend | UI Backend menu, not wired |
| **one app** | one shell page with two mains, one account, one session list, one origin | `ui/index.html`, `chat/frontend` |

Rule of thumb: if it runs a canvas design, it is the **runner**; if it is an AI
worker or an AI box, it is an **agent/job**. Training is the one design job
that deliberately runs **app-side**.
