import { fetchModelInfos, type ModelInfo } from "./api";
import { sessionHint } from "./auth";
import { CHAT_KITSUI_ID, chatKitsui, ensureChatKitsui, normalizeAgent, pointChatKitsui } from "./agents";
import { uid } from "./id";
import { defaultChoice } from "./modelchoice";
import { PLATFORM_BASE_URL, PLATFORM_MODEL, PLATFORM_PROVIDER_ID, isPlatform } from "./platform";
import { SETTINGS_KEY, WORKSPACE_KEY } from "./storageKeys";
import type { Agent, LlmProvider, SavedProvider, Settings, WebToolSettings, Workspace } from "../types";

export const SAVE_DEBOUNCE_MS = 300;
/** How long the reader rests before their place is saved. */
export const VIEW_SAVE_MS = 1000;
/** The debug-log tail kept per workspace (persisted with the studio record). */
export const MAX_STUDIO_LOGS = 50;
/** The raw streamed output kept per message for the inline activity window. */
export const RAW_STREAM_MAX = 8_000;
/** How many visual review/fix passes the App Builder gets per build or edit. */
export const MAX_REVIEW_PASSES = 2;

/** The built-in apps that run on a code brain (and so have a Code pane). */
export const CODE_APP_IDS = ["greeting", "conversation"];

/** The one note shared by the greeting's warning dialog and the red in-wall
    error: a send made with no usable model bounces back as exactly this
    message. */
export const NO_MODEL_NOTE = "No model is configured yet. Add a provider in Settings to start chatting.";

const defaultSettings: Settings = {
  sendMode: "ctrlEnter",
  webTools: { search: true, fetch: true, ask: { search: true, fetch: true } },
};

export function loadSettings(): Settings {
  // A guest's browser keeps nothing: the settings start at their defaults.
  if (!sessionHint()) return defaultSettings;
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Settings>;
      const tools = (parsed.webTools ?? {}) as Partial<WebToolSettings>;
      return {
        sendMode: parsed.sendMode === "enter" ? "enter" : defaultSettings.sendMode,
        // Web tools default on, and each call asks first unless the user turns the asking off.
        webTools: {
          search: tools.search !== false,
          fetch: tools.fetch !== false,
          ask: {
            search: tools.ask?.search !== false,
            fetch: tools.ask?.fetch !== false,
          },
        },
      };
    }
  } catch {
    // corrupted settings, fall back to defaults
  }
  return defaultSettings;
}

interface LegacySettings {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
}

/**
 * How long the boot waits on the gateway before giving up on it. A request
 * that hangs (a slow link, a proxy that never answers) must not leave the
 * app stuck half-loaded on a blank screen.
 */
export const BOOT_FETCH_MS = 10_000;

/** A timeout signal, with a manual fallback for older browsers. */
export function timeoutSignal(ms: number): AbortSignal {
  const withTimeout = AbortSignal as typeof AbortSignal & { timeout?: (ms: number) => AbortSignal };
  if (typeof withTimeout.timeout === "function") return withTimeout.timeout(ms);
  const ctrl = new AbortController();
  window.setTimeout(() => ctrl.abort(), ms);
  return ctrl.signal;
}

/**
 * The deployment's gateway listing (the Server side of the model picker),
 * probed once per session — it is static per deployment, so a second probe
 * answers from memory.
 */
let platformProbe: Promise<{ baseUrl: string; model: string; models: ModelInfo[] } | null> | null = null;
export function probePlatform(): Promise<{ baseUrl: string; model: string; models: ModelInfo[] } | null> {
  platformProbe ??= (async () => {
    const models = await fetchModelInfos(PLATFORM_BASE_URL, "", timeoutSignal(BOOT_FETCH_MS));
    if (!models.length) return null;
    const model =
      PLATFORM_MODEL && models.some((m) => m.id === PLATFORM_MODEL) ? PLATFORM_MODEL : models[0].id;
    return { baseUrl: PLATFORM_BASE_URL, model, models };
  })();
  return platformProbe;
}

/**
 * Fold the account's saved BYOK providers into the workspace: the saved copy
 * wins (it is the cross-device source of truth) and keeps its id, so model
 * choices survive a move between devices. Each provider gets an agent to ride.
 */
export function mergeSavedProviders(ws: Workspace, opened: SavedProvider[]): Workspace {
  if (opened.length === 0) return ws;
  let providers = [...ws.providers];
  const renames = new Map<string, string>();
  for (const saved of opened) {
    if (!saved.baseUrl.trim()) continue;
    const wantedId = saved.id?.trim() || "";
    const at = providers.findIndex(
      (p) =>
        !isPlatform(p) &&
        ((wantedId && p.id === wantedId) || (p.name === saved.name && p.baseUrl === saved.baseUrl))
    );
    if (at < 0) {
      providers = [
        ...providers,
        { id: wantedId || uid(), name: saved.name, baseUrl: saved.baseUrl, apiKey: saved.apiKey, noKey: saved.noKey, models: saved.models },
      ];
    } else {
      const prev = providers[at];
      const id = wantedId || prev.id;
      if (id !== prev.id) renames.set(prev.id, id);
      providers[at] = {
        ...prev,
        id,
        name: saved.name || prev.name,
        baseUrl: saved.baseUrl || prev.baseUrl,
        // A sealed (or absent) key never replaces an opened one.
        apiKey: saved.apiKey && !saved.apiKey.startsWith("e2e1:") ? saved.apiKey : prev.apiKey,
        noKey: saved.noKey ?? prev.noKey,
        models: saved.models?.length ? saved.models : prev.models,
      };
    }
  }
  const follow = (id: string): string => renames.get(id) ?? id;
  return { ...ws, providers, agents: ws.agents.map((a) => ({ ...a, providerId: follow(a.providerId) })) };
}

