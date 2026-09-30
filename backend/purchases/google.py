"""Google Play boundary for ``POST /purchases/google`` (#840; verification is #2787).

* :func:`expected_account_token` — the ``obfuscatedAccountId`` the client must
  pass to Play Billing for this session (docs/IAP.md §4).
* :func:`get_google_verifier` — the FastAPI dependency that supplies the
  :class:`~purchases.verifiers.GoogleVerifier`.

TODO(#2787): replace ``get_google_verifier``'s body with a verifier built from
``GOOGLE_PLAY_PACKAGE_NAME`` / ``GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`` (Play
Developer API ``purchases.products.get`` + ``acknowledge``, IAP.md §7.2-7.3),
and add ``POST /purchases/google/notifications`` (RTDN, §7.4), the
voided-purchases poll and the unacknowledged-purchase sweep. Revocations call
``purchases.service.apply_store_state``.
"""

from __future__ import annotations

import hashlib
import hmac

from .verifiers import GoogleVerifier, NotConfiguredGoogleVerifier


def expected_account_token(session_id: str) -> str:
    """``hex(SHA-256(session_id))`` — 64 lowercase hex characters."""
    return hashlib.sha256(session_id.encode("utf-8")).hexdigest()


def account_token_matches(session_id: str, token: str | None) -> bool:
    if not token:
        return False
    return hmac.compare_digest(token.lower(), expected_account_token(session_id))


_verifier: GoogleVerifier = NotConfiguredGoogleVerifier()


def get_google_verifier() -> GoogleVerifier:
    """FastAPI dependency. Tests override it via ``app.dependency_overrides``."""
    return _verifier
