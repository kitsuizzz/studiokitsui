// ─── nnstudio shell · 110 · runs and flow ─────────────────────────────────────
// the flow marks, run result/error/audit, offload, the run document, image feeds, and fetchBackend.
// Order is load-bearing: this slice is concatenated after the one before it.

// ---- the data flow: the backend's marks, kept wherever they live -----------
// Every box the run finished is remembered by its **full path** ("blk 2/norm"),
// so switching levels only changes what is drawn — never which boxes are lit.
// A mark means *done* (the engine marks a nested box after its inside); the
// live ring rides the deepest path seen and lights its whole chain, so the
// current location shows at every level. Glow updates only touch classes on
// the existing svg — no rebuild, so the lit wires never flicker or restart.
function bxPathId(id) {                        // any box's path at the level shown
  const up = bxCurrentPath();
  return (up.length ? up.join("/") + "/" : "") + id;
}
function bxNodePath(n) { return bxPathId(n && n.id); }
function bxFlowLive(path) {                    // the live box — or one containing it
  return bxFlowNow != null && path != null &&
         (bxFlowNow === path || bxFlowNow.indexOf(path + "/") === 0);
}
function bxFlowPaint() {                       // class pass only: the svg stays put
  const host = bxHost();
  const root = host && host.querySelector ? host.querySelector(".bxsvg") : null;
  if (!root || !root.querySelectorAll) return false;
  for (const g of root.querySelectorAll(".dnode")) {
    const id = g.getAttribute && g.getAttribute("data-id");
    if (!id || !g.classList) continue;
    const p = bxPathId(id);
    g.classList.toggle("flow", bxFlowSet.has(p));
    g.classList.toggle("now", bxFlowLive(p));
  }
  for (const e of root.querySelectorAll(".dedge")) {
    const from = e.getAttribute && e.getAttribute("data-from");
    if (!from || !e.classList) continue;
    e.classList.toggle("flow", bxFlowSet.has(bxPathId(from)));
  }
  return true;
}
function bxFlowClear() {
  bxFlowSet = new Set();
  bxFlowNow = null;
  bxFlowRendered = 0;
  if (bxFlowPending) { clearTimeout(bxFlowPending); bxFlowPending = null; }
  bxFlowPaint();
}
function bxFlowBeginStep(step) {               // a new forward pass: the sweep starts
  if (step == null || step === bxFlowStep) return false;   // over — show it live
  bxFlowStep = step;
  bxFlowClear();
  return true;
}
function bxFlowIngest(paths) {                 // the backend's marks, in order — kept
  let added = 0, last = null;                  // for every level, drawn at this one
  for (const raw of paths || []) {
    const path = String(raw);
    if (!bxFlowSet.has(path)) { bxFlowSet.add(path); added++; }
    last = path;
  }
  if (last != null) bxFlowNow = last;          // the newest mark: where the data is
  if (!added) return;                          // nothing new to draw
  const now = Date.now();
  if (now - bxFlowRendered >= 40) {            // batched: a burst is one class pass
    bxFlowRendered = now;
    bxFlowPaint();
  } else if (!bxFlowPending) {
    bxFlowPending = setTimeout(() => {
      bxFlowPending = null;
      bxFlowRendered = Date.now();
      bxFlowPaint();
    }, 50);
  }
}
function bxFlowRestore() {                     // a refresh: the backend still holds the
  if (typeof fetch !== "function") return;     // last run's marks — show them again
  fetch("/api/run/progress", { cache: "no-store" })
    .then(r => (r.ok ? r.json() : null))
    .then(d => {
      const p = d && d.progress;
      if (p && p.nodes && p.nodes.length) bxFlowIngest(p.nodes);
    })
    .catch(() => {});
}
function bxRunResult(d) {                      // a finished run: keep every value by path
  BXRUN.last = d;
  BXRUN.error = false;                         // the failure it replaces is gone
  const nowMs = (typeof performance !== "undefined" && performance.now)
    ? performance.now() : Date.now();
  if (BXRUN.sent_at != null)                   // the whole journey: press to result
    BXRUN.full_ms = Math.max(0, Math.round(nowMs - BXRUN.sent_at));
  BXRUN.timing = (d && d.timing) || null;      // the backend's own execution clock
  bxDataState = {};
  bxRunValues = {};
  for (const [path, st] of Object.entries((d && d.values) || {})) bxRunValues[path] = st;
  for (const [path, txt] of Object.entries((d && d.texts) || {}))
    bxRunValues[path] = { text: txt };
  bxFlowIngest((d && d.flow) || []);           // every finished box stays lit
  bxRender();
  bxtRunSync();
}
// ---- the run's error: mark the block the backend blamed --------------------
function bxRunErrClear() { bxRunErr = null; }
function bxRunStatusClear() {                  // a progress batch arrived: the status
  if (!BXRUN.running || BXRUN.error) return;   // line makes way — never an error
  if (BXRUN.msg) { BXRUN.msg = ""; bxtRunSync(); }
}
function bxAuditClear() { bxAudit = null; }
function bxMarkAudit(audit) {
  bxAudit = null;
  const issues = (audit && audit.issues) || [];
  if (!issues.length) return;
  // mark the box the issue names and every block on the way down to it, so
  // going inside still shows where the wiring is wrong
  const ids = new Set(), notes = {};
  const add = (id, text) => {
    if (!id) return;
    ids.add(id);
    const list = notes[id] || (notes[id] = []);
    if (list.indexOf(text) < 0) list.push(text);
  };
  for (const is of issues) {
    const text = (is.box ? is.box + ": " : "") + (is.what || "connection issue");
    for (const id of is.chain || []) add(id, text);
    add(is.nid, text);
  }
  bxAudit = { ids, notes, count: issues.length, ok: audit.ok !== false };
  if (ids.size) bxRender();
}
function bxMarkRunError(info) {
  bxRunErr = null;
  if (!info) return;
  // the chain from a top-level box down to the failing one — every container
  // on the way wears the mark, so going inside still shows where it broke
  const pathTo = (nodes, chain, byName) => {
    for (const n of nodes || []) {
      const here = chain.concat(n);
      if (byName ? n.name === info.box : n.id === info.nid) return here;
      if (n.kind === "custom" && n.inner) {
        const hit = pathTo(n.inner.nodes, here, byName);
        if (hit) return hit;
      }
    }
    return null;
  };
  const chain = (info.nid && pathTo(BX.nodes, [], false)) ||
                (info.box && pathTo(BX.nodes, [], true)) || [];
  const here = chain.length ? chain[chain.length - 1] : null;
  bxRunErr = { ids: new Set(chain.map(n => n.id)), here: here ? here.id : null,
               name: here ? here.name : (info.box || null),
               msg: String(info.error || "the run failed") };
  if (chain.length) bxRender();
}
function bxtRunOffload() {                     // let the backend drop everything
  BXRUN.offloading = true;
  BXRUN.msg = "";
  bxtRunSync();
  bxUsageWatch(true);
  const name = (bxLocalRunner() && bxLocalRunner().name) || "the runner";
  fetch("/api/offload", { method: "POST", headers: { "Content-Type": "application/json" },
                          body: "{}" })
    .then(r => r.json().then(d => ({ ok: r.ok, d })))
    .then(res => {
      BXRUN.offloading = false;
      bxUsageWatch(false);
      if (!res.ok || !res.d || !res.d.ok)
        throw new Error((res.d && res.d.error) || "the offload failed");
      BXRUN.loaded = null;                     // nothing is warm any more
      BXRUN.warmMode = null;
      const b = res.d.before || {}, a = res.d.after || {};
      const num = (v) => (v == null ? "?" : Number(v).toFixed(1));
      BXRUN.msg = "offloaded \u00b7 ram " + num(b.ram_used_gb) + " \u2192 " + num(a.ram_used_gb)
                + " GB \u00b7 vram " + num(b.vram_used_gb) + " \u2192 "
                + num(a.vram_used_gb) + " GB";
      bxtRunSync();
      fetchBackend();
    })
    .catch(e => {
      BXRUN.offloading = false;
      bxUsageWatch(false);
      bxtRunMsg("could not offload on " + name + " \u2014 " + String((e && e.message) || e));
      fetchBackend();
    });
}
// ---------------------------------------------------------- the run's own boxes
// A design may hold boxes the run never touches: a spare model, a half-built
// branch, an input nothing reads. The run is what goes from a source to an
// output (or a loss); everything else is discarded — the marks look only at
// the run, and the backend is asked only for what the run needs.
function bxFeedsItself(n, edges) {             // a box that makes its own data
  if (!n) return false;
  if (n.kind === "input" || n.kind === "dataset" || n.kind === "script")
    return true;
  return (n.kind === "tokenize" || n.kind === "hf") &&
         !(edges || []).some(e => e.to === n.id);
}
function bxRunSet(nodes, edges) {              // ids on a source -> sink path
  nodes = nodes || [];
  edges = edges || [];
  const byId = new Map(nodes.map(n => [n.id, n]));
  const src = nodes.filter(n => bxFeedsItself(n, edges));
  const sink = nodes.filter(n => n.kind === "output" || n.kind === "loss");
  const step = (from, dir) => {
    const seen = new Set(from.map(n => n.id));
    const q = from.slice();
    while (q.length) {
      const n = q.pop();
      for (const e of edges) {
        const nid = dir === "fwd" ? (e.from === n.id ? e.to : null)
                                  : (e.to === n.id ? e.from : null);
        const m = nid == null ? null : byId.get(nid);
        if (!m || seen.has(m.id)) continue;
        seen.add(m.id);
        q.push(m);
      }
    }
    return seen;
  };
  const fwd = step(src, "fwd"), back = step(sink, "back");
  const run = new Set();
  for (const id of fwd) if (back.has(id)) run.add(id);
  return run;
}
function bxRunDoc(nodes, edges) {              // one level, the run's boxes only
  nodes = nodes || [];
  edges = edges || [];
  const named = new Set();                     // what a training host reads from
  for (const n of nodes) {
    if (n.kind === "train" || (n.kind === "output" && n.train))
      [n.dataset, n.test_dataset].forEach(x => { if (x) named.add(x); });
    if (n.kind === "config" || n.kind === "training") {   // a config (or a
      if (n.model) named.add(n.model);         // Training box) names its model,
      if (n.test_dataset) named.add(n.test_dataset);   // and reads its own dots
      if (n.val_dataset) named.add(n.val_dataset);
    }
  }
  const extra = new Set();                     // the experiment's own boxes:
  for (const n of nodes)                       // a host that names a model
    if ((n.kind === "config" || n.kind === "training") && n.model)
      extra.add(n.id);
  if (nodes.some(n => n.kind === "train" || (n.kind === "output" && n.train)
                      || ((n.kind === "config" || n.kind === "training")
                          && n.model)))
    for (const e of edges) {                   // …and the matrix boxes it reads
      const a = nodes.find(x => x.id === e.from), b = nodes.find(x => x.id === e.to);
      if (!a || !b) continue;
      if (a.kind === "select") { extra.add(a.id); if (a.dataset) named.add(a.dataset); }
      if (a.kind === "config" && b.kind === "input") extra.add(a.id);
    }
  for (const e of edges) {                     // …and one wired into a host's dot
    const a = nodes.find(x => x.id === e.from), b = nodes.find(x => x.id === e.to);
    if (a && b && bxIsDataset(a) &&
        (b.kind === "train" || (b.kind === "output" && b.train) ||
         b.kind === "select" || b.kind === "config" || b.kind === "training"))
      named.add(a.id);
  }
  const run = bxRunSet(nodes, edges);
  const keep = nodes.filter(n => run.has(n.id) || named.has(n.id) || extra.has(n.id) ||
                                 n.kind === "train" || n.kind === "agent" ||
                                 n.kind === "reward");
  const ids = new Set(keep.map(n => n.id));
  return { nodes: keep, edges: edges.filter(e => ids.has(e.from) && ids.has(e.to)) };
}
function bxRunCanvas(doc) {                    // the exported design, minus the boxes
  if (!doc || !(doc.nodes || []).length) return doc;   // off the run's path
  const view = bxRunDoc(doc.nodes, doc.edges);
  const keep = new Set(view.nodes.map(n => n.id));
  const nodes = [];
  for (const n of doc.nodes) {
    if (!keep.has(n.id)) continue;
    if (n.kind === "custom" && n.inner) n.inner = bxRunCanvas(n.inner);
    nodes.push(n);
  }
  return Object.assign({}, doc, { nodes,
    edges: (doc.edges || []).filter(e => keep.has(e.from) && keep.has(e.to)) });
}
function bxFlowVerify() {                        // the browser's dataflow check: a source
  // must carry data to an output before the backend is asked to run the design
  const nodes = BX.nodes || [], edges = BX.edges || [];
  const bad = new Set(), reach = new Set();
  if (!nodes.length) return { ok: false, bad, why: "the canvas is empty" };
  const feeds_itself = (n) => bxFeedsItself(n, edges);
  const q = [];
  for (const n of nodes)
    if (!bxOffHere(n) && feeds_itself(n)) { reach.add(n.id); q.push(n.id); }
  while (q.length) {
    const id = q.shift();
    for (const e of edges)
      if (e.from === id && !reach.has(e.to)) { reach.add(e.to); q.push(e.to); }
  }
  if (!nodes.some(n => !bxOffHere(n) && feeds_itself(n)))
    return { ok: false, bad,
             why: "nothing makes the data \u2014 add an input (or a tokenizer with text)" };
  const outs = nodes.filter(n => n.kind === "output" && !bxOffHere(n));
  if (outs.length && !outs.some(o => reach.has(o.id))) {
    for (const o of outs) bad.add(o.id);
    const names = outs.map(o => o.name || o.id).slice(0, 3);
    return { ok: false, bad,
             why: "the data never reaches " + names.join(", ")
                  + " \u2014 wire the run through from an input" };
  }
  return { ok: true, bad };
}
function bxtRunGo() {
  if (bxRunFix()) return;                      // a model box without its file
  const canvas = (typeof bxExportCanvas === "function") ? bxExportCanvas() : null;
  if (!canvas) {
    if (BX.up) bxtRunMsg("the whole design runs from the top level \u2014 go back out first");
    return;
  }
  const runCanvas = bxRunCanvas(canvas);       // the run's own boxes: the rest is discarded
  const feeds = {};
  const training = (BXRUN.mode || "inference") === "training";
  if (!training) {                             // in training, the dataset feeds the input
    for (const n of BX.nodes.filter(n => (n.kind === "tokenize" || n.kind === "hf") &&
                                         !BX.edges.some(e => e.to === n.id))) {
      const store = BXRUN.texts || (BXRUN.texts = {});
      const raw = String(store[n.id] != null ? store[n.id] : (n.text || ""));
      if (raw) feeds[n.id] = raw;              // a string: the backend tokenizes it
    }                                          // (or continues it, for an hf model)
    for (const n of BX.nodes.filter(n => n.kind === "input")) {
      if (bxInputMode(n) !== "text") continue;   // a matrix or a picture defines itself
      const store = BXRUN.texts || (BXRUN.texts = {});
      const raw = String(store[n.id] != null ? store[n.id] : (n.text || ""));
      if (raw) feeds[n.id] = raw;            // a string: the tokenizer downstream reads it
    }
  }
  const runIds = bxRunSet(BX.nodes, BX.edges);
  const images = training ? []                     // training feeds the dataset, not
    : BX.nodes.filter(n => n.kind === "input" && n.input_mode === "image" &&
                           runIds.has(n.id));        // a discarded input needs nothing
  const noimg = images.find(n => !n.image);
  if (noimg) {
    bxtRunMsg("input \u201c" + (noimg.name || noimg.id)
              + "\u201d needs an image \u2014 pick one in the box");
    return;
  }
  const send = () => {
  const flow = bxFlowVerify();                 // the browser verifies the dataflow first
  if (!flow.ok) {
    BXRUN.error = true;                        // the run did not happen
    bxRunErr = { ids: flow.bad, here: null, msg: flow.why };
    bxRender();                                // the boxes it blames go red
    bxtRunMsg(flow.why);
    return;
  }
  BXRUN.sent_at = (typeof performance !== "undefined" && performance.now)
    ? performance.now() : Date.now();          // the clock behind run -> result
  BXRUN.full_ms = null;                        // the last run's clocks are stale
  BXRUN.timing = null;
  BXRUN.running = true;
  BXRUN.msg = "";
  BXRUN.error = false;
  BXRUN.last = null;                           // the last run's readout is stale now
  bxFlowStep = null;                           // the first pass counts as new
  bxFlowClear();                               // the last run's lights wash out
  bxRunErrClear();
  bxDataState = {};
  bxRunValues = {};
  bxRender();
  bxtRunSync();
  bxUsageWatch(true);                          // the weights land during compile too
  const name = (bxLocalRunner() && bxLocalRunner().name) || "the runner";
  let poll = 0;
  if (typeof setInterval === "function")
    poll = setInterval(() => {                 // the run's data-flow, while it runs
      if (!BXRUN.running) { clearInterval(poll); return; }
      fetch("/api/run/progress", { cache: "no-store" })
        .then(r => (r.ok ? r.json() : null))
        .then(d => {
          if (!BXRUN.running) return;        // the run ended while this was in flight
          const p = d && d.progress;
          if (!p) return;
          bxFlowBeginStep(p.step);           // a new pass re-walks: the marks restart
          if (p.note) {                      // e.g. huggingface downloading a model
            BXRUN.msg = p.note;
            bxtRunSync();
          }
          const ld = p.load;
          if (ld && ld.total && !ld.done) {    // the compile phase: show the build
            BXRUN.msg = "building\u2026 " + (100 * ld.bytes / ld.total).toFixed(0)
                      + "% \u00B7 " + bxGB(ld.bytes) + " / " + bxGB(ld.total);
            bxtRunSync();
          }
          if (p.nodes && p.nodes.length) {
            bxRunStatusClear();          // the flow has started: drop the status line
            bxFlowIngest(p.nodes);
          }
        })
        .catch(() => {});
    }, 140);
  const outs = BX.nodes.filter(n => n.kind === "output");
  const grows = BX.nodes.filter(n => n.kind === "tokenize" &&
                                     !BX.edges.some(e => e.to === n.id))
    .concat(BX.nodes.filter(n => n.kind === "input"));
  const body = { canvas: runCanvas, feeds, mode: BXRUN.mode || "inference" };
  const gen = training ? 0 : Math.max(0, Math.round(Number(BXRUN.gen) || 0));
  if (gen > 0 && outs.length && grows.length) {
    body.generate = gen;                       // the loop grows the ids and samples
    body.input = grows[0].id;                  // from the design's own logits
    const mdl = BX.nodes.find(n => n.kind === "custom" && n.inner);
    const home = mdl && BX.edges.find(e => e.from === mdl.id && !(e.fromPort || 0));
    const head = home && outs.find(n => n.id === home.to);
    body.output = (head || outs[0]).id;        // the vocab head, not a side branch
    body.temperature = BXRUN.temp == null ? 0 : Number(BXRUN.temp);
  }
  fetch("/api/run", { method: "POST", headers: { "Content-Type": "application/json" },
                      body: JSON.stringify(body) })
    .then(r => r.json().then(d => ({ ok: r.ok, d })))
    .then(res => {
      BXRUN.running = false;
      bxUsageWatch(false);
      if (poll) clearInterval(poll);
      if (!res.ok || !res.d || !res.d.ok) {
        const err = new Error((res.d && res.d.error) || "the run failed");
        err.nid = res.d && res.d.nid;          // which box the backend blamed
        err.box = res.d && res.d.box;
        throw err;
      }
      BXRUN.warmMode = (res.d && res.d.mode) || null;   // which mode the warm weights are in
      bxRunResult(res.d);                      // paint it all at once, tail included
      fetchBackend();                          // the run may have moved the memory
    })
    .catch(e => {
      BXRUN.running = false;
      bxUsageWatch(false);
      if (poll) clearInterval(poll);
      bxFlowClear();
      let why = String((e && e.message) || e);
      if (/out of memory|not enough memory|allocate/i.test(why))
        why += " \u2014 free the backend with offload (weights \u2192 offload), "
             + "or lighten the design";
      BXRUN.warmMode = null;                   // a failed run frees the backend's weights
      bxMarkRunError({ nid: e && e.nid, box: e && e.box, error: why });
      BXRUN.error = true;                      // it stays until the next run
      bxRender();
      bxtRunMsg("could not run on " + name + " \u2014 " + String((e && e.message) || e));
      fetchBackend();
    });
  };
  if (images.length && typeof fetch === "function"
      && typeof createImageBitmap === "function") {
    Promise.all(images.map(n => bxImageFeed(n))).then(vals => {
      const miss = [];
      images.forEach((n, i) => { if (vals[i]) feeds[n.id] = vals[i]; else miss.push(n); });
      if (miss.length) {
        bxtRunMsg("could not read the image for \u201c" + (miss[0].name || "image")
                  + "\u201d \u2014 try another file");
        return;
      }
      send();
    }).catch(() => bxtRunMsg("could not read the image \u2014 try another file"));
    return;
  }
  send();
}
function bxImageFeed(n) {                      // a blob -> the pixels a run sends
  const id = String(n.image || "").replace(/^blob:/, "");
  if (!id) return Promise.resolve(null);
  const size = Math.max(8, Math.round(Number(n.image_size) || 768));
  return fetch("/api/blob?id=" + encodeURIComponent(id), { cache: "no-store" })
    .then(r => (r.ok ? r.blob() : null))
    .then(b => (b ? createImageBitmap(b) : null))
    .then(bmp => {
      if (!bmp) return null;
      const cv = document.createElement("canvas");
      cv.width = size;
      cv.height = size;
      const ctx = cv.getContext && cv.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(bmp, 0, 0, size, size);
      const px = ctx.getImageData(0, 0, size, size).data;
      const rgb = new Uint8Array(size * size * 3);
      for (let i = 0, j = 0; i < px.length; i += 4, j += 3) {
        rgb[j] = px[i];
        rgb[j + 1] = px[i + 1];
        rgb[j + 2] = px[i + 2];
      }
      let bin = "";
      for (let i = 0; i < rgb.length; i += 0x8000)
        bin += String.fromCharCode.apply(null, rgb.subarray(i, i + 0x8000));
      return { w: size, h: size, rgb: btoa(bin) };
    });
}
function fetchBackend() {                      // the stateful channel, from the app's view
  if (typeof bxTrainPoll === "function") bxTrainPoll();
  if (typeof fetch !== "function") return;
  {                                           // a train box whose task the list
    let needList = false;                     // doesn't know (or that is live)
    for (const n of BX.nodes || []) {         // keeps the task list honest
      if (n.kind !== "train" || !n.task_id) continue;
      const t = bxTask(n.task_id);
      if (!t || t.status === "running" || t.status === "paused") { needList = true; break; }
    }
    if (needList && typeof bxTasksFetch === "function" && typeof bxAgentSync === "function")
      bxTasksFetch(bxAgentSync);
  }
  fetch("/api/backend", { cache: "no-store" })
    .then(r => (r.ok ? r.json() : null))
    .then(d => {
      if (!d || !d.local) return;
      BXRUN.local = d.local;
      bxtRunRefresh();
      if ($("bxtBackendMenu") && !$("bxtBackendMenu").hidden) bxtBackendRender();
      bxtRunSync();                      // the button and the Run box, with fresh numbers
      if ($("bxtVramMenu") && !$("bxtVramMenu").hidden) bxRenderEstimate();
    })
    .catch(() => {});
}
function bxUsageWatch(on) {                    // the 5 s poll is fine when idle; a
  if (typeof setInterval !== "function") return;   // load/run deserves a faster one
  if (!on) {
    if (bxUsageTimer) { clearInterval(bxUsageTimer); bxUsageTimer = null; }
    return;
  }
  if (bxUsageTimer) return;
  bxUsageTimer = setInterval(() => {
    if (!BXRUN.loading && !BXRUN.running && !BXRUN.offloading) {
      bxUsageWatch(false);
      return;
    }
    fetchBackend();                            // watch the memory move while it works
  }, 1500);
}

