// ─── nnstudio shell · 50 · box panes ───────────────────────────────────────
// the training hub/plan/spec, matrix input, output/heat readouts, and image actions inside the boxes.
// Order is load-bearing: this slice is concatenated after the one before it.

function bxTrainHub() {                           // the train node: the server config
  for (const n of BX.nodes || []) if (n.kind === "train") return n;
  return null;
}
function bxTraining(n) {                          // a box that carries a training run:
  // a train config (the model world), an output whose training switch is on
  // (older designs), or the train node the oldest designs carry
  return !!n && (n.kind === "train" || n.kind === "config" ||
                 n.kind === "training" ||
                 (n.kind === "output" && n.train));
}
function bxTrainHost() {                          // where the training is set up:
  // the config that names a model is the experiment now; the older hosts follow
  const tied = (typeof bxTrainWired === "function") ? bxTrainWired() : null;
  if (tied && tied.cfg) return tied.cfg;
  let hit = null;
  bxEveryBox(x => { if (!hit && x.kind === "output" && x.train) hit = x; });
  return hit || bxTrainHub();
}
function bxTrainAnywhere() {                      // the one Run box, from the top down
  let hit = null;
  const walk = (nodes) => {
    for (const n of nodes || []) {
      if (!hit && n.kind === "train") hit = n;
      if (n.kind === "custom" && n.inner) walk(n.inner.nodes);
    }
  };
  walk(BX.up && BX.stack && BX.stack.length ? BX.stack[0].nodes : BX.nodes);
  return hit;
}
function bxTrainAllowed() {                       // one Run box, at the top level only
  return !BX.up && !bxTrainAnywhere();
}
function bxTrainPrune(doc, allow) {               // strip what the rules forbid
  const cut = new Set();
  let kept = false;
  for (const n of doc.nodes || []) {
    if (n.kind !== "train") continue;
    if (!allow || kept) cut.add(n.id);            // inside a nested box: never
    else kept = true;                             // at the level itself: at most one
  }
  if (cut.size) {
    doc.nodes = (doc.nodes || []).filter(n => !cut.has(n.id));
    doc.edges = (doc.edges || []).filter(e => !cut.has(e.from) && !cut.has(e.to));
  }
  for (const n of doc.nodes || [])
    if (n.kind === "custom" && n.inner) bxTrainPrune(n.inner, false);
  return doc;
}
function bxEdgePairs() {                          // mirrors the engine's _edge_pairs
  const pairs = [];
  const walk = (doc) => {
    const byId = {};
    for (const n of (doc.nodes || [])) byId[n.id] = n;
    for (const e of (doc.edges || [])) {
      const s = byId[e.from], d = byId[e.to];
      if (s && d) pairs.push([s, d]);
    }
    for (const n of (doc.nodes || []))
      if (n.kind === "custom" && n.inner) walk(n.inner);
  };
  walk({ nodes: BX.nodes, edges: BX.edges });
  return pairs;
}
function bxTrainTintInfo() {                      // who carries the signal, at this level
  if ((BXRUN.mode || "inference") !== "training") return null;
  const hub = bxTrainHost();
  if (!hub) return null;
  const marks = new Map(), heads = [];
  const mark = (id, cls) => { if (id && !marks.has(id)) marks.set(id, cls); };
  const tied = bxTrainWired();
  const c = tied.cfg || hub;
  const target = c.model || hub.target;
  if (tied.cfg) {                                 // the wired training: its boxes
    mark(tied.cfg.id, "tsrc");
    if (tied.data) {
      mark(tied.data.id, "tsrc");
      const tell = bxMatrixTell(tied.data);
      if (tell && tell.ds) mark(tell.ds.id, "tsrc");
    }
  }
  if (hub.dataset) mark(hub.dataset, "tsrc");
  if (c.test_dataset) mark(c.test_dataset, "ttest");
  let wired = null;
  for (const e of (BX.edges || [])) {             // a dataset→loss wire beats the binding
    const s = bxNode(e.from), d = bxNode(e.to);
    if (s && d && bxIsDataset(s) && d.kind === "loss") { wired = [s, d]; break; }
  }
  if (wired) {
    mark(wired[0].id, "tsrc");
    mark(wired[1].id, "tscored");
    heads.push(wired[1].id);
  } else if (target) {
    mark(target, c.paradigm === "rl" ? "tpolicy" : "tscored");
    heads.push(target);
  }
  if (c.paradigm === "rl" && c.reward) {
    mark(c.reward, "tscorer");
    heads.push(c.reward);
  }
  const edges = new Set();
  for (const e of (BX.edges || []))
    if (heads.indexOf(e.from) >= 0) edges.add(bxPathId(e.from));
  return { marks, edges };
}
/** The training plan as words: what the engine will do, in the box. */
function bxTrainSummary(h) {                       // what the engine will do, in words
  // h: the output that trains. The settings live on the train config box wired
  // into the input, and the input's own dots carry X — plus Y, when supervised.
  // Older designs keep their stored fields (and their own note to move on).
  const lines = [], missing = [];
  const wired = bxTrainWired();
  const isModel = (h.kind === "config" || h.kind === "training") && !!h.model;
  const c = (h.kind === "config" || h.kind === "training") ? h
                                                           : (wired.cfg || h);
  const rl = c.paradigm === "rl";
  const unsup = c.paradigm === "unsupervised";
  const targetId = isModel ? h.model
                 : (c.model || (h.kind === "output" ? h.id : h.target));
  const find = (id) => bxFindBox(id);
  let vector = false;
  const lossBox = (function () {
    for (const p of bxEdgePairs())
      if (bxIsDataset(p[0]) && p[1].kind === "loss") return p;
    return null;
  })();
  if (wired.cfg || isModel) {
    // the config detects what is attached: one matrix on its data dot (or the
    // input's, in the designs built before models) — x col / y col pick
    if (isModel && !h.model)
      missing.push("no model picked — the nested box whose architecture trains");
    const at = bxAttached();
    if (!wired.data) {
      missing.push("wire the dataset (or a select col box) into the "
                   + (h.kind === "training" ? "training box's"
                      : isModel ? "config's" : "input's (the second one)") + " "
                   + "data dot");
    } else if (at.bad || !at.ds) {
      missing.push("the data matrix: " + (at.bad || "not a dataset box"));
    } else {
      const rows = at.rows;
      const specX = String(c.x_col || "").trim();
      const specY = String(c.y_col || "").trim();
      let xc = null, yc = null;
      if (!at.file) {
        xc = bxColsOf(c.x_col, at, 0);
        yc = bxColsOf(c.y_col, at, 1);
        if (xc === null)
          missing.push("x col names a column the matrix does not hand out: "
                       + specX.toUpperCase());
        if (!rl && !unsup && yc === null)
          missing.push("y col names a column the matrix does not hand out: "
                       + specY.toUpperCase());
        if (!rl && !unsup && !yc && !specY && (at.vnames || []).length < 2)
          missing.push("the matrix hands out one column \u2014 a supervised "
                       + "target needs a second one");
      }
      const label = (cols, spec, dflt) => cols ? bxColLabel(cols, at)
        : ((spec || "").toUpperCase() || bxColLetter(dflt));
      const bits = [at.node.name || at.node.id];
      if (at.ds !== at.node) bits.push("reads " + (at.ds.name || at.ds.id));
      if (rows != null) bits.push(rows + " rows");
      bits.push("x " + label(xc, specX, 0)
                + (rl || unsup ? " only" : " \u2192 y " + label(yc, specY, 1)));
      if (!at.file && !rl && !unsup && yc && xc
          && yc.join() === xc.join())
        bits.push("x and y are the same column");
      else if (!at.file && !rl && !unsup && yc && xc
               && yc.length !== xc.length)
        bits.push("x is " + xc.length + " wide, y is " + yc.length);
      if (at.file) bits.push("its columns are read on the backend");
      lines.push("data \u00b7 " + bits.join(" \u00b7 "));
      if (rows === 0) missing.push("the matrix has no rows");
      const width = (cols) => cols ? cols.length
        : (String(cols === xc ? specX : specY).trim().split(/[\s,]+/).filter(x => x)
           .length || 1);
      vector = (!rl && !unsup ? width(yc) : 0) > 1 || width(xc) > 1;
    }
    if (c.y_class && !rl && !unsup) {
      lines.push("classes \u00b7 y is a class label \u2014 the values it takes "
                 + "are the classes");
      if (vector)
        missing.push("a class label and a vector target do not mix \u2014 keep "
                     + "one column on each side");
    }
  } else {
    const dsId = h.dataset || (lossBox ? lossBox[0].id : null);
    if (!dsId)
      missing.push("no training setup \u2014 drop a train config box (palette: "
                   + "training) and wire it into the input's first dot");
    else {
      const ds = find(dsId);
      if (!ds) missing.push("the dataset is off the canvas");
      else {
        const bits = [ds.name || dsId];
        let rows = null;
        if (ds.file) {
          bits.push("rows in " + String(ds.file).split("/").pop());
          const hit = (BX.dsCache || {})[ds.file];
          if (hit && hit.ok) rows = (hit.rows || []).length;
        } else {
          rows = (bxTableRead(ds).rows || []).length;
          if (rows) bits.push(rows + " rows");
        }
        bits.push(rl || unsup ? "x " + (h.x_col || "A") + " only"
                              : "x " + (h.x_col || "A") + " \u2192 y " + (h.y_col || "B"));
        if ((h.y_class || (h.classes && h.classes.length)) && !rl && !unsup)
          bits.push("y is a class label \u2014 the values it takes are the classes");
        lines.push("data \u00b7 " + bits.join(" \u00b7 "));
        if (rows === 0) missing.push("the dataset has no rows");
        const xt = String(h.x_col || "").trim().split(/[\s,]+/).filter(x => x);
        const yt = String(h.y_col || "").trim().split(/[\s,]+/).filter(x => x);
        vector = xt.length > 1 || (!rl && !unsup && yt.length > 1);
      }
      if (!h.dataset && lossBox)
        lines.push("data \u00b7 " + (lossBox[0].name || dsId)
                   + " \u2014 the wired loss box's rows");
      if (h.dataset)
        lines.push("note \u00b7 this output carries the settings (an older design) "
                   + "\u2014 a train config box moves them to the input");
      else if (!lossBox)
        lines.push("note \u00b7 the rows come from the first dataset on the canvas");
    }
  }
  const testId = c.test_dataset;
  const xds = wired.cfg && wired.x ? (bxMatrixTell(wired.x) || {}).ds : null;
  if (testId) {
    if (xds && testId === xds.id && !rl)
      missing.push("the test split is the training dataset");
    else {
      const ts = find(testId);
      if (!ts) missing.push("the test dataset is off the canvas");
      else {
        const bits = [ts.name || testId];
        if (ts.file) bits.push("rows in " + String(ts.file).split("/").pop());
        else {
          const rows = (bxTableRead(ts).rows || []).length;
          bits.push(rows ? rows + " rows" : "no rows yet");
        }
        if (rl) bits.push("idle in rl");
        lines.push("test \u00b7 " + bits.join(" \u00b7 "));
      }
    }
  } else lines.push("test \u00b7 "
    + (rl ? "idle \u2014 rl scores every sample"
          : "none \u2014 the curves stay train-only"));
  if (lossBox && rl)
    missing.push("the reward is the signal in rl \u2014 a wired dataset\u2192loss "
                 + "box is a supervised leftover");
  else if (lossBox)
    lines.push("signal \u00b7 " + (lossBox[1].name || lossBox[1].id)
               + " \u2014 a dataset\u2192loss wire beats the binding");
  else if (targetId) {
    const tg = find(targetId);
    if (!tg) missing.push(isModel ? "the model is off the canvas"
                                  : "the target output box is off the canvas");
    else if (isModel) {
      lines.push("signal \u00b7 " + (tg.name || targetId)
        + (rl ? " \u2014 the policy, sampled from its first output"
              : " \u2014 the implicit loss on its first output"));
      if (!bxBoundary(tg, "out").length)
        missing.push("the model has no output box inside \u2014 it trains "
                     + "through its outputs");
    } else lines.push("signal \u00b7 " + (tg.name || targetId)
      + (rl ? " \u2014 the policy, scored by the reward box"
            : " \u2014 the implicit loss on its output"));
  } else missing.push(rl
    ? "rl training needs a model (or a target output box) to sample from"
    : (isModel ? "no signal — pick the model this config trains"
               : "no signal — an output with its training switch on "
                 + "(an older design's field)"));
  if (!rl && !lossBox) {
    lines.push(vector
      ? (unsup ? "loss \u00b7 mean squared error \u2014 the model rebuilds its own X"
               : "loss \u00b7 mean squared error over the vector target")
      : (unsup ? "loss \u00b7 cross entropy over the X rows themselves"
               : "loss \u00b7 cross entropy against the target \u2014 the one so far"));
  }
  if (rl) {
    if (!c.reward) missing.push("no reward box \u2014 rl is scored by the reward box");
    else {
      const rw = find(c.reward);
      if (!rw) missing.push("the reward box is off the canvas");
      else lines.push("reward \u00b7 " + (rw.name || c.reward));
    }
  }
  let iid = null;
  bxEveryBox(x => { if (x.kind === "input" && !iid) iid = x; });
  if (!iid) missing.push("no input box for the model to read the rows");
  let unfrozen = 0;
  bxEveryBox(x => { if (bxWeightedBox(x) && !bxBoxFrozen(x)) unfrozen++; });
  if (!unfrozen) missing.push("nothing to train \u2014 unfreeze a box first");
  const pb = ["lr " + (c.lr != null ? c.lr : "3e-4"), c.optimizer || "adamw",
              "batch " + (c.batch != null ? c.batch : 4),
              c.steps ? "steps " + c.steps : "steps until detach",
              "save every " + (c.save_every != null ? c.save_every : 50),
              "eval every " + (c.eval_every != null ? c.eval_every : 50)];
  if (c.weight_decay) pb.push("weight decay " + c.weight_decay);
  if (c.clip != null && c.clip !== 1) pb.push("grad clip " + c.clip);
  if (rl) pb.push("temperature " + (c.temperature != null ? c.temperature : 1),
                  "max " + (c.max_tokens != null ? c.max_tokens : 16) + " tokens",
                  (c.n_samples != null ? c.n_samples : 4) + " samples per row");
  lines.push("params \u00b7 " + pb.join(" \u00b7 "));
  return { lines, missing, rl, paradigm: c.paradigm || "supervised" };
}
function bxTrainNote(n, msg) {
  BXRUN.trainNotes = BXRUN.trainNotes || {};
  if (msg) BXRUN.trainNotes[n.id] = msg; else delete BXRUN.trainNotes[n.id];
  bxRender();
}
function bxTrainStart(n) {                        // the run button, for training
  const sum = bxTrainSummary(n);
  if (sum.missing.length) {
    bxTrainNote(n, "fix before starting: " + sum.missing.join("; "));
    return;
  }
  if (typeof fetch !== "function") {
    bxTrainNote(n, "the app cannot reach the server");
    return;
  }
  const canvas = (typeof bxExportCanvas === "function") ? bxExportCanvas() : null;
  if (!canvas) { bxTrainNote(n, "the design cannot be exported from here"); return; }
  fetch("/api/tasks", { method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ type: "train",
                                                // a config trains a model: its
                                                name: (n.model && (bxFindBox(n.model) || {}).name)
                                                      || n.name || "training",
                                                design: bxRunCanvas(canvas) }) })
    .then(r => r.json())
    .then(d => {
      if (!d || !d.ok || !d.task)
        throw new Error((d && d.error) || "the task could not start");
      BXTASKS.byId[d.task.id] = d.task;
      n.task_id = d.task.id;
      bxCommit();
      BXRUN.trainState = BXRUN.trainState || {};
      BXRUN.trainState[n.id] = {};
      BXRUN.trainHist = BXRUN.trainHist || {};
      BXRUN.trainHist[n.id] = [];
      BXRUN.trainSeen = BXRUN.trainSeen || {};
      delete BXRUN.trainSeen[n.id];
      bxTrainNote(n, "");
      bxAgentSync();                               // the task list, and the box's chips
      bxTrainPoll(true);
    })
    .catch(e => bxTrainNote(n, String((e && e.message) || e)));
}
function bxTrainLoadCkpt(n, st) {                 // train → inference, with the trained weights
  if (typeof fetch !== "function" || !st || !st.saved_at) return;
  if (BXRUN.running || BXRUN.loading) {
    bxTrainNote(n, "wait for the run to finish first");
    return;
  }
  BXRUN.mode = "inference";
  const canvas = (typeof bxExportCanvas === "function") ? bxExportCanvas() : null;
  if (!canvas) { bxTrainNote(n, "the design cannot be exported from here"); return; }
  BXRUN.loading = true;
  BXRUN.loadKey = "load";
  BXRUN.error = false;
  BXRUN.msg = "loading the last checkpoint\u2026";
  bxRender();
  bxtRunSync();
  fetch("/api/load", { method: "POST", headers: { "Content-Type": "application/json" },
                       body: JSON.stringify({ canvas: bxRunCanvas(canvas),
                                              mode: "inference",
                                              checkpoint: st.saved_at }) })
    .then(r => r.json().then(d => ({ ok: r.ok, d })))
    .then(res => {
      BXRUN.loading = false;
      if (!res.ok || !res.d || !res.d.ok)
        throw new Error((res.d && res.d.error) || "the checkpoint could not be loaded");
      BXRUN.loaded = res.d;
      BXRUN.warmMode = (res.d && res.d.mode) || "inference";
      bxtRunSync();
      bxRender();
      bxTrainNote(n, "loaded — the graph now carries the trained weights");
      fetchBackend();
    })
    .catch(e => {
      BXRUN.loading = false;
      bxtRunSync();
      bxRender();
      bxTrainNote(n, String((e && e.message) || e));
    });
}
function bxTrainFill(pane, n) {                   // the server config: the backend
  // machine, its usage and where the design's weights run \u2014 training is
  // the output box's training tab now, not this box's
  const prev = pane.querySelector ? pane.querySelector(".bxrunbody") : null;
  const keepTop = (prev && n._scroll && n._scroll.spec) ? prev.scrollTop : 0;
  pane.innerHTML = "";
  bxBehaveInside(pane);
  const head = mk("div", { class: "bxlogrow" });
  head.appendChild(mk("b", { text: "server config" }));
  pane.appendChild(head);
  const body = mk("div", { class: "bxrunbody" });
  body.addEventListener("scroll", () => {
    (n._scroll = n._scroll || {}).spec = body.scrollTop;
  });
  pane.appendChild(body);
  bxTrainSpec(body);
  body.scrollTop = keepTop;
}
function bxTrainPlan(body, n, noStart) {       // the training, in the window it lives
  // in: what it needs, where it stands, and the controls that drive it
  const st = (BXRUN.trainState || {})[n.id] || {};
  const t = n.task_id ? bxTask(n.task_id) : null;
  const live = !!n.task_id && !st.error && (!t || t.status === "running");
  const sum = bxTrainSummary(n);
  for (const line of sum.lines)
    body.appendChild(mk("div", { class: "panehint", text: line }));
  for (const why of sum.missing)
    body.appendChild(mk("div", { class: "bxbhint", text: "\u26a0 " + why }));
  if (sum.missing.length)
    body.appendChild(mk("div", { class: "bxbhint",
      text: "fix the warnings, then start the full training here" }));
  else
    body.appendChild(mk("div", { class: "bxbhint",
      text: "the full training starts here \u2014 the input box runs the design" }));
  const strip = mk("div", { class: "panehint" });
  if (sum.rl)
    strip.textContent = "step " + (st.step != null ? st.step : "\u2014")
        + (st.tloss != null ? "  \u00b7  reward " + Number(st.tloss).toFixed(4) : "")
        + (st.tacc != null ? "  \u00b7  baseline " + Number(st.tacc).toFixed(4) : "")
        + (st.sample ? "  \u00b7  \u201c" + String(st.sample).slice(0, 40) + "\u201d" : "")
        + (st.saved_at ? "  \u00b7  saved " + String(st.saved_at).split("/").slice(-1)[0] : "");
  else
    strip.textContent = "step " + (st.step != null ? st.step : "\u2014")
        + (st.loss != null ? "  \u00b7  loss " + Number(st.loss).toFixed(4) : "")
        + (st.acc != null ? "  \u00b7  acc " + Number(st.acc).toFixed(3) : "")
        + (st.tloss != null ? "  \u00b7  test loss " + Number(st.tloss).toFixed(4) : "")
        + (st.tacc != null ? "  \u00b7  test acc " + Number(st.tacc).toFixed(3) : "")
        + (st.saved_at ? "  \u00b7  saved " + String(st.saved_at).split("/").slice(-1)[0] : "");
  body.appendChild(strip);
  const hist = (BXRUN.trainHist || {})[n.id] || [];
  if (hist.length > 1) {                      // solid: the train split \u00b7 dashed: the test
    const dual = (getTrain, getTest, color) => {
      const all = [];
      for (const h0 of hist) {
        const a = getTrain(h0), b = getTest(h0);
        if (a != null) all.push(a);
        if (b != null) all.push(b);
      }
      if (all.length < 2) return;
      const max = Math.max.apply(null, all), min = Math.min.apply(null, all);
      const span = Math.max(max - min, 1e-6);
      const w = 220, h = 54;
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 " + w + " " + h);
      svg.setAttribute("style", "width:100%;height:" + h + "px");
      const line = (get, stroke, dash) => {
        const ps = [];
        for (let i = 0; i < hist.length; i++) {
          const v = get(hist[i]);
          if (v == null) continue;
          ps.push((i / (hist.length - 1) * w).toFixed(1) + "," +
                  (h - 3 - (v - min) / span * (h - 6)).toFixed(1));
        }
        if (ps.length < 2) return;
        const pl = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
        pl.setAttribute("points", ps.join(" "));
        pl.setAttribute("fill", "none");
        pl.setAttribute("stroke", stroke);
        pl.setAttribute("stroke-width", "1.5");
        if (dash) pl.setAttribute("stroke-dasharray", "4 3");
        svg.appendChild(pl);
      };
      line(getTrain, color, false);
      line(getTest, color, true);
      body.appendChild(svg);
    };
    if ((n.paradigm || "supervised") === "rl") {
      // rl: the mean reward and the baseline ride the test slots
      dual(h0 => h0.tloss, h0 => h0.tacc, "#f97316");
      body.appendChild(mk("div", { class: "bxbhint",
        text: "solid \u2014 the mean reward \u00b7 dashed \u2014 the baseline" }));
    } else {
      dual(h0 => h0.loss, h0 => h0.tloss, "#f97316");
      dual(h0 => h0.acc, h0 => h0.tacc, "#22c55e");
      body.appendChild(mk("div", { class: "bxbhint",
        text: "solid \u2014 the train split \u00b7 dashed \u2014 the test split" }));
    }
  }
  const row = mk("div", { class: "rrow" });
  const chip = (label, fn, title, off) => {
    const b = mk("span", { class: "chip tiny" + (off ? " off" : ""),
                            text: label, title: title || "" });
    b.addEventListener("mousedown", (e) => { if (e && e.stopPropagation) e.stopPropagation(); });
    b.addEventListener("click", () => {
      if (off) { if (title) bxTrainNote(n, title); return; }
      if (fn) fn();
    });
    return b;
  };
  if (live) {
    row.appendChild(chip("start \u2014 already running", null,
      "the task is live \u2014 save, hold or detach it", true));
    row.appendChild(chip("save now", () => bxTrainCmd(n, "save"), "land a checkpoint where it stands"));
    row.appendChild(chip("hold", () => bxTrainCmd(n, "pause"), "stop stepping, keep the gpu"));
    row.appendChild(chip("detach", () => bxTrainCmd(n, "detach"), "checkpoint and let the gpu go"));
  } else {
    const first = sum.missing[0] || "ready";
    if (!noStart)                              // a Training box keeps its start
      row.appendChild(chip("start \u2014 " + first,  // button in the footer instead
        () => bxTrainStart(n),
        sum.missing.length ? "fix before starting: " + sum.missing.join("; ") : "start training",
        !!sum.missing.length));
    if (n.task_id)
      row.appendChild(chip("resume", () => bxTrainCmd(n, "resume"),
        "pick up from the last checkpoint"));
  }
  if (st.saved_at)
    row.appendChild(chip("load last checkpoint", () => bxTrainLoadCkpt(n, st),
      "train \u2192 inference: run with the trained weights"));
  if (!live && !bxTrainWired().cfg)
    row.appendChild(chip("add a train config node", () => bxTrainAddConfig(n),
      "drops a config box beside the input and wires it in \u2014 the settings "
      + "live there now"));
  body.appendChild(row);
  if ((BXRUN.trainNotes || {})[n.id])
    body.appendChild(mk("div", { class: "bxbhint", text: BXRUN.trainNotes[n.id] }));
  if (st.error) body.appendChild(mk("div", { class: "bxbhint", text: "\u26a0 " + st.error }));
}

