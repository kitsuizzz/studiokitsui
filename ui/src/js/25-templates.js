// ─── nnstudio shell · 25 · templates ───────────────────────────────────────
// the attention/SSM/MoE/vision/model template builders, HF and tokenizer doors, and the palette placeable check.
// Order is load-bearing: this slice is concatenated after the one before it.

// ---------------------------------------------------------------- block templates
// Attention, state space and MoE are not kinds: they are ordinary nested boxes
// whose own network is made of atomic boxes (input · FC · activation ·
// operation · norm · output). The atoms (matmul, rope, topk, conv1d, scan) are
// in the operation box's list. The GGUF builder fills the same shape from the
// tensors it found; these builders make a blank one (sizes unknown until wired).
function bxDocMaker() {
  const doc = { type: "nested", version: 1, nodes: [], edges: [] };
  let seq = 0;
  const mk = (kind, name, x, y, extra) => {
    const n = Object.assign({ id: "t" + (++seq), kind, name,
                              x: bxSnapGrid(x), y: bxSnapGrid(y) }, extra || {});
    doc.nodes.push(n);
    return n;
  };
  const link = (a, b, fp, tp) => {
    doc.edges.push({ from: a.id, to: b.id, fromPort: fp || 0, toPort: tp || 0 });
  };
  return { doc, mk, link };
}
function bxAttentionDoc(opts) {
  opts = opts || {};
  const { doc, mk, link } = bxDocMaker();
  const col = (i) => 220 * i;
  const iin = mk("input", "in", 0, 0, { dout: opts.d_model });
  const qp = mk("layer", "q proj", col(1), -140, { din: opts.d_model, dout: opts.q, t: opts.tq });
  const kp = mk("layer", "k proj", col(1), 0, { din: opts.d_model, dout: opts.k, t: opts.tk });
  const vp = mk("layer", "v proj", col(1), 140, { din: opts.d_model, dout: opts.v, t: opts.tv });
  let lastQ = qp, lastK = kp;
  if (opts.tqn) { const qn = mk("norm", "q norm", col(2), -140, { norm: "rms", eps: opts.eps, t: opts.tqn });
                  link(lastQ, qn); lastQ = qn; }
  if (opts.tkn) { const kn = mk("norm", "k norm", col(2), 0, { norm: "rms", eps: opts.eps, t: opts.tkn });
                  link(lastK, kn); lastK = kn; }
  const rq = mk("op", "rope", col(3), -140, { op: "rope" });
  const rk = mk("op", "rope", col(3), 0, { op: "rope" });
  const qk = mk("op", "q\u00b7k\u1d40 scores", col(4), -60, { op: "matmul" });
  const sm = mk("act", "softmax", col(5), -60, { act: "softmax" });
  const pv = mk("op", "scores\u00b7v", col(6), -60, { op: "matmul" });
  let last = pv, x = col(7);
  if (opts.tg) {                              // a gated attention (attn_gate)
    const gp = mk("layer", "gate proj", col(7), 140, { din: opts.d_model, dout: opts.g, t: opts.tg });
    const sg = mk("act", "sigmoid", col(8), 140, { act: "sigmoid" });
    const mu = mk("op", "gate", col(9), -20, { op: "multiply" });
    link(iin, gp);                              // the gate is projected from the attention input
    link(gp, sg);
    link(pv, mu, 0, 0);
    link(sg, mu, 0, 1);
    last = mu;
    x = col(10);
  }
  const op = mk("layer", "out proj", x, -60, { din: opts.q, dout: opts.d_model, t: opts.to });
  const iout = mk("output", "out", x + 220, -60, { din: opts.d_model });
  link(iin, qp); link(iin, kp); link(iin, vp);
  link(lastQ, rq); link(lastK, rk);
  link(rq, qk, 0, 0); link(rk, qk, 0, 1);
  link(qk, sm); link(sm, pv, 0, 0); link(vp, pv, 0, 1);
  link(last, op);
  link(op, iout);
  return doc;
}
function bxStateDoc(opts) {
  opts = opts || {};
  const { doc, mk, link } = bxDocMaker();
  const col = (i) => 220 * i;
  const iin = mk("input", "in", 0, 0, { dout: opts.d_model });
  const ip = mk("layer", "in proj", col(1), 0, { din: opts.d_model, dout: opts.inner, t: opts.ti });
  const cv = mk("op", "conv", col(2), 0, { op: "conv1d" });
  const ac = mk("act", "silu", col(3), 0, { act: "silu" });
  const sc = mk("op", "scan", col(4), 0, { op: "scan" });
  let last = sc, x = col(5);
  if (opts.tn) { const nm = mk("norm", "ssm norm", x, 0, { norm: "rms", eps: opts.eps, t: opts.tn });
                 link(last, nm); last = nm; x += 220; }
  const op = mk("layer", "out proj", x, 0, { din: opts.inner, dout: opts.d_model, t: opts.to });
  const iout = mk("output", "out", x + 220, 0, { din: opts.d_model });
  link(iin, ip); link(ip, cv); link(cv, ac); link(ac, sc);
  link(last, op);
  link(op, iout);
  return doc;
}
function bxMoEDoc(opts) {
  opts = opts || {};
  const { doc, mk, link } = bxDocMaker();
  const col = (i) => 220 * i;
  const iin = mk("input", "in", 0, 0, { dout: opts.d_model });
  const rt = mk("layer", "router", col(1), -120, { din: opts.d_model, dout: opts.experts, t: opts.tr });
  const sm = mk("act", "softmax", col(2), -120, { act: "softmax" });
  const tk = mk("op", opts.topk ? "top " + opts.topk : "top k", col(3), -120, { op: "topk" });
  const up = mk("layer", "expert up", col(1), 120, { din: opts.d_model, dout: opts.ff, t: opts.tu });
  const ac = mk("act", "silu", col(2), 120, { act: "silu" });
  const dn = mk("layer", "expert down", col(3), 120, { din: opts.ff, dout: opts.d_model, t: opts.td });
  const mu = mk("op", "weights", col(4), 0, { op: "multiply" });
  const iout = mk("output", "out", col(5), 0, { din: opts.d_model });
  link(iin, rt); link(rt, sm); link(sm, tk);
  link(iin, up); link(up, ac); link(ac, dn);
  link(tk, mu, 0, 0); link(dn, mu, 0, 1);
  link(mu, iout);
  return doc;
}
function bxTxBlock(r, o) {                     // one transformer block: norm,
  const { mk, link } = r;                      // attention, residual; norm, MLP,
  const col = (i) => 190 * i;                  // residual. Wire o.from in, take
  const x0 = o.x, tag = o.tag, d = o.d;        // the returned exit on — the
  const y0 = o.y0 || 0;                        // boxes the ViT and the DiT lay
  const norm1 = mk("norm", "norm " + tag, col(x0), y0 - 160,
                   { norm: "rms", eps: 1e-6, size: d });
  const q = mk("layer", "q proj " + tag, col(x0 + 1), y0 - 180, { din: d, dout: d });
  const k = mk("layer", "k proj " + tag, col(x0 + 1), y0 - 60, { din: d, dout: d });
  const v = mk("layer", "v proj " + tag, col(x0 + 1), y0 + 60, { din: d, dout: d });
  const kt = mk("op", "k transposed", col(x0 + 2), y0 - 60, { op: "transpose" });
  const sc = mk("op", "scores " + tag, col(x0 + 3), y0 - 120, { op: "matmul" });
  const sm = mk("act", "softmax " + tag, col(x0 + 4), y0 - 120, { act: "softmax" });
  const sv = mk("op", "mix " + tag, col(x0 + 5), y0 - 120, { op: "matmul" });
  const op = mk("layer", "out proj " + tag, col(x0 + 6), y0 - 120, { din: d, dout: d });
  const res1 = mk("op", "residual " + tag, col(x0 + 7), y0 - 120, { op: "add" });
  const norm2 = mk("norm", "mlp norm " + tag, col(x0), y0 + 80,
                   { norm: "rms", eps: 1e-6, size: d });
  const up = mk("layer", "mlp up " + tag, col(x0 + 1), y0 + 80,
                { din: d, dout: o.mlp });
  const ga = mk("act", "gelu " + tag, col(x0 + 2), y0 + 80, { act: "gelu" });
  const dn = mk("layer", "mlp down " + tag, col(x0 + 3), y0 + 80,
                { din: o.mlp, dout: d });
  const res2 = mk("op", "residual mlp " + tag, col(x0 + 4), y0 + 80, { op: "add" });
  link(o.from, norm1);
  link(norm1, q); link(norm1, k); link(norm1, v);
  link(k, kt); link(q, sc, 0, 0); link(kt, sc, 0, 1);
  link(sc, sm); link(sm, sv, 0, 0); link(v, sv, 0, 1);
  link(sv, op); link(op, res1, 0, 0); link(o.from, res1, 0, 1);
  link(res1, norm2);
  link(norm2, up); link(up, ga); link(ga, dn);
  link(dn, res2, 0, 0); link(res1, res2, 0, 1);
  return { exit: res2 };
}
function bxViTDoc(opts) {                      // a vision transformer: the image
  opts = opts || {};                           // patches in, a class out — and
  const side = opts.image || 32;               // every box in it is trainable
  const pt = opts.patch || 8;                  // the patch side (8 → 16 patches)
  const d = opts.dim || 64;                    // the width the patches embed to
  const mlp = opts.mlp || d * 2;
  const blocks = opts.blocks || 2;             // attention + mlp, twice
  const classes = opts.classes || 10;
  const c = 3;                                 // RGB
  const rows = Math.max(1, Math.round(side / pt));
  const n = rows * rows;                       // the patch count
  const px = pt * pt * c;                      // pixels per patch
  const { doc, mk, link } = bxDocMaker();
  const col = (i) => 190 * i;
  const iin = mk("input", "pixels", 0, 0, { dout: side * side * c });
  const cut = mk("op", "cut the grid", col(1), 0,
                 { op: "reshape", dims: [rows, pt, rows, pt, c].join("x") });
  const grid = mk("op", "patches", col(2), 0, { op: "permute", axes: "0 2 1 3 4" });
  const flat = mk("op", "flatten", col(3), 0, { op: "reshape", dims: n + "x" + px });
  const embed = mk("layer", "patch embed", col(4), 0, { din: px, dout: d });
  link(iin, cut); link(cut, grid); link(grid, flat); link(flat, embed);
  let last = embed, x = 5;
  for (let b = 0; b < blocks; b++) {
    last = bxTxBlock({ mk, link }, { x: x, y0: 0, tag: b + 1, d: d, mlp: mlp,
                                     from: last }).exit;
    x += 7;
  }
  const pool = mk("op", "mean pool", col(x), 0, { op: "mean", dim: -2 });
  const head = mk("norm", "head norm", col(x + 1), 0,
                  { norm: "rms", eps: 1e-6, size: d });
  const fc = mk("layer", "head", col(x + 2), 0, { din: d, dout: classes });
  const iout = mk("output", "classes", col(x + 3), 0, { din: classes });
  link(last, pool); link(pool, head); link(head, fc); link(fc, iout);
  return doc;
}
function bxVAEDoc(opts) {                      // an autoencoder in its vision
  opts = opts || {};                           // dress: convs stride the picture
  const side = opts.image || 32;               // down to a latent map, then
  const c = 3;                                 // upsample + convs bring it back
  const ch = opts.channels || 16;              // up to pixels. An image (or a
  const lat = opts.latent || 16;               // channel-first batch) in, pixels
  const { doc, mk, link } = bxDocMaker();      // out: reconstruction is the
  const col = (i) => 190 * i;                  // unsupervised MSE run.
  const iin = mk("input", "pixels", 0, 0, { dout: side * side * c });
  const e1 = mk("conv", "encode 1", col(1), -150,
                { din: c, dout: ch, k: 3, stride: 2, pad: 1 });
  const n1 = mk("norm", "norm e1", col(2), -150, { norm: "rms", eps: 1e-6, size: ch });
  const a1 = mk("act", "silu e1", col(3), -150, { act: "silu" });
  const e2 = mk("conv", "encode 2", col(4), -150,
                { din: ch, dout: ch * 2, k: 3, stride: 2, pad: 1 });
  const n2 = mk("norm", "norm e2", col(5), -150, { norm: "rms", eps: 1e-6, size: ch * 2 });
  const a2 = mk("act", "silu e2", col(6), -150, { act: "silu" });
  const lz = mk("conv", "latent", col(7), -150, { din: ch * 2, dout: lat, k: 1 });
  const u1 = mk("op", "upsample 1", col(8), 150,
                { op: "upsample", factor: 2, mode: "nearest" });
  const d1 = mk("conv", "decode 1", col(9), 150, { din: lat, dout: ch, k: 3, pad: 1 });
  const n3 = mk("norm", "norm d1", col(10), 150, { norm: "rms", eps: 1e-6, size: ch });
  const a3 = mk("act", "silu d1", col(11), 150, { act: "silu" });
  const u2 = mk("op", "upsample 2", col(12), 150,
                { op: "upsample", factor: 2, mode: "nearest" });
  const d2 = mk("conv", "decode 2", col(13), 150, { din: ch, dout: ch, k: 3, pad: 1 });
  const n4 = mk("norm", "norm d2", col(14), 150, { norm: "rms", eps: 1e-6, size: ch });
  const a4 = mk("act", "silu d2", col(15), 150, { act: "silu" });
  const px = mk("conv", "to pixels", col(16), 150, { din: ch, dout: c, k: 3, pad: 1 });
  const iout = mk("output", "pixels out", col(17), 150, { din: side * side * c });
  link(iin, e1); link(e1, n1); link(n1, a1);
  link(a1, e2); link(e2, n2); link(n2, a2); link(a2, lz);
  link(lz, u1); link(u1, d1); link(d1, n3); link(n3, a3);
  link(a3, u2); link(u2, d2); link(d2, n4); link(n4, a4);
  link(a4, px); link(px, iout);
  return doc;
}
function bxUNetDoc(opts) {                     // a UNet in miniature: convs
  opts = opts || {};                           // stride down — each hearing the
  const side = opts.image || 32;               // timestep's embedding — attention
  const c = 3;                                 // over the middle map, then the
  const ch = opts.channels || 16;              // up path climbs back, the two
  const dn = ch * 2;                           // down levels riding along as
  const { doc, mk, link } = bxDocMaker();      // skips. Two dots in — the noisy
  const col = (i) => 190 * i;                  // picture and the step — one
  const iin = mk("input", "pixels", 0, 0, { dout: side * side * c });  // prediction out.
  const it = mk("input", "t", 0, 260);
  const te = mk("op", "t embed", col(1), 260, { op: "timestep", width: 32 });
  const tw = mk("layer", "t wide", col(2), 200, { din: 32, dout: dn });
  const tn = mk("layer", "t narrow", col(2), 320, { din: 32, dout: ch });
  const twv = mk("op", "t wide v", col(3), 200, { op: "reshape", dims: "1x1x" + dn });
  const tnv = mk("op", "t narrow v", col(3), 320, { op: "reshape", dims: "1x1x" + ch });
  const d1 = mk("conv", "down 1", col(4), 0, { din: c, dout: ch, k: 3, stride: 2, pad: 1 });
  const t1 = mk("op", "t in 1", col(5), 0, { op: "add" });
  const s1 = mk("act", "silu 1", col(6), 0, { act: "silu" });
  const d2 = mk("conv", "down 2", col(7), 0, { din: ch, dout: dn, k: 3, stride: 2, pad: 1 });
  const t2 = mk("op", "t in 2", col(8), 0, { op: "add" });
  const s2 = mk("act", "silu 2", col(9), 0, { act: "silu" });
  const fl = mk("op", "flatten mid", col(10), 0, { op: "reshape", dims: "64x" + dn });
  const q = mk("layer", "q proj mid", col(11), -160, { din: dn, dout: dn });
  const k = mk("layer", "k proj mid", col(11), 0, { din: dn, dout: dn });
  const v = mk("layer", "v proj mid", col(11), 160, { din: dn, dout: dn });
  const kt = mk("op", "k transposed mid", col(12), 0, { op: "transpose" });
  const sc = mk("op", "scores mid", col(13), -80, { op: "matmul" });
  const sm = mk("act", "softmax mid", col(14), -80, { act: "softmax" });
  const sv = mk("op", "mix mid", col(15), -80, { op: "matmul" });
  const op = mk("layer", "out proj mid", col(16), -80, { din: dn, dout: dn });
  const res = mk("op", "residual mid", col(17), -80, { op: "add" });
  const rsh = mk("op", "reshape mid", col(18), 0, { op: "reshape", dims: "8x8x" + dn });
  const nm = mk("norm", "norm mid", col(19), 0, { norm: "rms", eps: 1e-6, size: dn });
  const am = mk("act", "silu mid", col(20), 0, { act: "silu" });
  const cm = mk("conv", "conv mid", col(21), 0, { din: dn, dout: dn, k: 3, pad: 1 });
  const res2 = mk("op", "residual mid 2", col(22), 0, { op: "add" });
  const u1 = mk("op", "upsample 1", col(23), 0, { op: "upsample", factor: 2, mode: "nearest" });
  const up1 = mk("conv", "up 1", col(24), 0, { din: dn, dout: ch, k: 3, pad: 1 });
  const sk1 = mk("op", "skip 1", col(25), 0, { op: "add" });
  const n1 = mk("norm", "norm up 1", col(26), 0, { norm: "rms", eps: 1e-6, size: ch });
  const a1 = mk("act", "silu up 1", col(27), 0, { act: "silu" });
  const u2 = mk("op", "upsample 2", col(28), 0, { op: "upsample", factor: 2, mode: "nearest" });
  const up2 = mk("conv", "up 2", col(29), 0, { din: ch, dout: ch / 2, k: 3, pad: 1 });
  const a2 = mk("act", "silu up 2", col(30), 0, { act: "silu" });
  const out = mk("conv", "to pixels", col(31), 0, { din: ch / 2, dout: c, k: 3, pad: 1 });
  const iout = mk("output", "prediction", col(32), 0, { din: side * side * c });
  link(it, te); link(te, tw); link(te, tn); link(tw, twv); link(tn, tnv);
  link(iin, d1); link(d1, t1, 0, 0); link(tnv, t1, 0, 1); link(t1, s1);
  link(s1, d2); link(d2, t2, 0, 0); link(twv, t2, 0, 1); link(t2, s2);
  link(s2, fl);
  link(fl, q); link(fl, k); link(fl, v);
  link(k, kt); link(q, sc, 0, 0); link(kt, sc, 0, 1);
  link(sc, sm); link(sm, sv, 0, 0); link(v, sv, 0, 1);
  link(sv, op); link(op, res, 0, 0); link(fl, res, 0, 1);
  link(res, rsh); link(rsh, nm); link(nm, am); link(am, cm);
  link(cm, res2, 0, 0); link(rsh, res2, 0, 1);
  link(res2, u1); link(u1, up1); link(up1, sk1, 0, 0); link(s1, sk1, 0, 1);
  link(sk1, n1); link(n1, a1);
  link(a1, u2); link(u2, up2); link(up2, a2); link(a2, out); link(out, iout);
  return doc;
}
function bxDiTDoc(opts) {                      // a diffusion transformer: the
  opts = opts || {};                           // picture is cut into patches,
  const side = opts.image || 32;               // the step's embedding is added
  const pt = opts.patch || 8;                  // to the tokens of every block,
  const d = opts.dim || 64;                    // and the head unpacks the
  const mlp = opts.mlp || d * 2;               // patches back into pixels — the
  const blocks = opts.blocks || 2;             // prediction a diffusion run
  const c = 3;                                 // reads.
  const tdim = opts.tdim || 32;
  const rows = Math.max(1, Math.round(side / pt));
  const n = rows * rows;
  const px = pt * pt * c;
  const { doc, mk, link } = bxDocMaker();
  const col = (i) => 190 * i;
  const iin = mk("input", "pixels", 0, 0, { dout: side * side * c });
  const it = mk("input", "t", 0, 300);
  const cut = mk("op", "cut the grid", col(1), 0,
                 { op: "reshape", dims: [rows, pt, rows, pt, c].join("x") });
  const grid = mk("op", "patches", col(2), 0, { op: "permute", axes: "0 2 1 3 4" });
  const flat = mk("op", "flatten", col(3), 0, { op: "reshape", dims: n + "x" + px });
  const embed = mk("layer", "patch embed", col(4), 0, { din: px, dout: d });
  const te = mk("op", "t embed", col(1), 300, { op: "timestep", width: tdim });
  const tp = mk("layer", "t proj", col(2), 300, { din: tdim, dout: d });
  const tv = mk("op", "t vector", col(3), 300, { op: "reshape", dims: "1x" + d });
  link(iin, cut); link(cut, grid); link(grid, flat); link(flat, embed);
  link(it, te); link(te, tp); link(tp, tv);
  let last = embed, x = 5;
  for (let b = 0; b < blocks; b++) {
    const tag = b + 1;
    const add = mk("op", "t add " + tag, col(x), 0, { op: "add" });
    link(last, add, 0, 0); link(tv, add, 0, 1);
    last = bxTxBlock({ mk, link }, { x: x, y0: 0, tag: tag, d: d, mlp: mlp,
                                     from: add }).exit;
    x += 7;
  }
  const head = mk("norm", "head norm", col(x), 0, { norm: "rms", eps: 1e-6, size: d });
  const fc = mk("layer", "head", col(x + 1), 0, { din: d, dout: px });
  const un = mk("op", "unpatch", col(x + 2), 0,
                { op: "reshape", dims: [rows, rows, pt, pt, c].join("x") });
  const reg = mk("op", "regrid", col(x + 3), 0, { op: "permute", axes: "0 2 1 3 4" });
  const back = mk("op", "to pixels", col(x + 4), 0,
                  { op: "reshape", dims: side + "x" + side + "x" + c });
  const iout = mk("output", "prediction", col(x + 5), 0, { din: side * side * c });
  link(last, head); link(head, fc); link(fc, un); link(un, reg); link(reg, back);
  link(back, iout);
  return doc;
}
function bxModelDoc() {                       // a model: the box the architecture
  const i = bxId(), o = bxId();               // lives in — values in, values out
  return { nodes: [{ id: i, kind: "input", name: "in", x: 40, y: 120 },
                   { id: o, kind: "output", name: "out", x: 340, y: 120 }],
           edges: [{ from: i, to: o, fromPort: 0, toPort: 0 }] };
}
const BX_TEMPLATES = { attn: bxAttentionDoc, ssm: bxStateDoc, moe: bxMoEDoc,
                       model: bxModelDoc, vit: bxViTDoc, vae: bxVAEDoc,
                       unet: bxUNetDoc, dit: bxDiTDoc };
