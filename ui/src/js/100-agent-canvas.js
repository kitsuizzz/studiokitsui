// ─── nnstudio shell · 100 · the agent canvas ─────────────────────────────────────
// the conversation that replaces the drawing in an AI agent box.
// Order is load-bearing: this slice is concatenated after the one before it.

// ---- the AI agent canvas: a conversation, not a canvas ----------------------
// The ⌘K switcher opens it beside the canvases. Its surface is the
// reverse-engineering agent, spoken to: every message is one `chat` task, the
// agent's stream folds into the thread as it writes, and the CLI session the
// first turn creates is carried into the next — so the conversation remembers.
// There is no canvas under it: the palette, Import and VRAM are off while it
// is the active canvas.
function bxTalkOn() {
  const p = bxProject();
  return !!(p && p.kind === "ai");
}
function bxTalkBody(p) {
  return (p.talk = p.talk || { turns: [], draft: "" });
}
function bxTalkTask() {                        // the thread's last agent turn
  const p = bxProject();
  if (!p || p.kind !== "ai") return null;
  const turns = bxTalkBody(p).turns;
  for (let i = turns.length - 1; i >= 0; i--)
    if (turns[i].who === "agent" && turns[i].task) return bxTask(turns[i].task);
  return null;
}
function bxTalkCurrent() {                     // …when it is the one running now
  const t = bxTalkTask();
  return t && (t.status === "running" || t.status === "paused") ? t : null;
}
function bxTalkEnter(p) {
  BX.up = null;                                // no canvas on this tab at all
  BX.stack = [];
  bxSel = null;
  bxRunErr = null;
  BX.nodes = [];
  BX.edges = [];
  BX.weights = {};
  BX.model = null;
  BX.view = { cx: null, cy: null, k: 1 };
  bxUndoStack = [];
  bxRedoStack = [];
  const talk = $("bxtalk"), host = $("bxcanvas");
  if (host) host.hidden = true;                // the talk takes the canvas's place
  if (talk) talk.hidden = false;
  bxtDropsClose();
  bxTalkRender(p);
  bxRender();
  bxTabsRender();
  bxtRefresh();
}
function bxTalkLeave() {
  const talk = $("bxtalk"), host = $("bxcanvas");
  if (talk) talk.hidden = true;
  if (host) host.hidden = false;
  bxtRefresh();
}
function bxTalkSend(p) {                       // one message = one chat task
  p = p || bxProject();
  if (!p || p.kind !== "ai") return false;
  const talk = bxTalkBody(p);
  const text = String(talk.draft || "").trim();
  if (!text) return false;
  if (bxTalkCurrent()) return false;           // one turn at a time
  const prev = bxTalkTask();                   // the session the last turn opened
  const session = (prev && (prev.meta || {}).session) || null;
  const params = { message: text };
  if (session) params.session = String(session);
  talk.draft = "";
  talk.turns.push({ who: "you", text });
  bxTalkRender(p);
  if (typeof fetch !== "function") {
    talk.turns.push({ who: "error", text: "the app cannot reach the server" });
    return bxTalkRender(p), true;
  }
  bxTaskStart("chat", params, (task, why) => {
    if (!task) {
      talk.turns.push({ who: "error", text: why || "the turn could not start" });
      bxTalkRender(p);
      return;
    }
    talk.turns.push({ who: "agent", task: task.id });
    bxAgentTick(true);                         // pull the stream from now on
    bxTalkRender(p);
  });
  return true;
}
function bxTalkRender(p) {                     // the thread, the head, the composer
  p = p || bxProject();
  const host = $("bxtalk");
  if (!host || !p || p.kind !== "ai" || host.hidden) return false;
  const talk = bxTalkBody(p);
  const old = host.querySelector ? host.querySelector(".bxtalkbody") : null;
  const stick = !old || old.scrollTop + (old.clientHeight || 0) >=
                       (old.scrollHeight || 0) - 40;
  if (host.children) host.children.length = 0;
  host.innerHTML = "";
  const wrap = mk("div", { class: "bxtalkwrap" });
  const cur = bxTalkCurrent();
  const head = mk("div", { class: "bxphead" });
  head.appendChild(mk("span", { class: "bxptitle", text: "reverse engineering agent" }));
  head.appendChild(mk("span", { class: "bxchip " + (cur ? cur.status : "none"),
                                text: cur ? bxTaskChip(cur)
                                          : (talk.turns.length ? "" : "not started") }));
  if (cur)
    head.appendChild(mk("span", { class: "bxbbtn", text: "stop",
                                  title: "stop this turn",
                                  onclick: () => bxTaskCmd(cur.id, "cancel",
                                                           { reason: "stopped by you" },
                                                           () => bxTalkRender(p)) }));
  head.appendChild(mk("span", { class: "bxbhint",
                                text: "the whole conversation is one session \u2014 "
                                    + "every message continues it" }));
  wrap.appendChild(head);
  const body = mk("div", { class: "bxpbody bxtalkbody" });
  if (!talk.turns.length) {
    body.appendChild(mk("div", { class: "bxbhint",
      text: "say hello, or name a repo to reverse engineer \u2014 e.g. "
          + "\u201creverse engineer Qwen/Qwen2.5-0.5B\u201d. The agent reads the "
          + "family's source, inspects the repo's tensors and writes the spec; "
          + "ask it why afterwards." }));
  }
  for (const turn of talk.turns) {
    if (turn.who === "you") {
      const row = mk("div", { class: "bxtitem you" });
      row.appendChild(mk("div", { class: "bxtwho", text: "you" }));
      row.appendChild(mk("div", { class: "bxtsay", text: turn.text }));
      body.appendChild(row);
      continue;
    }
    if (turn.who === "error") {
      const row = mk("div", { class: "bxtitem agent" });
      row.appendChild(mk("div", { class: "bxtwho", text: "app" }));
      row.appendChild(mk("div", { class: "bxperr", text: turn.text }));
      body.appendChild(row);
      continue;
    }
    const t = bxTask(turn.task);
    const row = mk("div", { class: "bxtitem agent" });
    row.appendChild(mk("div", { class: "bxtwho",
      text: "agent" + (t ? " \u00b7 " + bxTaskChip(t) : "") }));
    const st = bxLogState(turn.task);
    for (const it of st.items.slice(-400)) {
      const line = mk("div", { class: "bxpitem " + it.kind });
      line.appendChild(mk("span", { class: it.kind === "do" ? "bxpdo"
                                    : it.kind === "step" ? "bxpstep"
                                    : it.kind === "error" ? "bxperr" : "bxpsay",
                                    text: it.text }));
      row.appendChild(line);
    }
    const live = t && (t.status === "running" || t.status === "paused");
    if (live && !st.items.length)
      row.appendChild(mk("div", { class: "bxbhint", text: "working \u2026" }));
    if (t && t.status === "done" && t.outcome === "failed") {
      const why = (t.meta && (t.meta.detail || t.meta.error)) || "the turn failed";
      row.appendChild(mk("div", { class: "bxperr", text: why }));
    }
    body.appendChild(row);
  }
  wrap.appendChild(body);
  const foot = mk("div", { class: "bxtalkfoot" });
  const inp = mk("textarea", { class: "bxtalkin", spellcheck: "false",
                                placeholder: cur
                                  ? "the agent is working \u2014 wait, or stop it above"
                                  : "reverse engineer org/name \u2014 or ask anything \u2026",
                                value: talk.draft || "" });
  inp.addEventListener("input", () => { talk.draft = inp.value; });
  inp.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && !ev.shiftKey) {
      if (ev.preventDefault) ev.preventDefault();
      bxTalkSend(p);
    }
  });
  foot.appendChild(inp);
  const send = mk("span", { class: "chip tiny", text: "send",
                            title: "Enter sends \u00b7 Shift+Enter makes a new line" });
  if (cur && send.classList) send.classList.add("off");
  send.addEventListener("click", () => bxTalkSend(p));
  foot.appendChild(send);
  wrap.appendChild(foot);
  host.appendChild(wrap);
  if (body.scrollTop != null)
    body.scrollTop = stick ? (body.scrollHeight || 0) : (talk.scroll || 0);
  if (body.addEventListener)
    body.addEventListener("scroll", () => { talk.scroll = body.scrollTop; });
  if (!cur && inp.focus) inp.focus();
  return true;
}
function bxTalkSync() {                        // a log/list poll landed: repaint
  if (bxTalkOn()) bxTalkRender(bxProject());
}

// ---- the Backend menu: two dropdowns, their instructions inside ------------
// The heavy work does not run in this page: Local dispatches to a connector on
// your own machine, Remote launches on your own Modal account with your key.
// Both are instructions and settings for now — the transport comes later.
let BX_BACKEND = { mode: "local", key: "" };
let bxbOpen = null;                            // which backend section is dropped down

