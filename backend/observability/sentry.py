"""Backend Sentry setup: SDK options, scrub lists and the event hooks (#840, #2787, #2863).

``init_sentry()`` is called by ``main.create_app()``; it is a no-op when
``SENTRY_DSN`` is unset (local dev, most CI jobs). ``sentry_options()`` builds
the ``sentry_sdk.init`` kwargs and is what the tests exercise.
"""

from __future__ import annotations

import os
import re

import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.starlette import StarletteIntegration
from sentry_sdk.scrubber import DEFAULT_DENYLIST, EventScrubber

# Keys the SDK would otherwise forward verbatim. Its default denylist knows none
# of ours (the SDK lowercases both sides, so matching is case-insensitive):
# X-Admin-Token is a secret, and X-Session-ID / session_id is the player's
# pseudonymous ID — the Privacy Policy says crash reports carry no identifier.
# The store evidence of POST /purchases/* (#840) is a bearer credential for a
# paid purchase: purchase_token (Google), signed_transaction / signedPayload
# (Apple JWS) and the store_key derived from either. Google Play (#2787) adds
# the Play API / RTDN spelling purchaseToken, the obfuscated account id (a
# session derivative), the order id, and the service-account key; the RTDN
# bearer token is "authorization", already in the SDK's default denylist.
SENTRY_SCRUBBED_KEYS = [
    "x-session-id",
    "x-admin-token",
    "session_id",
    "purchase_token",
    "signed_transaction",
    "signedPayload",
    "store_key",
    "purchaseToken",
    "obfuscatedExternalAccountId",
    "account_token",
    "orderId",
    "service_account_json",
    "service_account_info",
    # Client IP headers (#2863). The SDK's header filter already drops
    # X-Forwarded-For and X-Real-IP; the Cloudflare ones and Forwarded it does
    # not know. All five are listed so the rule does not depend on SDK
    # internals — the Privacy Policy says Sentry does not store IP addresses.
    "cf-connecting-ip",
    "true-client-ip",
    "x-forwarded-for",
    "x-real-ip",
    "forwarded",
]

# SQLAlchemy appends the statement and its bound values to every DBAPIError
# message ("[SQL: ...]", "[parameters: ...]"), and Postgres adds a
# "DETAIL:  Key (...)=(...)" line to constraint errors. Those values can be
# session ids or store keys, so they are cut before an event leaves.
_SQL_FRAGMENT = re.compile(r"\s*\[(?:SQL|parameters): .*", re.DOTALL)
_PG_DETAIL = re.compile(r"\n?[ \t]*DETAIL: [^\n]*")
SQL_REDACTED = " [SQL redacted]"


def _strip_sql(text: str) -> str:
    stripped = _PG_DETAIL.sub("", _SQL_FRAGMENT.sub("", text))
    return stripped + SQL_REDACTED if stripped != text else text


def _sentry_before_send(event: dict, hint: dict) -> dict:
    """Remove SQL statements, bound parameters and constraint details from an event."""
    for exc in (event.get("exception") or {}).get("values") or []:
        if isinstance(exc.get("value"), str):
            exc["value"] = _strip_sql(exc["value"])
    logentry = event.get("logentry")
    if isinstance(logentry, dict):
        for key in ("message", "formatted"):
            if isinstance(logentry.get(key), str):
                logentry[key] = _strip_sql(logentry[key])
    if isinstance(event.get("message"), str):
        event["message"] = _strip_sql(event["message"])
    return _redact_store_ids(event)


# Store API URLs carry credentials in their path or query: Google Play
# `.../purchases/productsv2/tokens/<purchaseToken>` and `.../products/<id>/tokens/<token>:acknowledge`,
# Apple `/inApps/v1/transactions/<transactionId>` and `/inApps/v1/history/<id>`,
# and pagination tokens (`?paginationToken=` for Apple notification history,
# `?token=` for Google voided purchases). The SDK's HTTP integrations (httpx,
# stdlib http.client) put full URLs into span descriptions and data and into
# breadcrumbs, which no key denylist catches — so every string in those is
# rewritten (#2787 security review B1). `before_send` does not run on
# transactions, hence the separate transaction and breadcrumb hooks.
_STORE_ID_PATTERNS = (
    (re.compile(r"(/tokens/)[^/?#:\s\"']+"), r"\1[redacted]"),
    (re.compile(r"(/transactions/)[^/?#\s\"']+"), r"\1[redacted]"),
    (re.compile(r"(/history/)[^/?#\s\"']+"), r"\1[redacted]"),
    (re.compile(r"((?:[?&]|^)(?:paginationToken|token)=)[^&#\s\"']+"), r"\1[redacted]"),
)


def _redact_text(text: str) -> str:
    for pattern, replacement in _STORE_ID_PATTERNS:
        text = pattern.sub(replacement, text)
    return text


def _redact_store_ids(value):
    """Recursively redact store IDs in every string of a dict / list structure."""
    if isinstance(value, str):
        return _redact_text(value)
    if isinstance(value, dict):
        return {k: _redact_store_ids(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_redact_store_ids(v) for v in value]
    return value


def _sentry_before_send_transaction(event: dict, hint: dict) -> dict:
    """Redact store IDs from a performance transaction (span descriptions, span data, breadcrumbs)."""
    return _redact_store_ids(event)


def _sentry_before_breadcrumb(crumb: dict, hint: dict) -> dict:
    """Redact store IDs from a breadcrumb (HTTP client breadcrumbs carry the full URL)."""
    return _redact_store_ids(crumb)


def sentry_options(dsn: str) -> dict:
    """Build the sentry_sdk.init kwargs.

    `environment` comes from ENVIRONMENT (set per service in render.yaml) and
    defaults to "development" — sentry-sdk's own default is "production", which
    tagged every dev-API event as production (#851). `release` is the deployed
    commit, which Render injects as RENDER_GIT_COMMIT.

    Request bodies are never attached (``max_request_body_size="never"``): the
    SDK has only a global switch, and /purchases bodies are store credentials
    (#840). Frame locals are off for the same reason — the repr of a local (a
    request model, a verifier's evidence) is not caught by a key denylist.
    """
    return {
        "dsn": dsn,
        "integrations": [StarletteIntegration(), FastApiIntegration()],
        "traces_sample_rate": 0.1,
        "environment": os.environ.get("ENVIRONMENT", "development"),
        "release": os.environ.get("RENDER_GIT_COMMIT"),
        "send_default_pii": False,
        "max_request_body_size": "never",
        "include_local_variables": False,
        "event_scrubber": EventScrubber(
            denylist=DEFAULT_DENYLIST + SENTRY_SCRUBBED_KEYS, recursive=True
        ),
        "before_send": _sentry_before_send,
        # Hooks rather than disabling the HTTP integrations: they cover httpx
        # (Google Play, the Apple API client) and stdlib http.client alike,
        # including any client added later, and keep outbound-call spans for
        # latency debugging.
        "before_send_transaction": _sentry_before_send_transaction,
        "before_breadcrumb": _sentry_before_breadcrumb,
    }


_initialised = False


def init_sentry() -> bool:
    """Initialise the SDK from SENTRY_DSN, once per process. Returns whether it ran.

    Runs before the FastAPI app is constructed (as the old import-time call
    did) so the Starlette/FastAPI integrations are patched in first. A second
    ``create_app()`` in the same process (tests) does not re-initialise the
    process-global client.
    """
    global _initialised
    if _initialised:
        return False
    _sentry_dsn = os.environ.get("SENTRY_DSN")
    if _sentry_dsn:
        sentry_sdk.init(**sentry_options(_sentry_dsn))
        _initialised = True
        return True
    return False
