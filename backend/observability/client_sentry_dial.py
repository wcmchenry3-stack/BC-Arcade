"""The app's Sentry dial (#3437, epic #3273): turns frontend Sentry volume down
without an app release.

``GET /games/catalog`` (which the app already fetches once per launch and at most
once an hour in the foreground, for the replay dial) serves it as
``client_sentry: {enabled, sample_rate}``. No new endpoint, poll or table.

- ``CLIENT_SENTRY_ENABLED`` (default ``true``): ``false`` stops the app's error,
  message and metric events on its next catalog fetch; the keep-list (fatal JS
  crashes, native crashes and hangs, player-sent feedback) is in
  ``docs/FEEDBACK-OBSERVABILITY.md``.
- ``CLIENT_SENTRY_SAMPLE_RATE`` (default ``1.0``, 0..1): the share of those events
  the app sends. A value outside 0..1 fails ``Settings`` validation at startup, so
  a bad value fails the deploy and the running instance keeps serving.

Both are env vars on Render: change them and redeploy (no code release, no
migration). Read lazily through this module's own ``_settings`` and kept for the
process, like ``REPLAY_RECORDING_ENABLED`` (``games.sessions``).
"""

from __future__ import annotations

from settings import Settings

_settings: Settings | None = None


def _get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings


def client_sentry_dial() -> tuple[bool, float]:
    """``(enabled, sample_rate)`` for the catalog's ``client_sentry`` block.

    The rate is rounded to 4 places, so a float read from the env is served as
    the value it was set to.
    """
    s = _get_settings()
    return s.client_sentry_enabled, round(float(s.client_sentry_sample_rate), 4)
