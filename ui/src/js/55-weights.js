// ─── nnstudio shell · 55 · weights and placement ─────────────────────────────────────
// weight counting, the GPU/system split, and the offload ratio/plan/apply.
// Order is load-bearing: this slice is concatenated after the one before it.

function bxEveryBox(fn) {                      // every box, at every nesting level
  const walk = (nodes) => {
    for (const n of nodes || []) {
      fn(n);
      if (n.kind === "custom" && n.inner) walk(n.inner.nodes);
    }
  };
  walk(BX.nodes);
}
function bxSharedCount(n) {                    // boxes bound to one tensor
  if (!n || !n.t) return 0;
  let c = 0;
  bxEveryBox(x => { if (x.t === n.t) c++; });
  return c;
}
function bxWeightNs(n) {                       // a box's registry namespace
  if (!n || !n.t) return null;
  const w = BX.weights || {};
  const first = String(n.t).split(",")[0].trim();
  if (n.file && w[n.file + "::" + first]) return n.file + "::" + first;
  return Object.keys(w).find(k => k.slice(k.indexOf("::") + 2) === first) || null;
}
function bxNodeWeightBytes(n) {                // what one box's weights weigh
  if (!n || n.kind === "custom" || n.kind === "input" || n.kind === "output" ||
      bxOffHere(n)) return 0;
  let params = null, dtype = null;
  if (n.params != null) {
    params = n.params;                         // exact: what the file holds
    dtype = n.dtype || "mixed";
  } else if (n.kind === "embed") {
    if (n.vocab != null && n.dout != null) params = n.vocab * n.dout;
    dtype = n.dtype || "f16";
  } else if (n.kind === "layer") {
    if (n.din != null && n.dout != null) params = n.din * n.dout;
    dtype = n.dtype || "f16";
  } else if (n.kind === "norm") {
    params = bxActSize(n);
    dtype = n.dtype || "f32";
  } else {
    if (n.kind === "act") params = 0;
    else if (bxOpName(n) === "scale" && n.t) params = 1;
    else if (!n.t) params = 0;
    dtype = n.dtype || "f32";
  }
  if (params == null) return 0;
  return n.wbytes != null ? n.wbytes : params * bxBytes(dtype);
}
function bxWeightSplit(gpuDefault) {           // bytes by where each layer will sit
  const out = { gpu: 0, system: 0 };
  const seen = new Set();                       // one copy per namespace: two
  const once = (n) => {                         // boxes on one tensor weigh once
    if (!n.t) return true;
    const key = (n.file || "") + "::" + n.t;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };
  if (!gpuDefault) {                           // a cpu-only backend: nothing sits on a gpu
    bxEveryBox(n => {
      if (n.kind !== "custom" && bxWeightedBox(n) && once(n))
        out.system += bxNodeWeightBytes(n);
    });
    return out;
  }
  const walk = (nodes, inherited) => {
    for (const n of nodes || []) {
      if (n.kind === "custom") {
        walk(n.inner && n.inner.nodes, n.place || inherited);
        continue;
      }
      if (!bxWeightedBox(n) || !once(n)) continue;
      const bytes = bxNodeWeightBytes(n);
      if (!bytes) continue;
      const sys = n.place ? n.place === "system" : inherited === "system";
      out[sys ? "system" : "gpu"] += bytes;
    }
  };
  walk(BX.nodes, gpuDefault ? "gpu" : "system");
  return out;
}
function bxSetPlace(id, key) {
  const n = typeof id === "string" ? bxNode(id) : id;
  if (!n || !bxWeightedBox(n)) return false;
  const val = key === "system" ? "system" : "gpu";
  if (n.place === val) return false;
  n.place = val;
  bxRender();
  bxCommit();
  return true;
}
function bxSetAllPlaces(key) {                 // load all: the Run box's two pins
  const val = key === "system" ? "system" : "gpu";
  let count = 0;
  bxEveryBox(n => {
    if (bxWeightedBox(n) && n.place !== val) { n.place = val; count++; }
  });
  if (!count) return 0;
  bxRender();
  bxCommit();
  return count;
}

