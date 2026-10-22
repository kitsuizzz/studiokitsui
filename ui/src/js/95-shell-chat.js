// ─── nnstudio shell · 95 · the shared shell ─────────────────────────────────────
// the Chat | Studio crossing, the chat bridge, studio/session binding, and the switcher.
// Order is load-bearing: this slice is concatenated after the one before it.

function bxViewIsChat() { return BXVIEW.half === "chat"; }
// Every /chat address (the page, its slash, a fallback deep path) is the chat
// main; /studio and / are the canvas. The built standalone page at
// /chat/index.html redirects here, so the whole prefix is the one shell.
function bxAtChatPath() {
  if (typeof location === "undefined") return false;
  const p = String(location.pathname || "");
  return p === "/chat" || p === "/chat/" || p.indexOf("/chat/") === 0;
}
// A canvas id has two spellings: the chat half's bare one and the store row's
// `canvas|`-prefixed one. The one session list matches them as the same row.
function bxBareCanvas(id) { return String(id == null ? "" : id).replace(/^canvas\|/, ""); }
// The chat half's welcome is full-bleed under the one top bar: while it is the
// main, the left menu steps aside (it returns with the first session). Until
// the embedded app reports (a cold /chat load), stay in the landing's shape.
function bxLandingApply() {
  const landing = bxViewIsChat() && (BXCHAT.landing || !BXCHAT.known);
  try { document.documentElement.classList.toggle("at-landing", landing); } catch (e) {}
}
// The account dialog is the chat half's (a proper overlay in both views); the
// shell only opens it. A sign-in/out reloads the page so the canvas, the store,
// and the chat all boot on the new account.
function bxShellAuth(mode) {
  bxtDropsClose();
  if (typeof window !== "undefined" && window.__nnShell && window.__nnShell.auth)
    window.__nnShell.auth(mode);
}
function bxPushUrl(path) {
  if (typeof history === "undefined" || !history.pushState) return;
  try { history.pushState({}, "", path); } catch (e) {}
}
function bxViewSet(half) {
  BXVIEW.half = half === "chat" ? "chat" : "studio";
  const canvasView = $("view-training"), chatView = $("nn-chat");
  if (canvasView) canvasView.hidden = BXVIEW.half === "chat";
  if (chatView) chatView.hidden = BXVIEW.half !== "chat";
  try {
    document.documentElement.classList.toggle("at-chat", BXVIEW.half === "chat");
    document.title = BXVIEW.half === "chat" ? "Studio Kitsui — Chat" : "Studio Kitsui — Studio";
  } catch (e) {}
  if (BXACCT && BXACCT.user) bxPlaceNow(BXVIEW.half);
  bxLandingApply();
  bxTabsRender();
}
async function bxChatEnsure() {
  if (BXCHAT.ready) return true;
  if (BXCHAT.loading) return BXCHAT.loading;
  BXCHAT.loading = (async () => {
    try {
      const res = await fetch("/chat/.vite/manifest.json", { cache: "no-store" });
      if (!res || !res.ok) throw new Error("manifest");
      const manifest = await res.json();
      const entry = manifest["index.html"] ||
        Object.keys(manifest).map(k => manifest[k]).find(x => x && x.isEntry);
      if (!entry || !entry.file) throw new Error("entry");
      for (const href of entry.css || []) {
        const have = [...document.querySelectorAll("link[rel=stylesheet]")]
          .some(l => String(l.href || "").indexOf(href) >= 0);
        if (have) continue;
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = "/chat/" + href;
        document.head.appendChild(link);
      }
      window.__NN_EMBEDDED = true;             // the app renders the main alone
      await import("/chat/" + entry.file);
      BXCHAT.ready = true;
      return true;
    } catch (e) {
      BXCHAT.loading = null;                   // a later switch may retry
      return false;
    }
  })();
  return BXCHAT.loading;
}
// The chat mounts once, from the dynamic import; its bridge appears after the
// first React render. The door may be clicked in that first breath, so wait
// for it (and give up quietly if the app never arrives).
function bxChatReady() {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (window.__nnChat) return Promise.resolve(window.__nnChat);
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      window.removeEventListener("nnchat:update", finish);
      resolve(window.__nnChat || null);
    };
    window.addEventListener("nnchat:update", finish);
    setTimeout(finish, 4000);
  });
}
// This is the Studio → Chat door's landing: the named conversation opens when
// the store has it, otherwise a session opens (never the welcome). The app is
// already mounted (it is mounted once, hidden, at boot), so it is told here.
async function bxChatOpen(conv) {
  if (!window.__nnChat) window.__NN_CHAT_OPEN = conv != null ? Number(conv) : null;
  await bxChatEnsure();
  BXCHAT.known = true;                         // the door's target is a session
  BXCHAT.landing = false;
  bxPushUrl(conv != null ? "/chat?conversation=" + conv : "/chat");
  bxViewSet("chat");
  const api = await bxChatReady();
  if (!api) return false;
  if (conv != null) api.open(Number(conv));
  else api.newSession();
  return true;
}
// The top bar's Studio switch: the active chat's canvas (creating it when the
// session has none yet), or the canvas main when the chat is at the welcome.
async function bxChatStudio() {
  const api = await bxChatReady();
  const active = api && api.active ? api.active() : null;
  if (active != null && api.studioFor) { api.studioFor(active); return; }
  bxStudioOpen(null);
}
// "New session" from the shell: a fresh chat session in the chat half, a new
// canvas in the canvas half — the same door, whichever main is up.
async function bxChatNew() {
  if (!window.__nnChat) window.__NN_CHAT_OPEN = null;
  await bxChatEnsure();
  BXCHAT.known = true;
  BXCHAT.landing = false;
  bxViewSet("chat");
  bxPushUrl("/chat");
  const api = await bxChatReady();
  if (api) api.newSession();
}
// The gear in the one top bar: the account-wide settings (models, providers,
// agents) — a main-area view in the chat half, under the same shell.
async function bxShellSettings() {
  await bxChatEnsure();
  bxViewSet("chat");
  bxPushUrl("/chat");
  const api = await bxChatReady();
  if (api && api.settings) api.settings();
}
// A session whose home is the canvas: bring its tab to the front (loading the
// saved row when it is not open) and show the canvas main — the live switch.
async function bxStudioOpen(id, name) {
  let opened = false;
  if (id) opened = await bxOpenCanvasId(id);
  if (id && !opened) {
    // A session whose canvas is only in memory (a guest's, or one just
    // minted): give it a tab carrying that id and the session's name, so
    // the pair is one item with one identity.
    const p = bxTabNew();
    if (p) {
      p.canvas = bxBareCanvas(id);
      if (name) p.name = String(name);
      bxTabsRender();
    }
  }
  bxViewSet("studio");
  bxPushUrl(id ? "/studio?canvas=" + bxBareCanvas(id) : "/studio");
}

