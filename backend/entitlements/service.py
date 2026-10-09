"""JWT signing for the entitlements endpoint (#1050).

Private key is loaded from ENTITLEMENT_PRIVATE_KEY (PEM string env var), via
``settings.Settings``. Like ``db.base``, this module builds its ``Settings`` on first
use and keeps it for the process (``create_app()`` does not pass its own here); a
test overrides it with
``monkeypatch.setattr(service, "_settings", Settings.isolated(...))``.
In CI / local dev without the env var, a freshly-generated ephemeral key pair
is used so tests can always verify the signature.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import GameEntitlement
from settings import Settings

# Keep in sync with is_premium=True rows (migrations 0014, 0016, 0020, 0022, 0023) —
# update when adding a premium game.
ALL_PREMIUM_SLUGS = ["blackjack", "cascade", "hearts", "mahjong", "starswarm"]

ALGORITHM = "RS256"

# Per-process cache — each worker generates its own ephemeral pair in local/CI.
# In production Render injects ENTITLEMENT_PRIVATE_KEY, so all workers share the same key.
_private_key_pem: str | None = None
_public_key_pem: str | None = None

# Built from the environment on first use; see the module docstring.
_settings: Settings | None = None


def _get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings


def is_dev_override_active() -> bool:
    return _get_settings().entitlement_dev_override


def _load_or_generate_keys() -> tuple[str, str]:
    """Return (private_pem, public_pem), generating an ephemeral pair if env vars are absent."""
    global _private_key_pem, _public_key_pem

    if _private_key_pem and _public_key_pem:
        return _private_key_pem, _public_key_pem

    env_keys = _get_settings().entitlement_keys
    if env_keys:
        _private_key_pem, _public_key_pem = env_keys
        return _private_key_pem, _public_key_pem

    # Ephemeral pair for local dev / CI — never used in production because
    # Render injects the env vars.
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    _private_key_pem = private_key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.TraditionalOpenSSL,
        serialization.NoEncryption(),
    ).decode()
    _public_key_pem = (
        private_key.public_key()
        .public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
        .decode()
    )
    return _private_key_pem, _public_key_pem


def get_public_key_pem() -> str:
    _, pub = _load_or_generate_keys()
    return pub


def issue_token(session_id: str, entitled_games: list[str]) -> tuple[str, datetime]:
    """Sign and return (jwt_string, expires_at)."""
    private_pem, _ = _load_or_generate_keys()
    now = datetime.now(UTC)
    exp = now + timedelta(hours=_get_settings().entitlement_token_ttl_hours)

    payload: dict[str, Any] = {
        "sub": session_id,
        "entitled_games": entitled_games,
        "iat": int(now.timestamp()),
        "exp": int(exp.timestamp()),
    }

    token = jwt.encode(payload, private_pem, algorithm=ALGORITHM)
    return token, exp


async def get_entitled_games(db_session: AsyncSession | None, session_id: str) -> list[str]:
    """Return entitled game slugs; when DEV_OVERRIDE is active, returns all premium slugs."""
    if is_dev_override_active():
        return list(ALL_PREMIUM_SLUGS)
    rows = (
        (
            await db_session.execute(
                select(GameEntitlement.game_slug).where(GameEntitlement.session_id == session_id)
            )
        )
        .scalars()
        .all()
    )
    return list(rows)