const BX_TPL_WORD = { attn: "attention", ssm: "state space", moe: "mixture",
                      model: "model", vit: "vision transformer", vae: "vae",
                      unet: "unet", dit: "dit" };
function bxTemplateName(tpl) {
  return BX_TPL_WORD[tpl] + " " + (BX.nodes.filter(n => n.name && n.name.indexOf(BX_TPL_WORD[tpl]) === 0).length + 1);
}
function bxAddHFModel(x, y, v) {              // a huggingface model: a model box,
  bxUndoLock++;                                // its text pipeline inside
  const repo = String(v.repo || "").trim();
  const n = bxAdd("custom", x, y, { name: v.name || repo.split("/").pop() || "hf model" });
  if (!n) { bxUndoLock--; return null; }
  n.model = true;
  const i = bxId(), h = bxId(), o = bxId();
  n.inner = {
    nodes: [{ id: i, kind: "input", name: "text", x: -240, y: 0, input_mode: "text" },
            { id: h, kind: "hf", name: "model", x: 40, y: 0, repo },
            { id: o, kind: "output", name: "next text", x: 320, y: 0 }],
    edges: [{ from: i, to: h, fromPort: 0, toPort: 0 },
            { from: h, to: o, fromPort: 0, toPort: 0 }] };
  // a box that stands on its own — or rests on the blank skeleton — gets its
  // boundaries with it, so the import runs as it lands: a prompt the Run menu
  // asks for, wired into the box, and its answer wired out. Dropped into a
  // bigger design, only the box lands — its dots are yours to wire.
  const bare = !BX.edges.some(e => e.from === n.id || e.to === n.id);
  const crop = (m) => m !== n && (m.kind === "input" || m.kind === "output") &&
    (bare || (BX.edges.some(e => e.from === m.id || e.to === m.id) &&
              BX.edges.every(e => (e.from !== m.id && e.to !== m.id) ||
                                  (e.from === m.id && e.to === n.id) ||
                                  (e.to === m.id && e.from === n.id))));
  if (BX.nodes.every(m => m === n || crop(m))) {
    BX.nodes.filter(m => m !== n).forEach(m => bxRemove(m.id));
    const src = bxAdd("input", n.x - 280, n.y,
                      { name: "prompt", input_mode: "text" });
    bxConnect(src.id, n.id, 0, 0);
    const sink = bxAdd("output", n.x + 280, n.y, { name: "next text" });
    bxConnect(n.id, sink.id, 0, 0);
  }
  bxSettleSizes();
  bxSelectBoxes([n.id]);
  bxRender();
  bxUndoLock--;
  bxCommit();
  return n;
}
function bxAddTokenizerPair(x, y, v) {        // one repo, the pair that belongs
  // together: the tokenizer (text -> ids) and the de-tokenizer (ids -> text)
  v = v || {};
  const repo = String(v.repo || "").trim();
  const base = repo.split("/").filter(Boolean).pop() || "";
  const tag = base ? " " + base.toLowerCase() : "";
  bxUndoLock++;                               // one step for the pair
  const tk = bxAdd("tokenize", x, y, { name: "tokenizer" + tag, repo: repo,
                                       tokens: v.tokens });
  const dt = bxAdd("detokenize", tk ? tk.x + bxNodeW(tk) + 80 : x, y,
                   { name: "de-tokenizer" + tag, repo: repo, tokens: v.tokens });
  bxSettleSizes();
  bxRender();
  bxUndoLock--;
  if (tk && dt) bxSelectBoxes([tk.id, dt.id]);   // ready to move as a pair
  bxCommit();
  return [tk, dt];
}
function bxAddTemplate(tpl, x, y, name) {
  bxUndoLock++;                             // one step for the whole template
  const n = bxAdd("custom", x, y, { name: name || bxTemplateName(tpl) });
  if (["model", "vit", "vae", "unet", "dit"].indexOf(tpl) >= 0)
    n.model = true;                            // the architecture's own boxes
  n.inner = BX_TEMPLATES[tpl]({});
  bxSettleSizes();
  bxRender();
  bxUndoLock--;
  bxCommit();
  return n;
}
function bxAddKind(kind, x, y, v) {              // the palette path: a kind, or a template
  if (BX_TEMPLATES[kind]) return bxAddTemplate(kind, x, y, v && v.name);
  if (!BX.up && bxWeightsKind(kind)) return null;   // weights live inside a model
  return bxAdd(kind, x, y, v);
}
function bxPlaceable(kind) {                    // would a card for this kind land
  if (BX_TEMPLATES[kind]) return true;          // here? The palette and the
  if (!BX.up && bxWeightsKind(kind)) return false;   // canvas menu both list
  if (kind === "train" && !bxTrainAllowed()) return false;  // only what does
  return true;
}

