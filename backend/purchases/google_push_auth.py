"""Google Play RTDN push authentication and the Google runtime (#2787, IAP.md §7.6).

**Push authentication** (:class:`PushAuthenticator`). Pub/Sub push requests
carry a Google-signed OIDC ID token in ``Authorization: Bearer``. It is
verified before the body is even parsed: header ``alg`` must be ``RS256``
(no ``none``, no HMAC), the ``kid`` must name a key in Google's JWKS
(fetched over HTTPS from Google, cached), and the signature, ``iss``
(``https://accounts.google.com``), ``aud`` (``GOOGLE_RTDN_AUDIENCE``),
``exp`` and ``iat`` must check out; then ``email`` must be the configured push
service account with ``email_verified``. Anything else is 401 (403 for a
valid token from another service account). A JWKS that cannot be fetched is
503, so Pub/Sub retries. It never fails open.

**Runtime** (:class:`GoogleRuntime`). The Play verifier and the push
authenticator, built once from the environment (:func:`build_from_env`,
cached by :func:`purchases.google.configured_runtime`).

Nothing here logs the bearer token.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

import httpx
import jwt

from ._common import misconfigured
from .google_play import GoogleConfig, PlayVerifier, build_verifier
from .verifiers import PurchaseError

_log = logging.getLogger("audit")

# ---------------------------------------------------------------------------
# Push authentication (Pub/Sub OIDC)
# ---------------------------------------------------------------------------

GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs"
GOOGLE_ISSUERS = ("https://accounts.google.com", "accounts.google.com")
PUSH_ALGORITHM = "RS256"
MAX_BEARER_CHARS = 4_096
JWKS_TTL_S = 3_600.0
# An unknown kid refetches the JWKS at most this often (Google rotates keys
# rarely; this stops a flood of bogus kids from hammering Google).
JWKS_MIN_REFRESH_S = 60.0
# A failed fetch is retried at most this often, and while Google's JWKS is
# unreachable the last good keys keep serving for this long past their TTL
# (Google publishes each key well before use and keeps it for days after).
JWKS_RETRY_BACKOFF_S = 60.0
JWKS_STALE_GRACE_S = 24 * 3_600.0
JWKS_FETCH_TIMEOUT_S = 5.0
CLOCK_LEEWAY_S = 30


class GoogleJwks:
    """Google's OAuth2 signing keys (JWKS), RSA/RS256 only, cached."""

    def __init__(
        self,
        transport: httpx.AsyncBaseTransport | None = None,
        *,
        url: str = GOOGLE_JWKS_URL,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._client = httpx.AsyncClient(transport=transport, timeout=JWKS_FETCH_TIMEOUT_S)
        self._url = url
        self._clock = clock
        self._keys: dict[str, Any] = {}
        self._fetched_at: float | None = None
        self._failed_at: float | None = None
        self._lock = asyncio.Lock()

    async def _refresh(self) -> None:
        try:
            response = await self._client.get(self._url)
            data = response.json() if response.status_code == 200 else None
        except (httpx.HTTPError, ValueError):
            data = None
        listed = data.get("keys") if isinstance(data, dict) else None
        keys: dict[str, Any] = {}
        for jwk in listed if isinstance(listed, list) else []:
            if not isinstance(jwk, dict) or jwk.get("kty") != "RSA":
                continue
            if jwk.get("alg") not in (None, PUSH_ALGORITHM) or jwk.get("use") not in (None, "sig"):
                continue
            kid = jwk.get("kid")
            if not isinstance(kid, str) or not kid:
                continue
            try:
                keys[kid] = jwt.PyJWK(jwk, algorithm=PUSH_ALGORITHM).key
            except (jwt.PyJWKError, jwt.InvalidKeyError, ValueError, TypeError):
                continue
        if not keys:
            _log.warning(json.dumps({"event": "google_jwks_unavailable"}))
            raise PurchaseError(503, "store_unavailable")
        self._keys = keys
        self._fetched_at = self._clock()

    async def key(self, kid: str) -> Any | None:
        """The key for ``kid``, or None. 503 only when no usable keys exist at all.

        Refetches when the cache is past its TTL, or for an unknown ``kid``
        at most every ``JWKS_MIN_REFRESH_S``. A failed fetch is not retried
        for ``JWKS_RETRY_BACKOFF_S`` (so an outage does not make every
        request, junk tokens included, wait on Google under the lock), and
        the previous keys keep serving for ``JWKS_STALE_GRACE_S`` past the TTL.
        """
        async with self._lock:
            now = self._clock()
            age = None if self._fetched_at is None else now - self._fetched_at
            expired = age is None or age >= JWKS_TTL_S
            unknown_kid = age is not None and kid not in self._keys and age >= JWKS_MIN_REFRESH_S
            backing_off = (
                self._failed_at is not None and now - self._failed_at < JWKS_RETRY_BACKOFF_S
            )
            if (expired or unknown_kid) and not backing_off:
                try:
                    await self._refresh()
                    self._failed_at = None
                except PurchaseError:
                    self._failed_at = now
            usable = self._fetched_at is not None and (
                now - self._fetched_at < JWKS_TTL_S + JWKS_STALE_GRACE_S
            )
            if not usable:
                raise PurchaseError(503, "store_unavailable")
            return self._keys.get(kid)


class PushAuthenticator:
    """Verifies the OIDC token Pub/Sub attaches to each push (fails closed)."""

    def __init__(self, audience: str, service_account: str, jwks: GoogleJwks) -> None:
        self.audience = audience
        self.service_account = service_account.lower()
        self._jwks = jwks

    async def authenticate(self, authorization: str | None) -> dict[str, Any]:
        unauthorized = PurchaseError(401, "unauthorized")
        if not authorization or not authorization.startswith("Bearer "):
            raise unauthorized
        token = authorization[len("Bearer ") :].strip()
        if not token or len(token) > MAX_BEARER_CHARS:
            raise unauthorized
        try:
            header = jwt.get_unverified_header(token)
        except jwt.PyJWTError:
            raise unauthorized from None
        # Pin the algorithm before choosing a key: no "none", no HS256 with
        # the RSA public key as an HMAC secret, no ES/PS variants.
        if header.get("alg") != PUSH_ALGORITHM:
            raise unauthorized
        kid = header.get("kid")
        if not isinstance(kid, str) or not kid:
            raise unauthorized
        key = await self._jwks.key(kid)  # 503 when Google's JWKS is unreachable
        if key is None:
            raise unauthorized
        try:
            claims = jwt.decode(
                token,
                key,
                algorithms=[PUSH_ALGORITHM],
                audience=self.audience,
                issuer=GOOGLE_ISSUERS,
                leeway=CLOCK_LEEWAY_S,
                options={"require": ["exp", "iat", "iss", "aud"]},
            )
        except jwt.PyJWTError:
            raise unauthorized from None
        email = claims.get("email")
        if (
            not isinstance(email, str)
            or email.lower() != self.service_account
            or claims.get("email_verified") is not True
        ):
            raise PurchaseError(403, "forbidden")
        return claims


# ---------------------------------------------------------------------------
# Runtime
# ---------------------------------------------------------------------------


@dataclass
class GoogleRuntime:
    """Everything the Google routes and jobs need, built once from the environment."""

    config: GoogleConfig
    verifier: PlayVerifier
    push_auth: PushAuthenticator


def build_runtime(
    config: GoogleConfig,
    *,
    play_transport: httpx.AsyncBaseTransport | None = None,
    token_transport: httpx.BaseTransport | None = None,
    jwks_transport: httpx.AsyncBaseTransport | None = None,
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    clock: Callable[[], float] = time.monotonic,
) -> GoogleRuntime:
    verifier = build_verifier(
        config, play_transport=play_transport, token_transport=token_transport, sleep=sleep
    )
    auth = PushAuthenticator(
        config.rtdn_audience,
        config.rtdn_push_service_account,
        GoogleJwks(jwks_transport, clock=clock),
    )
    return GoogleRuntime(config=config, verifier=verifier, push_auth=auth)


def build_from_env() -> GoogleRuntime | None:
    """A :class:`GoogleRuntime` from the environment, or None (dormant)."""
    from .google_play import load_config

    config = load_config()
    if config is None:
        return None
    try:
        return build_runtime(config)
    except Exception:  # noqa: BLE001 — e.g. an unreadable private key: stay dormant, loudly
        misconfigured("google", "init")
        return None
