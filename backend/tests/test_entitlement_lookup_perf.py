"""Indexed entitlement lookup stays under the 5 ms target (#840, docs/IAP.md §8.1).

``check_entitlement`` runs on every premium ``POST /games``. With the purchase
tables in place it still reads ``game_entitlements`` by ``(session_id,
game_slug)``; this measures that lookup against a table seeded with many
sessions, and checks the query plan uses the index rather than a scan.

Method: 20,000 rows across 10,000 sessions, then the median of 200 timed
``check_entitlement`` calls (one open DB session, as a request uses). The
median, not the max, so a CI scheduler hiccup does not fail the run.

The query-plan check (index, no scan) always runs: it is the deterministic
half of the guarantee. The timing check fails at the documented 5 ms target
locally, and at 20 ms on CI (``CI`` set) or under coverage, where shared
runners and tracing overhead make wall-clock time noisy; a regression to a
table scan over 20,000 rows still fails it.

Query budgets (#2966): the hot routes' statement counts, see the section at the
end of this file.
"""

from __future__ import annotations

import contextlib
import os
import statistics
import sys
import time
import uuid
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event, insert, text

from db.base import get_engine, get_session_factory
from db.models import GameEntitlement
from entitlements.dependencies import check_entitlement
from entitlements.service import get_entitled_games
from tests._helpers import session_headers

TARGET_MS = 5.0
# Allowance for shared CI runners and coverage tracing (see module docstring).
NOISY_TARGET_MS = 20.0
SESSIONS = 10_000


def _timing_budget_ms() -> float:
    noisy = bool(os.environ.get("CI")) or "coverage" in sys.modules
    return NOISY_TARGET_MS if noisy else TARGET_MS


_PLAN_SQL = "SELECT * FROM game_entitlements WHERE session_id = :s AND game_slug = :g"


async def test_entitlement_lookup_is_indexed_and_under_target() -> None:
    target = str(uuid.uuid4())
    rows = [
        {"id": uuid.uuid4(), "session_id": str(uuid.uuid4()), "game_slug": slug}
        for _ in range(SESSIONS)
        for slug in ("hearts", "cascade")
    ]
    rows.append({"id": uuid.uuid4(), "session_id": target, "game_slug": "hearts"})

    factory = get_session_factory()
    async with factory() as db:
        await db.execute(insert(GameEntitlement), rows)
        await db.commit()

        samples = []
        for _ in range(200):
            start = time.perf_counter()
            await check_entitlement(db, target, "hearts")
            samples.append((time.perf_counter() - start) * 1000)
        median_ms = statistics.median(samples)

        start = time.perf_counter()
        games = await get_entitled_games(db, target)
        jwt_lookup_ms = (time.perf_counter() - start) * 1000
        assert games == ["hearts"]

        params = {"s": target, "g": "hearts"}
        if db.bind.dialect.name == "sqlite":
            rows_ = (await db.execute(text("EXPLAIN QUERY PLAN " + _PLAN_SQL), params)).all()
            plan = " ".join(str(r[-1]) for r in rows_)
            uses_index = "USING INDEX" in plan and "SCAN" not in plan.replace("USING INDEX", "")
        else:
            await db.execute(text("ANALYZE game_entitlements"))
            rows_ = (await db.execute(text("EXPLAIN " + _PLAN_SQL), params)).all()
            plan = " ".join(str(r[0]) for r in rows_)
            uses_index = "Index" in plan and "Seq Scan" not in plan
        assert uses_index, plan

    print(
        f"\ncheck_entitlement median {median_ms:.3f} ms "
        f"(p95 {statistics.quantiles(samples, n=20)[-1]:.3f} ms); "
        f"get_entitled_games {jwt_lookup_ms:.3f} ms; {len(rows)} rows"
    )
    budget = _timing_budget_ms()
    assert median_ms < budget, f"median {median_ms:.3f} ms >= {budget} ms budget"


def test_timing_budget_is_the_target_locally_and_relaxed_on_ci(monkeypatch) -> None:
    monkeypatch.setenv("CI", "true")
    assert _timing_budget_ms() == NOISY_TARGET_MS
    monkeypatch.delenv("CI")
    monkeypatch.delitem(sys.modules, "coverage", raising=False)
    assert _timing_budget_ms() == TARGET_MS