function bxMatrixParse(text) {                 // the numbers a matrix input carries:
  const rows = [];                             // one row per line, spaces or commas
  for (const line of String(text == null ? "" : text).split("\n")) {
    const toks = line.replace(/,/g, " ").split(/\s+/).filter(Boolean);
    if (!toks.length) continue;
    const nums = toks.map(Number);
    if (nums.some(x => !isFinite(x))) return { bad: "a value is not a number" };
    rows.push(nums);
  }
  if (!rows.length) return null;
  const c = rows[0].length;
  return { rows: rows, r: rows.length, c: c, ragged: rows.some(x => x.length !== c),
           count: rows.reduce((a, x) => a + x.length, 0) };
}
function bxMatrixShape(text) {                 // its shape, as the card reads it
  const m = bxMatrixParse(text);
  if (!m || m.bad) return null;
  if (m.ragged) return null;                   // not a matrix yet
  return m.r > 1 ? m.r + "\u00d7" + m.c : String(m.count);
}
function bxInputMode(n) {                      // the input's data type — matrix is the
  if (n && n.input_mode === "dataset") return "dataset";   // its own sheet
  if (n && n.input_mode === "text") return "text";    // plain one; the old python/
  if (n && n.input_mode === "image") return "image";  // random/values read as it
  return "matrix";
}
function bxInputFill(pane, n) {                // the input box's own editor, in the box:
  // the datatype, and the data itself — typed right on the canvas
  pane.innerHTML = "";
  bxBehaveInside(pane);
  const mrow = mk("label", { class: "rf" });
  mrow.appendChild(mk("span", { text: "data" }));
  const sel = mk("select", { class: "bxsel" });
  for (const [k, t] of [["matrix", "matrix"], ["text", "text"], ["image", "image"],
                        ["dataset", "dataset"]])
    sel.appendChild(mk("option", { value: k, text: t }));
  sel.value = bxInputMode(n);
  mrow.appendChild(sel);
  pane.appendChild(mrow);
  const link = bxInputLink(n);
  if (link.on) {                               // training on: the three dots
    const bits = ["training"];
    if (link.cfg) {
      bits.push("config \u00b7 " + (link.cfg.name || link.cfg.id));
      bits.push(link.data ? "data \u00b7 " + (link.data.name || link.data.id)
                          : "data \u2014 bare");
    } else bits.push("wire a train config box into its first dot");
    pane.appendChild(mk("div", { class: "panehint", text: bits.join(" \u00b7 ") }));
  }
  const body = mk("div", { class: "bxinputbody" });
  pane.appendChild(body);
  const save = (patch) => bxConfigure(n.id, patch);   // settles, renders, one undo step
  const field = (label, value, ph, fn) => {
    const lab = mk("label", { class: "rf" });
    lab.appendChild(mk("span", { text: label }));
    const inp = mk("input", { type: "text", class: "bxbin", placeholder: ph || "",
                              value: value == null ? "" : String(value) });
    lab.appendChild(inp);
    body.appendChild(lab);
    inp.addEventListener("change", () => fn(inp.value));
    return inp;
  };
  const mode = bxInputMode(n);
  if (mode === "dataset") {                    // the input reads as a sheet: the
    bxDatasetFill(body, n);                    // same table the dataset box edits
    return;                                    // \u2014 cells, paste, files and all
  }
  if (mode === "matrix") {
    // the matrix itself, typed right here: one row per line, numbers split by
    // spaces or commas. The box carries it and the run sends it as data
    const area = mk("textarea", { class: "bxmat", spellcheck: "false",
                                  placeholder: "1 2 3\n4 5 6 \u2014 one row per line" });
    area.value = n.values == null ? "" : String(n.values);
    body.appendChild(area);
    const m = bxMatrixParse(area.value);
    body.appendChild(mk("div", { class: "panehint" + ((m && m.bad) ? " bad" : ""),
      text: !m ? "type its numbers \u2014 one row per line"
           : m.bad ? m.bad
           : m.ragged ? "its rows do not line up"
           : m.r > 1 ? m.r + " \u00d7 " + m.c + " \u00b7 " + m.count + " numbers \u00b7 "
                       + m.c + " wide"
           : m.count + " number" + (m.count === 1 ? "" : "s") }));
    area.addEventListener("change", () => {
      const mm = bxMatrixParse(area.value);
      save({ input_mode: "matrix", values: area.value,
             dout: mm && !mm.bad && !mm.ragged ? mm.c : undefined });
    });
  } else if (mode === "text") {
    field("text", n.text || "", "the string it carries",
          (v) => save({ input_mode: "text", text: v }));
  } else if (mode === "image") {
    // the picture: drop it here, paste it, or choose it. It lands in the
    // project's media store, the box shows the thumbnail it received, and the
    // run sends its pixels across the wires as an RGB matrix (h x w x 3).
    const file = mk("input", { type: "file", accept: "image/*" });
    file.hidden = true;
    body.appendChild(file);
    const zone = mk("div", { class: "bxdrop" + (n.image ? " has" : "") });
    zone.tabIndex = 0;
    const keep = (e) => {                      // a drop is ours, not the canvas'
      if (e && e.preventDefault) e.preventDefault();
      if (e && e.stopPropagation) e.stopPropagation();
    };
    if (n.image) {
      const bid = String(n.image).replace(/^blob:/, "");
      zone.appendChild(mk("img", { class: "bxdropimg",
                                   src: "/api/blob?id=" + encodeURIComponent(bid) }));
      const row = mk("div", { class: "bxdroprow" });
      const rep = mk("span", { class: "chip tiny", text: "replace" });
      rep.addEventListener("click", (e) => {
        keep(e);
        if (file.click) file.click();
      });
      const off = mk("span", { class: "chip tiny", text: "clear" });
      off.addEventListener("click", (e) => {
        keep(e);
        save({ input_mode: "image", image: "" });
      });
      row.appendChild(rep);
      row.appendChild(off);
      zone.appendChild(row);
    } else {
      zone.appendChild(mk("div", { class: "bxdropmsg", text: "Drop or choose\u2026" }));
      zone.appendChild(mk("div", { class: "bxdropmsg faint",
        text: "drag it here, paste it with the box selected, or click to choose" }));
    }
    const over = (on) => { zone.className = "bxdrop" + (n.image ? " has" : "")
                                                   + (on ? " over" : ""); };
    zone.addEventListener("click", () => { if (file.click) file.click(); });
    zone.addEventListener("dragover", (e) => { keep(e); over(true); });
    zone.addEventListener("dragleave", () => over(false));
    zone.addEventListener("drop", (e) => {
      keep(e);
      over(false);
      const dt = e && e.dataTransfer;
      const f = dt && dt.files && dt.files[0];
      if (f) bxImageAttach(n, f, zone);
    });
    zone.addEventListener("paste", (e) => {
      const cd = e && e.clipboardData;
      const f = cd && cd.files && cd.files[0];
      if (f) {
        keep(e);
        bxImageAttach(n, f, zone);
      }
    });
    file.addEventListener("change", () => {
      const f = file.files && file.files[0];
      if (f) bxImageAttach(n, f, zone);
    });
    body.appendChild(zone);
    field("size", n.image_size == null ? "768" : n.image_size,
          "768 \u2014 the side the pixels are sent at",
          (v) => save({ input_mode: "image", image_size: v }));
  }
  sel.addEventListener("change", () => save({ input_mode: sel.value }));
  // the run action lives here now: where the data is, the way to run it —
  // in a footer of its own, so the button never sits on the box's edge
  const foot = mk("div", { class: "runfoot" });
  const runbar = mk("div", { class: "rrow" });
  const go = mk("span", { class: "chip tiny play" + (bxtRunEnabled() ? "" : " off"),
                          text: BXRUN.running ? "running\u2026"
                               : BXRUN.loading ? "loading\u2026"
                               : "\u25b6 run the design" });
  go.title = bxtRunEnabled() ? "the whole design on the backend"
                             : "connect a backend first \u2014 Backend \u25be";
  go.addEventListener("click", () => {
    if (bxtRunEnabled() && !BXRUN.running && !BXRUN.loading) bxtRunGo();
  });
  runbar.appendChild(go);
  foot.appendChild(runbar);
  pane.appendChild(foot);
  const outcome = bxRunOutcome();
  if (outcome)
    foot.appendChild(mk("div", { class: "bxbhint " + (outcome.ok ? "runok" : "runbad"),
                                text: outcome.text }));
  const clock = [];                            // the two clocks, side by side
  if (BXRUN.full_ms != null)
    clock.push("run \u2192 result " + bxMs(BXRUN.full_ms));
  const tm = BXRUN.timing;
  if (tm && tm.input_to_output_ms != null) {
    let line = "input \u2192 output " + bxMs(tm.input_to_output_ms);
    if (tm.sweeps > 1)
      line += " \u00b7 " + tm.sweeps + " sweeps \u00b7 " + bxMs(tm.per_sweep_ms) + " each";
    clock.push(line);
  }
  if (clock.length)
    foot.appendChild(mk("div", { class: "bxbhint bxclock", text: clock.join(" \u00b7 ") }));
}
function bxImageAttach(n, f, zone) {           // a file -> the media store -> the box
  if (!f) return false;
  const looks = /^image\//.test(String(f.type || ""))
             || /\.(png|jpe?g|gif|webp|avif|bmp)$/i.test(String(f.name || ""));
  if (!looks) {
    if (zone) zone.appendChild(mk("div", { class: "bxdropmsg bad",
                                           text: "that is not a picture" }));
    return false;
  }
  if (typeof fetch !== "function") return false;
  if (zone) zone.appendChild(mk("div", { class: "bxdropmsg", text: "uploading \u2026" }));
  fetch("/api/blob?name=" + encodeURIComponent(f.name || "image.png"),
        { method: "POST", body: f })
    .then(r => r.json())
    .then(d => {
      if (!d || !d.ok || !d.id) throw new Error((d && d.error) || "upload failed");
      bxConfigure(n.id, { input_mode: "image", image: "blob:" + d.id,
                          image_size: Number(n.image_size) || 768, dout: 3 });
    })
    .catch(e => {
      if (zone) zone.appendChild(mk("div", { class: "bxdropmsg bad",
                                             text: String((e && e.message) || e) }));
    });
  return true;
}
function bxImageDraw(body, st, name) {         // the picture a state carries, drawn
  const im = st && st.image;                   // as it arrived — blob or thumbnail
  if (!im || !body) return false;
  const bid = String(im.blob || "").replace(/^blob:/, "");
  if (bid) {
    body.appendChild(mk("img", { class: "bxoutimg",
                                 src: "/api/blob?id=" + encodeURIComponent(bid) }));
    if (name) bxImageActions(body, st, name);
    return true;
  }
  const t = im.thumb;
  if (t && t.rgb && typeof atob === "function") {
    const cv = mk("canvas", { class: "bxoutimg" });
    cv.width = t.w;
    cv.height = t.h;
    body.appendChild(cv);
    const ctx = cv.getContext && cv.getContext("2d");
    if (ctx) {
      const bin = atob(t.rgb);                 // the backend's own RGB bytes
      const px = ctx.createImageData(t.w, t.h);
      for (let i = 0, j = 0; i < px.data.length; i += 4, j += 3) {
        px.data[i] = bin.charCodeAt(j);
        px.data[i + 1] = bin.charCodeAt(j + 1);
        px.data[i + 2] = bin.charCodeAt(j + 2);
        px.data[i + 3] = 255;
      }
      ctx.putImageData(px, 0, 0);
    }
    if (name) bxImageActions(body, st, name);
    return true;
  }
  return false;
}
function bxImageFileName(name, st) {          // a box's name, as a file name —
  const im = (st && st.image) || {};           // with the stored picture's own
  const bid = String(im.blob || "").replace(/^blob:/, "");
  const ext = (bid.split(".").pop() || "").toLowerCase();   // extension when there
  const keep = /^(png|jpe?g|webp|gif|avif|bmp)$/.test(ext); // is one (a thumbnail
  const base = String(name || "image").trim().replace(/[^\w.-]+/g, "-")   // always
                     .replace(/^-+|-+$/g, "");              // re-encodes to png)
  return (base || "image") + "." + (keep ? ext : "png");
}
function bxImageBlob(st) {                     // the picture as a PNG blob, either way
  return new Promise((resolve, reject) => {
    const im = (st && st.image) || {};
    const bid = String(im.blob || "").replace(/^blob:/, "");
    if (bid) {                                 // the stored picture: ask the server
      if (typeof fetch !== "function")
        return reject(new Error("the app cannot reach the server"));
      fetch("/api/blob?id=" + encodeURIComponent(bid))
        .then(r => (r && r.ok && r.blob ? r.blob()
                                        : Promise.reject(new Error("the picture could not be read"))))
        .then(resolve, reject);
      return;
    }
    const t = im.thumb;
    if (!t || !t.rgb || typeof atob !== "function" ||
        typeof document === "undefined" || !document.createElement)
      return reject(new Error("this picture is not copyable here"));
    const cv = document.createElement("canvas");
    cv.width = t.w;
    cv.height = t.h;
    const ctx = cv.getContext && cv.getContext("2d");
    if (!ctx || !cv.toBlob)
      return reject(new Error("this browser cannot export the picture"));
    const bin = atob(t.rgb);                   // the backend's own RGB bytes
    const px = ctx.createImageData(t.w, t.h);
    for (let i = 0, j = 0; i < px.data.length; i += 4, j += 3) {
      px.data[i] = bin.charCodeAt(j);
      px.data[i + 1] = bin.charCodeAt(j + 1);
      px.data[i + 2] = bin.charCodeAt(j + 2);
      px.data[i + 3] = 255;
    }
    ctx.putImageData(px, 0, 0);
    cv.toBlob((b) => b ? resolve(b)
                       : reject(new Error("the picture could not be encoded")), "image/png");
  });
}
function bxImageSave(st, file, chip) {         // save image: a plain PNG download
  bxImageBlob(st).then(blob => {
    if (typeof URL === "undefined" || !URL.createObjectURL ||
        typeof document === "undefined" || !document.createElement)
      throw new Error("this browser cannot save files");
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = file;
    if (a.click) a.click();
    if (URL.revokeObjectURL) URL.revokeObjectURL(url);
    if (chip) chip.textContent = "saved \u2713";
  }).catch(e => {
    if (chip) chip.textContent = String((e && e.message) || e).slice(0, 46);
  });
}
function bxImageCopy(st, chip) {               // copy image: onto the clipboard
  bxImageBlob(st).then(blob => {
    if (typeof navigator === "undefined" || !navigator.clipboard ||
        !navigator.clipboard.write || typeof ClipboardItem === "undefined")
      throw new Error("clipboard images need Chrome \u2014 use save");
    return navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
  }).then(() => { if (chip) chip.textContent = "copied \u2713"; },
          e => { if (chip) chip.textContent = String((e && e.message) || e).slice(0, 46); });
}
function bxImageActions(body, st, name) {      // the two ways to keep the picture
  const row = mk("div", { class: "rrow" });
  const file = bxImageFileName(name, st);
  const chip = (label, title, fn) => {
    const b = mk("span", { class: "chip tiny", text: label, title: title });
    b.addEventListener("mousedown", (e) => {   // a display click is not a canvas click:
      if (e && e.stopPropagation) e.stopPropagation();   // the state stays put
    });
    b.addEventListener("click", () => fn(b));
    row.appendChild(b);
    return b;
  };
  chip("copy image", "put the picture on the clipboard as a PNG",
       (b) => bxImageCopy(st, b));
  chip("save image", "download it as " + file, (b) => bxImageSave(st, file, b));
  body.appendChild(row);
  return row;
}
function bxPeekBlock(st) {                     // a value's numbers: a matrix
  const sh = ((st && st.shape) || []).map(Number);   // up to 2-D reads as a
  const peek = (st && st.peek) || [];                // grid — rows of cells at
  if (!peek.length) return null;                     // the matrix's own row
  const count = sh.reduce((a, b) => a * b, 1);       // width, numbered; anything
  const flat = mk("div", { class: "bxdata",          // wider or deeper stays a
    text: peek.map(bxNumText).join(", ")             // flat, clipped readout
        + (count > peek.length ? ", \u2026" : "") });
  if (sh.length < 1 || sh.length > 2) return flat;
  const rows = sh.length === 2 ? sh[0] : 1;
  const cols = sh.length === 2 ? sh[1] : sh[0];
  if (!cols || cols > 64 || rows < 1) return flat;
  const wrap = mk("div", { class: "peekwrap" });
  const g = mk("div", { class: "peekgrid" });
  const lead = rows > 1 ? "auto " : "";
  g.style.gridTemplateColumns = lead + "repeat(" + cols + ", max-content)";
  if (rows > 1 && cols <= 32) {                // the column numbers, when they read
    if (lead) g.appendChild(mk("div", { class: "ph", text: "" }));
    for (let c = 0; c < cols; c++)
      g.appendChild(mk("div", { class: "ph", text: String(c) }));
  }
  for (let r = 0; r < rows; r++) {
    if (lead) g.appendChild(mk("div", { class: "pi", text: String(r) }));
    let any = false;
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (i >= peek.length) break;             // the peek runs out: the last
      any = true;                              // cell says so once
      g.appendChild(mk("div", { class: "pc", text: bxNumText(peek[i]) }));
    }
    if (!any) break;
  }
  if (count > peek.length)
    g.appendChild(mk("div", { class: "pc pmore", text: "\u2026" }));
  wrap.appendChild(g);
  return wrap;
}
function bxOutputFill(pane, n) {               // the output's window: whatever data
  // the last run handed it — the readout, and that is all: the training —
  // lives on a config that names a model, or on a Training box
  pane.innerHTML = "";
  bxBehaveInside(pane);
  const st = bxNodeState(n);
  const body = mk("div", { class: "bxinputbody" });
  body.addEventListener("scroll", () => {
    (n._scroll = n._scroll || {}).output = body.scrollTop;
  });
  pane.appendChild(body);
  if (!st) {
    body.appendChild(mk("div", { class: "panehint",
      text: "no data yet \u2014 run the design and what arrives here shows up" }));
    return;
  }
  if (st.text != null) {
    body.appendChild(mk("div", { class: "bxdata", text: "\u201c" + st.text + "\u201d" }));
    return;
  }
  if (st.image) {                              // a picture arrived: draw the data
    const drew = bxImageDraw(body, st, n.name || "output");   // as it is, then
                                               // say what it is — and how to keep it
    if (!drew) {
      body.appendChild(mk("div", { class: "panehint",
        text: "an image arrived (" + (st.image.w || "?") + "\u00d7"
              + (st.image.h || "?") + ")" }));
    }
    const ib = [];
    if (st.image.w && st.image.h) ib.push(st.image.w + "\u00d7" + st.image.h + " px");
    if (st.mean != null) ib.push("\u03bc " + bxNumText(st.mean));
    if (st.min != null && st.max != null)
      ib.push("min " + bxNumText(st.min) + " \u00b7 max " + bxNumText(st.max));
    if (ib.length)
      body.appendChild(mk("div", { class: "panehint", text: ib.join(" \u00b7 ") }));
    return;
  }
  const sh = (st.shape || []).map(Number);
  const peek = st.peek || [];
  const block = bxPeekBlock(st);               // the numbers, structured where
  if (block) body.appendChild(block);          // a matrix can be read as one
  else if (st.scalar != null) {
    body.appendChild(mk("div", { class: "bxdata", text: bxNumText(st.scalar) }));
  }
  const bits = [];                             // the summary under the numbers
  if (sh.length) bits.push("shape [" + sh.join("\u00d7") + "]");
  else if (st.mean != null) bits.push("one value");
  if (st.mean != null && (peek.length || st.scalar == null)) bits.push("\u03bc " + bxNumText(st.mean));
  if (st.min != null && st.max != null)
    bits.push("min " + bxNumText(st.min) + " \u00b7 max " + bxNumText(st.max));
  if (bits.length) body.appendChild(mk("div", { class: "panehint", text: bits.join(" \u00b7 ") }));
}

