// ─── nnstudio shell · 105 · backend and run setup ─────────────────────────────────────
// the Backend menu, the run switch, usage rows, and backend feeds.
// Order is load-bearing: this slice is concatenated after the one before it.

function bxtBackendLoad() {
  if (!bxSessionHint()) {                     // a guest keeps nothing
    BX_BACKEND.mode = "local";
    BX_BACKEND.key = "";
    return;
  }
  try {
    BX_BACKEND.mode = localStorage.getItem("nnstudio_backend") === "remote" ? "remote" : "local";
    BX_BACKEND.key = localStorage.getItem("nnstudio_modal_key") || "";
  } catch (e) {}
}
function bxtBackendPick(mode) {
  BX_BACKEND.mode = mode === "remote" ? "remote" : "local";
  try { if (bxSessionHint()) localStorage.setItem("nnstudio_backend", BX_BACKEND.mode); } catch (e) {}
  bxtBackendRender();
}
function bxtBackendToggle() {
  const open = bxtToggle("bxtBackendMenu", "bxtBackend");
  if (open) bxtBackendRender();
  return open;
}
// one collapsible section: the header, and the pane when it is dropped down
function bxtBackendSection(menu, name, label) {
  const open = bxbOpen === name;
  const head = mk("div", { class: "bxtcat", text: label,
                           title: open ? "collapse" : "expand" });
  if (BX_BACKEND.mode === name)
    head.appendChild(mk("span", { class: "bxton", text: " \u25cf" }));   // the one in use
  head.appendChild(mk("span", { class: "chev", text: open ? "\u25be" : "\u25b8" }));
  head.addEventListener("click", () => {
    bxbOpen = open ? null : name;
    bxtBackendRender();
  });
  menu.appendChild(head);
  if (!open) return null;
  const pane = mk("div", { class: "bxbpane" });
  menu.appendChild(pane);
  return pane;
}
function bxtBackendUse(pane, mode, label) {
  const row = mk("div", { class: "rrow" });
  const use = mk("span", { class: "chip tiny",
                           text: BX_BACKEND.mode === mode ? "in use" : label });
  use.addEventListener("click", () => bxtBackendPick(mode));
  row.appendChild(use);
  pane.appendChild(row);
}
function bxtRunnerPair(pane) {
  const row = mk("div", { class: "rrow" });
  const input = mk("input", { class: "bxbin", type: "text",
                              placeholder: "ABCD-EFGH", maxlength: 9,
                              autocomplete: "off", spellcheck: "false" });
  const go = mk("span", { class: "chip tiny", text: "connect runner" });
  const note = mk("div", { class: "bxbhint",
                           text: "the runner prints a one-time code when it starts" });
  const claim = () => {
    const code = String(input.value || "").trim();
    if (!code) { note.textContent = "enter the runner's code"; return; }
    if (typeof fetch !== "function") return;
    note.textContent = "connecting\u2026";
    fetch("/api/runner/claim", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: code }) })
      .then(r => r.json().then(d => ({ ok: r.ok, d: d })))
      .then(res => {
        const d = res.d || {};
        if (!res.ok || !d.ok) {
          note.textContent = d.error || "that code is not live \u2014 check the runner";
          return;
        }
        note.textContent = "connected \u00b7 " + ((d.runner && d.runner.name) || "runner");
        fetchBackend();
      })
      .catch(() => { note.textContent = "could not reach the app"; });
  };
  go.addEventListener("click", claim);
  input.addEventListener("keydown", (ev) => {
    if (ev && ev.key === "Enter") claim();
  });
  row.appendChild(input);
  row.appendChild(go);
  pane.appendChild(row);
  pane.appendChild(note);
}

