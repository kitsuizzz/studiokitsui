import type { AccountUser, GuestSession, SavedProvider } from "../types";
import { APP_BASE } from "./base";
import { credentialFromKey, generateAccessKey, handleFromKey, sealSecret } from "./crypto";

/**
 * The session lives in an HttpOnly cookie the server sets on sign-up and
 * sign-in: page scripts cannot read it, so a cross-site script cannot steal
 * it. What is kept here is only a hint — "a sign-in may be live" — so a cold
 * boot skips the /auth/me round trip for guests. The server always has the
 * last word: a hint without a session fails that call once and lands in the
 * guest shell. Both halves of Studio Kitsui share the hint (one origin), and
 * the access key itself is never kept — it is shown once, at creation, and
 * lives only in the user's own password manager / notes.
 */
const SESSION_HINT = "nnstudio_account";

export function sessionHint(): boolean {
  try {
    return localStorage.getItem(SESSION_HINT) === "1";
  } catch {
    return false;
  }
}

export function markSession(): void {
  try {
    localStorage.setItem(SESSION_HINT, "1");
  } catch {
    // Storage unavailable (private mode): the next boot probes /auth/me anyway.
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(SESSION_HINT);
  } catch {
    // Ignore.
  }
}


interface AuthResponse {
  /** The access key — sign-up only, and the only place it is ever returned.
      The browser minted it, so the server never had it to return. */
  key?: string;
  /** The session token: the server also sets it as the HttpOnly cookie the
      browser rides; this copy is for CLIs and tests, not for the app. */
  token?: string;
  user?: AccountUser;
  /** The account's saved BYOK providers (if any); /auth/signin returns them. */
  providers?: SavedProvider[];
  /** The account's first saved provider (legacy shape). */
  provider?: SavedProvider;
  /** The account's admin key, sealed — ciphertext only its owner can open. */
  adminKey?: string | null;
  /** The account's sealed agents (ciphertext only its owner can open). */
  agents?: string | null;
}

export interface AuthConfig {
  /** The sign-up robot check is on (the server decides; the site key only
      paints the widget). */
  captcha: boolean;
  /** The public Turnstile site key (never the secret). */
  site_key: string;
  /** How long a session lasts, in days. */
  session_days: number;
}

/**
 * What a sign-up dialog needs to draw itself: whether the robot check is on
 * and its public site key. Read at runtime (not baked in at build time), so
 * one build serves any deployment — including the fused app, where the key
 * lives in the repository's .env.
 */
export async function fetchAuthConfig(): Promise<AuthConfig | null> {
  try {
    const res = await fetch(`${APP_BASE}/auth/config`);
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<AuthConfig>;
    return {
      captcha: data.captcha === true,
      site_key: typeof data.site_key === "string" ? data.site_key : "",
      session_days: typeof data.session_days === "number" ? data.session_days : 30,
    };
  } catch {
    return null;
  }
}

/** What /auth/me resolves a stored token to, or null when it is unknown. */
export interface MeResponse {
  user: AccountUser;
  /** The account's saved BYOK providers (empty until one has been stored). */
  providers: SavedProvider[];
  /** The account's admin key (sealed client-side), if one was stored. */
  adminKey: string | null;
  /** The account's sealed agents (ciphertext only its owner can open), if any. */
  agents: string | null;
}

/** The /auth endpoints are same-origin (Vite proxy in dev, nginx in docker);
 *  APP_BASE keeps them inside the mount prefix when the app runs under one. */