// ---- the cpu-offload ratio -----------------------------------------------
// One setting, `BX.model.cpu_offload` (percent), decides how much of the
// design's weights stay on the gpu. The planner walks the design in document
// order — the model's own order — and pins whole layers/blocks to the gpu
// while the budget lasts, the rest to the system, so the split is contiguous
// (first layers on the gpu), never layer-ping-pong.
function bxBoxWeightTotal(n) {                 // one box's weights, nesting included
  if (!n) return 0;
  if (n.kind !== "custom") return bxNodeWeightBytes(n);
  let sum = 0;
  for (const c of (n.inner && n.inner.nodes) || []) sum += bxBoxWeightTotal(c);
  return sum;
}
function bxOffloadRatio() {
  const r = BX.model && BX.model.cpu_offload;
  return r == null ? 0 : Math.max(0, Math.min(100, Math.round(Number(r) || 0)));
}
function bxOffloadPlan(ratio) {                // {gpu, system, total} — no mutation
  const norm = Math.max(0, Math.min(100, Number(ratio) || 0));
  let total = 0;
  for (const n of BX.nodes || []) total += bxBoxWeightTotal(n);
  let remaining = total * (1 - norm / 100), gpu = 0, system = 0;
  const walk = (nodes) => {
    for (const n of nodes || []) {
      if (n.kind === "input" || n.kind === "output" || n.off) continue;
      const bytes = bxBoxWeightTotal(n);
      if (!bytes) continue;
      if (remaining <= 0) { system += bytes; continue; }
      if (bytes <= remaining) { gpu += bytes; remaining -= bytes; continue; }
      if (n.kind === "custom" && n.inner && (n.inner.nodes || []).length) {
        walk(n.inner.nodes);                  // this block straddles the budget
        continue;
      }
      system += bytes;
    }
  };
  walk(BX.nodes);
  return { gpu, system, total };
}
function bxApplyOffload(key) {                 // write the plan into the places
  const ratio = key === "system" ? 100 : bxOffloadRatio();
  let total = 0;
  for (const n of BX.nodes || []) total += bxBoxWeightTotal(n);
  let remaining = total * (1 - ratio / 100);
  const assign = (nodes) => {
    for (const n of nodes || []) {
      if (n.kind === "input" || n.kind === "output" || n.off) continue;
      const bytes = bxBoxWeightTotal(n);
      if (!bytes) continue;
      if (remaining <= 0) { n.place = "system"; continue; }
      if (bytes <= remaining) { n.place = "gpu"; remaining -= bytes; continue; }
      if (n.kind === "custom" && n.inner && (n.inner.nodes || []).length) {
        assign(n.inner.nodes);                // descend the straddling block
        continue;
      }
      n.place = "system";
    }
  };
  assign(BX.nodes);
  bxEveryBox(n => {                           // a no-weight box carries no place
    if (n.kind !== "custom" && n.place && !bxWeightedBox(n)) delete n.place;
  });
  bxRender();
  bxCommit();
  return bxOffloadPlan(ratio);
}
// ---------------------------------------------------------------- the design, as JSON
// A design is JSON in one of two shapes: {"type":"canvas"} is the whole canvas,
// {"type":"nested"} is one nested box's own network. Nested designs nest
// recursively, so a nested box may hold nested boxes — but a nested design
// never holds a canvas, at any depth. A canvas may load either shape (a nested
// design arrives on the canvas as a nested box); a nested box only ever loads
// a nested design.
const BX_JSON_VERSION = 1;
const BX_KINDS = ["input", "embed", "layer", "act", "op", "norm", "script",
                  "tokenize", "detokenize", "sample", "hf", "agent", "custom", "output",
                  "dataset", "loss", "reward", "train", "vision", "heatmap",
                  "select", "config", "training", "conv"];