// A session is a pair: when a canvas gains its chat, the canvas record keeps
// its design and records the conversation id — creating the record (under the
// pair's id) when the canvas was never saved. A guest keeps the pair in memory.
async function bxCanvasBindSession(p, convId) {
  if (!p) return false;
  p.session = String(convId);
  if (!BXACCT.user || !BXACCT.key || typeof fetch !== "function") return true;
  const bare = p.canvas ? bxBareCanvas(p.canvas)
                        : "c_" + bxHex(crypto.getRandomValues(new Uint8Array(8)));
  p.canvas = bare;
  const aad = bxCanvasAad(bare);
  try {
    const rows = await bxCanvasRecords();
    const row = rows.find(r => bxCanvasAad(r.id) === aad);
    let rec = null;
    if (row) {
      rec = await bxOpenRecord(BXACCT.key, aad, row.blob);
    } else {
      const design = p.id === BX.active ? bxExportCanvas() : (p.doc || null);
      if (!design) return false;
      rec = { name: p.name, design: design, session: null };
    }
    rec.session = String(convId);
    const blob = await bxSealRecord(BXACCT.key, aad, rec);
    const r = await fetch("/chat/auth/store/sync", { method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ canvases: {
        upserts: [{ id: aad, blob: blob }],
        deletes: row && row.id !== aad ? [row.id] : [] } }) });
    if (!r.ok) return false;
    p.saved = true;
    p.dirty = false;
    bxTabsRender();
    bxSessionPush();
    return true;
  } catch (e) {
    return false;
  }
}