async function authPost(path: "signup" | "signin", body: Record<string, string>, token?: string): Promise<AuthResponse> {
  const res = await fetch(`${APP_BASE}/auth/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = `Request failed with status ${res.status}`;
    try {
      const data: { detail?: string } = await res.json();
      if (data.detail) detail = data.detail;
    } catch {
      // non-JSON error body
    }
    throw new Error(detail);
  }
  return (await res.json()) as AuthResponse;
}

/** Normalize a profile payload: the provider list, with the legacy
    single-provider shape folded in. */
export function providersFrom(data: { provider?: SavedProvider | null; providers?: SavedProvider[] | null }): SavedProvider[] {
  const list = Array.isArray(data.providers) ? data.providers.filter((p) => p && typeof p.baseUrl === "string") : [];
  if (list.length) return list;
  return data.provider ? [data.provider] : [];
}

/** The identity + saved providers behind the stored token, or null when unknown. */
export async function fetchMe(signal?: AbortSignal): Promise<MeResponse | null> {
  // The session cookie rides along (same-origin). Network failures and
  // timeouts PROPAGATE (the caller decides whether the session is dead or
  // merely unreachable); a non-OK response means the server does not
  // recognize this session.
  const res = await fetch(`${APP_BASE}/auth/me`, { signal });
  if (!res.ok) return null;
  let data: {
    user?: AccountUser;
    provider?: SavedProvider | null;
    providers?: SavedProvider[] | null;
    adminKey?: string | null;
    agents?: string | null;
  };
  try {
    data = await res.json();
  } catch {
    return null;
  }
  if (!data.user) return null;
  return { user: data.user, providers: providersFrom(data), adminKey: data.adminKey ?? null, agents: data.agents ?? null };
}

export async function signup(captcha?: string): Promise<AuthResponse> {
  // The browser generates the access key, so the server never has it: the
  // sign-up body carries only SHA-256(key) (the credential) and the display
  // handle. The key is attached to the response for the one-time reveal, and
  // it is the only copy anywhere.
  const key = generateAccessKey();
  const credential = await credentialFromKey(key);
  const body: Record<string, string> = { credential, handle: handleFromKey(key) };
  if (captcha) body.captcha = captcha;
  const res = await authPost("signup", body);
  return { ...res, key };
}

export async function signin(key: string): Promise<AuthResponse> {
  // The access key is the only credential; only its hash ever leaves the
  // browser, so the server can authenticate but never decrypt.
  const credential = await credentialFromKey(key);
  return authPost("signin", { credential });
}

/** Best-effort: invalidate the token server-side even if the request fails. */
export async function signout(): Promise<void> {
  try {
    await fetch(`${APP_BASE}/auth/signout`, { method: "POST" });
  } catch {
    // The server clears the cookie; a failed call leaves it to expire.
  }
}

/**
 * Persist (or, when empty, clear) the signed-in account's BYOK providers.
 * Best-effort: a failed save just means the next login re-onboards, so it
 * never blocks the UI.
 *
 * Each apiKey is sealed under the account key before it leaves the browser,
 * so the server stores opaque values; name/baseUrl/model stay readable, which
 * is what lets a device (and the server's own view) know the providers in use.
 */
export async function saveProviders(providers: SavedProvider[], key: CryptoKey | null): Promise<void> {
  try {
    const stored = await Promise.all(
      providers.map(async (p) => ({ ...p, apiKey: await sealSecret(key, p.apiKey) }))
    );
    await fetch(`${APP_BASE}/auth/profile`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providers: stored }),
    });
  } catch {
    // Ignore — see above.
  }
}

/**
 * Ask the server for an "are you admin?" challenge (single-use, short-lived).
 * Nothing about the account's user type was readable before this; answering
 * the challenge with an admin key is the only way the server ever learns it.
 */
export async function fetchAdminChallenge(): Promise<string | null> {
  try {
    const res = await fetch(`${APP_BASE}/auth/admin/challenge`, { method: "POST" });
    if (!res.ok) return null;
    const data: { challenge?: string } = await res.json();
    return data.challenge || null;
  } catch {
    return null;
  }
}

/** Answer a challenge with the admin key; true when the server accepts it. */
export async function proveAdmin(challenge: string, key: string): Promise<boolean> {
  try {
    const res = await fetch(`${APP_BASE}/auth/admin/prove`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ challenge, key }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Store (or clear) the account's sealed admin-key copy — server-side it is
    opaque ciphertext, kept so admin can be proven from another device. */
export async function saveAdminKey(sealed: string | null): Promise<void> {
  try {
    await fetch(`${APP_BASE}/auth/admin/key`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: sealed }),
    });
  } catch {
    // Best-effort: proving still works with the in-memory key.
  }
}

/** Store the account's sealed agents in its profile; the providers are left as they are. */
export async function saveAgentsRecord(sealed: string | null): Promise<void> {
  try {
    await fetch(`${APP_BASE}/auth/profile`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agents: sealed }),
    });
  } catch {
    // Best-effort, like the provider save.
  }
}

/** A saved provider as the guest-shaped session the greeting brain expects. */
export function providerToGuest(provider: SavedProvider): GuestSession {
  return {
    guest: true,
    providerName: provider.name,
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    noKey: provider.noKey === true ? true : undefined,
    model: provider.model,
    at: 0,
  };
}

/** A guest-shaped session as the saved-provider shape the profile stores. */
export function guestToProvider(session: GuestSession): SavedProvider {
  return {
    name: session.providerName,
    baseUrl: session.baseUrl,
    apiKey: session.apiKey,
    model: session.model,
    noKey: session.noKey === true ? true : undefined,
  };
}