/** The guest's in-session providers as saved entries — what the first sign-in
    claims into the account (the caller seals the keys on upload). */
export function claimGuestProviders(ws: Workspace): SavedProvider[] {
  const choice = defaultChoice(ws);
  return ws.providers
    .filter((p) => !isPlatform(p) && (p.apiKey.trim().length > 0 || p.noKey === true))
    .map((p) => ({
      id: p.id,
      name: p.name,
      baseUrl: p.baseUrl,
      apiKey: p.apiKey,
      noKey: p.noKey,
      models: p.models,
      model: choice?.providerId === p.id ? choice.model : p.models?.[0] ?? "",
    }));
}

export function seedWorkspace(legacy: LegacySettings | null): Workspace {
  const provider: LlmProvider = {
    id: uid(),
    name: "OpenAI",
    baseUrl: legacy?.baseUrl?.trim() || "https://api.openai.com/v1",
    apiKey: legacy?.apiKey?.trim() ?? "",
    models: legacy?.model?.trim() ? [legacy.model.trim()] : undefined,
  };
  return {
    providers: [provider],
    agents: [chatKitsui(provider.id, legacy?.model?.trim() || "gpt-4o-mini")],
    activeAgentId: CHAT_KITSUI_ID,
  };
}

export function loadWorkspace(): Workspace {
  // A guest's browser keeps nothing: no stored workspace, no legacy settings.
  if (!sessionHint()) return seedWorkspace(null);
  try {
    const raw = localStorage.getItem(WORKSPACE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Workspace> & { modelChoice?: { providerId?: string; model?: string } | null };
      if (Array.isArray(parsed.providers) && Array.isArray(parsed.agents)) {
        // The platform provider gets its stable id, so the server choice keeps
        // pointing at it across reloads and devices (a legacy random id is remapped).
        const legacyPlatformId = parsed.providers.find((p) => p.mode === "platform" && p.id !== PLATFORM_PROVIDER_ID)?.id ?? null;
        const remap = (id?: string | null): string => (id && id === legacyPlatformId ? PLATFORM_PROVIDER_ID : id ?? "");
        const providers = (parsed.providers as LlmProvider[]).map((p) => (p.id === legacyPlatformId ? { ...p, id: PLATFORM_PROVIDER_ID } : p));
        const rawAgents = parsed.agents as Partial<Agent>[];
        // Earlier builds made one "Assistant" agent per provider; those carry no prompt of their own and fold into Chat Kitsui.
        const agents = rawAgents
          .filter((a) => !(a.name === "Assistant" && !a.systemPrompt && !a.builtIn))
          .map((a) => normalizeAgent({ ...a, providerId: remap(a.providerId) }))
          .filter((a): a is Agent => a !== null);
        const oldActive = rawAgents.find((a) => a.id === parsed.activeAgentId) ?? rawAgents[0];
        const choice = parsed.modelChoice?.providerId
          ? { providerId: remap(parsed.modelChoice.providerId), model: parsed.modelChoice.model ?? "" }
          : oldActive
            ? { providerId: remap(oldActive.providerId), model: oldActive.model ?? "" }
            : { providerId: providers.find((p) => isPlatform(p))?.id ?? "", model: "" };
        const withChat = ensureChatKitsui(agents, choice);
        const activeAgentId = withChat.some((a) => a.id === parsed.activeAgentId) ? (parsed.activeAgentId as string) : CHAT_KITSUI_ID;
        const loaded: Workspace = { providers, agents: withChat, activeAgentId };
        return sessionHint() ? loaded : guestSafeWorkspace(loaded);
      }
    }
  } catch {
    // corrupted workspace, re-seed below
  }
  let legacy: LegacySettings | null = null;
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) legacy = JSON.parse(raw) as LegacySettings;
  } catch {
    legacy = null;
  }
  return seedWorkspace(legacy);
}

/** A guest's providers and custom agents are session-only: the stored copy keeps just the deployment's server provider and Chat Kitsui, so a reload never resurrects a guest's providers (keys included) or agents. Signed-in accounts re-fetch theirs from the server profile. */
export function guestSafeWorkspace(ws: Workspace): Workspace {
  return reconcileChat({
    ...ws,
    providers: ws.providers.filter((p) => isPlatform(p)),
    agents: ws.agents.filter((a) => a.builtIn),
    activeAgentId: CHAT_KITSUI_ID,
  });
}

/** The workspace without the deployment's server provider (used when the gateway answers with no models, so nothing can ride a stale server model). */
export function withoutPlatform(ws: Workspace): Workspace {
  if (!ws.providers.some((p) => isPlatform(p))) return ws;
  return reconcileChat({ ...ws, providers: ws.providers.filter((p) => !isPlatform(p)) });
}

/** Chat Kitsui must ride a provider that exists: it keeps its choice when that provider survives; otherwise it moves to the server model, or the next provider left, or to nothing (the picker then asks for a provider). Agents on a removed provider keep their definitions and need a new provider. */
export function reconcileChat(ws: Workspace, platformModel = ""): Workspace {
  const chat = ws.agents.find((a) => a.builtIn);
  if (chat && ws.providers.some((p) => p.id === chat.providerId)) return ws;
  const next = ws.providers.find((p) => isPlatform(p)) ?? ws.providers[0];
  const model = next && isPlatform(next) ? platformModel : "";
  return pointChatKitsui(ws, next?.id ?? "", model, false);
}
