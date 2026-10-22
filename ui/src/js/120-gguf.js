// ─── nnstudio shell · 120 · GGUF import ─────────────────────────────────────
// reading a local GGUF header through the server and loading it as a model box.
// Order is load-bearing: this slice is concatenated after the one before it.

// load a whole model: read a local GGUF's header (through the server) and put
// its structure on the canvas — the same overwrite rule as any canvas import
function bxGGUFLoad(boxId, canvas, file, repo) {   // put a built model inside a nested box
  const b = typeof boxId === "string" ? bxNode(boxId) : boxId;
  if (!b || b.kind !== "custom") return false;
  const src = canvas && (canvas.nodes || []).find(n => n.kind === "custom");
  if (!src || !src.inner) return false;
  if (repo) b.repo = String(repo);         // the HF repo it came from, if any
  if (canvas.weights) BX.weights = canvas.weights;   // its namespace registry
  // a box wired only to its own boundary crop (or to nothing) can be treated
  // as the whole design: the crop is re-made to the model's new dots
  // nothing but this box and bare boundary inputs/outputs: the model becomes
  // the design, its own boundaries re-made. A box wired to nothing counts, and
  // so does the blank skeleton still wired input → output.
  const bare = !BX.edges.some(e => e.from === b.id || e.to === b.id);
  const crop = (n) => n !== b && (n.kind === "input" || n.kind === "output") &&
    (bare || (BX.edges.some(e => e.from === n.id || e.to === n.id) &&
              BX.edges.every(e => (e.from !== n.id && e.to !== n.id) ||
                                  (e.from === n.id && e.to === b.id) ||
                                  (e.to === n.id && e.from === b.id))));
  const clean = BX.nodes.every(n => n === b || crop(n));
  const textly = (canvas.nodes || []).some(n => n.kind === "tokenize" ||
                                                n.kind === "detokenize");
  const whole = textly || !!(canvas.model && (canvas.model.vision ||
                canvas.model.fidelity === "diffusers"));   // a pipeline
  if (canvas.model && canvas.model.vision && !clean)
    return false;                              // the tower needs the whole page
  if (clean && whole) {
    // the served design *is* the whole pipeline (prompt -> tokenizer -> model
    // -> logits, tokenizer -> de-tokenizer): land it as it came — the model
    // keeps its own boundaries — with the model box where this box was
    const doc = bxJSONDocFrom(JSON.parse(JSON.stringify(canvas)), "canvas");
    if (doc && (doc.nodes || []).some(n => n.kind === "custom")) {
      bxUndoLock++;
      BX.stack = [];
      BX.up = null;
      const dx = (b.x || 0) - (src.x || 0), dy = (b.y || 0) - (src.y || 0);
      for (const n of doc.nodes) { n.x += dx; n.y += dy; }
      BX.nodes = doc.nodes;
      BX.edges = doc.edges;
      const mm = BX.nodes.find(x => x.kind === "custom");
      if (mm && repo) mm.repo = String(repo);   // which repo this model is
      if (doc.model) BX.model = Object.assign({}, BX.model, doc.model);
      bxSel = null;
      BX.view = { cx: null, cy: null, k: 1 };
      bxSettleSizes();
      bxRender();
      bxRenderPalette();
      bxUndoLock--;
      bxCommit();                              // one step: the whole load
      bxFlowRestore();                         // the run's marks, if this repo ran
      return true;
    }
  }
  bxUndoLock++;                                // the inside, the name and the
  if (clean) BX.nodes.filter(n => n !== b).forEach(n => bxRemove(n.id));  // crop
  b.inner = JSON.parse(JSON.stringify(src.inner));   // land as one step
  if (src.name) b.name = src.name;
  if (file) b.file = bxClip(String(file), 300);      // where its tensors read from
  if (canvas.model) BX.model = Object.assign({}, BX.model, canvas.model);
  if (clean) {                                 // the model's own boundaries, sized
    const ins = bxPortSizes(b, "in"), outs = bxPortSizes(b, "out");
    const x = b.x || 0, y = b.y || 0;
    ins.forEach((size, i) => {
      const source = bxAdd("input", x - 280, y + 90 * i,
                           { name: i === 0 ? "tokens" : "input " + (i + 1),
                             dout: size == null ? 1 : size });
      bxConnect(source.id, b.id, 0, i);
    });
    outs.forEach((size, i) => {
      const sink = bxAdd("output", x + 280, y + 90 * i,
                         { name: i === 0 ? "logits"
                                         : ("mtp hidden" + (i > 1 ? " " + i : "")),
                           din: size });
      bxConnect(b.id, sink.id, i, 0);
    });
    bxSelectBoxes([b.id]);
  }
  bxSettleSizes();
  bxRender();
  bxRenderPalette();
  bxUndoLock--;
  bxCommit();                                  // one step: the whole load
  bxFlowRestore();                             // the run's marks, if this repo ran
  return true;
}

// ---- AI agents: tasks in the database, boxes that watch them ---------------
// A task is the entity — a row in hf_arc's database saying which agent runs
// and what the user asked for (a repo id for reverse engineering, a prompt for
// the python agent). The AI box is the only surface that fires and manages
// one: pick the agent type, give it what it needs, start it — and watch the
// agent's chain of thought stream in live, token by token, with stop, pause,
// resume and restart at hand. The box is optional: a task keeps running
// headless and any AI box can select it again later.
const BX_TASK_TYPES = {
  reverse: { label: "reverse engineer repo",
             fields: [{ key: "repo", label: "HF repo id", ph: "org/name" }] },
  python:  { label: "python agent",
             fields: [{ key: "prompt", label: "the task", ph: "what should it do?" }] },
  train:   { label: "training", fields: [] },
};
let BXTASKS = { list: [], byId: {}, timer: null, timer2: null, log: {}, sig: "" };

