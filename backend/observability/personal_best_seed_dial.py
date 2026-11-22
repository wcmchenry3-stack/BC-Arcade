"""The app's personal-best seed switch (#3802, epic #3273): turns the one-off
seeding of the app's local best from ``/stats/me`` off without an app release.

``GET /games/catalog`` (already fetched once per launch, and at most once an hour
in the foreground) serves it as ``personal_best_seed: {enabled}``. No new endpoint,
poll or table.

- ``PERSONAL_BEST_SEED_ENABLED`` (default ``true``): ``false`` stops the app seeding
  its local best on its next catalog fetch. Nothing else changes; the local best
  stays authoritative.

An env var on Render: change it and redeploy (no code release, no migration). Read
lazily through this module's own ``_settings`` and kept for the process, like
``client_sentry_dial``.
"""

from __future__ import annotations

from settings import Settings

_settings: Settings | None = None


def _get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings


def personal_best_seed_enabled() -> bool:
    """The catalog's ``personal_best_seed.enabled``."""
    return _get_settings().personal_best_seed_enabled