// A canvas with no chat yet: create the missing half on the canvas's own id,
// bind the record, and open the chat. The pair is then one session everywhere.
async function bxChatAttachCanvas(p) {
  if (!p || p.kind === "ai") { bxStudioTab(p); return; }
  const api = await bxChatReady();
  if (!api || !api.attach) { bxStudioTab(p); return; }
  let id = p.canvas ? bxBareCanvas(p.canvas) : "";
  if (!id) {
    id = "c_" + bxHex(crypto.getRandomValues(new Uint8Array(8)));
    p.canvas = id;
  }
  // A blank boot canvas has an implementation name, not a session name: the
  // chat pair should be born as "New session", never as "New Project N".
  const auto = /^New Project \d+$/.test(String(p.name || "").trim());
  if (auto || !p.name) p.name = "New session";
  const cid = api.attach(id, p.name);
  if (cid == null) { bxStudioTab(p); return; }
  bxTabsRender();
  await bxCanvasBindSession(p, cid);
  bxChatOpen(cid);
}

// "New session" from the canvas side: the chat half creates the session and
// seals its canvas, then hands the canvas id back to open here.
function bxNewStudioSession() {
  const api = typeof window !== "undefined" ? window.__nnChat : null;
  if (api && api.newStudioSession) { api.newStudioSession(); return; }
  // The bridge is not up yet (the first breath, or a test): a plain canvas
  // now; its chat is created on the first crossing, so the pair still forms.
  bxTabNew();
}
// …from an already-open tab: the address names its saved canvas, or the plain
// canvas half when it has never been saved.
function bxStudioTab(p) {
  if (p && p.id !== BX.active) bxTabSelect(p.id);
  bxViewSet("studio");
  bxPushUrl(p && p.canvas ? "/studio?canvas=" + p.canvas : "/studio");
}
async function bxOpenCanvasId(id) {
  const want = String(id || "");
  if (!want) return false;
  // The chat half passes the bare canvas id; an open tab carries the row id
  // (`canvas|<id>`). They are the same canvas — never open a second tab.
  const open = (BX.projects || []).find(p => p.canvas && bxBareCanvas(p.canvas) === bxBareCanvas(want));
  if (open) { bxTabSelect(open.id); return true; }
  if (!BXACCT.user || !BXACCT.key) return false;
  let rows = [];
  try { rows = await bxCanvases(); } catch (e) { return false; }
  const hit = rows.find(r => r.id === want || r.id === "canvas|" + want);
  if (!hit || !hit.design) return false;
  return !!bxTabOpenSaved(hit.name, hit.design, hit.id, hit.session);
}
// ---- the chat agent's live canvas door -------------------------------------
// The canvas is state in this shell, not in the chat SPA. The agent reads and
// edits through these two calls; every edit batch is one undo step and the
// user approves the call in chat before it runs.
async function bxAgentCanvasTarget(id) {
  const want = bxBareCanvas(id);
  if (!want) return { error: "this session has no canvas" };
  let p = (BX.projects || []).find(x => x.canvas && bxBareCanvas(x.canvas) === want);
  if (!p) {
    const opened = await bxOpenCanvasId(want);
    if (!opened) return { error: "the canvas is not open and could not be loaded" };
    p = (BX.projects || []).find(x => x.canvas && bxBareCanvas(x.canvas) === want);
  }
  if (!p) return { error: "the canvas tab was not found" };
  if (BX.active !== p.id && !bxTabSelect(p.id))
    return { error: "the canvas tab could not be opened" };
  if (BX.up) return { error: "the canvas is open inside a nested box; come back to the top level first" };
  return { p: p };
}
function bxAgentNodeRef(ref) {
  if (ref == null) return null;
  if (typeof ref === "string" || typeof ref === "number") ref = { id: String(ref) };
  if (ref && ref.id) {
    const hit = bxNode(String(ref.id));
    if (hit) return hit;
  }
  const name = String((ref && ref.name) || "").trim().toLowerCase();
  if (!name) return null;
  const hits = (BX.nodes || []).filter(n => String(n.name || "").trim().toLowerCase() === name);
  return hits.length === 1 ? hits[0] : null;
}
function bxAgentApplyOps(ops) {
  if (!Array.isArray(ops) || !ops.length)
    return { ok: false, error: "the edit call had no operations" };
  if (BX.up) return { ok: false, error: "go back to the top level before editing" };
  const before = bxSnapshotNow();
  const changed = [];
  let error = "";
  bxUndoLock++;
  try {
    for (const raw of ops) {
      const op = raw && typeof raw === "object" ? raw : {};
      const what = String(op.op || "");
      const settings = Object.assign({}, op.settings || {});
      if (op.name && settings.name === undefined) settings.name = String(op.name);
      if (what === "add" || what === "template") {
        const x = Number.isFinite(Number(op.x)) ? Number(op.x) : bxCenter().cx - 160;
        const y = Number.isFinite(Number(op.y)) ? Number(op.y) : bxCenter().cy - 60;
        const template = String(op.template || "");
        const n = template
          ? bxAddTemplate(template, x, y, op.name ? String(op.name) : undefined)
          : bxAddKind(String(op.kind || ""), x, y, settings);
        if (!n) throw new Error("a box of that kind cannot land here");
        if (template && Object.keys(settings).length) bxConfigure(n.id, settings);
        changed.push({ op: "add", id: n.id, name: n.name, kind: n.kind });
        continue;
      }
      if (what === "update") {
        const n = bxAgentNodeRef(op);
        if (!n) throw new Error("no box matches " + (op.id || op.name || "?"));
        if (!bxConfigure(n.id, settings)) throw new Error("that box could not be updated");
        changed.push({ op: "update", id: n.id, name: n.name, kind: n.kind });
        continue;
      }
      if (what === "move") {
        const n = bxAgentNodeRef(op);
        if (!n) throw new Error("no box matches " + (op.id || op.name || "?"));
        if (op.x != null) n.x = bxSnapTo(Number(op.x));
        if (op.y != null) n.y = bxSnapTo(Number(op.y));
        bxSettleSizes();
        changed.push({ op: "move", id: n.id, name: n.name, kind: n.kind });
        continue;
      }
      if (what === "remove") {
        const n = bxAgentNodeRef(op);
        if (!n) throw new Error("no box matches " + (op.id || op.name || "?"));
        bxRemove(n.id);
        changed.push({ op: "remove", id: n.id, name: n.name, kind: n.kind });
        continue;
      }
      if (what === "connect" || what === "disconnect") {
        const a = bxAgentNodeRef(op.from);
        const b = bxAgentNodeRef(op.to);
        if (!a || !b) throw new Error("both ends of the wire must name a box");
        const fp = Number(op.fromPort) || 0, tp = Number(op.toPort) || 0;
        if (what === "connect") {
          const why = bxConnect(a.id, b.id, fp, tp);
          if (why) throw new Error(why);
          changed.push({ op: "connect", from: a.name, to: b.name, fromPort: fp, toPort: tp });
        } else {
          if (!bxRemoveEdge(a.id, b.id, fp, tp)) throw new Error("no such wire");
          changed.push({ op: "disconnect", from: a.name, to: b.name, fromPort: fp, toPort: tp });
        }
        continue;
      }
      throw new Error("unknown edit op: " + (what || "?"));
    }
  } catch (e) {
    error = String((e && e.message) || e);
  }
  bxUndoLock--;
  if (error) {
    try { bxRestore(before); } catch (e) { /* the screen stays usable */ }
    return { ok: false, error: error, changed: changed };
  }
  bxCommit();
  bxRender();
  bxRenderPalette();
  return { ok: true, changed: changed };
}
async function bxShellCanvasRead(id) {
  const hit = await bxAgentCanvasTarget(id);
  if (hit.error) return { ok: false, error: hit.error };
  const design = bxExportCanvas();
  if (!design) return { ok: false, error: "the canvas could not be read at this level" };
  return { ok: true, name: hit.p.name, design: design };
}
async function bxShellCanvasEdit(id, ops) {
  const hit = await bxAgentCanvasTarget(id);
  if (hit.error) return { ok: false, error: hit.error };
  const out = bxAgentApplyOps(ops);
  out.canvas = { id: bxBareCanvas(hit.p.canvas || id), name: hit.p.name };
  return out;
}

