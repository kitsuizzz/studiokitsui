// ─── nnstudio shell · 85 · account and crypto ─────────────────────────────────────
// keys, the sealed store, canvas records, sign-in/up/unlock, and the account menu.
// Order is load-bearing: this slice is concatenated after the one before it.

/** True when WebCrypto and TextEncoder/Decoder exist (a secure origin). */
function bxCryptoReady() {
  return typeof crypto !== "undefined" && !!crypto.subtle && !!crypto.getRandomValues &&
         typeof TextEncoder === "function" && typeof TextDecoder === "function";
}
function bxUtf8(s) { return new TextEncoder().encode(String(s)); }
function bxB64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function bxUnb64(text) {
  const bin = atob(String(text));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bxHex(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, "0");
  return s;
}
// the session hint, shared with the Chat half (one origin): the cookie itself
// is HttpOnly, so this only says "a sign-in may be live" — /chat/auth/me has
// the last word
function bxSessionHint() {
  try { return localStorage.getItem("nnstudio_account") === "1"; } catch (e) { return false; }
}
function bxSessionMark() {
  try { localStorage.setItem("nnstudio_account", "1"); } catch (e) {}
}
function bxSessionClear() {
  try { localStorage.removeItem("nnstudio_account"); } catch (e) {}
}
// The flow, in one place:
//
//   guests   always arrive on the landing page (the Chat half's welcome),
//            where Chat and Studio are both a click away — so this page, when
//            it is the front door (`/`), sends every guest there;
//   accounts always arrive wherever they left off last time, which is the
//            account's own `place` record in its store — on the backend, so
//            it follows the account to any device. The one record the app
//            keeps unsealed: routing must work before a key is entered, and
//            "which half" is metadata, not content.
//
// `location.pathname` decides: `/` (and `/index.html`) is the door and routes;
// `/studio` is the canvas itself and never bounces (the landing's Studio
// choice, and the switch's Studio link, both land there).
function bxAtDoor() {
  if (typeof location === "undefined" || !location.pathname) return true;
  const p = String(location.pathname);
  return p === "/" || p === "/index.html";
}
function bxGo(path) {
  if (typeof location !== "undefined" && location.replace) location.replace(path);
}
function bxPlaceRow(rows) {                    // {"half": "chat"|"studio"} from the store
  const row = (rows || []).find(r => r.id === "current");
  if (!row) return "";
  try {
    const v = JSON.parse(String(row.blob || ""));
    return String((v && v.half) || "");
  } catch (e) {
    return "";
  }
}
function bxPlaceNow(half) {                    // where this account is, for the backend
  if (typeof fetch !== "function" || !BXACCT.user) return;
  const blob = JSON.stringify({ half: half, at: new Date().toISOString() });
  fetch("/chat/auth/store/sync", { method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ place: { upserts: [{ id: "current", blob: blob }], deletes: [] } }) })
    .catch(() => {});                          // best-effort: never blocks the app
}
function bxNewKey() {                          // the access key the browser mints
  const bytes = new Uint8Array(32);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return BX_KEY_PREFIX + bxB64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function bxHandle(key) { return String(key || "").slice(BX_KEY_PREFIX.length,
                                                        BX_KEY_PREFIX.length + 6); }
async function bxCredential(key) {             // what the server is allowed to see
  return bxHex(new Uint8Array(await crypto.subtle.digest("SHA-256", bxUtf8(key))));
}
/**
 * Derive the record key from an access key: HKDF(SHA-256, salt "aistudio:e2e:v1",
 * info "conversations") -> non-extractable AES-GCM key. This must stay
 * byte-identical to the Chat half's lib/crypto.ts deriveEncKey.
 */
async function bxDataKey(key) {                // the record key: Chat's deriveEncKey
  const material = await crypto.subtle.importKey("raw", bxUtf8(key), "HKDF", false,
                                                 ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: bxUtf8(BX_E2E.salt), info: bxUtf8(BX_E2E.info) },
    material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
/**
 * Seal a JSON value under a record key. The record id is the AAD, and the
 * result is base64(iv || AES-GCM ciphertext); a fresh IV is used every time.
 */
async function bxSealRecord(key, aad, value) { // base64(iv ‖ ct), bound to its record
  const iv = crypto.getRandomValues(new Uint8Array(12));
  // An absent AAD is *absent*, not undefined: Chrome rejects a present
  // `additionalData: undefined` ("Not a BufferSource"), so the member only
  // exists when there is one (an unbound record seals exactly as before).
  const params = { name: "AES-GCM", iv: iv };
  if (aad) params.additionalData = bxUtf8(aad);
  const ct = await crypto.subtle.encrypt(params, key, bxUtf8(JSON.stringify(value)));
  const out = new Uint8Array(iv.length + ct.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(ct), iv.length);
  return bxB64(out);
}
/** Open a sealed record with its AAD; throws when the key or binding is wrong. */
async function bxOpenRecord(key, aad, blob) {
  const raw = bxUnb64(blob);
  if (raw.length <= 12) throw new Error("malformed record");
  const params = { name: "AES-GCM", iv: raw.subarray(0, 12) };
  if (aad) params.additionalData = bxUtf8(aad);
  const pt = await crypto.subtle.decrypt(params, key, raw.subarray(12));
  return JSON.parse(new TextDecoder().decode(pt));
}
// the shared key cache: the "aistudio" IndexedDB the Chat half opens (same
// version, same stores) — a non-extractable key, usable but never readable
function bxKeyDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("no IndexedDB")); return; }
    const req = indexedDB.open(BX_E2E.db, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
      if (!db.objectStoreNames.contains("keys")) db.createObjectStore("keys");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("IndexedDB open failed"));
  });
}
function bxKeyGet(userId) {
  return bxKeyDb().then(db => new Promise((resolve) => {
    try {
      const req = db.transaction("keys", "readonly").objectStore("keys").get(userId);
      req.onsuccess = () => { db.close(); resolve(req.result || null); };
      req.onerror = () => { db.close(); resolve(null); };
    } catch (e) { db.close(); resolve(null); }
  }), () => null);
}
function bxKeyPut(userId, key) {
  return bxKeyDb().then(db => new Promise((resolve) => {
    try {
      const tx = db.transaction("keys", "readwrite");
      tx.objectStore("keys").put(key, userId);
      tx.oncomplete = () => { db.close(); resolve(true); };
      tx.onerror = () => { db.close(); resolve(false); };
      tx.onabort = () => { db.close(); resolve(false); };
    } catch (e) { db.close(); resolve(false); }
  }), () => false);
}
function bxKeyDrop(userId) {
  return bxKeyDb().then(db => new Promise((resolve) => {
    try {
      const tx = db.transaction("keys", "readwrite");
      tx.objectStore("keys").delete(userId);
      tx.oncomplete = () => { db.close(); resolve(true); };
      tx.onerror = () => { db.close(); resolve(false); };
      tx.onabort = () => { db.close(); resolve(false); };
    } catch (e) { db.close(); resolve(false); }
  }), () => false);
}
function bxTurnstileLoad(cb) {                 // the widget script, fetched once
  if (typeof window === "undefined") return cb(null);
  if (window.turnstile) return cb(window.turnstile);
  if (BX_TS.failed) return cb(null);
  if (BX_TS.queue) { BX_TS.queue.push(cb); return; }
  BX_TS.queue = [cb];
  const done = (ts) => {
    const q = BX_TS.queue || [];
    BX_TS.queue = null;
    if (!ts) BX_TS.failed = true;
    for (const fn of q) { try { fn(ts); } catch (e) {} }
  };
  if (typeof document === "undefined" || !document.createElement) return done(null);
  const s = document.createElement("script");
  s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=__bxTurnstileUp";
  s.async = true;
  window.__bxTurnstileUp = () => done(window.turnstile || null);
  s.onerror = () => done(null);
  if (document.head) document.head.appendChild(s);
  else if (document.body) document.body.appendChild(s);
  if (typeof setTimeout === "function")
    setTimeout(() => { if (BX_TS.queue) done(window.turnstile || null); }, 10000);
}
function bxSplash(show, note) {                // the boot veil: up while the
  const el = $("bxsplash");                    // session's tabs are on their way,
  if (!el) return;                             // down the moment they are (or the
  if (note) {                                  // answer is "there are none")
    const n = $("bxsplashnote");
    if (n) n.textContent = String(note);
  }
  el.hidden = !show;
}
function bxAccountLoad() {                     // who is this, and where do they belong
  try { localStorage.removeItem("nnstudio_token"); } catch (e) {}   // the old root token
  if (typeof fetch !== "function") {           // no server to ask: a guest, that is that
    BXACCT.known = true;
    bxAccountSync();
    if (bxAtDoor()) bxGo("/chat");             // guests arrive on the landing page
    return;
  }
  // the sign-up dialog's needs (the robot check and its public site key)
  fetch("/chat/auth/config").then(r => r.json()).then(d => {
    if (!d) return;
    BXACCT.site = d.site_key || "";
    BXACCT.captcha = !!d.captcha;
  }).catch(() => {});
  if (!bxSessionHint() && !bxAtDoor()) {       // the canvas, no session to ask about
    BXACCT.known = true;
    bxAccountSync();
    return;
  }
  // The door asks the server (a live cookie may have no hint): a guest is sent
  // to the landing page, an account to the half it left off in. An unreachable
  // server routes nobody.
  fetch("/chat/auth/me").then(r => r.json().then(d => ({ ok: r.ok, d: d })))
    .then(({ ok, d }) => {
      BXACCT.known = true;
      if (!ok || !d || !d.user) {              // the hint outlived the session
        bxSessionClear();
        bxAccountSync();
        if (bxAtDoor()) bxGo("/chat");         // a guest: the landing page is the door
        return;
      }
      return bxAccountSignedIn(d.user);        // the key comes from the cache
    })
    .catch(() => { BXACCT.known = true; bxAccountSync(); });
}
async function bxAccountSignedIn(user) {
  BXACCT.known = true;
  BXACCT.user = user || null;
  BXACCT.name = (user && user.name) || "";
  BXACCT.key = null;
  if (BXACCT.user) bxSessionMark();
  if (BXACCT.user) {
    try { BXACCT.key = await bxKeyGet(BXACCT.user.id); } catch (e) {}
  }
  BXACCT.locked = !!BXACCT.user && !BXACCT.key;
  if (BXACCT.user && bxAtDoor()) {
    // An account arrives wherever it left off: the backend's place record
    // decides, and the canvas is both the fallback and the answer when the
    // record cannot be read.
    let half = "";
    try {
      const store = await bxStoreRead();
      half = bxPlaceRow((store || {}).place);
    } catch (e) {}
    if (half === "chat") { bxGo("/chat"); return; }
    bxPlaceNow("studio");                      // the door resolved to the canvas
  } else if (BXACCT.user) {
    bxPlaceNow(BXVIEW.half);                   // whichever main is up
  }
  bxAccountSync();
  if (!BXSESSION.restored) {                   // the canvases come back where they
    BXSESSION.restored = true;                 // were — once per page
    bxSessionRestore().then(() => { bxSplash(false); bxSessionPush(); })
                      .catch(() => bxSplash(false));
  } else {
    bxSplash(false);
  }
}
function bxAccountOut() {
  BXACCT.known = true;                         // a logout is a known guest
  BXACCT.user = null;
  BXACCT.name = "";
  BXACCT.key = null;
  BXACCT.locked = false;
  bxAccountSync();
}
function bxAccountSync() {
  const wrap = $("bxuser");
  const b = $("bxtAccount");
  const nm = $("bxuname");
  const av = $("bxuavatar");
  if (!b || !nm) return;
  if (wrap) wrap.hidden = !BXACCT.known;       // nothing until the guest is confirmed
  if (!BXACCT.known) return;
  b.className = "bxuserbtn";
  const guestIcon = '<svg class="bxuico" viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
  if (av) {
    if (BXACCT.user) {
      av.className = "bxuavatar";
      av.textContent = String(BXACCT.name || "?").trim().charAt(0).toUpperCase() || "?";
    } else {
      av.className = "bxuavatar guest";
      av.innerHTML = guestIcon;
    }
  }
  if (!BXACCT.user) {
    bxSplash(false);                           // a guest has no session to wait for
    nm.textContent = "Guest";
    b.title = "a guest: drawing and running are free, saving takes an account";
    return;
  }
  if (BXACCT.locked) {
    bxSplash(false);                           // locked: nothing can be unsealed
    nm.textContent = BXACCT.name;
    b.title = "signed in — paste your access key once so this browser can read your designs";
    b.className = "bxuserbtn locked";
    return;
  }
  nm.textContent = BXACCT.name;
  b.title = "signed in — designs are sealed in this browser; the server holds only ciphertext";
}
function bxtAccountToggle() {
  const m = $("bxtAccountMenu");
  if (!m) return false;
  const open = !!m.hidden;
  bxtDropsClose("bxtAccountMenu");
  BXACCT.confirmingOut = false;                // the two-step sign-out starts over
  bxAccountBuild();                            // the items depend on who is here
  m.hidden = !open;
  if (open) bxtPlace("bxtAccountMenu", "bxtAccount");
  return open;
}
function bxAccountBuild() {
  const m = $("bxtAccountMenu");
  if (!m) return;
  m.innerHTML = "";
  const note = () => {
    const p = mk("p", { class: "accnote" });
    m.appendChild(p);
    return p;
  };
  const btn = (text, cls, fn) => {
    const b = mk("button", { class: "accbtn" + (cls ? " " + cls : ""), text,
                             type: "button" });
    b.addEventListener("click", fn);
    m.appendChild(b);
    return b;
  };
  const close = () => bxtDropsClose();
  if (!BXACCT.user) {
    note().textContent =
      "You\u2019re browsing as a guest. Create an account to keep signing in as yourself.";
    btn("Create an account", "", () => { close(); bxShellAuth("signup"); });
    btn("Sign in", "ghost", () => { close(); bxShellAuth("signin"); });
    return;
  }
  const p = note();
  p.appendChild(document.createTextNode("Signed in as "));
  p.appendChild(mk("strong", { text: BXACCT.name }));
  if (BXACCT.user.role === "admin") p.appendChild(mk("span", { class: "accrole", text: "Admin" }));
  if (BXACCT.locked) {
    p.appendChild(document.createTextNode(" \u2014 this browser holds no key, so your saved work is locked."));
    btn("Unlock with your access key", "", () => { close(); bxShellAuth("signin"); });
  }
  if (BXACCT.confirmingOut) {
    const q = mk("p", { class: "accconfirm", text: "Are you sure?" });
    m.appendChild(q);
    btn("Yes, I'm sure, let me out.", "danger", () => {
      BXACCT.confirmingOut = false;
      close();
      bxAccountLogout();
    });
  } else {
    btn("Sign out", "ghost", () => { BXACCT.confirmingOut = true; bxAccountBuild(); });
  }
}
function bxAccountLogout() {
  if (typeof fetch === "function")
    fetch("/chat/auth/signout", { method: "POST" }).catch(() => {});
  if (BXACCT.user && BXACCT.user.id) bxKeyDrop(BXACCT.user.id);
  bxSessionClear();
  bxAccountOut();
  // Both mains share the account now: reboot on the guest shell.
  if (typeof location !== "undefined" && location.reload) location.reload();
}
function bxAccountForm() {                     // #bxmenu, centered like the import
  const m = $("bxmenu");
  if (!m) return null;
  m.innerHTML = "";
  const wrap = mk("div", { class: "bf bxacct" });
  m.appendChild(wrap);
  m.hidden = false;
  return wrap;
}
function bxAccountPlace() {
  const m = $("bxmenu");
  if (!m) return;
  const w = $("bxwrap");
  const r = (w && w.getBoundingClientRect) ? w.getBoundingClientRect()
                                           : { width: 900, height: 500 };
  bxMenuAt_(Math.max(6, ((r.width || 900) - (m.offsetWidth || 360)) / 2),
            Math.max(6, ((r.height || 500) - (m.offsetHeight || 200)) / 2));
  bxMenuPlace();
}
function bxAccountRow(wrap, goText, goFn) {
  const row = mk("div", { class: "row" });
  const cancel = mk("span", { class: "chip tiny", text: "cancel" });
  cancel.addEventListener("click", bxMenuClose);
  const go = mk("span", { class: "chip tiny", text: goText });
  go.addEventListener("click", () => goFn(go));
  row.appendChild(cancel);
  row.appendChild(go);
  wrap.appendChild(row);
  return go;
}
function bxAccountNameField(defaultName) {
  const lab = mk("label", { text: "name" });
  const inp = mk("input", { class: "bxinp", type: "text", autocomplete: "off",
                            placeholder: "a name for this canvas" });
  inp.value = defaultName || "";
  lab.appendChild(inp);
  return { lab, inp };
}
function bxAccountCreate() {
  const wrap = bxAccountForm();
  if (!wrap) return false;
  wrap.appendChild(mk("div", { class: "mhead", text: "create an account" }));
  wrap.appendChild(mk("div", { class: "panehint",
    text: "one account for both halves of the app — the Studio and the Chat. " +
          "It issues an access key, shown exactly once: it is the login and the " +
          "only key to your saved designs." }));
  const status = mk("div", { class: "panehint", text: "" });
  const mount = mk("div", { class: "bxcf" });
  wrap.appendChild(status);
  wrap.appendChild(mount);
  let challenge = "";
  const go = bxAccountRow(wrap, "create", () => submit());
  const submit = () => {
    if (BXACCT.captcha && BXACCT.site && !challenge) {
      status.textContent = "the bot check has not passed yet";
      return;
    }
    bxAccountRegister(challenge, status, go);
  };
  const start = (ts) => {
    if (!ts) { status.textContent = "the bot check could not load — an account needs it"; return; }
    try {
      BX_TS.widget = ts.render(mount, {
        sitekey: BXACCT.site,
        callback: (cf) => {
          challenge = cf;
          status.textContent = "bot check passed";
          bxAccountPlace();
        },
        "error-callback": () => {
          challenge = "";
          status.textContent = "the bot check failed — try again";
        },
        "expired-callback": () => {
          challenge = "";
          status.textContent = "the bot check expired — it will rerun";
        },
      });
      status.textContent = "waiting for the bot check …";
    } catch (e) {
      status.textContent = "the bot check could not start";
    }
    bxAccountPlace();
  };
  bxAccountPlace();
  if (!bxCryptoReady()) {
    status.textContent = "this browser or origin has no WebCrypto — the sealing needs " +
                         "http://localhost or https";
    return true;
  }
  if (BXACCT.captcha && BXACCT.site) {
    if (typeof window !== "undefined" && window.turnstile) start(window.turnstile);
    else bxTurnstileLoad(start);
  } else {
    status.textContent = "no bot check on this deployment";
  }
  return true;
}
async function bxAccountRegister(challenge, status, go) {
  if (typeof fetch !== "function") return false;
  if (!bxCryptoReady()) { if (status) status.textContent = "this browser cannot seal"; return false; }
  if (go) go.textContent = "creating …";
  const key = bxNewKey();                      // made here, in the browser
  try {
    const r = await fetch("/chat/auth/signup", { method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credential: await bxCredential(key),
                             handle: bxHandle(key),
                             captcha: challenge || "" }) });
    const d = await r.json().catch(() => null);
    if (!r.ok || !d || !d.user) throw new Error((d && d.detail) || "the server refused");
    await bxKeyPut(d.user.id, await bxDataKey(key));   // the cache both halves use
    await bxAccountSignedIn(d.user);
    bxAccountReveal(key, BXACCT.name);
  } catch (e) {
    if (go) go.textContent = "create";
    if (status) status.textContent = String((e && e.message) || e);
    if (typeof window !== "undefined" && window.turnstile && BX_TS.widget !== null) {
      try { window.turnstile.reset(BX_TS.widget); } catch (err) {}
    }
    bxAccountPlace();
  }
  return true;
}
function bxAccountReveal(key, name) {
  const wrap = bxAccountForm();
  if (!wrap) return false;
  wrap.appendChild(mk("div", { class: "mhead", text: "your access key" }));
  wrap.appendChild(mk("div", { class: "panehint",
    text: (name ? name + " is in. " : "") +
          "It is shown once. It is the login to both halves of the app, and it is " +
          "the only key to your saved designs — the server never sees it, so losing " +
          "it loses them." }));
  const ta = mk("textarea", { class: "bxtok", readonly: "readonly", spellcheck: "false" });
  ta.value = key;
  wrap.appendChild(ta);
  const row = mk("div", { class: "row" });
  const copy = mk("span", { class: "chip tiny", text: "copy" });
  copy.addEventListener("click", () => {
    let done = false;
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
        const p = navigator.clipboard.writeText(key);
        if (p && p.catch) p.catch(() => {});
        done = true;
      }
    } catch (e) {}
    if (!done && ta.select) { try { ta.select(); } catch (e) {} }
    copy.textContent = done ? "copied" : "select all";
  });
  const fin = mk("span", { class: "chip tiny", text: "done" });
  fin.addEventListener("click", bxMenuClose);
  row.appendChild(copy);
  row.appendChild(fin);
  wrap.appendChild(row);
  bxAccountPlace();
  return true;
}
function bxAccountLogin() {
  const wrap = bxAccountForm();
  if (!wrap) return false;
  wrap.appendChild(mk("div", { class: "mhead", text: "log in with your access key" }));
  wrap.appendChild(mk("div", { class: "panehint",
    text: "an account shows its access key once, when it is created — paste that " +
          "here. It never leaves this browser: it authenticates and it decrypts." }));
  const lab = mk("label", { text: "access key" });
  const inp = mk("input", { class: "bxinp", type: "password", autocomplete: "off",
                            placeholder: "ast_…" });
  lab.appendChild(inp);
  wrap.appendChild(lab);
  const status = mk("div", { class: "panehint", text: "" });
  wrap.appendChild(status);
  const go = bxAccountRow(wrap, "log in", (btn) => {
    const key = String(inp.value || "").trim();
    if (!key) { status.textContent = "the access key is empty"; return; }
    if (typeof fetch !== "function") { status.textContent = "the app cannot reach the server"; return; }
    if (!bxCryptoReady()) { status.textContent = "this browser or origin has no WebCrypto"; return; }
    btn.textContent = "checking …";
    (async () => {
      const r = await fetch("/chat/auth/signin", { method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credential: await bxCredential(key) }) });
      const d = await r.json().catch(() => null);
      if (!r.ok || !d || !d.user)
        throw new Error((d && d.detail) || "that access key is not an account");
      await bxKeyPut(d.user.id, await bxDataKey(key));
      await bxAccountSignedIn(d.user);
      bxMenuClose();
    })().catch(e => {
      btn.textContent = "log in";
      status.textContent = String((e && e.message) || e);
      bxAccountPlace();
    });
  });
  bxAccountPlace();
  return true;
}
function bxAccountUnlockForm() {
  const wrap = bxAccountForm();
  if (!wrap) return false;
  wrap.appendChild(mk("div", { class: "mhead", text: "unlock your designs" }));
  wrap.appendChild(mk("div", { class: "panehint",
    text: "the access key is the key. The server never had it — this browser just " +
          "needs to be told it again." }));
  const lab = mk("label", { text: "access key" });
  const inp = mk("input", { class: "bxinp", type: "password", autocomplete: "off",
                            placeholder: "the key your account showed you" });
  lab.appendChild(inp);
  wrap.appendChild(lab);
  const status = mk("div", { class: "panehint", text: "" });
  wrap.appendChild(status);
  const go = bxAccountRow(wrap, "unlock", (btn) => {
    const key = String(inp.value || "").trim();
    if (!key) { status.textContent = "the access key is empty"; return; }
    if (!bxCryptoReady()) { status.textContent = "this browser or origin has no WebCrypto"; return; }
    const user = BXACCT.user;
    if (!user) { status.textContent = "there is nothing locked here"; return; }
    btn.textContent = "checking …";
    (async () => {
      const cryptoKey = await bxDataKey(key);
      const rows = await bxCanvasRecords();    // a wrong key must not pass: open one
      if (rows.length) {
        let opened = false;
        for (const r of rows) {
          try { await bxOpenRecord(cryptoKey, bxCanvasAad(r.id), r.blob); opened = true; break; }
          catch (e) {}
        }
        if (!opened) throw new Error("that access key does not open this account's designs");
      }
      await bxKeyPut(user.id, cryptoKey);
      BXACCT.key = cryptoKey;
      BXACCT.locked = false;
      bxAccountSync();
      bxSessionRestore().then(() => bxSessionPush()).catch(() => {});
      bxMenuClose();
    })().catch(e => {
      btn.textContent = "unlock";
      status.textContent = String((e && e.message) || e);
      bxAccountPlace();
    });
  });
  bxAccountPlace();
  return true;
}
function bxAccountSaveForm(onSaved, given) {
  if (!BXACCT.user || typeof fetch !== "function" || !bxCryptoReady()) return false;
  if (BXACCT.locked) { bxAccountUnlockForm(); return false; }
  const design = given || bxExportCanvas();
  const text = JSON.stringify(design);
  const wrap = bxAccountForm();
  if (!wrap) return false;
  wrap.appendChild(mk("div", { class: "mhead", text: "save this canvas" }));
  wrap.appendChild(mk("div", { class: "panehint",
    text: "sealed in this browser under " + BXACCT.name +
          " — the server keeps ciphertext, and saving over a name replaces it." }));
  let remembered = "";
  try { remembered = localStorage.getItem("nnstudio_canvas_name") || ""; } catch (e) {}
  const { lab, inp } = bxAccountNameField(remembered || "design 1");
  wrap.appendChild(lab);
  const status = mk("div", { class: "panehint",
    text: text.length + " bytes of design" });
  wrap.appendChild(status);
  let saved = false;
  const go = bxAccountRow(wrap, "save", () => {
    if (saved) { bxMenuClose(); return; }
    const name = String(inp.value || "").trim();
    if (!name) { status.textContent = "the design needs a name"; return; }
    bxAccountSave(name, design, status, go, (savedName, id) => {
      saved = true;
      if (onSaved) onSaved(savedName, id);     // the canvas takes the name it was saved under
    });
  });
  bxAccountPlace();
  return true;
}
async function bxStoreRead() {                 // every record the account owns
  if (typeof fetch !== "function" || !BXACCT.user) return null;
  const r = await fetch("/chat/auth/store");
  if (!r.ok) throw new Error("the store could not be read (HTTP " + r.status + ")");
  return await r.json();
}
async function bxCanvasRecords() {             // the raw `canvas` rows: id + ciphertext
  const store = await bxStoreRead();           // the key is not needed to fetch
  return Array.isArray(store && store.canvases) ? store.canvases : [];
}
/** Normalize a canvas id to the AAD the Chat half binds: "canvas|<id>". */
function bxCanvasAad(id) {                      // the record key is the AAD. Two
  // shapes of row id coexist: the chat half stores "canvas|<id>" (key and
  // AAD alike); this half's legacy rows are the bare id under that same
  // AAD. Prefixed keys pass through, bare ones get the prefix.
  return id && String(id).indexOf("canvas|") === 0 ? id : "canvas|" + id;
}

