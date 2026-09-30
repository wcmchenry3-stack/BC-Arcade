"""Apple (App Store) boundary for ``POST /purchases/apple`` (#840; verification is #2786).

What lives here now:

* :func:`expected_account_token` — the ``appAccountToken`` the client must pass
  to StoreKit for this session (docs/IAP.md §4).
* :func:`parse_store_key` — reads ``originalTransactionId`` from the
  **unverified** JWS payload, only so the per-``store_key`` rate limit can be
  counted before any store call (IAP.md §8.2). Nothing is granted from it.
* :func:`get_apple_verifier` — the FastAPI dependency that supplies the
  :class:`~purchases.verifiers.AppleVerifier`.

TODO(#2786): replace ``get_apple_verifier``'s body with a verifier built from
``APPLE_IAP_*`` / ``APPLE_BUNDLE_ID`` / ``APPLE_APP_ID`` / ``APPLE_IAP_ENVIRONMENTS``
(one ``SignedDataVerifier`` + ``AppStoreServerAPIClient`` per allowed
environment, IAP.md §6.2), and add ``POST /purchases/apple/notifications``
(ASSN v2, §6.5) plus the notification-history replay cron. Both should call
``purchases.service.apply_store_state`` for REFUND / REVOKE / REFUND_REVERSED.
"""

from __future__ import annotations

import base64
import binascii
import json
import uuid

from .verifiers import AppleVerifier, NotConfiguredAppleVerifier, PurchaseError

# Namespace for appAccountToken = uuid5(APP_ACCOUNT_NS, X-Session-ID). A fixed,
# public constant shared with the client (#841/#2786) — not a secret. Changing
# it breaks the ownership check for every purchase made before the change.
APP_ACCOUNT_NS = uuid.UUID("9be30341-bb1d-44c0-a581-03038f538fe9")


def expected_account_token(session_id: str) -> str:
    """``uuid5(APP_ACCOUNT_NS, session_id)`` as a lowercase canonical UUID string."""
    return str(uuid.uuid5(APP_ACCOUNT_NS, session_id))


def account_token_matches(session_id: str, token: str | None) -> bool:
    """True when ``token`` is this session's appAccountToken (case-insensitive UUID)."""
    if not token:
        return False
    try:
        return uuid.UUID(token) == uuid.UUID(expected_account_token(session_id))
    except ValueError:
        return False


def _b64url_json(segment: str) -> dict:
    padded = segment + "=" * (-len(segment) % 4)
    return json.loads(base64.urlsafe_b64decode(padded.encode("ascii")))


def parse_store_key(signed_transaction: str) -> str:
    """``originalTransactionId`` from the JWS payload, **without** verifying it.

    Only for rate-limit bucketing. Raises ``400 invalid_request`` when the
    string is not a three-part JWS whose payload names a transaction.
    """
    parts = signed_transaction.split(".")
    if len(parts) != 3:
        raise PurchaseError(400, "invalid_request")
    try:
        payload = _b64url_json(parts[1])
    except (ValueError, UnicodeError, binascii.Error):
        raise PurchaseError(400, "invalid_request") from None
    key = payload.get("originalTransactionId") if isinstance(payload, dict) else None
    if not isinstance(key, str | int) or isinstance(key, bool) or not str(key):
        raise PurchaseError(400, "invalid_request")
    return str(key)


_verifier: AppleVerifier = NotConfiguredAppleVerifier()


def get_apple_verifier() -> AppleVerifier:
    """FastAPI dependency. Tests override it via ``app.dependency_overrides``."""
    return _verifier
