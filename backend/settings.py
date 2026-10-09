"""Process configuration: one ``Settings`` object built from the environment (#2997).

``main.create_app()`` builds a ``Settings`` once (or takes one a test passes in),
keeps it on ``app.state.settings`` and hands the relevant fields to the code that
needs them. Tests override configuration by passing ``create_app(Settings(...))``
or by setting env vars before ``create_app()``, except for the values a module reads
from its own lazy ``Settings``: ``DATABASE_URL`` (``db.base._settings``), the
``ENTITLEMENT_*`` fields (``entitlements.service._settings``) and the ``APPLE_*`` /
``GOOGLE_*`` fields (``purchases._common._settings``). Passing those through
``create_app(settings)`` has no effect; tests set the module's ``_settings`` instead
(``tests/_helpers.set_dev_override``). Two values are still read when
their module is imported: ``DAILY_WORD_SALT`` (``daily_word/puzzle.py``) and
``DAILY_CHALLENGE_SALT`` (``daily_challenge/definitions.py``), so ``load_dotenv()``
in ``main.py`` must stay above the project imports.

Parity rules (the owner decisions on #2997):

- Every env var keeps its exact name, with no prefix, and is matched
  case-sensitively, as ``os.environ`` is on Linux.
- Every default is the one the old ``os.environ.get`` call used. Values stay raw
  strings where the old code parsed them itself, so the parse — and the startup
  error a bad value raises — is unchanged (``TRUSTED_PROXY_*`` is validated by
  ``limiter.load_proxy_trust``).
- ``backend/.env`` is still loaded by ``load_dotenv()`` in ``main``, not here, so
  the precedence (a real env var wins) is unchanged.
- Operational tunables (#3110) are env-overridable with bounds; game rules
  (``daily_word.progress.MAX_GUESSES``) stay constants.

Migrated so far: the app-level settings ``main``, ``limiter`` and
``observability.sentry`` read; ``DATABASE_URL`` (``db.base``, read lazily, and
``alembic/env.py``); the two daily salts (``daily_word.puzzle`` and
``daily_challenge.definitions``, still read when imported); ``ADMIN_API_TOKEN``
(``games.router``, from ``app.state.settings``, so read once at startup rather
than per request); and ``ENTITLEMENT_DEV_OVERRIDE`` / ``ENTITLEMENT_PRIVATE_KEY``
/ ``ENTITLEMENT_PUBLIC_KEY`` (``entitlements.service``, read lazily on first use
and kept for the process); and the ``APPLE_*`` / ``GOOGLE_*`` store config
(``purchases._common``, read lazily on first use and kept for the process, so
``APPLE_IAP_ENVIRONMENTS`` / ``GOOGLE_PLAY_ENVIRONMENTS`` are no longer re-read on
every ``allowed_environments()`` call).

The six operational tunables (#3110) are read lazily through the owning module's
own ``_settings``, like the ``ENTITLEMENT_*`` fields, so ``create_app(settings)`` does
not affect them: ``ENTITLEMENT_TOKEN_TTL_HOURS`` (``entitlements.service``),
``STALE_GAME_AFTER_HOURS`` (``games.sweep``), ``MAX_RESULT_BYTES`` (``games.sessions``),
``STREAK_LOOKBACK_DAYS`` (``daily_challenge.streak``), ``APPLE_REPLAY_WINDOW_HOURS``
(``purchases.apple_notifications``, via ``purchases._common``) and
``DB_PING_TIMEOUT_SECONDS`` (``routes.health``).

Secrets (``ADMIN_API_TOKEN``, the entitlement keys, ``APPLE_IAP_PRIVATE_KEY`` and
``GOOGLE_PLAY_SERVICE_ACCOUNT_JSON``) are ``SecretStr``, so a
``repr()`` or log of ``Settings`` shows ``**********``; call ``.get_secret_value()``
where the value is used.
"""

from __future__ import annotations

from typing import Any

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, PydanticBaseSettingsSource, SettingsConfigDict

# CORS origins when ALLOWED_ORIGINS is unset or empty: the local Expo dev servers.
DEFAULT_ALLOWED_ORIGINS: tuple[str, ...] = ("http://localhost:8081", "http://localhost:19006")
# The Sentry environment when ENVIRONMENT is unset (sentry-sdk's own default is
# "production", which mis-tagged every dev-API event, #851).
DEFAULT_SENTRY_ENVIRONMENT = "development"


