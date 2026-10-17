import { useMemo } from "react";
import { greetingSource } from "./studio/brains/greeting";
import BrainHost from "./studio/BrainHost";
import { Block, type BlockCtx, type ComposerHost } from "./studio/blocks";
import type { StudioBlock } from "../types";

interface GreetingFrameProps {
  /** The host-wired message box, docked once settings are in. */
  composer: ComposerHost;
  /** The app's effective brain source (override-aware, from the App). */
  source?: string;
  /** The host's account state; the brain hides "Create an account" for it. */
  signedIn?: boolean;
  /** The brain asked to start a fresh conversation — the host routes to a
      new session, and warns (a dialog) when no model is configured yet. */
  onNewSession?: () => void;
  /** Open the auth dialog (the brain's "Create an account" button). */
  onOpenAuth?: (mode: "signin" | "signup") => void;
}

/**
 * The welcome screen, hung as the "greeting" default app. The greeting brain
 * (a sandbox) owns the onboarding choice and emits registry blocks; this
 * frame owns only the stage — splitting the brain's flat block list back into
 * the persistent head and the body — and relays the brain's `ai.host` calls
 * to the app. The welcome carries no provider form: models are configured in
 * Settings.
 */
export default function GreetingFrame({ composer, source, signedIn, onNewSession, onOpenAuth }: GreetingFrameProps) {
  const onHost = (action: string, arg?: unknown) => {
    if (action === "new-session") onNewSession?.();
    else if (action === "auth") onOpenAuth?.(arg as "signin" | "signup");
  };

  const ctxData = useMemo(
    () => ({ signedIn: !!signedIn }),
    [signedIn]
  );

  return (
    <BrainHost
      source={source ?? greetingSource}
      title="Welcome"
      trusted
      composer={composer}
      ctxData={ctxData}
      onHost={onHost}
    >
      {({ blocks, ctx }: { blocks: StudioBlock[] | null; ctx: BlockCtx }) => {
        // The head (typewriter title) stays mounted across renders; the body
        // group carries a per-step key so it remounts cleanly.
        const head = blocks ? blocks.find((b) => b.type === "greetinghead") : undefined;
        const body = blocks ? blocks.filter((b) => b.type !== "greetinghead") : [];
        return (
          <main className="greeting">
            {head && <Block block={head} ctx={ctx} />}
            {body.map((b, i) => (
              <Block key={b.type === "group" ? (b.key ?? b.className) : String(i)} block={b} ctx={ctx} />
            ))}
          </main>
        );
      }}
    </BrainHost>
  );
}
