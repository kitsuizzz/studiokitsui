#!/usr/bin/env node
/**
 * The Studio half's account crypto, pinned to the Chat half's.
 *
 * ui/index.html derives the record key with HKDF(SHA-256, salt "aistudio:e2e:v1",
 * info "conversations") — byte for byte what the Chat half's lib/crypto.ts
 * derives, so one access key opens both halves' records. This test lifts the
 * page's crypto helpers out of the script, derives a key from a fixed access
 * key, and checks the sealed bytes against Node's own HKDF (RFC 5869) — an
 * independent implementation — plus the credential, the key's shape, the
 * record binding (AAD), and the AAD normalizer that lets the page's legacy
 * rows open under the key the Chat half binds them by.
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ROOT = path.dirname(__dirname);
const HTML = fs.readFileSync(path.join(ROOT, "ui", "index.html"), "utf8");

function grab(start, end) {
  const i = HTML.indexOf(start);
  const j = i < 0 ? -1 : HTML.indexOf(end, i);
  if (i < 0 || j < 0) throw new Error("the UI script moved: no " + start);
  return HTML.slice(i, j);
}

const consts = grab("const BX_E2E = {", "const BX_CANVAS_MAX");
const funcs = grab("function bxCryptoReady()", "// the shared key cache");
// the AAD normalizer sits past the key cache, so it gets its own lift
const aad = grab("function bxCanvasAad(id) {", "async function bxCanvases()");
const ui = new Function(
  consts + funcs + aad +
  "; return { bxNewKey, bxHandle, bxCredential, bxDataKey, bxSealRecord, bxOpenRecord, bxCanvasAad };",
)();

const failed = [];
const checks = [];
function check(name, fn) {
  const p = Promise.resolve()
    .then(fn)
    .then(() => console.log("  ok   " + name))
    .catch((e) => {
      failed.push(name);
      console.log("  FAIL " + name + " — " + (e && e.message));
    });
  checks.push(p); // the summary waits on all of these — a trailing bare
                   // Promise.resolve().then(...) reports before the async
                   // checks settle, and would let their failures escape
  return p;
}
function need(cond, msg) {
  if (!cond) throw new Error(msg);
}

const KEY = "ast_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const AAD = "canvas|test-record";

check("the access key's shape (ast_ + 43 URL-safe chars)", () => {
  const key = ui.bxNewKey();
  need(/^ast_[A-Za-z0-9_-]{43}$/.test(key), "unexpected shape: " + key);
  need(ui.bxHandle(key) === key.slice(4, 10), "the handle is the key's opening");
});

check("the credential is SHA-256(key), hex", async () => {
  const credential = await ui.bxCredential(KEY);
  const reference = crypto.createHash("sha256").update(KEY, "utf8").digest("hex");
  need(credential === reference, credential + " != " + reference);
});

check("the record key is the Chat half's HKDF, byte for byte", async () => {
  const key = await ui.bxDataKey(KEY);
  // Node's own HKDF — an implementation that shares nothing with the page.
  const raw = crypto.hkdfSync(
    "sha256",
    Buffer.from(KEY, "utf8"),
    Buffer.from("aistudio:e2e:v1", "utf8"),
    Buffer.from("conversations", "utf8"),
    32,
  );
  const reference = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
  // The page seals; the reference opens. Equal bytes or this throws.
  const blob = await ui.bxSealRecord(key, AAD, { name: "hello", n: 42 });
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: Buffer.from(blob, "base64").subarray(0, 12), additionalData: Buffer.from(AAD, "utf8") },
    reference,
    Buffer.from(blob, "base64").subarray(12),
  );
  const value = JSON.parse(Buffer.from(plaintext).toString("utf8"));
  need(value.name === "hello" && value.n === 42, "the payload came back wrong");
  // And the reference seals, the page opens.
  const iv = crypto.randomBytes(12);
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: Buffer.from(AAD, "utf8") },
    reference,
    Buffer.from(JSON.stringify({ from: "reference" }), "utf8"),
  );
  const both = Buffer.concat([Buffer.from(iv), Buffer.from(sealed)]).toString("base64");
  const back = await ui.bxOpenRecord(key, AAD, both);
  need(back.from === "reference", "the page could not open the reference's record");
});

check("a record is bound to its id (AAD)", async () => {
  const key = await ui.bxDataKey(KEY);
  const blob = await ui.bxSealRecord(key, "canvas|one", { v: 1 });
  let opened = false;
  try {
    await ui.bxOpenRecord(key, "canvas|two", blob);
    opened = true;
  } catch (e) {
    // expected: the ciphertext does not belong to that record
  }
  need(!opened, "a record opened under the wrong id");
});

check("the normalizer maps a legacy bare id onto the AAD the Chat half binds", () => {
  need(ui.bxCanvasAad("c_00112233") === "canvas|c_00112233", "a bare id must take the canvas| prefix");
  need(ui.bxCanvasAad("canvas|c_00112233") === "canvas|c_00112233", "a prefixed id must pass through, untouched");
});

check("a legacy row sealed through the normalizer opens under the Chat half's AAD", async () => {
  const key = await ui.bxDataKey(KEY);
  // pre-v2, the canvas rows were keyed by the bare id; the normalizer is
  // what makes the bytes the page seals for such a row belong to the row
  // key the Chat half looks them up by
  const blob = await ui.bxSealRecord(key, ui.bxCanvasAad("c_00112233"), { name: "legacy", session: "7" });
  const back = await ui.bxOpenRecord(key, "canvas|c_00112233", blob);
  need(back && back.name === "legacy" && back.session === "7",
    "a legacy row did not open under the key the Chat half binds it by");
});

check("a double-prefixed AAD opens nothing", async () => {
  const key = await ui.bxDataKey(KEY);
  const blob = await ui.bxSealRecord(key, "canvas|c_00112233", { v: 1 });
  let opened = false;
  try {
    await ui.bxOpenRecord(key, "canvas|canvas|c_00112233", blob);
    opened = true;
  } catch (e) {
    // expected: the double prefix is not this record's AAD
  }
  need(!opened, "a record opened under a double-prefixed AAD");
});

check("the session row is bound to its own AAD (session|current)", async () => {
  const key = await ui.bxDataKey(KEY);
  const blob = await ui.bxSealRecord(key, "session|current", { tabs: [{ id: "c_00112233", name: "legacy" }], active: "c_00112233" });
  const back = await ui.bxOpenRecord(key, "session|current", blob);
  need(back && back.tabs && back.tabs.length === 1 && back.tabs[0].id === "c_00112233" && back.active === "c_00112233",
    "the session row did not round-trip under its AAD");
});

Promise.all(checks).then(() => {
  if (failed.length) {
    console.log("studio_crypto_test: " + failed.length + " failure(s): " + failed.join(", "));
    process.exit(1);
  }
  console.log("studio_crypto_test: all assertions passed");
});
