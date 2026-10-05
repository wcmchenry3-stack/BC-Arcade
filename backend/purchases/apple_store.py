"""Real App Store verification for ``POST /purchases/apple`` and the ASSN v2 webhook (#2786).

Built on Apple's official ``app-store-server-library`` (docs/IAP.md §6.2):

* :class:`AppStoreVerifier` implements :class:`~purchases.verifiers.AppleVerifier`.
  It verifies a StoreKit 2 ``signedTransaction`` JWS locally — ES256 only, a
  three-certificate ``x5c`` chain that must end at the bundled **Apple Root
  CA - G3** (``purchases/certs/``), Apple's leaf/intermediate marker OIDs,
  certificate validity, the bundle id and the environment — then, when App Store Server
  API credentials are configured, re-reads the transaction with **Get
  Transaction Info** and verifies that answer the same way.
* :func:`load_config` reads the environment. Without ``APPLE_BUNDLE_ID`` (or
  without ``APPLE_APP_ID`` while Production is allowed) it returns None and
  the routes keep answering ``503 store_unavailable`` — the dormant default.

One ``SignedDataVerifier`` (and, with credentials, one API client) exists per
allowed environment: the environment named in the **unverified** payload only
picks which one to use, and the library then checks that the *signed*
environment matches it.

Certificate checks follow ``APPLE_IAP_ONLINE_CHECKS``. **On** (the default,
and the only setting accepted when ``ENVIRONMENT=production``): validity is
checked at the current time and both certificates are checked by OCSP.
**Off**: no OCSP, and validity is checked at the JWS's own ``signedDate`` —
so a revoked signing certificate with a backdated ``signedDate`` would pass;
for local/dev use only.

The library's verification is synchronous (pyOpenSSL chain building, and
``requests`` for OCSP), so it runs in a worker thread.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import json
import logging
import os
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import anyio
import sentry_sdk
from appstoreserverlibrary.api_client import APIException, AsyncAppStoreServerAPIClient
from appstoreserverlibrary.models.Environment import Environment as AppleEnvironment
from appstoreserverlibrary.models.JWSTransactionDecodedPayload import (
    JWSTransactionDecodedPayload,
)
from appstoreserverlibrary.models.ResponseBodyV2DecodedPayload import (
    ResponseBodyV2DecodedPayload,
)
from appstoreserverlibrary.signed_data_verifier import (
    SignedDataVerifier,
    VerificationException,
    VerificationStatus,
)

from .verifiers import (
    AppleEvidence,
    Environment,
    PurchaseError,
    VerifiedPurchase,
    allowed_environments,
)

_log = logging.getLogger("audit")

CERT_DIR = Path(__file__).parent / "certs"
APPLE_ROOT_CA_G3_FILE = CERT_DIR / "AppleRootCA-G3.cer"
# SHA-256 of the DER certificate, as published at
# https://www.apple.com/certificateauthority/ ("Apple Root CA - G3 Root").
# Checked on load, so a swapped file cannot silently change what is trusted.
APPLE_ROOT_CA_G3_SHA256 = "63343abfb89a6a03ebb57e9b3f5fa7be7c4f5c756f3017b3a8c488c3653e9179"

# Apple's name for each environment we can accept → ours (verifiers.Environment).
_ENV_FROM_APPLE: dict[str, Environment] = {"Production": "production", "Sandbox": "sandbox"}
_APPLE_ENV: dict[Environment, AppleEnvironment] = {
    "production": AppleEnvironment.PRODUCTION,
    "sandbox": AppleEnvironment.SANDBOX,
}

NON_CONSUMABLE = "Non-Consumable"


def load_apple_root_certificates() -> list[bytes]:
    """The bundled Apple Root CA - G3 (DER), after checking its fingerprint."""
    der = APPLE_ROOT_CA_G3_FILE.read_bytes()
    if hashlib.sha256(der).hexdigest() != APPLE_ROOT_CA_G3_SHA256:
        raise RuntimeError("bundled Apple Root CA - G3 does not match its pinned fingerprint")
    return [der]


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class AppleApiCredentials:
    """App Store Connect In-App Purchase key (App Store Server API)."""

    issuer_id: str
    key_id: str
    private_key: bytes = field(repr=False)  # PEM; never in a repr or log


@dataclass(frozen=True)
class AppleConfig:
    bundle_id: str
    app_apple_id: int | None
    environments: frozenset[Environment]
    online_checks: bool
    api: AppleApiCredentials | None


def _env(name: str) -> str:
    return (os.environ.get(name) or "").strip()


def _misconfigured(reason: str) -> None:
    """Report why Apple verification stays dormant: the reason code only.

    Never an exception text or a variable's value (the private key). Goes to
    the audit log and, as a message, to Sentry, so a set-but-broken
    configuration is not silent.
    """
    _log.warning(json.dumps({"event": "apple_iap_misconfigured", "reason": reason}))
    sentry_sdk.capture_message(f"apple_iap_misconfigured: {reason}", level="warning")


def load_config() -> AppleConfig | None:
    """The Apple settings from the environment, or None when verification must stay dormant.

    Required: ``APPLE_BUNDLE_ID``; ``APPLE_APP_ID`` (numeric) when ``Production``
    is in ``APPLE_IAP_ENVIRONMENTS``. Optional: ``APPLE_IAP_ISSUER_ID`` +
    ``APPLE_IAP_KEY_ID`` + ``APPLE_IAP_PRIVATE_KEY`` (all three, or none) for
    the App Store Server API; ``APPLE_IAP_ONLINE_CHECKS`` (default on).
    A half-set configuration is logged (names only) and treated as missing.
    """
    bundle_id = _env("APPLE_BUNDLE_ID")
    if not bundle_id:
        return None
    envs = frozenset(e for e in allowed_environments("apple") if e in _APPLE_ENV)
    if not envs:
        _misconfigured("environments")
        return None
    app_apple_id: int | None = None
    raw_app_id = _env("APPLE_APP_ID")
    if raw_app_id:
        if not (raw_app_id.isascii() and raw_app_id.isdigit()):
            _misconfigured("app_id")
            return None
        app_apple_id = int(raw_app_id)
    elif "production" in envs:
        _misconfigured("app_id")
        return None

    api_parts = [
        _env("APPLE_IAP_ISSUER_ID"),
        _env("APPLE_IAP_KEY_ID"),
        _env("APPLE_IAP_PRIVATE_KEY"),
    ]
    api: AppleApiCredentials | None = None
    if all(api_parts):
        # Render stores a multi-line PEM fine, but a pasted "\n"-escaped one is common.
        pem = api_parts[2].replace("\\n", "\n").encode("utf-8")
        api = AppleApiCredentials(issuer_id=api_parts[0], key_id=api_parts[1], private_key=pem)
    elif any(api_parts):
        _misconfigured("api_key")
        return None

    online = _env("APPLE_IAP_ONLINE_CHECKS").lower() not in {"0", "false", "no", "off"}
    if not online and _env("ENVIRONMENT") == "production":
        # Offline checks trust the JWS's own signedDate for certificate
        # validity and skip OCSP; never acceptable on the production API.
        _misconfigured("online_checks_off_in_production")
        return None
    return AppleConfig(
        bundle_id=bundle_id,
        app_apple_id=app_apple_id,
        environments=envs,  # type: ignore[arg-type]
        online_checks=online,
        api=api,
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _unverified_payload(jws: str) -> dict[str, Any]:
    """The JWS payload **without** verifying it — only to pick a verifier."""
    parts = jws.split(".")
    if len(parts) != 3:
        raise PurchaseError(400, "invalid_request")
    try:
        padded = parts[1] + "=" * (-len(parts[1]) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded.encode("ascii")))
    except (ValueError, UnicodeError, binascii.Error):
        raise PurchaseError(400, "invalid_request") from None
    if not isinstance(payload, dict):
        raise PurchaseError(400, "invalid_request")
    return payload


def _ms(value: int | None) -> datetime | None:
    if value is None:
        return None
    return datetime.fromtimestamp(value / 1000, tz=timezone.utc)


def _verification_error(exc: VerificationException) -> PurchaseError:
    if exc.status == VerificationStatus.RETRYABLE_VERIFICATION_FAILURE:
        return PurchaseError(503, "store_unavailable")
    if exc.status == VerificationStatus.INVALID_APP_IDENTIFIER:
        return PurchaseError(422, "wrong_app")
    return PurchaseError(422, "verification_failed")


def revocation_reason(txn: JWSTransactionDecodedPayload) -> str:
    """A short, stable reason string for ``purchases.revocation_reason``."""
    if txn.rawRevocationType == "FAMILY_REVOKE":
        return "family_revoke"
    if txn.rawRevocationReason == 1:
        return "refund_app_issue"
    if txn.rawRevocationReason == 0:
        return "refund_other"
    return "revoked"


def _notification_environment(payload: dict[str, Any]) -> object:
    """The (unverified) Apple environment name, found where the library looks for it."""
    for key in ("data", "summary"):
        section = payload.get(key)
        if isinstance(section, dict) and section:
            return section.get("environment")
    token = payload.get("externalPurchaseToken")
    if isinstance(token, dict) and token:
        external_id = token.get("externalPurchaseId")
        sandbox = isinstance(external_id, str) and external_id.startswith("SANDBOX")
        return "Sandbox" if sandbox else "Production"
    app_data = payload.get("appData")
    if isinstance(app_data, dict) and app_data:
        return app_data.get("environment")
    return None


# ---------------------------------------------------------------------------
# Verifier
# ---------------------------------------------------------------------------


class AppStoreVerifier:
    """The real :class:`~purchases.verifiers.AppleVerifier` (IAP.md §6.2)."""

    def __init__(
        self,
        config: AppleConfig,
        root_certificates: list[bytes] | None = None,
        api_clients: dict[Environment, Any] | None = None,
    ) -> None:
        roots = (
            root_certificates if root_certificates is not None else (load_apple_root_certificates())
        )
        self.config = config
        # Every environment we *can* verify (Production needs the app id), so a
        # notification from a disallowed environment can still be verified and
        # then acknowledged as ignored. Transactions use only the allowed ones.
        verifiable: set[Environment] = {"sandbox"} | set(config.environments)
        if config.app_apple_id is not None:
            verifiable.add("production")
        self._all_verifiers: dict[Environment, SignedDataVerifier] = {
            env: SignedDataVerifier(
                roots,
                config.online_checks,
                _APPLE_ENV[env],
                config.bundle_id,
                config.app_apple_id,
            )
            for env in sorted(verifiable)
        }
        self._verifiers: dict[Environment, SignedDataVerifier] = {
            env: v for env, v in self._all_verifiers.items() if env in config.environments
        }
        if api_clients is not None:
            self._api: dict[Environment, Any] = dict(api_clients)
        elif config.api is not None:
            self._api = {
                env: AsyncAppStoreServerAPIClient(
                    config.api.private_key,
                    config.api.key_id,
                    config.api.issuer_id,
                    config.bundle_id,
                    _APPLE_ENV[env],
                )
                for env in config.environments
            }
        else:
            self._api = {}

    # -- environment selection ----------------------------------------------

    def _pick(self, apple_env: object) -> tuple[Environment, SignedDataVerifier]:
        """The verifier for an (unverified) Apple environment name, or 422."""
        env = _ENV_FROM_APPLE.get(apple_env) if isinstance(apple_env, str) else None
        if env is None or env not in self._verifiers:
            raise PurchaseError(422, "environment_not_allowed")
        return env, self._verifiers[env]

    def allows(self, env: Environment) -> bool:
        return env in self._verifiers

    @property
    def has_api(self) -> bool:
        return bool(self._api)

    def api_client(self, env: Environment) -> Any | None:
        return self._api.get(env)

    def api_environments(self) -> list[Environment]:
        return sorted(self._api)

    # -- decoding ------------------------------------------------------------

    async def decode_transaction(
        self, signed_transaction: str, env: Environment | None = None
    ) -> tuple[Environment, JWSTransactionDecodedPayload]:
        """Verify a signed transaction; ``env`` pins the verifier (else read from the payload)."""
        if env is None:
            env, verifier = self._pick(_unverified_payload(signed_transaction).get("environment"))
        else:
            verifier = self._verifiers[env]
        try:
            txn = await anyio.to_thread.run_sync(
                verifier.verify_and_decode_signed_transaction, signed_transaction
            )
        except VerificationException as exc:
            raise _verification_error(exc) from None
        except Exception:  # noqa: BLE001 — a model the library cannot structure
            raise PurchaseError(422, "verification_failed") from None
        return env, txn

    async def decode_notification(
        self, signed_payload: str
    ) -> tuple[Environment, ResponseBodyV2DecodedPayload]:
        """Verify an ASSN v2 ``signedPayload`` with the verifier its environment names.

        The environment may be one this deployment does not allow (the caller
        acknowledges those as ignored); it must still verify. One we cannot
        verify at all (Production without ``APPLE_APP_ID``, or an unknown
        name) is ``422 environment_not_allowed``.
        """
        name = _notification_environment(_unverified_payload(signed_payload))
        env = _ENV_FROM_APPLE.get(name) if isinstance(name, str) else None
        if env is None or env not in self._all_verifiers:
            raise PurchaseError(422, "environment_not_allowed")
        verifier = self._all_verifiers[env]
        try:
            decoded = await anyio.to_thread.run_sync(
                verifier.verify_and_decode_notification, signed_payload
            )
        except VerificationException as exc:
            raise _verification_error(exc) from None
        except Exception:  # noqa: BLE001
            raise PurchaseError(422, "verification_failed") from None
        return env, decoded

    # -- store API -------------------------------------------------------------

    async def _authoritative(
        self, env: Environment, txn: JWSTransactionDecodedPayload
    ) -> JWSTransactionDecodedPayload:
        """Re-read ``txn`` with Get Transaction Info when the API is configured."""
        client = self._api.get(env)
        if client is None:
            return txn
        try:
            resp = await client.get_transaction_info(txn.transactionId)
        except APIException as exc:
            if (
                exc.http_status_code in (400, 404)
                and exc.api_error is not None
                and "RETRYABLE" not in exc.api_error.name
            ):
                raise PurchaseError(422, "verification_failed") from None
            raise PurchaseError(503, "store_unavailable") from None
        except Exception:  # noqa: BLE001 — network errors, timeouts
            raise PurchaseError(503, "store_unavailable") from None
        signed = getattr(resp, "signedTransactionInfo", None)
        if not signed:
            raise PurchaseError(503, "store_unavailable")
        _, fresh = await self.decode_transaction(signed, env)
        if (
            fresh.originalTransactionId != txn.originalTransactionId
            or fresh.productId != txn.productId
        ):
            raise PurchaseError(422, "verification_failed")
        return fresh

    # -- AppleVerifier -------------------------------------------------------

    def to_verified(self, env: Environment, txn: JWSTransactionDecodedPayload) -> VerifiedPurchase:
        """Normalize a verified transaction (IAP.md §8.4 field table)."""
        if not txn.originalTransactionId or not txn.productId:
            raise PurchaseError(422, "verification_failed")
        if txn.rawType != NON_CONSUMABLE:
            raise PurchaseError(422, "unknown_product")
        revoked = txn.revocationDate is not None
        return VerifiedPurchase(
            platform="apple",
            product_id=txn.productId,
            store_key=str(txn.originalTransactionId),
            transaction_id=str(txn.transactionId) if txn.transactionId else None,
            environment=env,
            ownership_type=(
                "family_shared" if txn.rawInAppOwnershipType == "FAMILY_SHARED" else "purchased"
            ),
            # StoreKit 2 has no "pending" transaction: an Ask-to-Buy purchase
            # produces no JWS until it is approved (IAP.md §5).
            state="revoked" if revoked else "owned",
            purchased_at=_ms(txn.purchaseDate),
            account_token=txn.appAccountToken,
            revoked_at=_ms(txn.revocationDate),
            revocation_reason=revocation_reason(txn) if revoked else None,
            event_at=_ms(txn.signedDate),
        )

    async def verify(self, evidence: AppleEvidence) -> VerifiedPurchase:
        # Imported here: service imports apple, which imports this module lazily.
        from .service import slug_for_product

        env, txn = await self.decode_transaction(evidence.signed_transaction)
        # Catalog check before any store call; the service re-checks is_premium.
        if not txn.productId or slug_for_product(txn.productId) is None:
            raise PurchaseError(422, "unknown_product")
        if txn.rawType != NON_CONSUMABLE:
            raise PurchaseError(422, "unknown_product")
        txn = await self._authoritative(env, txn)
        return self.to_verified(env, txn)


def build_from_env(root_certificates: list[bytes] | None = None) -> AppStoreVerifier | None:
    """An :class:`AppStoreVerifier` from the environment, or None (dormant)."""
    config = load_config()
    if config is None:
        return None
    if root_certificates is None:
        try:
            root_certificates = load_apple_root_certificates()
        except Exception:  # noqa: BLE001 — missing or altered file: stay dormant, loudly
            _misconfigured("root_certificate")
            return None
    try:
        return AppStoreVerifier(config, root_certificates=root_certificates)
    except Exception:  # noqa: BLE001 — e.g. an unreadable private key: stay dormant, loudly
        _misconfigured("init")
        return None
