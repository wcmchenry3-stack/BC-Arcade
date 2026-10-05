"""Plain helpers shared by the backend tests (#2953).

Not a test module and not a conftest: tests import from here directly (importing
from ``conftest`` is unsupported by pytest). Fixtures live in ``conftest.py``.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import jwt
from sqlalchemy import func, select

from db.base import get_session_factory
from entitlements import service as entitlements_service

if TYPE_CHECKING:
    from fastapi.testclient import TestClient


def session_headers(sid: str) -> dict[str, str]:
    """JSON request headers for session ``sid``."""
    return {"X-Session-ID": sid, "Content-Type": "application/json"}


def jwt_games(client: TestClient, sid: str) -> list[str]:
    """The ``entitled_games`` claim of the entitlement JWT ``GET /entitlements`` returns."""
    r = client.get("/entitlements", headers=session_headers(sid))
    assert r.status_code == 200
    pub = entitlements_service.get_public_key_pem()
    return jwt.decode(r.json()["token"], pub, algorithms=["RS256"])["entitled_games"]


async def count(model, *where) -> int:
    """Rows of ``model`` matching ``where``."""
    async with get_session_factory()() as db:
        return (
            await db.execute(select(func.count()).select_from(model).where(*where))
        ).scalar_one()
