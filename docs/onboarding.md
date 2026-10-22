# Onboarding — the first day

Read these in order:

1. [`README.md`](../README.md) — what the app is, the two halves, how to run.
2. [`docs/architecture.md`](architecture.md) — the two backends, the boundary
   table, the training exception.
3. [`docs/glossary.md`](glossary.md) — runner vs AI agent vs session vs Studio.
4. [`ui/README.md`](../ui/README.md) — the generated shell, its slices, its hot
   paths, its test seams.
5. [`chat/README.md`](../chat/README.md) — the vendored Chat half.
6. [`runner/README.md`](../runner/README.md) — the studio backend.
7. [`docs/backend.md`](backend.md) — what the runner can execute.

## Run it

    ./run.sh                         # app backend on :8124
    python runner/runner.py --app 127.0.0.1:8125   # prints a code; enter it in Backend → Local
    ./tests/run.sh                   # the offline gate

For UI work:

    .venv/bin/python tools/build_ui.py          # regenerate ui/index.html
    cd chat/frontend && VITE_BASE_PATH=chat npm run build

## Trace one canvas run

1. `ui/src/js/145-gestures.js` — the input box's run button.
2. `ui/src/js/110-run-flow.js` — the request, the flow marks, the result.
3. `app/server.py` `/api/run` — dispatch to the connected runner.
4. `runner/runner.py` — `run`, `runtime/nn_torch.py` compiles and executes.
5. The result comes back to `bxRunResult` and the boxes' readouts.

Training is different on purpose: `app/server.py` `/api/tasks` spawns
`app/jobs/train_job.py` beside the app.

## Trace one chat message

1. `chat/frontend/src/components/Composer.tsx` — the message.
2. `chat/frontend/src/App.tsx` — the turn and stream.
3. `app/gateway_bridge.py` — the in-process bridge.
4. `chat/backend/gateway` — accounts, the sealed store, `/chat/v1` upstream.
5. `ui/src/js/95-shell-chat.js` — the shell's Chat | Studio crossing and the
   session list.

## Add a box kind

1. `app/design.py` — the design builder, if the kind comes from a model.
2. `ui/src/js/10-values.js` — the label/shape vocabulary.
3. `ui/src/js/20-model-link.js` — ports.
4. `ui/src/js/40-model-edit.js` — `bxConfigure`.
5. `ui/src/js/75-card-render.js` — `bxCard`.
6. `ui/src/js/135-models-weights.js` — `bxForm`.
7. `runtime/nn_torch.py` — execution, if it computes.
8. `tests/ui_boot.js` and `tests/nn_torch_test.py` — the two gates.

## Where not to start

- Do not edit `ui/index.html`; edit `ui/src`, then rebuild.
- Do not import `runtime/` into `app/server.py`; app-side jobs may, in a child
  process.
- Do not call the runner an agent in new code; see the glossary.
- Do not add a second backend process for AI jobs; they are app-side workers.
