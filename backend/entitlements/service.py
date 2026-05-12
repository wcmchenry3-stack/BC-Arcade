"""JWT signing for the entitlements endpoint (#1050).

Private key is loaded from ENTITLEMENT_PRIVATE_KEY (PEM string env var).
In CI / local dev without the env var, a freshly-generated ephemeral key pair
is used so tests can always verify the signature.
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from sqlalchemy import select

from db.models import GameEntitlement, GameType

TOKEN_TTL_HOURS = 24
ALGORITHM = "RS256"

# Per-process cache — each worker generates its own ephemeral pair in local/CI.
# In production Render injects ENTITLEMENT_PRIVATE_KEY, so all workers share the same key.
_private_key_pem: str | None = None
_public_key_pem: str | None = None

_DEV_OVERRIDE_VAR = "ENTITLEMENT_DEV_OVERRIDE"


def is_dev_override_active() -> bool:
    return os.environ.get(_DEV_OVERRIDE_VAR, "").lower() == "true"


def _load_or_generate_keys() -> tuple[str, str]:
    """Return (private_pem, public_pem), generating an ephemeral pair if env vars are absent."""
    global _private_key_pem, _public_key_pem

    if _private_key_pem and _public_key_pem:
        return _private_key_pem, _public_key_pem

    env_private = os.environ.get("ENTITLEMENT_PRIVATE_KEY", "").strip()
    env_public = os.environ.get("ENTITLEMENT_PUBLIC_KEY", "").strip()

    if env_private and env_public:
        _private_key_pem = env_private
        _public_key_pem = env_public
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
    now = datetime.now(timezone.utc)
    exp = now + timedelta(hours=TOKEN_TTL_HOURS)

    payload: dict[str, Any] = {
        "sub": session_id,
        "entitled_games": entitled_games,
        "iat": int(now.timestamp()),
        "exp": int(exp.timestamp()),
    }

    token = jwt.encode(payload, private_pem, algorithm=ALGORITHM)
    return token, exp


async def get_entitled_games(db_session, session_id: str) -> list[str]:
    """Return entitled game slugs; when DEV_OVERRIDE is active, returns all premium slugs (#1052)."""
    if is_dev_override_active():
        rows = (
            (await db_session.execute(select(GameType.name).where(GameType.is_premium.is_(True))))
            .scalars()
            .all()
        )
        return list(rows)
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
