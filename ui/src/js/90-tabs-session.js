// ─── nnstudio shell · 90 · tabs and session ─────────────────────────────────────
// BXSESSION/BXCANVAS_WANT, tab restore/close/save, and the delete confirm.
// Order is load-bearing: this slice is concatenated after the one before it.

// ---- the session record: which canvases were open, and which was on screen --
// One entry per open canvas; switching snapshots the one on screen and loads the
// other through the same JSON path an imported design takes. Ctrl/Cmd+S saves the
// active project: sealed in this browser first, ciphertext posted after. The
// browser always keeps a copy; a signed-in, unlocked account also gets it sealed
// and posted, so a reload (or another machine) lands where you left off.
let BXSESSION = { hold: false, restored: false };
// The door parameter: /studio?canvas=<id> names the canvas this boot should
// open on screen — the chat half's Studio door crosses over with it. The id
// is the bare one; in the store the row may carry the "canvas|" prefix.
// Read once, softly: the boot harness stubs location.
let BXCANVAS_WANT = "";
try { BXCANVAS_WANT = (new URLSearchParams(location.search || "").get("canvas")) || ""; } catch (e) {}

function bxSessionNow() {
  // One tab per canvas, whichever id shape the projects carry (an older
  // build could leave two tabs for one canvas; the record must not keep them).
  const seen = new Set();
  const tabs = [];
  for (const p of BX.projects || []) {
    if (!p.saved || !p.canvas) continue;
    const bare = bxBareCanvas(p.canvas);
    if (seen.has(bare)) continue;
    seen.add(bare);
    // The bare id is the chat half's shape too — its unbind drops the tab by
    // that id, so the shared record must carry it, not the row's prefixed one.
    tabs.push({ id: bare, name: p.name });
  }
  const act = bxProject();
  return { tabs: tabs,
           active: act && act.saved && act.canvas ? bxBareCanvas(act.canvas) : null };
}
async function bxSessionPush() {               // after every open, close, switch,
  if (BXSESSION.hold) return false;            // save: which saved canvases were
  if (!BXACCT.user || !BXACCT.key) return true;   // open, and which one was on
  const sn = bxSessionNow();                   // screen, lands in the account's
  try {                                        // store — sealed, and on the
    const blob = await bxSealRecord(BXACCT.key, "session|current", sn);
    await fetch("/chat/auth/store/sync", {     // backend, so any device that
      method: "POST",                          // signs in lands where the
      headers: { "Content-Type": "application/json" },   // account left off
      body: JSON.stringify({ session: { upserts: [{ id: "session|current", blob: blob }], deletes: [] } }),
    });
  } catch (e) {}
  return true;
}
async function bxSessionStored() {             // the sealed session, or null. The
  // row's key is its AAD, "session|current" — pre-v2 stores carried this same
  // record under the bare key "current". The new key wins; while a legacy row
  // still exists it is folded in and retired here, once — a link made in the
  // chat half before this boot must not shadow the user's own tabs.
  if (!BXACCT.user || !BXACCT.key) return null;
  try {
    const rows = (((await bxStoreRead()) || {}).session) || [];
    const row = rows.find(r => r.id === "session|current");
    const legacy = rows.find(r => r.id === "current");
    if (legacy) {
      const old = await bxOpenRecord(BXACCT.key, "session|current", legacy.blob);
      if (!old || typeof old !== "object") {   // unreadable: behave as pre-v2
        if (!row) return null;                  // nothing to fold in; the new
        const sn = await bxOpenRecord(BXACCT.key, "session|current", row.blob);      // row stands alone
        return sn && typeof sn === "object" ? sn : null;
      }
      const sn = (row && (await bxOpenRecord(BXACCT.key, "session|current", row.blob))) || null;
      const tabs = [];
      const seen = {};
      for (const t of [].concat(old.tabs || [], (sn && sn.tabs) || []))
        if (t && t.id && !seen[t.id]) { seen[t.id] = true; tabs.push(t); }
      const merged = { tabs: tabs, active: (sn && sn.active) || old.active || null };
      const blob = await bxSealRecord(BXACCT.key, "session|current", merged);
      await fetch("/chat/auth/store/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session: { upserts: [{ id: "session|current", blob: blob }], deletes: ["current"] } }),
      });
      return merged;                            // the legacy row is retired
    }
    if (!row) return null;
    const sn = await bxOpenRecord(BXACCT.key, "session|current", row.blob);
    return sn && typeof sn === "object" ? sn : null;
  } catch (e) {
    return null;                               // unreadable: no tabs to bring back
  }
}
function bxSessionMatch(sn, rows) {            // the session's tabs, still saved
  const out = [];
  const seen = new Set();
  for (const t of (sn && sn.tabs) || []) {
    // Tab ids arrive in two shapes: a row's own (the canvas's tabs) or the
    // chat half's bare one — "canvas|" + bare is the same row in the store.
    const hit = (rows || []).find(r => r.id === t.id || r.id === "canvas|" + t.id);
    if (!hit || seen.has(bxBareCanvas(hit.id))) continue;   // one tab per canvas
    seen.add(bxBareCanvas(hit.id));
    out.push(hit);
  }
  return out;
}
async function bxSessionRestore() {            // at sign-in: open what was open
  if (!BXACCT.user || !BXACCT.key) return false;
  const stored = await bxSessionStored();      // the account's own tab record
  // A door visit may name a canvas: ?canvas=<id> is how the chat half's
  // Studio button crosses over. With no tab record to bring back, the named
  // canvas stands in for one — it becomes the sole, active tab.
  const sn = (stored && stored.tabs && stored.tabs.length) ? stored
           : (BXCANVAS_WANT ? { tabs: [{ id: BXCANVAS_WANT }], active: null } : null);
  if (!sn) return false;
  let rows = [];
  try { rows = await bxCanvases(); } catch (e) { return false; }
  let want = bxSessionMatch(sn, rows);
  if (BXCANVAS_WANT) {                          // the named canvas opens first…
    const hit = (rows || []).find(r => r.id === BXCANVAS_WANT || r.id === "canvas|" + BXCANVAS_WANT);
    if (hit) want = [hit].concat(want.filter(w => w !== hit));
    else if (!want.length) bxTabsSay("That canvas is not in your store.");
  }
  if (!want.length) return false;
  BXSESSION.hold = true;                       // the opens must not half-push
  let opened = 0, activeId = null;
  // On screen: the door's canvas when one was named, else the account's last
  // active tab. Ids come in two shapes (bare / prefixed) — see bxSessionMatch.
  const isTarget = (w) => BXCANVAS_WANT
    ? (w.id === BXCANVAS_WANT || w.id === "canvas|" + BXCANVAS_WANT)
    : (sn.active != null && (w.id === sn.active || w.id === "canvas|" + sn.active));
  for (const w of want) {
    if (!w.design) continue;
    const pr = bxTabOpenSaved(w.name, w.design, w.id, w.session);
    if (pr) { opened += 1; if (isTarget(w)) activeId = pr.id; }
  }
  if (opened) {
    bxTabStash();                              // the open screen belongs to its tab
    const blank = (BX.projects || []).find(x => !x.saved && !x.dirty &&
                  String(x.name || "").indexOf("New Project ") === 0);
    if (blank && BX.projects.length > 1) {     // the boot blank steps aside
      BX.projects = BX.projects.filter(x => x !== blank);
      if (BX.active === blank.id) BX.active = null;
    }
    const wantId = (activeId && bxProject(activeId)) ? activeId
                 : (bxProject() ? BX.active
                                : ((BX.projects[BX.projects.length - 1] || {}).id || null));
    if (wantId && wantId !== BX.active) {
      bxTabStash();                            // …and the one being left, too:
      BX.active = wantId;                      // a tab's doc lives in its own stash
      bxTabLoad(bxProject(wantId));
    } else {
      bxTabsRender();                          // the screen is already the right one
    }
  }
  BXSESSION.hold = false;
  return opened > 0;
}
let BXTAB = { msg: "", view: "main", cursor: 0 }; // the note, the switcher's view, its cursor
let bxTabSeq = 1;                              // the next "New Project N"

