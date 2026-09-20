"""GET /health/db — the DB round-trip the uptime monitor polls (#2432).

`/health` never touches the database, so it cannot keep the Supabase project
awake or tell us the pooler is unreachable. These tests pin the three outcomes
and that a failure never leaks connection detail into the response.
"""

import pytest
from fastapi.testclient import TestClient

import main


@pytest.fixture()
def client() -> TestClient:
    return TestClient(main.app)


def test_health_db_ok_when_database_reachable(client: TestClient) -> None:
    r = client.get("/health/db")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_health_db_503_when_query_fails(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _boom() -> None:
        raise RuntimeError("connection to pooler.example:5432 refused — secret-detail")

    monkeypatch.setattr(main, "_ping_db", _boom)
    r = client.get("/health/db")
    assert r.status_code == 503
    assert r.json() == {"status": "unavailable"}
    assert "secret-detail" not in r.text


def test_health_db_503_when_database_stalls(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A pooler that accepts the connection and then hangs must yield a prompt 503."""
    import asyncio

    class _StalledEngine:
        def connect(self):
            return self

        async def __aenter__(self):
            await asyncio.sleep(30)

        async def __aexit__(self, *exc: object) -> None:
            return None

    monkeypatch.setattr(main, "get_engine", lambda: _StalledEngine())
    monkeypatch.setattr(main, "DB_PING_TIMEOUT_SECONDS", 0.05)
    r = client.get("/health/db")
    assert r.status_code == 503
    assert r.json() == {"status": "unavailable"}


def test_health_db_503_when_database_unconfigured(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(main, "is_configured", lambda: False)
    r = client.get("/health/db")
    assert r.status_code == 503
    assert r.json() == {"status": "unconfigured"}


def test_health_db_is_rate_limited(client: TestClient) -> None:
    statuses = [client.get("/health/db").status_code for _ in range(31)]
    assert statuses[:30] == [200] * 30
    assert statuses[30] == 429