function bxShellInit() {
  BXVIEW.half = bxAtChatPath() ? "chat" : "studio";
  // the view is right from the first frame; the account arrives asynchronously
  const canvasView = $("view-training"), chatView = $("nn-chat");
  if (canvasView) canvasView.hidden = BXVIEW.half === "chat";
  if (chatView) chatView.hidden = BXVIEW.half !== "chat";
  try {
    document.documentElement.classList.toggle("at-chat", BXVIEW.half === "chat");
    document.title = BXVIEW.half === "chat" ? "Studio Kitsui — Chat" : "Studio Kitsui — Studio";
  } catch (e) {}
  bxLandingApply();                            // the menu waits for the app's report on /chat
  bxTabsRender();
  bxChatEnsure();                              // the session list lives in every view
  window.__nnShell = {
    studio(canvasId, name) {
      bxStudioOpen(canvasId, name);
    },
    canvas: {
      read: bxShellCanvasRead,
      edit: bxShellCanvasEdit,
    },
    async auth(mode) {
      bxViewSet("chat");
      await bxChatEnsure();
      const api = window.__nnChat;
      if (api && api.auth) api.auth(mode === "signup" ? "signup" : "signin");
    },
  };
  // The chat's list, active session, and titles change while it runs; keep the
  // one sidebar in step (only redraw on a real change — streaming re-emits).
  window.addEventListener("nnchat:update", () => {
    const api = window.__nnChat;
    if (!api) return;
    // The one sidebar is the shell's: keep the chat's reading column in step
    // with its fold (a remembered fold included).
    if (api.sidebar) {
      const s = $("bxsidebar");
      api.sidebar(!!(s && s.classList && s.classList.contains("collapsed")));
    }
    // A sign-in (or an unlock) inside the chat dialog is an account change for
    // the whole shell: reboot so the canvas and the store follow. The guard on
    // `ready` keeps the async boots from racing each other into a reload.
    const st = api.state ? api.state() : "";
    const ready = api.ready ? api.ready() : false;
    const locked = api.locked ? api.locked() : false;
    if (ready) {
      BXCHAT.known = true;
      BXCHAT.landing = !!(api.landing && api.landing());
      bxLandingApply();
    }
    if (ready && BXACCT.known &&
        ((st === "user" && !BXACCT.user) || (st === "guest" && BXACCT.user) ||
         (st === "user" && BXACCT.locked && !locked))) {
      try { location.reload(); } catch (e) {}
      return;
    }
    let list = [];
    try { list = api.list() || []; } catch (e) {}
    BXCHAT.convs = list;
    const sig = JSON.stringify([BXVIEW.half, api.active ? api.active() : null,
      list.map(c => [c.id, c.title, c.canvasId || ""])]);
    if (sig === BXCHAT.sig) return;
    BXCHAT.sig = sig;
    bxTabsRender();
  });
  // The address bar is the view too: back/forward between the halves works.
  window.addEventListener("popstate", () => {
    const half = bxAtChatPath() ? "chat" : "studio";
    if (half !== BXVIEW.half) { bxChatEnsure(); bxViewSet(half); }
  });
}
function bxTabsRender() {                      // the one session list, shared by both views
  const list = $("bxlist");
  if (!list) return;
  list.innerHTML = "";
  const convs = BXCHAT.convs || [];
  const byId = new Map(convs.map(c => [c.id, c]));
  const byCanvas = new Map();
  for (const c of convs) if (c.canvasId) {
    const bare = bxBareCanvas(c.canvasId);
    byCanvas.set(bare, c);
    byCanvas.set("canvas|" + bare, c);
  }
  // A session pairs by the conversation's canvasId, and just as firmly by the
  // canvas record's `session` (the link's copy) when the conversation's own
  // save was lost. Each conversation is claimed once; the canvas id wins.
  const projectConv = new Map();
  const usedConv = new Set();
  for (const p of BX.projects || []) {
    const c = p.canvas ? byCanvas.get(String(p.canvas)) : null;
    if (c) { projectConv.set(p.id, c); usedConv.add(c.id); }
  }
  for (const p of BX.projects || []) {
    if (projectConv.has(p.id) || p.session == null) continue;
    const c = byId.get(Number(p.session));
    if (c && !usedConv.has(c.id)) { projectConv.set(p.id, c); usedConv.add(c.id); }
  }
  // Last resort: a saved canvas and a chat-only session can carry the same
  // title when the binding never landed (both sides were created before the
  // pair did). A meaningful title names one session, not two.
  for (const p of BX.projects || []) {
    if (projectConv.has(p.id)) continue;
    const title = String(p.name || "").trim();
    if (!title || title === "New session" || /^New Project \d+$/.test(title)) continue;
    const c = convs.find(x => !usedConv.has(x.id) && String(x.title || "").trim() === title);
    if (!c) continue;
    projectConv.set(p.id, c);
    usedConv.add(c.id);
    // Give the canvas record the session id, so the chat half's heal can
    // adopt it back onto the conversation (the design is untouched).
    if (!p.session && p.canvas && c.canvasId == null) void bxCanvasBindSession(p, c.id);
  }
  const openCanvas = new Set();
  for (const p of BX.projects || []) if (p.canvas) openCanvas.add(bxBareCanvas(p.canvas));
  const chat = bxViewIsChat();
  const api = typeof window !== "undefined" ? window.__nnChat : null;
  const activeConv = chat && api && api.active ? api.active() : null;
  const row = (opts) => {
    const t = mk("div", { class: "bxcitem" + (opts.active ? " on" : "") + (opts.ai ? " ai" : ""),
                          title: opts.title || opts.name });
    const tile = mk("span", { class: "bxctile" });
    if (opts.dirty)
      tile.appendChild(mk("span", { class: "bxtdot", title: "changes not saved" }));
    else
      tile.appendChild(mk("span", { text: String(opts.name || "?").charAt(0).toUpperCase() }));
    t.appendChild(tile);
    t.appendChild(mk("span", { class: "bxctitle", text: opts.name }));
    if (opts.close) {
      const x = mk("span", { class: "bxclose", text: "\u00d7",
                            title: opts.closeTitle || "close this project" });
      x.addEventListener("click", (ev) => {
        if (ev && ev.stopPropagation) ev.stopPropagation();
        opts.close();
      });
      t.appendChild(x);
    }
    t.addEventListener("click", opts.go);
    list.appendChild(t);
  };
  // The open canvases, in tab order. A bound one wears the chat's title, so
  // both halves name the same session the same way. The pristine boot blank is
  // not a session: hide it while any chat session exists.
  const hideBlank = convs.length > 0;
  for (const p of BX.projects || []) {
    if (hideBlank && bxPristineBlank(p)) continue;
    const conv = projectConv.get(p.id) || null;
    row({
      name: conv ? (conv.title || p.name) : p.name,
      ai: p.kind === "ai",
      dirty: p.dirty,
      active: chat ? (conv != null && conv.id === activeConv) : p.id === BX.active,
      // A session's × removes the pair — allowed even when it is the last open
      // canvas (a fresh blank canvas takes its place). A lone canvas keeps the
      // Studio's rule: the last one stays, so it wears no ×.
      close: (conv || (BX.projects || []).length > 1) ? () => bxSessionRemove(p, conv) : null,
      closeTitle: conv ? "remove this session" : "close this project",
      go: () => {
        if (chat) {
          if (conv) { bxChatOpen(conv.id); return; }
          if (p.kind === "ai") { bxStudioTab(p); return; }
          bxChatAttachCanvas(p);               // the pair's chat, on this canvas
          return;
        }
        bxTabSelect(p.id);
      },
    });
  }
  // chat sessions with no open canvas: recent first, as the chat lists them
  const rest = convs.filter(c => !usedConv.has(c.id) &&
    (!c.canvasId || !openCanvas.has(bxBareCanvas(c.canvasId))))
    .sort((a, b) => (b.createdAt ?? b.id) - (a.createdAt ?? a.id) || b.id - a.id);
  for (const c of rest) {
    row({
      name: c.title || "New session",
      active: chat && c.id === activeConv,
      close: api && api.remove ? () => bxSessionRemoveConv(c) : null,
      closeTitle: "remove this session",
      go: () => {
        if (chat) { bxChatOpen(c.id); return; }
        const api = window.__nnChat;
        if (c.canvasId) {                      // the pair's canvas, opened here
          bxOpenCanvasId(c.canvasId).then(ok => {
            if (!ok && api && api.studioFor) api.studioFor(c.id);
          });
          return;
        }
        if (api && api.studioFor) { api.studioFor(c.id); return; }
        bxChatOpen(c.id);                      // bridge not ready: the chat
      },
    });
  }
  const note = $("bxtabnote");
  if (note) {
    note.textContent = BXTAB.msg || "";
    if (note.classList) note.classList.toggle("on", !!BXTAB.msg);
  }
  bxHeadRefresh();                             // the head wears the active canvas's name
}
// a page that would take unsaved projects with it asks first (the browser's
// own guard, on reload or close)
if (typeof window !== "undefined" && window.addEventListener) {
  window.addEventListener("beforeunload", (ev) => {
    if (!bxTabAnyDirty()) return;
    if (ev && ev.preventDefault) ev.preventDefault();
    if (ev) ev.returnValue = "";
    return "";
  });
}
function bxSwitchToggle() {                     // ⌘K: the door over the wall
  const b = $("bxswitchBack");
  if (!b) return false;
  const open = !!b.hidden;
  bxtDropsClose();
  b.hidden = !open;
  if (open) {
    BXTAB.view = "main";
    BXTAB.cursor = 0;
    const q = $("bxswitchQuery");
    if (q) { q.value = ""; if (q.focus) q.focus(); }
    bxSwitchBuild();
  }
  return open;
}
function bxSwitchClose() {
  const b = $("bxswitchBack");
  if (b) b.hidden = true;
  BXTAB.view = "main";
}
function bxsToggle() {                          // the sidebar folds, and the choice is remembered
  const s = $("bxsidebar");
  if (!s || !s.classList) return;
  const collapsed = s.classList.toggle("collapsed");
  try { if (bxSessionHint()) localStorage.setItem("nnstudio_sidebar", collapsed ? "1" : "0"); } catch (e) {}
  const api = typeof window !== "undefined" ? window.__nnChat : null;
  if (api && api.sidebar) api.sidebar(collapsed);
}
function bxSwitchBuild() {                      // the switcher's list, in its view
  const list = $("bxswitchList");
  if (!list) return;
  const item = (label, hint, fn, dim) => {
    const it = mk("li", { class: "bxswitch-item" + (dim ? " dim" : "") });
    it.appendChild(mk("span", { class: "bxswitch-label", text: label }));
    if (hint) it.appendChild(mk("span", { class: "bxswitch-hint", text: hint }));
    if (fn) it.addEventListener("click", fn);
    list.appendChild(it);
    return it;
  };
  list.innerHTML = "";
  BXTAB.cursor = 0;
  const ql = String(($("bxswitchQuery") || {}).value || "").trim().toLowerCase();
  if (BXTAB.view === "saved") {
    item("\u2190 back", "", () => { BXTAB.view = "main"; bxSwitchBuild(); });
    if (!BXACCT.user) {
      item("saving and opening need an account \u2014 create one at the top right",
           "", null, true);
      return;
    }
    if (BXACCT.locked) {
      item("the account is locked \u2014 unlock it with your access key", "", null, true);
      return;
    }
    const status = item("reading the list \u2026", "", null, true);
    if (typeof fetch !== "function") {
      status.children[0].textContent = "the app cannot reach the server";
      return;
    }
    bxCanvases().then((rows) => {
      const back = $("bxswitchBack");
      if (!back || back.hidden || BXTAB.view !== "saved") return;    // the door closed meanwhile
      list.innerHTML = "";
      BXTAB.cursor = 0;
      item("\u2190 back", "", () => { BXTAB.view = "main"; bxSwitchBuild(); });
      if (!rows.length)
        item("nothing saved yet \u2014 Ctrl+S saves this canvas", "", null, true);
      rows.forEach((r) => {
        const row = item(r.name, bxWhen(r.updatedAt), () => {
          if (!r.design) {
            if (row.children[0]) row.children[0].textContent = "that canvas could not be opened";
            return;
          }
          if (bxTabOpenSaved(r.name, r.design, r.id, r.session)) {
            if (bxViewIsChat()) {
              bxViewSet("studio");
              bxPushUrl("/studio?canvas=" + r.id);
            }
            bxSwitchClose();
          }
          else if (row.children[0]) row.children[0].textContent = "that canvas could not be opened";
        });
      });
    }).catch((e) => {
      const back = $("bxswitchBack");
      if (!back || back.hidden) return;
      if (status.children[0]) status.children[0].textContent = String((e && e.message) || e);
    });
    return;
  }
  if (!ql) {
    item("New session", "create", () => {
      bxSwitchClose();
      if (bxViewIsChat()) bxChatNew(); else bxNewStudioSession();
    });
    item("AI agent", "create", () => {
      bxSwitchClose();
      if (bxViewIsChat()) bxViewSet("studio");
      bxTabNewAI();
    });
    item("Saved canvas \u2026", "view",
         () => { BXTAB.view = "saved"; bxSwitchBuild(); });
  }
  let seen = 0;
  const chat = bxViewIsChat();
  const api = typeof window !== "undefined" ? window.__nnChat : null;
  const activeConv = chat && api && api.active ? api.active() : null;
  const byCanvas = new Map();
  for (const c of BXCHAT.convs || []) if (c.canvasId) {
    const bare = bxBareCanvas(c.canvasId);
    byCanvas.set(bare, c);
    byCanvas.set("canvas|" + bare, c);
  }
  const hideBlank = (BXCHAT.convs || []).length > 0;
  (BX.projects || []).forEach((p) => {
    if (hideBlank && bxPristineBlank(p)) return;
    const conv = p.canvas ? byCanvas.get(String(p.canvas)) : null;
    const name = conv ? (conv.title || p.name) : p.name;
    if (ql && String(name || "").toLowerCase().indexOf(ql) < 0) return;
    seen += 1;
    const current = chat ? (conv != null && conv.id === activeConv) : p.id === BX.active;
    item(name, current ? "current" : "", () => {
      bxSwitchClose();
      if (chat) {
        if (conv) { bxChatOpen(conv.id); return; }
        if (p.kind === "ai") { bxStudioTab(p); return; }
        bxChatAttachCanvas(p);
        return;
      }
      bxTabSelect(p.id);
    });
  });
  // chat sessions with no open canvas, newest first
  const openCanvas = new Set((BX.projects || []).map(p => bxBareCanvas(p.canvas)).filter(Boolean));
  const rest = (BXCHAT.convs || [])
    .filter(c => !c.canvasId || !openCanvas.has(bxBareCanvas(c.canvasId)))
    .sort((a, b) => (b.createdAt ?? b.id) - (a.createdAt ?? a.id) || b.id - a.id);
  for (const c of rest) {
    const name = c.title || "New session";
    if (ql && name.toLowerCase().indexOf(ql) < 0) continue;
    seen += 1;
    const current = chat && c.id === activeConv;
    item(name, current ? "current" : (c.canvasId ? "" : "chat"), () => {
      bxSwitchClose();
      if (chat) { bxChatOpen(c.id); return; }
      const api = window.__nnChat;
      if (c.canvasId) {
        bxOpenCanvasId(c.canvasId).then(ok => {
          if (!ok && api && api.studioFor) api.studioFor(c.id);
        });
        return;
      }
      if (api && api.studioFor) { api.studioFor(c.id); return; }
      bxChatOpen(c.id);
    });
  }
  if (ql && !seen) item("nothing matches", "", null, true);
}