async function bxCanvases() {                  // the list, decrypted: name + design
  const rows = await bxCanvasRecords();
  const out = [];
  for (const r of rows) {
    let name = "(unreadable)", design = null, session = null;
    try {
      const v = await bxOpenRecord(BXACCT.key, bxCanvasAad(r.id), r.blob);
      name = String((v && v.name) || "canvas");
      design = (v && v.design) || null;
      session = (v && v.session) != null ? String(v.session) : null;
    } catch (e) {}
    out.push({ id: r.id, name: name, updatedAt: r.updatedAt || 0, design: design,
               session: session });
  }
  out.sort((a, b) => (bxWhenMs(b.updatedAt) - bxWhenMs(a.updatedAt)));
  return out;
}
async function bxAccountSave(name, design, status, go, onSaved, bound) {
  if (typeof fetch !== "function" || !BXACCT.user || !BXACCT.key) return false;
  if (go) go.textContent = "sealing …";
  try {
    // Saving a bound project goes in place over its own row — the id (and the
    // chat binding, if it has one) is already known. A fresh project keeps the
    // old path: replace the same-named row, or mint an id when none matches.
    const rows = await bxCanvasRecords();
    let id = "", session = null;
    if (bound && bound.canvas) {
      id = String(bound.canvas);
      if (bound.session != null) session = String(bound.session);
    } else {
      for (const r of rows) {                   // saving over a name replaces it
        try {
          const v = await bxOpenRecord(BXACCT.key, bxCanvasAad(r.id), r.blob);
          if (String((v && v.name) || "") === name) { id = r.id; break; }
        } catch (e) {}
      }
      if (!id) id = "c_" + bxHex(crypto.getRandomValues(new Uint8Array(8)));
    }
    // The row id is the record's key (the AAD): `canvas|<id>`. Writing under
    // it — and dropping a legacy bare row in the same write — keeps one row
    // per canvas, so the chat half's link finds it.
    const rowId = bxCanvasAad(id);
    const blob = await bxSealRecord(BXACCT.key, rowId,
      { name: name, design: design, session: session });
    if (blob.length > BX_CANVAS_MAX)
      throw new Error("that design is too big to seal (" +
                      (blob.length / 2 ** 20).toFixed(1) + " MB)");
    if (go) go.textContent = "saving …";
    const r = await fetch("/chat/auth/store/sync", { method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ canvases: {
        upserts: [{ id: rowId, blob: blob }],
        deletes: id !== rowId ? [id] : [] } }) });
    if (!r.ok) throw new Error("the server refused (HTTP " + r.status + ")");
    try { if (bxSessionHint()) localStorage.setItem("nnstudio_canvas_name", name); } catch (e) {}
    if (status) status.textContent = "saved as " + name + " ✓ (sealed)";
    if (go) go.textContent = "close";
    if (onSaved) onSaved(name, id);
  } catch (e) {
    if (go) go.textContent = "save";
    if (status) status.textContent = String((e && e.message) || e);
    bxAccountPlace();
  }
  return true;
}
function bxAccountOpenForm() {
  if (!BXACCT.user) return false;
  if (BXACCT.locked) { bxAccountUnlockForm(); return false; }
  const wrap = bxAccountForm();
  if (!wrap) return false;
  wrap.appendChild(mk("div", { class: "mhead", text: "open a saved canvas" }));
  wrap.appendChild(mk("div", { class: "panehint",
    text: "loading one replaces everything already on the canvas." }));
  const list = mk("div", { class: "bxlist" });
  const status = mk("div", { class: "panehint", text: "reading the list …" });
  wrap.appendChild(list);
  wrap.appendChild(status);
  bxAccountRow(wrap, "close", () => bxMenuClose());
  bxAccountPlace();
  if (typeof fetch !== "function") { status.textContent = "the app cannot reach the server"; return true; }
  bxCanvases().then(rows => bxAccountList(list, status, rows)).catch(e => {
    status.textContent = String((e && e.message) || e);
    bxAccountPlace();
  });
  return true;
}
function bxWhen(t) {
  const d = new Date(bxWhenMs(t));
  if (!d || !d.toLocaleString || isNaN(d.getTime())) return "";
  try { return d.toLocaleString(); } catch (e) { return ""; }
}
function bxWhenMs(t) {                         // epoch seconds, or an ISO string
  if (typeof t === "number") return t * 1000;
  const ms = Date.parse(String(t || ""));
  return isNaN(ms) ? 0 : ms;
}
function bxAccountList(list, status, rows) {
  if (!list) return false;
  list.innerHTML = "";
  if (!rows.length) {
    status.textContent = "nothing saved yet — save this canvas first.";
    bxAccountPlace();
    return true;
  }
  const count = () => {
    const left = (list.children || []).length;
    status.textContent = left ? left + (left === 1 ? " design" : " designs")
                              : "nothing saved yet — save this canvas first.";
  };
  let armed = "";
  status.textContent = rows.length + (rows.length === 1 ? " design" : " designs");
  rows.forEach((r) => {
    const rowl = mk("div", { class: "rowl", title: "open " + r.name });
    rowl.appendChild(mk("span", { class: "nm", text: r.name }));
    rowl.appendChild(mk("span", { class: "dt", text: bxWhen(r.updatedAt) }));
    const rm = mk("span", { class: "rm", text: "×", title: "delete it" });
    rm.addEventListener("click", (ev) => {
      if (ev && ev.stopPropagation) ev.stopPropagation();
      if (typeof fetch !== "function") return;
      fetch("/chat/auth/store/sync", { method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ canvases: { upserts: [], deletes: [r.id] } }) }).then(() => {
          if (rowl.remove) rowl.remove();
          else if (list.removeChild) list.removeChild(rowl);
          count();
          bxAccountPlace();
        }).catch(() => {});
    });
    rowl.appendChild(rm);
    rowl.addEventListener("click", () => {
      const blank = !((bxExportCanvas().nodes || []).length);
      if (!blank && armed !== r.id) {          // an overwrite is asked twice
        armed = r.id;
        status.textContent = "opening " + r.name + " replaces the canvas — click it again";
        return;
      }
      if (!r.design) { status.textContent = "that design could not be opened"; return; }
      status.textContent = "opening " + r.name + " …";
      if (!bxAccountOpenApply(r.name, r.design))
        status.textContent = "that design is not a canvas";
    });
    list.appendChild(rowl);
  });
  bxAccountPlace();
  return true;
}
function bxAccountOpenApply(name, design) {
  const where = bxtAnchor();
  const read = bxJSONRead(JSON.stringify(design), where);
  if (!read.ok) return false;
  bxJSONApply(read, where);
  bxMenuClose();
  return true;
}
