// ─── nnstudio shell · 15 · the viewport ─────────────────────────────────────
// bounds, viewBox, the world grid, zoom/pan, points, and default names.
// Order is load-bearing: this slice is concatenated after the one before it.

function bxHost() { return $("bxcanvas"); }
function bxViewport() {
  const r = bxHost() && bxHost().getBoundingClientRect ? bxHost().getBoundingClientRect() : null;
  return { w: Math.max(240, (r && r.width) || 900), h: Math.max(180, (r && r.height) || 520) };
}
function bxBounds() {
  const vis = (BX.nodes || []).filter(n => !n.hidden);   // hidden boxes take no room
  if (!vis.length) return { x0: 0, y0: 0, x1: BXW + 260, y1: BXH + 160 };
  const xs = vis.map(n => n.x), ys = vis.map(n => n.y);
  return { x0: Math.min(...xs), y0: Math.min(...ys),
           x1: Math.max(...vis.map(n => n.x + bxNodeW(n))),
           y1: Math.max(...vis.map(n => n.y + bxNodeH(n))) };
}
function bxCenter() {
  const b = bxBounds();
  return { cx: BX.view.cx == null ? (b.x0 + b.x1) / 2 : BX.view.cx,
           cy: BX.view.cy == null ? (b.y0 + b.y1) / 2 : BX.view.cy,
           k: BX.view.k || 1 };
}
function bxViewBox() {
  const z = bxViewport(), c = bxCenter();
  const vw = z.w / c.k, vh = z.h / c.k;
  return (c.cx - vw / 2) + " " + (c.cy - vh / 2) + " " + vw + " " + vh;
}
// The canvas grid: world-space lines behind the design. The step is 20 or 40
// world units — finer than the boxes' 4×2 cells, never coarser — so every box
// and wire bend on the 40-lattice sits on a line at every zoom. Every fifth
// line is a touch stronger.
function bxGridStep(k) {
  let s = 20;
  while (k * s < 24 && s < 40) s *= 2;
  while (k * s > 96 && s > 20) s /= 2;
  return s;
}
function bxGridPaths() {
  const z = bxViewport(), c = bxCenter();
  const vw = z.w / c.k, vh = z.h / c.k;
  const x0 = c.cx - vw / 2, y0 = c.cy - vh / 2;
  const step = bxGridStep(c.k);
  let minor = "", major = "";
  for (let i = Math.floor(x0 / step); i * step <= x0 + vw; i++) {
    const at = i * step;
    const d = "M" + at + " " + y0 + "V" + (y0 + vh);
    if (i % 5 === 0) major += d; else minor += d;
  }
  for (let i = Math.floor(y0 / step); i * step <= y0 + vh; i++) {
    const at = i * step;
    const d = "M" + x0 + " " + at + "H" + (x0 + vw);
    if (i % 5 === 0) major += d; else minor += d;
  }
  return { minor, major };
}
function bxGridDraw(g) {
  const p = bxGridPaths();
  const kids = (g && g.children) || [];
  if (kids[0]) kids[0].setAttribute("d", p.minor);
  if (kids[1]) kids[1].setAttribute("d", p.major);
}
function bxGrid() {
  const g = svg("g", { class: "bxgrid" });
  for (const cls of ["gminor", "gmajor"])
    g.appendChild(svg("path", { class: cls, "vector-effect": "non-scaling-stroke" }));
  bxGridDraw(g);
  return g;
}
function bxGridRefresh() {
  const root = bxHost() && bxHost().querySelector ? bxHost().querySelector("svg") : null;
  const g = root && root.querySelector ? root.querySelector(".bxgrid") : null;
  if (g) bxGridDraw(g);
}
// The canvas can never be lost: the view's centre stays within the origin and
// the design's bounds, plus four cells of slack — a tight little world that
// grows on its own as boxes are placed further out.
function bxClampView() {
  const b = bxBounds(), c = bxCenter();
  const pad = 4 * BX_GRID;
  const x0 = Math.min(0, b.x0) - pad, x1 = Math.max(0, b.x1) + pad;
  const y0 = Math.min(0, b.y0) - pad, y1 = Math.max(0, b.y1) + pad;
  const cx = Math.max(x0, Math.min(x1, c.cx));
  const cy = Math.max(y0, Math.min(y1, c.cy));
  if (cx !== c.cx || cy !== c.cy) BX.view = { cx, cy, k: c.k };
}
function bxFit() {
  const z = bxViewport(), b = bxBounds();
  const cw = Math.max(120, b.x1 - b.x0), ch = Math.max(90, b.y1 - b.y0);
  BX.view = { cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2,
              k: Math.max(0.5, Math.min(1.2, Math.min((z.w - 90) / cw, (z.h - 90) / ch))) };
  bxRender();
}
// How much one wheel event zooms: proportional to how far the wheel turned (so
// a trackpad's many tiny deltas stay gentle), clamped, and normalised for
// browsers that report lines or pages instead of pixels. ~5 % per mouse notch.
function bxWheelFactor(deltaY, deltaMode) {
  let d = Number(deltaY) || 0;
  if (deltaMode === 1) d *= 16;            // lines
  else if (deltaMode === 2) d *= 100;      // pages
  d = Math.max(-240, Math.min(240, d));
  if (!d) return 1;
  return Math.pow(1.0005, -d);
}
function bxZoomAt(ev, f) {
  const r = bxHost() ? bxHost().getBoundingClientRect() : null;
  if (!r) return;
  const c = bxCenter();
  const k = c.k, nk = Math.max(0.5, Math.min(4, k * f));
  const x = c.cx - r.width / (2 * k) + ((ev.clientX || 0) - r.left) / k;   // world under cursor
  const y = c.cy - r.height / (2 * k) + ((ev.clientY || 0) - r.top) / k;
  BX.view = { cx: x + (c.cx - x) * (k / nk), cy: y + (c.cy - y) * (k / nk), k: nk };
  bxClampView();
  bxRender();
}
function bxPoint(ev) {
  const root = bxHost() && bxHost().querySelector ? bxHost().querySelector("svg") : null;
  const pt = root && root.createSVGPoint ? root.createSVGPoint() : null;
  if (!pt || !root.getScreenCTM) return { x: 0, y: 0 };
  pt.x = ev.clientX || 0; pt.y = ev.clientY || 0;
  try { return pt.matrixTransform(root.getScreenCTM().inverse()); } catch (e) { return { x: 0, y: 0 }; }
}
function bxDefaultName(kind) {
  const n = BX.nodes.filter(b => b.kind === kind).length + 1;
  const word = kind === "embed" ? "embedding"
             : kind === "layer" ? "fully connected"
             : kind === "act" ? "activation"
             : kind === "op" ? "operation"
             : kind === "norm" ? "norm"
             : kind === "script" ? "script"
             : kind === "tokenize" ? "tokenizer"
             : kind === "detokenize" ? "de-tokenizer"
             : kind === "sample" ? "sample"
             : kind === "hf" ? "hf model"
             : kind === "agent" ? "agent"
             : kind === "train" ? "server config"
             : kind === "conv" ? "convolution"
             : kind === "select" ? "matrix"
             : kind === "config" ? "train config"
             : kind === "training" ? "training"
             : kind === "heatmap" ? "heatmap"
             : kind === "custom" ? "nested"
             : kind === "vision" ? "vision tower" : kind;
  return word + " " + n;
}

