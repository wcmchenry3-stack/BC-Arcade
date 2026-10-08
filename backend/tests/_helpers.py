"""Plain helpers shared by the backend tests (#2953).

Not a test module and not a conftest: tests import from here directly (importing
from ``conftest`` is unsupported by pytest). Fixtures live in ``conftest.py``.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import jwt
import pytest
from pydantic import SecretStr
from sqlalchemy import func, select

from db.base import get_session_factory
from entitlements import service as entitlements_service
from purchases import _common as purchases_common
from settings import Settings

if TYPE_CHECKING:
    from fastapi.testclient import TestClient


def set_dev_override(monkeypatch: pytest.MonkeyPatch, value: str) -> None:
    """Make ``ENTITLEMENT_DEV_OVERRIDE`` read as ``value`` ("" = unset) for this test.

    The entitlements service builds its ``Settings`` once per process, so setting the
    env var mid-test no longer takes effect; this swaps that ``Settings`` instead.
    """
    base = entitlements_service._settings or Settings()
    monkeypatch.setattr(
        entitlements_service,
        "_settings",
        base.model_copy(update={"entitlement_dev_override_raw": value}),
    )


class StoreEnv(pytest.MonkeyPatch):
    """A ``MonkeyPatch`` whose ``setenv`` / ``delenv`` also drop ``purchases._common``'s lazy
    ``Settings``, so the next store-config read sees the new ``APPLE_*`` / ``GOOGLE_*``
    values (it is otherwise built once per process)."""

    def setenv(self, name: str, value: str, prepend: str | None = None) -> None:
        super().setenv(name, value, prepend)
        self.setattr(purchases_common, "_settings", None)

    def delenv(self, name: str, raising: bool = True) -> None:
        super().delenv(name, raising)
        self.setattr(purchases_common, "_settings", None)


def set_admin_token(client: TestClient, monkeypatch: pytest.MonkeyPatch, token: str) -> None:
    """Give the running app ``ADMIN_API_TOKEN=token`` for this test.

    The admin token is read from ``app.state.settings`` (set once in ``create_app``).
    """
    current = client.app.state.settings
    monkeypatch.setattr(
        client.app.state,
        "settings",
        current.model_copy(update={"admin_api_token": SecretStr(token)}),
    )


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
