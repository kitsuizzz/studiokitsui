/**
 * The welcome screen, re-unified as a sandbox "logic" brain.
 *
 * Unlike the wall brain (which projects live conversation data pushed by the
 * host), the greeting brain is self-driven: it runs the title typewriter and
 * owns the onboarding state — the one choice step. It talks to the host only
 * through the bridge: `ai.render` (blocks), `ai.on` (user events) and
 * `ai.host` (new-session / auth).
 *
 * The welcome is the choice and nothing else: it carries no provider form.
 * "Continue as guest" always emits `ai.host("new-session")` — the door into
 * a fresh session, even when no model is configured yet. In that case the
 * host shows a warning dialog on the way in, and a send that goes ahead
 * anyway bounces back in the wall as the same note, in red.
 *
 * Account creation is the host's job, not the brain's: "Create an account"
 * calls `ai.host("auth", "signup")` to open the host's one-click sign-up
 * dialog. When the host confirms an account now exists it pushes `signedIn`
 * through ctx, and the brain drops the account button (a signed-in user has
 * nothing to create) and stays on the choice step — the host routes
 * signed-in users itself (reopening their conversation, or starting a fresh
 * one); the choice step is what a signed-in user with no provider yet sees.
 *
 * A 600 ms timer boots the normal flow if the host never answers.
 *
 * The source is one flat string with no `${` and no backticks, so it can be
 * embedded verbatim in the iframe's <script> and shown in the Code pane.
 */
export const greetingSource = `
var TITLE = "One place for every task";
var SUBTITLE = "Take the most advantage of generative AI";
// The speed sits just above the host's 33ms render throttle, so no frame is
// dropped and the animation runs at the intended pace.
var TYPE_SPEED_MS = 45;

// --- onboarding state ---------------------------------------------------------
var typed = "";
var typeTimer = null;
var booted = false;
var bootTimer = null;
// The host's account state: a signed-in user has no account to create.
var signedIn = false;

var reducedMotion = (function () {
  try {
    return typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch (e) { return false; }
})();

function stopTitleTimers() {
  if (typeTimer) { clearInterval(typeTimer); typeTimer = null; }
}

// --- block builders -----------------------------------------------------------
function btn(label, to, ghost, disabled) {
  var b = { type: "button", label: label, to: to };
  if (ghost) b.variant = "ghost";
  if (disabled) b.disabled = true;
  return b;
}
function mkGroup(className, key, blocks) {
  var b = { type: "group", className: className, blocks: blocks };
  if (key) b.key = key;
  return b;
}

// --- render -------------------------------------------------------------------
// The head is emitted separately so the frame can keep it mounted (the
// typewriter keeps running) while the body group carries the step.
function render() {
  var head = { type: "greetinghead", title: typed, sub: SUBTITLE };
  var actions = [];
  // A signed-in user has no account to create; for them the choice step is
  // only the door into a session (with no model yet, the host warns and
  // points to Settings on the way in).
  if (!signedIn) actions.push(btn("Create an account", "signup", false, false));
  actions.push(btn("Continue as guest", "chat", true, false));
  var body = mkGroup("greeting-prompt", "choice", [
    mkGroup("greeting-actions", null, actions)
  ]);
  ai.render({ blocks: [head, body] });
}

// --- title typewriter ----------------------------------------------------------
function typeOut(text, speed) {
  if (reducedMotion) { typed = text; render(); return; }
  stopTitleTimers();
  typed = "";
  render();
  var i = 0;
  typeTimer = setInterval(function () {
    i += 1;
    typed = text.slice(0, i);
    render();
    if (i >= text.length) { clearInterval(typeTimer); typeTimer = null; }
  }, speed);
}

function boot() {
  if (booted) return;
  booted = true;
  if (bootTimer) { clearTimeout(bootTimer); bootTimer = null; }
  if (reducedMotion) { typed = TITLE; render(); }
  else typeOut(TITLE, TYPE_SPEED_MS);
}

// --- event routing -------------------------------------------------------------
ai.on("click", function (arg, blockType) {
  if (blockType !== "button") return;
  // Account creation is the host's job (its one-click sign-up dialog); the
  // brain stays put and re-renders when the host confirms an account exists.
  if (arg === "Create an account") { ai.host("auth", "signup"); }
  else if (arg === "Continue as guest") {
    // Always the door into a fresh session. With no model configured yet the
    // host shows a warning dialog on the way in, and a send that goes ahead
    // anyway bounces back in the wall as the same note, in red.
    ai.host("new-session");
  }
});
ai.on("ctx", function (data) {
  // The host's account state: a signed-in user has no account to create, so
  // a flip re-renders the choice step (it changes which buttons it shows).
  if (data && typeof data.signedIn === "boolean" && data.signedIn !== signedIn) {
    signedIn = data.signedIn;
    if (booted) render();
  }
  boot();
});
bootTimer = setTimeout(boot, 600);
ai.ready();
`;
