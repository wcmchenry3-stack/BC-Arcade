"""Google Play boundary for ``POST /purchases/google`` (#840) and its runtime (#2787).

* :func:`expected_account_token` — the ``obfuscatedAccountId`` the client must
  pass to Play Billing for this session (docs/IAP.md §4).
* :func:`configured_runtime` — the real verifier and the RTDN push
  authenticator (:class:`purchases.google_notifications.GoogleRuntime`),
  built from the environment on first use.
* :func:`get_google_verifier` — the FastAPI dependency that supplies the
  :class:`~purchases.verifiers.GoogleVerifier`.

Without ``GOOGLE_PLAY_PACKAGE_NAME`` (or with any other required variable
missing, docs/IAP.md §16) the runtime is None, the dependency keeps returning
:class:`~purchases.verifiers.NotConfiguredGoogleVerifier`, and every Google
route answers ``503 store_unavailable`` — the dormant default. Verification
is in ``purchases/google_play.py``; the RTDN webhook, the voided-purchases
poll and the acknowledgement sweep in ``purchases/google_notifications.py``.
"""

from __future__ import annotations

import hashlib
import hmac
from typing import Any

from .verifiers import GoogleVerifier, NotConfiguredGoogleVerifier


def expected_account_token(session_id: str) -> str:
    """``hex(SHA-256(session_id))`` — 64 lowercase hex characters."""
    return hashlib.sha256(session_id.encode("utf-8")).hexdigest()


def account_token_matches(session_id: str, token: str | None) -> bool:
    if not token:
        return False
    return hmac.compare_digest(token.lower(), expected_account_token(session_id))


_NOT_CONFIGURED = NotConfiguredGoogleVerifier()
_UNSET: Any = object()
_runtime: Any = _UNSET  # GoogleRuntime | None once read


def configured_runtime():  # -> purchases.google_notifications.GoogleRuntime | None
    """The Google runtime built from the environment (cached), or None when dormant."""
    global _runtime
    if _runtime is _UNSET:
        from .google_notifications import build_from_env

        _runtime = build_from_env()
    return _runtime


def configured_verifier():  # -> purchases.google_play.PlayVerifier | None
    runtime = configured_runtime()
    return None if runtime is None else runtime.verifier


def reset_google_runtime() -> None:
    """Forget the cached runtime so the next call re-reads the environment (tests)."""
    global _runtime
    _runtime = _UNSET


def get_google_verifier() -> GoogleVerifier:
    """FastAPI dependency. Tests override it via ``app.dependency_overrides``."""
    return configured_verifier() or _NOT_CONFIGURED
