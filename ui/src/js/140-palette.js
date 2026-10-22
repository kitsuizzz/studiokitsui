// ─── nnstudio shell · 140 · palette ────────────────────────────────────────
// the palette cards and the drag/drop of a card onto the canvas.
// Order is load-bearing: this slice is concatenated after the one before it.

function bxPreview(kind) {
  const isTpl = !!BX_TEMPLATES[kind];
  const fake = { id: "pal-" + kind, kind: isTpl ? "custom" : kind, x: 0, y: 0,
                 name: (kind === "vit" ? "vision transformer "
                        : kind === "vae" ? "vae "
                        : kind === "unet" ? "unet "
                        : kind === "dit" ? "dit "
                        : kind === "model" ? "model "
                        : kind === "embed" ? "embedding " : kind === "layer" ? "fully connected "
                        : kind === "act" ? "activation "
                        : kind === "op" ? "operation " : kind === "norm" ? "norm "
                        : kind === "tokenize" ? "tokenizer "
                        : kind === "detokenize" ? "de-tokenizer "
                        : kind === "hf" ? "hf model "
                        : kind === "sample" ? "sample "
                        : kind === "attn" ? "attention " : kind === "ssm" ? "state space "
                        : kind === "moe" ? "mixture " : kind === "custom" ? "nested "
                        : kind + " ") + "1",
                 din: kind === "embed" ? 1 : null, dout: null,
                 vocab: (kind === "tokenize" || kind === "detokenize")
                        ? "abcdefghijklmnopqrstuvwxyz"
                        : (kind === "embed" ? 32000 : undefined),
                 repo: kind === "hf" ? "Qwen/Qwen2.5-0.5B" : undefined,
                 act: kind === "act" ? "silu" : undefined,
                 op: kind === "op" ? BX_OPS[0] : undefined,
                 norm: kind === "norm" ? "rms" : undefined,
                 script: kind === "script" ? "def run(x):\n    return x" : undefined,
                 eps: kind === "norm" ? 1e-6 : undefined,
                 heads: kind === "attn" ? 32 : undefined,
                 kv: kind === "attn" ? 8 : undefined,
                 hd: kind === "attn" ? 128 : undefined,
                 rope: kind === "attn" ? 10000 : undefined,
                 state: kind === "ssm" ? 16 : undefined,
                 conv: kind === "ssm" ? 4 : undefined,
                 experts: kind === "moe" ? 8 : undefined,
                 topk: kind === "moe" ? 2 : undefined,
                 inner: isTpl ? { nodes: [
                     { id: "pi", kind: "input", name: "in", x: 0, y: 0 },
                     { id: "po", kind: "output", name: "out", x: 320, y: 0 }], edges: [] } : undefined };
  return svg("svg", { class: "bxpalcard", viewBox: "-14 -8 196 96", width: "100%", height: "96" },
             bxCard(fake));
}
const BX_PALETTE = () => [
  ["Model", [["model", "model box"]]],                 // the architecture's box
  ["Layers", [["embed", "embedding box"],              // what goes inside it
              ["layer", "fully connected box"], ["conv", "convolution box"],
              ["norm", "norm box"],
              ["act", "activation box"], ["op", "operation box"],
              ["script", "script box"], ["sample", "sample box"]]],
  ["Blocks", [["attn", "attention box"], ["ssm", "state space box"],
              ["moe", "mixture of experts box"]]],
  ["Vision", [["vit", "vision transformer box"], ["vae", "vae box"],
              ["unet", "unet box"], ["dit", "dit box"]]],
  ["Text", [["tokenize", "tokenizer box"], ["detokenize", "de-tokenizer box"]]],
  ["Data", [["select", "select col box"]]],   // a dataset is an input's datatype
  ["Training", [["training", "training box"], ["config", "train config box"],
                ["loss", "loss box"], ["reward", "reward box"]]],
  ["Analysis", [["heatmap", "heatmap box"]]],
];
function bxPalCard(kind, label) {
  const item = mk("div", { class: "bxpalitem",
                           title: label + " \u2014 click to drop it in the middle, "
                               + "or drag it onto the canvas" });
  item.setAttribute("data-kind", kind);
  item.appendChild(bxPreview(kind));
  item.addEventListener("mousedown", (ev) => bxPalDown(ev, kind));
  return item;
}
function bxDatasetRowCount(n) {                // rows typed in, or "file"
  if (n.file) return "file";
  return String(n.text || "").split("\n").filter(l => l.trim()).length;
}
function bxRenderPalette() {
  const menu = $("bxtPalMenu");
  if (menu) {
    menu.innerHTML = "";
    // the graph's edges are cards of their own, not a category
    const io = mk("div", { class: "bxtcards" });
    io.appendChild(bxPalCard("input", "input box"));
    io.appendChild(bxPalCard("output", "output box"));
    menu.appendChild(io);
    for (const [name, kinds] of BX_PALETTE()) {
      const here = kinds.filter(([kind]) => bxPlaceable(kind));
      if (!here.length) continue;                // nothing in this shelf lands here
      const open = bxpOpen === name;
      const head = mk("div", { class: "bxtcat", text: name,
                               title: open ? "collapse" : "expand" });
      head.appendChild(mk("span", { class: "chev", text: open ? "\u25be" : "\u25b8" }));
      head.addEventListener("click", () => {
        bxpOpen = open ? null : name;
        bxRenderPalette();
      });
      menu.appendChild(head);
      if (!open) continue;
      const grid = mk("div", { class: "bxtcards" });
      for (const [kind, label] of here) grid.appendChild(bxPalCard(kind, label));
      menu.appendChild(grid);
    }
  }
  const vramMenu = $("bxtVramMenu");
  if (vramMenu && !vramMenu.hidden) bxRenderEstimate();
}
// the card gesture: a press that stays put is a click (drop in the middle);
// a press that moves carries a ghost you can release over the canvas
let bxPalDrag = null, bxPalGhost = null;
function bxPalDown(ev, kind) {
  if (ev.button != null && ev.button !== 0) return;
  if (ev.preventDefault) ev.preventDefault();
  if (ev.stopPropagation) ev.stopPropagation();
  bxPalDrag = { kind, sx: ev.clientX || 0, sy: ev.clientY || 0, moved: false };
}
function bxOverCanvas(ev) {
  const c = bxHost();
  if (!c || !c.getBoundingClientRect) return false;
  const r = c.getBoundingClientRect();
  const x = ev.clientX || 0, y = ev.clientY || 0;
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}
function bxPalMove(ev) {
  if (!bxPalDrag) return;
  const dx = (ev.clientX || 0) - bxPalDrag.sx, dy = (ev.clientY || 0) - bxPalDrag.sy;
  if (!bxPalDrag.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
  bxPalDrag.moved = true;
  if (!bxPalGhost) {
    bxPalGhost = mk("div", { class: "bxghost" }, bxPreview(bxPalDrag.kind));
    document.body.appendChild(bxPalGhost);
  }
  bxPalGhost.style.left = Math.round(ev.clientX + 10) + "px";
  bxPalGhost.style.top = Math.round(ev.clientY + 8) + "px";
  if (bxPalGhost.classList) bxPalGhost.classList.toggle("over", bxOverCanvas(ev));
}
function bxPalUp(ev) {
  if (!bxPalDrag) return;
  const g = bxPalDrag;
  bxPalDrag = null;
  if (bxPalGhost && bxPalGhost.parentNode) bxPalGhost.parentNode.removeChild(bxPalGhost);
  bxPalGhost = null;
  if (g.moved && !bxOverCanvas(ev)) return;    // dropped outside: nothing happens
  bxDropPalette(g.kind, g.moved ? ev : null);  // click: middle · drag: where you let go
  bxtDropsClose();                             // the menu has done its job
}
// where the cursor is, in world units (the same maths as the canvas itself)
function bxDropPalette(kind, ev) {
  const c = bxHost();
  if (!c) return null;
  const r = c.getBoundingClientRect ? c.getBoundingClientRect() : { left: 0, top: 0, width: 600, height: 400 };
  const x = ev ? (ev.clientX || 0) : r.left + (r.width || 600) / 2;
  const y = ev ? (ev.clientY || 0) : r.top + (r.height || 400) / 2;
  const p = bxPoint({ clientX: x, clientY: y });
  const n = bxAddKind(kind, p.x, p.y, {});
  if (!n) return null;                         // refused (a second Run box, say)
  if (n.kind === "custom" && ev) {             // a model let go on a Training box
    const under = bxBoxUnder({ clientX: x, clientY: y }, n.id);   // lands in its slot
    if (under && under.kind === "training") {
      bxDockModel(under.id, n.id);
      return n;
    }
  }
  bxSelectBoxes([n.id]);                       // ready to move / configure / delete
  return n;
}

