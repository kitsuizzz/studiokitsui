"""Gateway configuration.

Environment variables (or a .env file) drive the gateway:

- UPSTREAM_BASE_URL  OpenAI-compatible base URL of the real provider,
                      including the /v1 segment (e.g. https://api.openai.com/v1).
- UPSTREAM_API_KEY   The real provider key. Kept server-side; clients never see it.
- GATEWAY_TOKEN      Optional shared secret for /v1. Set = every request must
                     present it (Authorization: Bearer <token>); unset = the
                     gateway is open (the app's platform gateway, where the
                     browser calls /v1 directly and the upstream key stays here).
                      When unset, any non-empty bearer token is accepted (local dev).
- CONTEXT_TOKENS     Optional "model:tokens,..." map used to fill in
                      max_context_tokens when the upstream model endpoint omits it
                      (real OpenAI's does).
- GATEWAY_MODELS     Optional "model-a,model-b" allow-list for /v1/models.
                     Empty = expose everything the upstream lists; "none" =
                     expose no models (the app then hides Server-provided).
- CORS_ORIGINS       Comma-separated origins allowed to call the gateway
                     cross-origin. Defaults to chat.kitsui.co plus the local
                     dev origins (so pointing the app straight at :8000 keeps
                     working); empty = wide open (the old "*" behavior).
- PORT               Port the gateway listens on (informational for uvicorn).
- DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_NAME
                     The accounts database (MariaDB). The defaults suit a
                     local `docker compose up -d mariadb` (loopback :3306,
                     user aistudio); the compose stack points DB_HOST at the
                     mariadb service and passes the MARIADB_* values through.
- TURNSTILE_MODE     off | test | live — the "I'm not a robot" check on
                     /auth/signup. "test" is the official Cloudflare test keys
                     (any domain, tokens pass against the test pair only);
                     "live" adds a hostname match so tokens can't be replayed
                     on other hosts. Off is the default (fully offline).
- TURNSTILE_SECRET_KEY  The Turnstile secret key for the mode above. No secret
                     key means "off" no matter what the mode says.
- TURNSTILE_SITE_KEY The widget's public site key, handed to the frontends by
                     GET /auth/config (Studio Kitsui's Studio half asks for it;
                     it is not a secret).
- COOKIE_SECURE      Add "Secure" to the session cookie (set it when the app
                     is served over https; a bridged https request sets it
                     automatically).
- SESSION_TTL_DAYS   How long a session token stays valid after sign-in.
- REQUIRE_SESSION    The fused app's default: /v1 needs a signed-in session
                     (the platform gateway is not open to the network).
                     Unset GATEWAY_TOKEN for this to matter; set this to 0
                     to keep the gateway open for guests (local dev).
- SEARCH_PROVIDER    auto | searxng | duckduckgo — the keyless web-search backend
                     used by POST /v1/websearch. "auto" (default) prefers the
                     SearXNG instance when SEARXNG_URL is set, and falls back to
                     the DuckDuckGo HTML endpoint either way.
- SEARXNG_URL        Base URL of a SearXNG instance with the JSON format enabled
                     (the docker stack ships one). Empty = DuckDuckGo only.
"""

import os

from pydantic_settings import BaseSettings, SettingsConfigDict

# The fused app's root: this file is chat/backend/gateway/config.py, so three
# levels up is the repository — where the app's .env lives. Relative paths
# would otherwise depend on the working directory (app/server.py runs from the
# root; pytest runs from chat/backend).
_REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
)


class Settings(BaseSettings):
    # The repo root's .env first, a CWD-local one last (it wins). Environment
    # variables always win over both.
    model_config = SettingsConfigDict(
        env_file=(os.path.join(_REPO_ROOT, ".env"), ".env"), extra="ignore"
    )

    upstream_base_url: str = "http://127.0.0.1:9400/v1"
    upstream_api_key: str = ""
    gateway_token: str | None = None
    context_tokens: str = ""
    gateway_models: str = ""
    cors_origins: str = (
        "https://chat.kitsui.co,http://localhost:1234,http://127.0.0.1:1234"
    )
    port: int = 8000
    db_host: str = "127.0.0.1"
    db_port: int = 3306
    db_user: str = "aistudio"
    db_password: str = "aistudio"
    db_name: str = "aistudio"
    turnstile_mode: str = "off"
    turnstile_secret_key: str = ""
    turnstile_site_key: str = ""
    cookie_secure: bool = False
    session_ttl_days: int = 30
    # The fused app defaults to a session-gated gateway: /v1 is reachable on
    # the network, so the platform model (and its upstream key) belongs to
    # signed-in accounts. A GATEWAY_TOKEN, when set, takes over instead.
    require_session: bool = True
    search_provider: str = "auto"
    searxng_url: str = ""

    @property
    def captcha_enabled(self) -> bool:
        """The sign-up robot check is on when a real mode is set and has a secret."""
        return self.turnstile_mode in ("test", "live") and bool(
            self.turnstile_secret_key
        )

    @property
    def context_token_map(self) -> dict[str, int]:
        """CONTEXT_TOKENS as {model_id: max_context_tokens}."""
        result: dict[str, int] = {}
        for part in self.context_tokens.split(","):
            part = part.strip()
            if not part or ":" not in part:
                continue
            model, _, raw = part.partition(":")
            try:
                result[model.strip()] = int(raw.strip())
            except ValueError:
                continue
        return result

    @property
    def model_allowlist(self) -> list[str] | None:
        """The /v1/models allow-list: None = expose everything the upstream
        lists; an empty list (GATEWAY_MODELS="none") = expose nothing, so the
        app hides the Server-provided category entirely."""
        raw = self.gateway_models.strip()
        if not raw:
            return None
        if raw.lower() in ("none", "-"):
            return []
        return [m.strip() for m in raw.split(",") if m.strip()]

    @property
    def cors_origin_list(self) -> list[str]:
        """CORS_ORIGINS as a list; empty = wide open (the old "*" behavior)."""
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