function bxtBackendRender() {
  const menu = $("bxtBackendMenu");
  if (!menu) return;
  menu.innerHTML = "";
  const door = mk("div", { class: "bxtmi", id: "bxtTrainBtn",
                           title: bxTrainDoorTitle(), text: bxTrainDoorText() });
  if (!bxTrainShown()) door.classList.add("off");
  door.addEventListener("click", () => bxtRunToggle());
  menu.appendChild(door);
  let pane = bxtBackendSection(menu, "local", "Local");
  if (pane) {
    const a = bxLocalRunner();
    if (a) {
      pane.appendChild(mk("div", { class: "bxbhint",
        text: "connected \u00b7 " + a.name + " \u2014 the runner executes the design. "
            + "its specs and live usage are in the server config." }));
    } else {
      pane.appendChild(mk("div", { class: "bxbhint",
        text: "1 \u00b7 on that computer, run the runner \u2014 it prints a one-time "
            + "connection code:" }));
      const host = (typeof location !== "undefined" && location.hostname) || "127.0.0.1";
      pane.appendChild(mk("pre", { class: "bxbcode",
        text: "python runner/runner.py --app " + host + ":8125" }));
      pane.appendChild(mk("div", { class: "bxbhint",
        text: "2 \u00b7 enter that code here. the runner needs python3 and torch \u2014 "
            + "the CUDA build on an NVIDIA card, plain torch on Apple Silicon "
            + "(the metal gpu, mps)." }));
      bxtRunnerPair(pane);
    }
    bxtBackendUse(pane, "local", "use this computer");
  }
  pane = bxtBackendSection(menu, "remote", "Remote \u2014 Modal (BYOK)");
  if (pane) {
    pane.appendChild(mk("div", { class: "bxbhint",
      text: "paste a Modal token \u2014 it stays in this browser, and jobs run on your "
          + "own Modal account." }));
    const row = mk("div", { class: "rrow" });
    const key = mk("input", { class: "bxbin", type: "password", value: BX_BACKEND.key,
                              placeholder: "ak-\u2026" });
    key.addEventListener("input", () => { BX_BACKEND.key = key.value; });
    row.appendChild(key);
    const save = mk("span", { class: "chip tiny", text: "save key" });
    save.addEventListener("click", () => {
      try { if (bxSessionHint()) localStorage.setItem("nnstudio_modal_key", BX_BACKEND.key || ""); } catch (e) {}
      save.textContent = "saved";
    });
    row.appendChild(save);
    pane.appendChild(row);
    pane.appendChild(mk("div", { class: "bxbhint",
      text: "make one at modal.com \u2192 Settings \u2192 Tokens. (not wired yet)" }));
    bxtBackendUse(pane, "remote", "use modal");
  }
}
// ---- the Run button: the whole design, on the user's backend -----------------
// Disabled until a backend is established — a runner connected under Local.
// Then Run hands the canvas to the runner over the stateful control channel
// and shows what came back.
let BXRUN = { local: { connected: false, agent: null, runner: null }, inputs: {}, last: null,
              loaded: null, mode: "inference", warmMode: null,
              loading: false, loadKey: null, offloading: false,
              msg: "", error: false, running: false, gen: 0, temp: 0 };
