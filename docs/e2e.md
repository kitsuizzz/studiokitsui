# The account's sealed store — one contract, two runtimes

The browser shell (`ui/src/js/85-account.js`) and the Chat half
(`chat/frontend/src/lib/crypto.ts`) implement the same small protocol. They
must stay byte-for-byte compatible; changing any value here is a two-runtime
change.

## The access key

- Shape: `ast_` + 43 URL-safe base64 chars (32 random bytes).
- The server never sees it. It is shown once and is the whole login.
- The two derived values:

```
credential  = SHA-256(access key)                     # hex, sent to /auth
record key  = HKDF-SHA-256(
                 ikm  = access key,
                 salt = "aistudio:e2e:v1",
                 info = "conversations",
                 len  = 32
              ) → AES-GCM-256 (non-extractable)
```

## Records

A record is `base64(iv ‖ AES-GCM ciphertext)`:

- `iv`: 12 random bytes, a fresh one per seal.
- `additionalData`: the record's own id (the AAD). A record cannot be opened
  under another id.
- The server stores ciphertext only; it does not know the key.

## Record ids (the AAD)

| id | owner | meaning |
|---|---|---|
| `canvas\|<id>` | canvas half | one design |
| `session\|current` | Chat half | the open-tabs record |
| `<conversation-id>` (conversations kind) | Chat half | one conversation |
| `<conversation-id>` (views kind) | Chat half | a reader's place |
| `current` (last kind) | Chat half | the account's last conversation |
| `<studio-id>` (studios kind) | Chat half | the build record |

A canvas row is sealed by the canvas half under `canvas|<id>`. A session
binding lives in the canvas record's `session` field. The Chat half reads the
canvas rows and writes the binding; the canvas half owns the design.

## What pins it

- `tests/studio_crypto_test.js` — the shell's key shape, credential, HKDF
  against Node's own HKDF, AAD binding, legacy normalizer.
- `tests/canvas_link_test.js` — the Chat half's reader against the canvas
  half's sealer.
- `tests/live_account_test.js` — the live signup/store/signout path.

If you change the salt, info, key shape, base64 layout, or AAD, update both
implementations and these tests in the same change.
