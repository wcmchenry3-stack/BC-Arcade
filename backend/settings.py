"""Process configuration: one ``Settings`` object built from the environment (#2997).

``main.create_app()`` builds a ``Settings`` once (or takes one a test passes in),
keeps it on ``app.state.settings`` and hands the relevant fields to the code that
needs them. Tests override configuration by passing ``create_app(Settings(...))``
or by setting env vars before ``create_app()``; nothing here is read when a module
is imported.

Parity rules (the owner decisions on #2997):

- Every env var keeps its exact name, with no prefix, and is matched
  case-sensitively, as ``os.environ`` is on Linux.
- Every default is the one the old ``os.environ.get`` call used. Values stay raw
  strings where the old code parsed them itself, so the parse — and the startup
  error a bad value raises — is unchanged (``TRUSTED_PROXY_*`` is validated by
  ``limiter.load_proxy_trust``).
- ``backend/.env`` is still loaded by ``load_dotenv()`` in ``main``, not here, so
  the precedence (a real env var wins) is unchanged.
- Operational tunables are named constants, not env vars.

Migrated so far: the app-level settings ``main``, ``limiter`` and
``observability.sentry`` read. The package-level variables (``DATABASE_URL``,
``ADMIN_API_TOKEN``, ``ENTITLEMENT_*``, ``DAILY_*_SALT``, the ``APPLE_*`` /
``GOOGLE_*`` store config) move here one package per PR.
"""

from __future__ import annotations

from typing import Any

from pydantic import Field
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