function bxProject(id) {
  const want = id === undefined ? BX.active : id;
  return (BX.projects || []).find(p => p.id === want) || null;
}
function bxTabsSay(msg) { BXTAB.msg = String(msg || ""); bxTabsRender(); }
function bxTabDirty() {                        // a change the server has not seen
  const p = bxProject();
  if (!p || p.dirty) return;
  p.dirty = true;
  bxTabsRender();
}
function bxTabStash() {                        // the screen's state → its tab
  const p = bxProject();
  if (!p) return null;
  if (p.kind === "ai") return p;               // a conversation has no canvas to stash
  p.doc = bxExportCanvas() || p.doc;           // top level: the whole canvas
  p.view = { cx: BX.view.cx, cy: BX.view.cy, k: BX.view.k };
  p.undo = bxUndoStack;
  p.redo = bxRedoStack;
  p.undoLast = bxUndoLast;
  return p;
}
function bxTabLoad(p, doc) {                   // a tab → the screen
  if (p && p.kind === "ai") {                  // a conversation, not a canvas
    bxTalkEnter(p);
    return true;
  }
  bxTalkLeave();
  const wasDirty = !!p.dirty;
  BX.up = null;                                // a canvas loads at the top level
  BX.stack = [];
  const text = JSON.stringify(doc || p.doc ||
                              { type: "canvas", version: 1, nodes: [], edges: [] });
  const ok = bxJSONApply(bxJSONRead(text, {}), {});
  if (!ok || !ok.ok) {
    bxTabsSay(String((ok && ok.error) || "that canvas cannot be opened"));
    return false;
  }
  if (p.undo) bxUndoStack = p.undo;            // the canvas keeps its own history
  else { bxUndoStack = [bxSnapshotNow()]; bxUndoLast = JSON.stringify(bxUndoStack[0]); }
  bxRedoStack = p.redo || [];
  if (p.undoLast != null) bxUndoLast = p.undoLast;
  if (p.view && p.view.cx != null)             // …and the camera it was left at
    BX.view = { cx: p.view.cx, cy: p.view.cy, k: p.view.k };
  bxSel = null;
  bxRunErr = null;
  BXRUN.last = null;                           // the verdict was the other tab's
  BXRUN.full_ms = null;
  BXRUN.timing = null;
  p.dirty = wasDirty;
  bxRender();
  bxTabsRender();
  return true;
}
function bxTabSelect(id) {
  if (id === BX.active || !bxProject(id)) return false;
  bxTabStash();
  BX.active = id;
  bxTabsSay("");                               // (the label the old build parked
  const ok = bxTabLoad(bxProject(id));         // here rode along for a while)
  if (ok) bxSessionPush();
  return ok;
}
function bxTabAnyDirty() {                     // any tab holding what the
  return (BX.projects || []).some(p => !!p.dirty);   // server has not seen
}                                              // (the page guard reads this)
function bxConfirm(msg) {                      // the browser's own question —
  return typeof confirm === "function" ? !!confirm(msg) : true;   // none in tests
}
function bxTabDrop(id) {                       // close without asking (the caller
  const p = bxProject(id);                     // already did), even the last one
  if (!p) return false;
  const wasActive = p.id === BX.active;
  BX.projects = (BX.projects || []).filter(x => x.id !== p.id);
  if (wasActive) {
    const next = BX.projects[BX.projects.length - 1];
    if (next) {                                // a neighbour keeps the screen
      BX.active = next.id;
      bxTabLoad(next);
    }
  }
  return true;
}
function bxTabClose(id) {                      // ×: close one project, asking
  const p = bxProject(id);                     // first when it holds unsaved work —
  if (!p) return false;                        // and never the last one: there is
  if ((BX.projects || []).length <= 1) return false;   // always one canvas open
  if (p.dirty && !bxConfirm("“" + p.name + "” has changes that are not "
                            + "saved — close it anyway?"))
    return false;
  bxTabDrop(id);
  bxTabsRender();
  bxSessionPush();
  return true;
}
// The × on a session row means the session, not half of it: a paired canvas
// asks the chat to remove the conversation and the canvas record (its link and
// its tab), then closes every open tab of that canvas here — including old
// duplicate tabs of the same canvas — so one click leaves nothing behind. A
// canvas with no chat, or a shell without the bridge, keeps the old meaning:
// close this tab.
function bxSessionRemove(p, conv) {
  const api = typeof window !== "undefined" ? window.__nnChat : null;
  if (!(conv && api && api.remove)) return bxTabClose(p.id);
  if (!bxConfirm("remove this session — its chat and its canvas?")) return false;
  // The conversation's own canvas id wins; an older pairing that never landed
  // on the conversation still knows its canvas on the tab.
  const bare = conv.canvasId ? bxBareCanvas(conv.canvasId)
             : (p.canvas ? bxBareCanvas(p.canvas) : "");
  const doomed = (BX.projects || []).filter(x => x.id === p.id ||
    (bare && x.canvas && bxBareCanvas(x.canvas) === bare));
  for (const x of doomed) bxTabDrop(x.id);
  if (!(BX.projects || []).length) bxTabNew();  // the Studio keeps one canvas
  api.remove(conv.id, bare || null);
  bxTabsRender();
  bxSessionPush();
  return true;
}
function bxSessionRemoveConv(conv) {            // the same × on a chat-only row
  const api = typeof window !== "undefined" ? window.__nnChat : null;
  if (!(conv && api && api.remove)) return false;
  if (!bxConfirm("remove this session — its chat and its canvas?")) return false;
  const bare = conv.canvasId ? bxBareCanvas(conv.canvasId) : "";
  if (bare) {
    const doomed = (BX.projects || []).filter(x => x.canvas && bxBareCanvas(x.canvas) === bare);
    for (const x of doomed) bxTabDrop(x.id);
    if (!(BX.projects || []).length) bxTabNew();
  }
  api.remove(conv.id, bare || null);
  bxTabsRender();
  bxSessionPush();
  return true;
}
// A fresh boot/blank canvas is an implementation detail, not a session: it is
// hidden from the session list while any chat session exists, and a new blank
// reuses it instead of minting another "New Project N".
function bxPristineBlank(p) {
  return !!p && p.kind !== "ai" && !p.saved && !p.dirty && p.session == null &&
         /^New Project \d+$/.test(String(p.name || ""));
}
function bxTabNew() {                          // a blank canvas, its own tab
  bxTabStash();
  // Only when a chat half exists: a new session adopts the idle boot blank
  // instead of making a second "New Project N". Two explicit blank canvases
  // (no chat yet) still get their own tabs.
  let p = (BXCHAT.convs || []).length
    ? (BX.projects || []).find(bxPristineBlank)
    : null;
  if (p) {                                     // reuse the empty canvas: no new name
    delete p.canvas;
    delete p.session;
    delete p.doc;
    delete p.undo;
    delete p.redo;
    delete p.view;
    p.dirty = false;
    p.saved = false;
  } else {
    p = { id: bxId(), name: "New Project " + (bxTabSeq++), dirty: false, saved: false };
    (BX.projects = BX.projects || []).push(p);
  }
  BX.active = p.id;
  BX.up = null;
  BX.stack = [];
  BX.nodes = [];
  BX.edges = [];
  BX.weights = {};
  BX.model = null;
  BX.view = { cx: null, cy: null, k: 1 };
  bxSeedBlank();                               // the blank skeleton, wired already
  bxUndoStack = [bxSnapshotNow()];
  bxUndoLast = JSON.stringify(bxUndoStack[0]);
  bxRedoStack = [];
  bxSel = null;
  p.dirty = false;                             // a fresh blank is nothing unsaved
  bxtDropsClose();
  bxRender();
  bxTabsRender();
  bxTabsSay("");
  bxSessionPush();
  return p;
}
function bxTabOpenSaved(name, doc, canvasId, session) { // a saved canvas → its own tab
  bxTabStash();
  const p = { id: bxId(), name: String(name || "saved canvas"),
              canvas: String(canvasId || ""),
              session: session != null ? String(session) : null,
              dirty: false, saved: true };
  (BX.projects = BX.projects || []).push(p);
  BX.active = p.id;
  if (!bxTabLoad(p, doc)) {
    BX.projects = BX.projects.filter(x => x !== p);
    BX.active = (BX.projects[BX.projects.length - 1] || {}).id || null;
    return null;
  }
  // A session's canvas is created by the chat half, which seals it before the
  // canvas half can seed anything. Give that empty pair the same default
  // input → output skeleton as a fresh canvas; a standalone design the user
  // emptied by hand is left alone. The skeleton is the base, so undo cannot
  // take it back to the empty record.
  if (p.session != null && bxSeedBlank()) {
    bxUndoStack = [bxSnapshotNow()];
    bxUndoLast = JSON.stringify(bxUndoStack[0]);
    bxRedoStack = [];
  }
  p.dirty = false;
  bxtDropsClose();
  bxTabsSay("");
  bxSessionPush();
  return p;
}
function bxTabNewAI() {                        // a conversation, its own tab
  bxTabStash();
  const p = { id: bxId(), kind: "ai", name: "AI agent", dirty: false, saved: false,
              talk: { turns: [], draft: "" } };
  (BX.projects = BX.projects || []).push(p);
  BX.active = p.id;
  bxTalkEnter(p);
  bxTabsRender();
  bxTabsSay("");
  bxSessionPush();
  return p;
}
function bxTabSave() {                         // Ctrl/Cmd+S, and the saved names
  const p = bxProject();
  if (!p) return false;
  if (p.kind === "ai") {
    bxTabsSay("this tab is a conversation, not a canvas \u2014 nothing to save");
    return false;
  }
  if (typeof fetch !== "function") { bxTabsSay("the app cannot reach the server to save"); return false; }
  if (!BXACCT.user) {
    bxTabsSay("saving takes an account \u2014 create one from the block at the top right");
    return false;
  }
  if (BXACCT.locked) {
    bxTabsSay("the account is locked \u2014 unlock it with your token to save");
    return false;
  }
  if (!p.saved) {                              // never saved: what name is this?
    let design = bxExportCanvas();
    if (!design) design = (bxTabStash() || {}).doc || null;   // saving from inside one
    if (!design) { bxTabsSay("come back out to the top level to save"); return false; }
    bxTabsSay("name this project \u2026");
    bxAccountSaveForm((name, id) => {          // the dialog seals and posts it
      if (!name) return;
      p.name = String(name);
      p.canvas = String(id || "");
      p.saved = true;
      p.dirty = false;
      bxTabsSay("saved · " + p.name + " ✓");
      bxTabsRender();
      bxSessionPush();
    }, design);
    return true;
  }
  let design = bxExportCanvas();
  if (!design) design = (bxTabStash() || {}).doc || null;
  if (!design) { bxTabsSay("come back out to the top level to save"); return false; }
  bxTabsSay("saving \u00b7 " + p.name + " \u2026");
  bxAccountSave(p.name, design, null, null, (name, id) => {
    p.canvas = String(id || "");
    p.dirty = false;
    bxTabsSay("saved · " + p.name + " ✓");
    bxTabsRender();
    bxSessionPush();
  }, p);
  return true;
}
// ---- the one shared shell: two mains, one sidebar and one top bar ----------
// The page hosts both halves. `BXVIEW.half` says which main area is up. The
// chat app (the vendored SPA) mounts in #nn-chat in its embedded mode and is
// driven through window.__nnChat; the canvas keeps running underneath, hidden.
// The sidebar lists one set of sessions for both views: an open canvas, the
// conversation bound to it, or a chat-only session.
const BXVIEW = { half: "studio" };
const BXCHAT = { loading: null, ready: false, convs: [], sig: "", landing: false, known: false };