function bxHeatFill(pane, n) {                 // the heatmap's window: the picture
  // it drew, once a run has handed it a vector
  pane.innerHTML = "";
  bxBehaveInside(pane);
  const st = bxNodeState(n);
  const body = mk("div", { class: "bxinputbody" });
  pane.appendChild(body);
  if (!st || !st.image) {
    body.appendChild(mk("div", { class: "panehint",
      text: "no picture yet \u2014 run the design and the vector it receives draws here" }));
    return;
  }
  const drew = bxImageDraw(body, st, n.name || "heatmap");
  if (!drew)
    body.appendChild(mk("div", { class: "panehint",
      text: "an image arrived (" + (st.image.w || "?") + "\u00d7"
            + (st.image.h || "?") + ")" }));
  const bits = [];
  if (st.image.w && st.image.h) bits.push(st.image.w + "\u00d7" + st.image.h + " px");
  if (st.shape && st.shape.length)
    bits.push("from " + st.shape.reduce((a, b) => a * b, 1) + " values");
  if (st.min != null && st.max != null)
    bits.push("min " + bxNumText(st.min) + " \u00b7 max " + bxNumText(st.max));
  if (bits.length) body.appendChild(mk("div", { class: "panehint", text: bits.join(" \u00b7 ") }));
}
function bxRunOutcome() {                       // the run's verdict, in one line
  if (BXRUN.running) return { ok: true, text: "\u2026 running the design" };
  if (BXRUN.loading) return { ok: true, text: "\u2026 loading the weights" };
  if (BXRUN.msg) return { ok: !BXRUN.error,
                          text: (BXRUN.error ? "\u2717 " : "\u2026 ") + BXRUN.msg };
  const r = BXRUN.last;
  if (!r || !Object.keys(bxRunValues || {}).length) return null;   // stale once edited
  const n = Object.keys(r.values || {}).length + Object.keys(r.texts || {}).length;
  const bits = [n + " box" + (n === 1 ? "" : "es"), (r.ms || 0) + " ms"];
  if (r.device) bits.push("on " + r.device);
  else if (r.backend) bits.push("on " + r.backend);
  return { ok: true, text: "\u2713 ran the design \u00b7 " + bits.join(" \u00b7 ") };
}
function bxTrainSpec(pane) {                  // Spec: the machine, its usage, and
  // how the design's weights sit on it
  const a = bxLocalRunner();
  const remote = BX_BACKEND.mode === "remote";
  pane.appendChild(mk("div", { class: "mhead", text: "backend" }));
  const bstate = mk("div", { class: "bxbhint" });
  bstate.textContent = a
    ? a.name + " \u00b7 " + (a.specs.gpu || a.specs.cpu || "?") + " \u00b7 "
      + (a.specs.device || "cpu")
    : (remote ? "remote (Modal) \u2014 the transport is not wired yet"
              : "no backend connected \u2014 Backend \u2192 Local");
  pane.appendChild(bstate);
  if (!a) return;                              // the rest is the machine's work
  bxSpecRows(pane, a.specs || {});
  const u = a.usage || {};
  const sp = a.specs || {};
  bxUsageRow(pane, "ram now",
             u.ram_used_gb != null ? u.ram_used_gb : null,
             u.ram_total_gb != null ? u.ram_total_gb : (sp.ram_gb || null),
             u.ram_pct);
  bxUsageRow(pane, "vram now",
             u.vram_used_gb != null ? u.vram_used_gb : null,
             u.vram_total_gb != null ? u.vram_total_gb : (sp.vram_gb || null),
             u.vram_pct);
  // load the whole design's weights: set the bar, then load \u2014 the ratio
  // writes each layer's place, there is no separate gpu/cpu button any more
  pane.appendChild(mk("div", { class: "mhead", text: "weights" }));
  const orow = mk("label", { class: "rf" });
  orow.appendChild(mk("span", { text: "cpu offload" }));
  const orange = mk("input", { type: "range", min: "0", max: "100", step: "5",
                               class: "bxoff", value: String(bxOffloadRatio()),
                               title: "how much of the weights stays on the system ram "
                                      + "\u2014 the first layers stay on the gpu" });
  orow.appendChild(orange);
  const opct = mk("span", { text: bxOffloadRatio() + "%" });
  orow.appendChild(opct);
  pane.appendChild(orow);
  const oread = mk("div", { class: "bxbhint" });
  const orender = () => {
    const r = Math.max(0, Math.min(100, Number(orange.value) || 0));
    opct.textContent = r + "%";
    const plan = bxOffloadPlan(r);
    const free = (u.vram_total_gb != null && u.vram_used_gb != null)
                 ? u.vram_total_gb - u.vram_used_gb : null;
    const rfree = (u.ram_total_gb != null && u.ram_used_gb != null)
                  ? u.ram_total_gb - u.ram_used_gb : null;
    let warn = "";
    if (free != null && plan.gpu > free * 0.92 * 2 ** 30) warn += " \u00b7 over vram";
    if (rfree != null && plan.system > rfree * 0.92 * 2 ** 30) warn += " \u00b7 over ram";
    oread.textContent = "planned: gpu " + bxGB(plan.gpu) + " \u00b7 system "
                        + bxGB(plan.system)
                        + (free != null ? " \u00b7 vram free " + free.toFixed(1) + " GB" : "")
                        + (rfree != null ? " \u00b7 ram free " + rfree.toFixed(1) + " GB" : "")
                        + warn
                        + (r > 0 ? " \u00b7 first layers on the gpu" : "");
  };
  orange.addEventListener("input", orender);
  orange.addEventListener("change", () => {
    BX.model = BX.model || {};
    BX.model.cpu_offload = Math.max(0, Math.min(100, Number(orange.value) || 0));
    bxApplyOffload("gpu");                     // one undo step, the boxes follow
    bxtRunSync();
  });
  orender();
  pane.appendChild(oread);
  const lrow = mk("div", { class: "rrow" });
  const loadBtn = (key, label) => {
    const chip = mk("span", { class: "chip tiny",
                              text: (BXRUN.loading && BXRUN.loadKey === key) ? "\u2026" : label });
    chip.addEventListener("click", () => {
      if (!BXRUN.loading && !BXRUN.running) bxtRunLoad();
    });
    lrow.appendChild(chip);
  };
  loadBtn("load", "load weights");
  const off = mk("span", { class: "chip tiny", text: BXRUN.offloading ? "\u2026" : "offload" });
  off.addEventListener("click", () => {
    if (!BXRUN.loading && !BXRUN.running && !BXRUN.offloading) bxtRunOffload();
  });
  lrow.appendChild(off);
  pane.appendChild(lrow);
  const accel = ["cuda", "mps"].indexOf((a.specs || {}).device) >= 0;
  const split = bxWeightSplit(accel);          // where the layers sit, in bytes
  const total = split.gpu + split.system;
  let wtext = "no weights yet";
  if (total > 0) {
    const wstate = split.system === 0 ? "all on the gpu"
                 : split.gpu === 0 ? "all on the cpu" : "mixed";
    wtext = bxGB(total) + " \u00b7 " + wstate;
    if (wstate === "mixed")
      wtext += " (" + bxGB(split.gpu) + " gpu \u00b7 " + bxGB(split.system) + " cpu)";
  }
  pane.appendChild(mk("div", { class: "bxbhint", text: wtext }));
  if (BXRUN.loaded) {                          // what the backend actually holds now
    const l = BXRUN.loaded;
    const g = l.on_gpu_bytes || 0, sy = l.on_system_bytes || 0;
    const where = sy === 0 && g > 0 ? "all on the gpu"
                : g === 0 && sy > 0 ? "all on the system" : "mixed";
    pane.appendChild(mk("div", { class: "bxbhint", text:
      "loaded: " + bxGB(l.bytes || 0) + " \u00b7 " + where
      + " (" + bxGB(g) + " gpu \u00b7 " + bxGB(sy) + " system)"
      + (l.cached ? " \u00b7 already warm" : "")
      + (l.ms ? " \u00b7 " + l.ms + " ms" : "") }));
  }
  if (BX.model && BX.model.arc && BX.model.fidelity === "exact")
    pane.appendChild(mk("div", { class: "bxbhint", text:
      "researched from the repo \u00b7 exact, in the hf_arc database" }));
  else if (BX.model && BX.model.fidelity === "exact" && BX.model.spec)
    pane.appendChild(mk("div", { class: "bxbhint", text: "designed from the " +
      BX.model.spec + " spec \u00b7 exact (conformance-verified)" }));
  else if (BX.model && BX.model.fidelity === "diffusers")
    pane.appendChild(mk("div", { class: "bxbhint", text:
      "diffusers " + (BX.model.arc ? "researched from the repo \u00b7 " : "") +
      "the UNet is mirrored exactly \u2014 the VAE and the text encoders stay on the Hub" }));
  else if (BX.model && BX.model.fidelity === "approximate" && BX.model.arch)
    pane.appendChild(mk("div", { class: "bxbhint", text:
      "approximate skeleton \u2014 no verified " + BX.model.arch + " spec yet" }));
  if (BX.model && BX.model.audit && !BX.model.audit.ok) {
    pane.appendChild(mk("div", { class: "mhead", text: "connection audit" }));
    for (const is of (BX.model.audit.issues || []).slice(0, 6))
      pane.appendChild(mk("div", { class: "bxbhint",
        text: "\u26a0 " + (is.box || "?") + ": " + is.what }));
  }
}
function bxTrainRefresh() {                    // repaint every Run box's window, live
  const root = bxHost();
  if (!root || !root.querySelectorAll) return;
  for (const el of root.querySelectorAll(".bxlogpane")) {
    const id = el.getAttribute ? el.getAttribute("data-agent") : null;
    const n = id ? bxNode(id) : null;
    if (!n || !bxTraining(n)) continue;
    if (typeof document !== "undefined" && document.activeElement && el.contains &&
        el.contains(document.activeElement)) continue;   // let a typist keep the field
    bxPaneFill(el, n);
  }
}
function bxTrainCmd(n, cmd) {
  if (typeof fetch !== "function" || !n.task_id) return;
  fetch("/api/tasks/cmd", { method: "POST", headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ task: n.task_id, cmd }) })
    .then(r => r.json())
    .then(() => { bxTrainPoll(true); })
    .catch(() => {});
}
function bxTrainPoll(force) {                  // one poller for every training host
  const boxes = [];
  bxEveryBox(x => { if (bxTraining(x) && x.task_id) boxes.push(x); });
  if (!boxes.length) return;
  const seen = BXRUN.trainSeen = BXRUN.trainSeen || {};
  for (const n of boxes) {
    if (typeof fetch !== "function") continue;
    fetch("/api/tasks/state?task=" + encodeURIComponent(n.task_id), { cache: "no-store" })
      .then(r => r.json())
      .then(d => {
        const st = d && d.state;
        if (!st) return;
        BXRUN.trainState = BXRUN.trainState || {};
        BXRUN.trainState[n.id] = st;
        if (st.step != null && seen[n.id] !== st.step) {
          seen[n.id] = st.step;
          if (st.loss != null || st.acc != null ||
              st.tloss != null || st.tacc != null) {
            BXRUN.trainHist = BXRUN.trainHist || {};
            const hist = BXRUN.trainHist[n.id] = BXRUN.trainHist[n.id] || [];
            hist.push({ loss: st.loss, acc: st.acc, tloss: st.tloss, tacc: st.tacc });
            if (hist.length > 200) hist.shift();
          }
        }
        bxRender();
      })
      .catch(() => {});
  }
}

