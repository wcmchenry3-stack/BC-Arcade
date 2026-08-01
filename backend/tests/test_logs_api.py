"""End-to-end tests for the bug log write API (#364)."""

from __future__ import annotations

import os
import uuid
from collections.abc import Iterator
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from db.base import is_configured

pytestmark = pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"),
    reason="DATABASE_URL not set — skipping live API tests",
)


@pytest.fixture()
def client() -> Iterator[TestClient]:
    assert is_configured()
    from main import app

    with TestClient(app) as c:
        yield c


def _headers(sid: str) -> dict[str, str]:
    return {"X-Session-ID": sid, "Content-Type": "application/json"}


def _log(level: str = "warn") -> dict:
    return {
        "id": str(uuid.uuid4()),
        "logged_at": datetime.now(timezone.utc).isoformat(),
        "level": level,
        "source": "test",
        "message": "something happened",
        "context": {"k": "v"},
    }


def test_post_bug_logs_happy_path(client: TestClient) -> None:
    sid = str(uuid.uuid4())
    r = client.post("/logs/bug", headers=_headers(sid), json={"logs": [_log(), _log()]})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["accepted"] == 2
    assert body["duplicates"] == 0


def test_post_bug_logs_idempotent_on_uuid(client: TestClient) -> None:
    sid = str(uuid.uuid4())
    log = _log()
    r1 = client.post("/logs/bug", headers=_headers(sid), json={"logs": [log]})
    r2 = client.post("/logs/bug", headers=_headers(sid), json={"logs": [log]})
    assert r1.json()["accepted"] == 1
    assert r2.json()["accepted"] == 0
    assert r2.json()["duplicates"] == 1


def test_post_bug_logs_rejects_invalid_level(client: TestClient) -> None:
    sid = str(uuid.uuid4())
    r = client.post(
        "/logs/bug",
        headers=_headers(sid),
        json={"logs": [_log(level="info")]},  # not in warn/error/fatal
    )
    assert r.status_code == 422  # Pydantic Literal rejects


def test_post_bug_logs_batch_cap(client: TestClient) -> None:
    sid = str(uuid.uuid4())
    logs = [_log() for _ in range(51)]
    r = client.post("/logs/bug", headers=_headers(sid), json={"logs": logs})
    assert r.status_code == 422


def test_post_bug_logs_rate_limit_per_session(client: TestClient) -> None:
    sid = str(uuid.uuid4())
    codes = [
        client.post("/logs/bug", headers=_headers(sid), json={"logs": [_log()]}).status_code
        for _ in range(35)
    ]
    assert 429 in codes
