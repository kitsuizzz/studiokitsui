/**
 * The Turnstile "I'm not a robot" widget's script loader. There is ONE key for
 * the bot check — the app's .env (TURNSTILE_SITE_KEY) — and it reaches this
 * half at runtime through GET /auth/config, so a build never carries a key and
 * both halves always show the same widget. See lib/auth.ts's fetchAuthConfig.
 */

/** The subset of the Turnstile browser API the dialog uses (explicit render). */
type TurnstileApi = {
  render: (
    container: Element,
    options: {
      sitekey: string;
      theme?: string;
      /**
       * Fired the moment a token is solved — in the sign-up dialog this
       * *is* the one-click create action, so the dialog submits on it.
       * (Headless browsers are auto-solved on load; real users tick the box.)
       */
      onSuccess?: (token: string) => void;
    },
  ) => string;
  getResponse: (widgetId?: string) => string;
  reset: (widgetId?: string) => string;
  remove: (widgetId?: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let loader: Promise<TurnstileApi | null> | null = null;

/**
 * Lazily load the Turnstile script (render=explicit, so nothing renders until
 * we call render()). Resolves to the API, or null when the script can't load
 * (e.g. offline); the caller only loads it once it has a site key.
 */
export function loadTurnstile(): Promise<TurnstileApi | null> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!loader) {
    loader = new Promise<TurnstileApi | null>((resolve) => {
      const script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.onload = () => resolve(window.turnstile ?? null);
      script.onerror = () => resolve(null);
      document.head.appendChild(script);
    });
  }
  return loader;
}