// The app backend calls the studio backend a "runner"; older backends and the
// DOM harness may still expose `agent`. One accessor keeps the UI honest.
function bxLocalRunner() {
  if (typeof BXRUN === "undefined" || !BXRUN.local) return null;
  return BXRUN.local.runner || BXRUN.local.agent || null;
}
let bxUsageTimer = null;                       // a fast usage read while an action runs
function bxSpecRow(pane, k, v) {
  const row = mk("div", { class: "bxbspec" });
  row.appendChild(mk("span", { text: k }));
  row.appendChild(mk("b", { text: String(v) }));
  pane.appendChild(row);
  return row;
}
function bxNativeKernels() {                  // the connected backend's native set
  const a = bxLocalRunner() || {};
  const nq = (a.specs || {}).native_quant || {};
  return (nq.available ? (nq.kernels || []) : []).map(x => String(x).toLowerCase());
}
function bxSpecRows(pane, s) {                 // what the runner says it is
  if (!s) return;
  const nq = s.native_quant || {};
  const prov = Object.keys(nq.providers || {}).filter(k => nq.providers[k]);
  const dev = s.device || "cpu";
  const rows = [["cpu", [s.cpu, s.cores ? s.cores + " cores" : null]
                   .filter(Boolean).join(" \u00b7 ")],
                ["ram", s.ram_gb ? s.ram_gb + " GB" : null],
                ["gpu", s.gpu ? s.gpu + (s.vram_gb ? " \u00b7 " + s.vram_gb + " GB" : "")
                              : "none found"],
                ["torch", s.torch ? s.torch + (s.cuda ? " \u00b7 cuda"
                                   : dev === "mps" ? " \u00b7 mps" : " \u00b7 cpu")
                                  : (s.torch_error ? "not installed" : null)],
                ["cuda", s.cuda ? "ready"
                                : (s.cuda_error ? String(s.cuda_error).slice(0, 120)
                                                : "not available")]];
  if (s.mps) rows.push(
    ["mps", dev === "mps" ? "ready \u00b7 the apple gpu runs the design"
         : (s.mps_error ? String(s.mps_error).slice(0, 120) : "available")]);
  rows.push(["quant kernels", nq.available
               ? (nq.kernels || []).join(", ") + " \u00b7 " + (nq.backend || "native")
               : "f16 dequant at load \u00b7 docs/backend.md"],
            ["os", s.os]);
  if (prov.length) rows.push(["quant providers", prov.join(", ")]);
  for (const [k, v] of rows) if (v) bxSpecRow(pane, k, v);
}
function bxtRunEnabled() {
  // The studio backend is a connected runner. A saved Modal key is a future
  // runner selector, not a transport: it must not make Run look ready.
  return !!(BXRUN.local && BXRUN.local.connected);
}
function bxTrainShown() {                      // the Train box is on the canvas
  if (BX.up) return false;                     // it lives at the top level only
  const hub = bxTrainAnywhere();
  return !!hub && !hub.hidden;
}
function bxTrainDoorText() {                   // what the Backend menu's row offers
  if (BX.up) return "the server config lives at the top level";
  return bxTrainShown() ? "hide the server config" : "show the server config";
}
function bxTrainDoorTitle() {
  if (BX.up) return "come back out to the top level first";
  return bxTrainShown() ? "hide the server config" : "show the server config";
}
function bxtRunRefresh() {                    // the Backend menu's row follows the box
  const item = $("bxtTrainBtn");
  if (!item) return;                           // the menu is closed: built fresh on open
  if (item.classList) item.classList.toggle("off", !bxTrainShown());
  item.title = bxTrainDoorTitle();
  if (item.textContent != null) item.textContent = bxTrainDoorText();
}
function bxtRunToggle() {                     // the Run button: the box on / off
  if (BX.up) return false;                    // the Run box lives at the top level
  bxtDropsClose();                            // the Backend menu shuts behind it
  const hub = bxTrainAnywhere();
  if (!hub) {                                 // none yet: the toggle creates it
    bxDropPalette("train", null);
    bxtRunRefresh();
    return true;
  }
  hub.hidden = !hub.hidden;
  if (hub.hidden && bxSel && bxSel.kind === "boxes") {
    bxSel.ids = bxSel.ids.filter(x => x !== hub.id);
    if (!bxSel.ids.length) bxSel = null;
  }
  bxCommit();
  bxRender();                                 // the canvas and the button follow
  return !hub.hidden;
}
function bxtRunMsg(text) { BXRUN.msg = text; bxtRunSync(); }
function bxtRunSync() {                       // every run surface, fresh
  bxtRunRefresh();
  bxTrainRefresh();
}
function bxMs(v) {                             // a duration, as a person reads it
  const n = Number(v) || 0;
  return n >= 10000 ? (n / 1000).toFixed(1) + " s"
       : n >= 1000 ? (n / 1000).toFixed(2) + " s"
       : Math.round(n) + " ms";
}
function bxGB(bytes) {
  const b = Number(bytes) || 0;
  if (b >= 2 ** 30) return (b / 2 ** 30).toFixed(2) + " GB";
  if (b >= 2 ** 20) return (b / 2 ** 20).toFixed(1) + " MB";
  return b + " B";
}
function bxUsageRow(pane, label, used, total, pct) {
  if (used == null || total == null) { bxSpecRow(pane, label, "\u2014"); return; }
  bxSpecRow(pane, label, used.toFixed(1) + " / " + total.toFixed(1) + " GB"
            + (pct == null ? "" : " \u00b7 " + pct + "%"));
}
function bxRunFeeds(pane) {                       // inference: what the model reads
  const ins = BX.nodes.filter(n => n.kind === "input");
  if (ins.length) {
    pane.appendChild(mk("div", { class: "mhead", text: "inputs" }));
    for (const n of ins) {
      if (n.input_mode === "text") {
        const lab = mk("label", { class: "rf" });
        lab.appendChild(mk("span", { text: bxClip(n.name || "input", 14) }));
        const store = BXRUN.texts || (BXRUN.texts = {});
        const inp = mk("input", { class: "bxbin", type: "text", placeholder: "text",
                                  value: store[n.id] != null ? store[n.id] : (n.text || "") });
        inp.addEventListener("input", () => {
          (BXRUN.texts = BXRUN.texts || {})[n.id] = inp.value;
        });
        lab.appendChild(inp);
        pane.appendChild(lab);
        continue;
      }
      const lab = mk("label", { class: "rf" });   // the box defines this one: no run field
      lab.appendChild(mk("span", { text: bxClip(n.name || "input", 14) }));
      lab.appendChild(mk("span", { class: "wmode",
        text: n.input_mode === "image" ? "image"
              : "matrix " + (bxMatrixShape(n.values) || "?") }));
      pane.appendChild(lab);
    }
  }
  const toks = BX.nodes.filter(n => (n.kind === "tokenize" || n.kind === "hf") &&
                                    !BX.edges.some(e => e.to === n.id));   // wired: fed upstream
  if (toks.length) {
    pane.appendChild(mk("div", { class: "mhead", text: "text" }));
    for (const n of toks) {
      const lab = mk("label", { class: "rf" });
      lab.appendChild(mk("span", { text: bxClip(n.name ||
        (n.kind === "hf" ? "hf model" : "tokenizer"), 14) }));
      const store = BXRUN.texts || (BXRUN.texts = {});
      const inp = mk("input", { class: "bxbin", type: "text",
                                placeholder: n.kind === "hf" ? "the text to continue"
                                                             : "text to tokenize",
                                value: store[n.id] != null ? store[n.id] : (n.text || "") });
      inp.addEventListener("input", () => {
        (BXRUN.texts = BXRUN.texts || {})[n.id] = inp.value;
      });
      lab.appendChild(inp);
      pane.appendChild(lab);
    }
    const g1 = mk("label", { class: "rf" });     // how far the model writes on
    g1.appendChild(mk("span", { text: "tokens" }));
    const gi = mk("input", { class: "bxbin", type: "number", min: "0", step: "1",
                             value: String(BXRUN.gen || 0) });
    gi.addEventListener("input", () => {
      BXRUN.gen = Math.max(0, Math.round(Number(gi.value) || 0));
    });
    g1.appendChild(gi);
    const g2 = mk("label", { class: "rf" });
    g2.appendChild(mk("span", { text: "temperature" }));
    const ti = mk("input", { class: "bxbin", type: "number", min: "0", step: "0.1",
                             value: String(BXRUN.temp == null ? 0 : BXRUN.temp) });
    ti.addEventListener("input", () => {
      const t = Number(ti.value);
      BXRUN.temp = isFinite(t) ? t : 0;
    });
    g2.appendChild(ti);
    pane.appendChild(g1);
    pane.appendChild(g2);
    pane.appendChild(mk("div", { class: "bxbhint",
      text: "0 tokens is one forward; temperature 0 picks the most likely id" }));
  }
}
function bxtRunLoad() {                        // the whole design, loaded warm
  bxApplyOffload("gpu");                       // the ratio writes the places
  const canvas = bxExportCanvas();
  if (!canvas) return;
  const ratio = bxOffloadRatio();
  BXRUN.loading = true;
  BXRUN.loadKey = "load";
  BXRUN.error = false;
  BXRUN.msg = "loading the whole design\u2026"
              + (ratio ? " (" + ratio + "% on the system)" : "");
  bxtRunSync();
  bxUsageWatch(true);                          // watch the memory move while it loads
  let prog = 0;                                // and how far the compile is
  if (typeof setInterval === "function")
    prog = setInterval(() => {
      fetch("/api/run/progress", { cache: "no-store" })
        .then(r => (r.ok ? r.json() : null))
        .then(d => {
          const ld = d && d.progress && d.progress.load;
          if (!ld || !ld.total || !BXRUN.loading) return;
          BXRUN.msg = "loading\u2026 " + (100 * ld.bytes / ld.total).toFixed(0)
                    + "% \u00b7 " + bxGB(ld.bytes) + " / " + bxGB(ld.total);
          bxtRunSync();
        })
        .catch(() => {});
    }, 900);
  const runner = bxLocalRunner();
  const name = (runner && runner.name) || "the runner";
  fetch("/api/load", { method: "POST", headers: { "Content-Type": "application/json" },
                       body: JSON.stringify({ canvas, mode: BXRUN.mode || "inference" }) })
    .then(r => r.json().then(d => ({ ok: r.ok, d })))
    .then(res => {
      BXRUN.loading = false;
      if (prog) clearInterval(prog);
      bxUsageWatch(false);
      if (!res.ok || !res.d || !res.d.ok)
        throw new Error((res.d && res.d.error) || "the load failed");
      BXRUN.loaded = res.d;
      BXRUN.warmMode = (res.d && res.d.mode) || null;
      BXRUN.msg = "";
      bxtRunSync();
      fetchBackend();                          // the runner just measured — show it now
    })
    .catch(e => {
      BXRUN.loading = false;
      if (prog) clearInterval(prog);
      bxUsageWatch(false);
      BXRUN.warmMode = null;                   // a failed load frees the backend's weights
      BXRUN.error = true;                      // it stays until the next load/run
      bxtRunMsg("could not load on " + name + " \u2014 " + String((e && e.message) || e));
      fetchBackend();
    });
}