class Settings(BaseSettings):
    """The API's env-driven configuration.

    Each field's alias is its env var name, and only the alias is read — from the
    environment and as a keyword: ``Settings(ENVIRONMENT="test")``. A keyword that
    is not an env var name (``Settings(environment="test")``) is an error rather
    than silently ignored, and a lower-case ``environment`` env var is not read.
    """

    model_config = SettingsConfigDict(
        case_sensitive=True,
        extra="forbid",
        frozen=True,
    )

    # Deployment environment: "production", "development", "test" or unset.
    environment: str | None = Field(default=None, alias="ENVIRONMENT")
    # Comma-separated full origins; unset or empty → DEFAULT_ALLOWED_ORIGINS.
    allowed_origins_raw: str = Field(default="", alias="ALLOWED_ORIGINS")
    sentry_dsn: str | None = Field(default=None, alias="SENTRY_DSN")
    # Injected by Render; becomes the Sentry release.
    render_git_commit: str | None = Field(default=None, alias="RENDER_GIT_COMMIT")
    # Raw values; limiter.load_proxy_trust validates them (and raises) at startup.
    trusted_proxy_mode: str | None = Field(default=None, alias="TRUSTED_PROXY_MODE")
    # A raw string on purpose (limiter.load_proxy_trust parses it), so tests must
    # pass a string: Settings(TRUSTED_PROXY_HOPS="3"), not 3.
    trusted_proxy_hops: str | None = Field(default=None, alias="TRUSTED_PROXY_HOPS")
    log_proxy_headers: str = Field(default="", alias="LOG_PROXY_HEADERS")
    # Raw value; ``database_url`` strips it and treats empty as unset. db.base adds
    # the async driver, alembic/env.py strips it.
    database_url_raw: str = Field(default="", alias="DATABASE_URL")
    # Raw strings, parsed where they are used, so a bad value fails exactly as it
    # did: daily_word.puzzle int()s DAILY_WORD_SALT when imported (an empty or
    # non-integer value raises ValueError), and daily_challenge.definitions.parse_salt
    # never raises (unset or blank → 0, a non-integer is hashed).
    daily_word_salt: str = Field(default="0", alias="DAILY_WORD_SALT")
    daily_challenge_salt: str | None = Field(default=None, alias="DAILY_CHALLENGE_SALT")

    # Admin token for PATCH /games/catalog/{id}; empty → the route always answers 403.
    admin_api_token: SecretStr = Field(default=SecretStr(""), alias="ADMIN_API_TOKEN")
    # The ENTITLEMENT_* fields are read from entitlements.service's own lazy Settings,
    # not app.state.settings; create_app(settings) does not affect them.
    # Raw; ``entitlement_dev_override`` is true only for the word "true", any case.
    entitlement_dev_override_raw: str = Field(default="", alias="ENTITLEMENT_DEV_OVERRIDE")
    # RS256 PEM pair; ``entitlement_keys`` treats a blank value as absent.
    entitlement_private_key: SecretStr = Field(
        default=SecretStr(""), alias="ENTITLEMENT_PRIVATE_KEY"
    )
    entitlement_public_key: SecretStr = Field(default=SecretStr(""), alias="ENTITLEMENT_PUBLIC_KEY")

    # The APPLE_* / GOOGLE_* store config is read from purchases._common's own lazy
    # Settings, not app.state.settings; create_app(settings) does not affect it.
    # Every value except the two *_ENVIRONMENTS lists is stripped on load, so unset,
    # empty and blank all read as "" (the old ``(os.environ.get(n) or "").strip()``).
    apple_bundle_id: str = Field(default="", alias="APPLE_BUNDLE_ID")
    apple_app_id: str = Field(default="", alias="APPLE_APP_ID")
    apple_iap_issuer_id: str = Field(default="", alias="APPLE_IAP_ISSUER_ID")
    apple_iap_key_id: str = Field(default="", alias="APPLE_IAP_KEY_ID")
    apple_iap_private_key: SecretStr = Field(default=SecretStr(""), alias="APPLE_IAP_PRIVATE_KEY")
    apple_iap_online_checks: str = Field(default="", alias="APPLE_IAP_ONLINE_CHECKS")
    google_play_package_name: str = Field(default="", alias="GOOGLE_PLAY_PACKAGE_NAME")
    google_play_service_account_json: SecretStr = Field(
        default=SecretStr(""), alias="GOOGLE_PLAY_SERVICE_ACCOUNT_JSON"
    )
    google_rtdn_audience: str = Field(default="", alias="GOOGLE_RTDN_AUDIENCE")
    google_rtdn_push_sa: str = Field(default="", alias="GOOGLE_RTDN_PUSH_SA")
    # Raw, not stripped: ``purchases.verifiers.allowed_environments`` falls back to
    # its default when the value is empty and does the strip/lowercase/split itself.
    apple_iap_environments_raw: str = Field(default="", alias="APPLE_IAP_ENVIRONMENTS")
    google_play_environments_raw: str = Field(default="", alias="GOOGLE_PLAY_ENVIRONMENTS")

    # Operational tunables (#3110). Defaults are the values the modules hard-coded;
    # each is read through the owning module's lazy ``_settings`` (never at import).
    # A value outside its bounds fails ``Settings()`` — at startup via ``create_app``.
    # Entitlement JWT lifetime (entitlements.service). At most 7 days: the client's
    # offline grace is 7 days, so a longer token would outlive the grace window.
    entitlement_token_ttl_hours: int = Field(
        default=24, alias="ENTITLEMENT_TOKEN_TTL_HOURS", ge=1, le=168
    )
    # An open game this old is closed as abandoned (games.sweep, games.sweep_gate).
    stale_game_after_hours: int = Field(default=24, alias="STALE_GAME_AFTER_HOURS", ge=1, le=720)
    # Largest accepted JSON ``result`` on game completion (games.sessions). Capped at
    # 128 KiB, half the 256 KiB ``/games`` request-body cap (middleware.body_size), so
    # the completion envelope always fits and a valid result is never rejected with 413.
    max_result_bytes: int = Field(default=8192, alias="MAX_RESULT_BYTES", ge=1024, le=131_072)
    # How far back the daily-challenge streak looks, and so its cap (daily_challenge.streak).
    streak_lookback_days: int = Field(default=60, alias="STREAK_LOOKBACK_DAYS", ge=1, le=365)
    # The App Store notification-history replay window (purchases.apple_notifications).
    # The one window is sent to every environment, and Sandbox only accepts a startDate
    # within 30 days (Production allows 180), so the cap is 720 h = 30 days.
    apple_replay_window_hours: int = Field(
        default=48, alias="APPLE_REPLAY_WINDOW_HOURS", ge=1, le=720
    )
    # Bound on the ``/health/db`` ``SELECT 1`` (routes.health).
    db_ping_timeout_seconds: float = Field(
        default=5.0, alias="DB_PING_TIMEOUT_SECONDS", gt=0, le=60
    )

    @field_validator(
        "apple_bundle_id",
        "apple_app_id",
        "apple_iap_issuer_id",
        "apple_iap_key_id",
        "apple_iap_private_key",
        "apple_iap_online_checks",
        "google_play_package_name",
        "google_play_service_account_json",
        "google_rtdn_audience",
        "google_rtdn_push_sa",
        mode="before",
    )
    @classmethod
    def _strip_store_value(cls, value: Any) -> Any:
        if isinstance(value, SecretStr):
            return SecretStr(value.get_secret_value().strip())
        return value.strip() if isinstance(value, str) else value

    @classmethod
    def isolated(cls, **values: Any) -> Settings:
        """Build ``Settings`` from the keywords alone, ignoring ``os.environ``.

        For tests: ``Settings(...)`` still fills every field it is not given from
        the environment (which may hold a developer's ``backend/.env`` once
        ``main`` has called ``load_dotenv()``), so a test could pick up a real
        ``SENTRY_DSN``. Unspecified fields here take their defaults.
        """

        class _Isolated(cls):  # type: ignore[valid-type, misc]
            @classmethod
            def settings_customise_sources(
                cls_,
                settings_cls: type[BaseSettings],
                init_settings: PydanticBaseSettingsSource,
                env_settings: PydanticBaseSettingsSource,
                dotenv_settings: PydanticBaseSettingsSource,
                file_secret_settings: PydanticBaseSettingsSource,
            ) -> tuple[PydanticBaseSettingsSource, ...]:
                return (init_settings,)

        return _Isolated(**values)

    @property
    def database_url(self) -> str | None:
        """DATABASE_URL stripped, or ``None`` when it is unset, empty or blank."""
        return self.database_url_raw.strip() or None

    @property
    def entitlement_dev_override(self) -> bool:
        """``ENTITLEMENT_DEV_OVERRIDE`` is the word ``true`` (any case)."""
        return self.entitlement_dev_override_raw.lower() == "true"

    @property
    def entitlement_keys(self) -> tuple[str, str] | None:
        """The (private, public) PEM pair, stripped, or ``None`` unless both are non-blank."""
        private = self.entitlement_private_key.get_secret_value().strip()
        public = self.entitlement_public_key.get_secret_value().strip()
        return (private, public) if private and public else None

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    @property
    def is_test(self) -> bool:
        return self.environment == "test"

    @property
    def allowed_origins(self) -> list[str]:
        """CORS origins: ALLOWED_ORIGINS split on commas, or the local dev servers."""
        if not self.allowed_origins_raw:
            return list(DEFAULT_ALLOWED_ORIGINS)
        return [o.strip() for o in self.allowed_origins_raw.split(",") if o.strip()]

    @property
    def sentry_environment(self) -> str:
        return DEFAULT_SENTRY_ENVIRONMENT if self.environment is None else self.environment

    @property
    def log_proxy_headers_requested(self) -> bool:
        """``LOG_PROXY_HEADERS=1`` is set (whether or not production ignores it)."""
        return self.log_proxy_headers.strip() == "1"

    def proxy_environ(self) -> dict[str, str]:
        """The client-IP trust variables as the env mapping ``limiter`` parses.

        Unset variables are left out, exactly as they are absent from
        ``os.environ``.
        """
        values = {
            "ENVIRONMENT": self.environment,
            "TRUSTED_PROXY_MODE": self.trusted_proxy_mode,
            "TRUSTED_PROXY_HOPS": self.trusted_proxy_hops,
            "LOG_PROXY_HEADERS": self.log_proxy_headers,
        }
        return {k: v for k, v in values.items() if v is not None}
