// ─── nnstudio shell · 00 · prelude ─────────────────────────────────────────
// $ and the DOM builders, the guest storage sweep, and the theme/fold that must land before the first paint.
// Order is load-bearing: this slice is concatenated after the one before it.

const $ = id => document.getElementById(id);

// A guest's browser keeps nothing: no session cookie, and no stored
// workspace, settings, theme, fold, or backend key. Clear what an earlier
// session left behind; only a live account keeps its preferences.
let bxHint = false;
try { bxHint = localStorage.getItem("nnstudio_account") === "1"; } catch (e) {}
if (!bxHint) {
  try {
    for (const k of ["nnstudio_theme", "aistudio.theme", "nnstudio_sidebar",
                     "nnstudio_backend", "nnstudio_modal_key", "nnstudio_canvas_name",
                     "aistudio.settings", "aistudio.sidebarCollapsed", "aistudio.workspace"])
      localStorage.removeItem(k);
  } catch (e) {}
}

// The remembered theme lands before anything draws (Salon dark is home)
// The one shell owns the theme for both halves; the chat's old key is read
// once, so a theme chosen over there still lands here.
try {
  let th = bxHint ? localStorage.getItem("nnstudio_theme") : null;
  if (bxHint && th !== "light" && th !== "dark") th = localStorage.getItem("aistudio.theme");
  document.documentElement.setAttribute("data-theme", th === "light" ? "light" : "dark");
} catch (e) {
  document.documentElement.setAttribute("data-theme", "dark");
}

// The remembered sidebar state lands before anything draws (accounts)
try {
  if (bxHint && localStorage.getItem("nnstudio_sidebar") === "1") {
    const s = document.getElementById("bxsidebar");
    if (s && s.classList) s.classList.add("collapsed");
  }
} catch (e) {}

// Tiny element builder: mk("div", {class: "x", text: "hi", onclick: fn}, kid...)
function mk(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k === "html") el.innerHTML = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el[k] = v;
  }
  for (const kid of kids) if (kid) el.appendChild(kid);
  return el;
}

// SVG sibling of mk: attributes go through setAttribute (SVG needs it).
function svg(tag, attrs = {}, ...kids) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === "text") el.textContent = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  for (const kid of kids) if (kid) el.appendChild(kid);
  return el;
}
function svgText(x, y, text, cls) {
  return svg("text", { x, y, class: cls, text });
}