# ---------------------------------------------------------------------------
# Query budgets (#2966): the static lookups come from games/catalog_cache.py,
# and /stats/me skips the stale sweep while it cannot match (games/sweep_gate.py).
# Counted with SQLAlchemy's before_cursor_execute, after a warm-up request, so
# the numbers are the steady state (the catalog cache costs two SELECTs once a
# minute per process; the first streak read of a day freezes its templates).
# Measured before -> after #2966 (SQLite): POST /games free 4 -> 1, premium
# 5 -> 2, each +1 with a client id; /stats/me with win/loss rows 7 -> 5.
# ---------------------------------------------------------------------------

POST_GAMES_BUDGET = 3
STATS_ME_BUDGET = 5


@contextlib.contextmanager
def _statements() -> Iterator[list[str]]:
    statements: list[str] = []

    def record(_conn, _cursor, statement, *_rest) -> None:
        statements.append(statement)

    engine = get_engine().sync_engine
    event.listen(engine, "before_cursor_execute", record)
    try:
        yield statements
    finally:
        event.remove(engine, "before_cursor_execute", record)


async def _entitle(sid: str, slug: str) -> None:
    factory = get_session_factory()
    async with factory() as db:
        db.add(GameEntitlement(id=uuid.uuid4(), session_id=sid, game_slug=slug))
        await db.commit()


@pytest.mark.parametrize("game_type", ["yacht", "hearts"])  # free, premium
async def test_post_games_query_budget(client: TestClient, game_type: str) -> None:
    sid = str(uuid.uuid4())
    await _entitle(sid, game_type)
    headers = session_headers(sid)
    # Warm-up: loads the catalog cache.
    assert client.post("/games", headers=headers, json={"game_type": game_type}).status_code == 200

    with _statements() as plain:
        r = client.post("/games", headers=headers, json={"game_type": game_type})
    assert r.status_code == 200, r.text
    with _statements() as with_id:
        r = client.post(
            "/games", headers=headers, json={"game_type": game_type, "id": str(uuid.uuid4())}
        )
    assert r.status_code == 200, r.text

    print(f"\nPOST /games {game_type}: {len(plain)} queries, {len(with_id)} with a client id")
    assert not [s for s in plain + with_id if "game_types" in s or "event_types" in s]
    assert len(plain) <= POST_GAMES_BUDGET, plain
    assert len(with_id) <= POST_GAMES_BUDGET, with_id


async def test_post_games_free_game_never_reads_entitlements(client: TestClient) -> None:
    headers = session_headers(str(uuid.uuid4()))
    client.post("/games", headers=headers, json={"game_type": "yacht"})
    with _statements() as statements:
        assert (
            client.post("/games", headers=headers, json={"game_type": "yacht"}).status_code == 200
        )
    assert not [s for s in statements if "game_entitlements" in s]


async def test_stats_me_query_budget(client: TestClient) -> None:
    sid = str(uuid.uuid4())
    await _entitle(sid, "hearts")
    headers = session_headers(sid)
    # Wins and losses, so the win-streak scan runs too.
    for outcome in ("win", "loss", "win"):
        gid = client.post("/games", headers=headers, json={"game_type": "hearts"}).json()["id"]
        r = client.patch(
            f"/games/{gid}/complete",
            headers=headers,
            json={"final_score": 10, "outcome": outcome, "duration_ms": 60_000},
        )
        assert r.status_code == 200, r.text
    assert client.get("/stats/me", headers=headers).status_code == 200  # warm-up

    with _statements() as statements:
        r = client.get("/stats/me", headers=headers)
    assert r.status_code == 200, r.text
    assert r.json()["by_game"]["hearts"]["won"] == 2

    print(f"\n/stats/me: {len(statements)} queries")
    assert not [s for s in statements if s.lstrip().upper().startswith(("UPDATE", "INSERT"))]
    assert len(statements) <= STATS_ME_BUDGET, statements
