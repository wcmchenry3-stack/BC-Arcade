"""Indexed entitlement lookup stays under the 5 ms target (#840, docs/IAP.md §8.1).

``check_entitlement`` runs on every premium ``POST /games``. With the purchase
tables in place it still reads ``game_entitlements`` by ``(session_id,
game_slug)``; this measures that lookup against a table seeded with many
sessions, and checks the query plan uses the index rather than a scan.

Method: 20,000 rows across 10,000 sessions, then the median of 200 timed
``check_entitlement`` calls (one open DB session, as a request uses). The
median, not the max, so a CI scheduler hiccup does not fail the run.
"""

from __future__ import annotations

import statistics
import time
import uuid

from sqlalchemy import insert, text

from db.base import get_session_factory
from db.models import GameEntitlement
from entitlements.dependencies import check_entitlement
from entitlements.service import get_entitled_games

TARGET_MS = 5.0
SESSIONS = 10_000


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

        if db.bind.dialect.name == "sqlite":
            plan = " ".join(
                str(r[-1])
                for r in (
                    await db.execute(
                        text(
                            "EXPLAIN QUERY PLAN SELECT * FROM game_entitlements "
                            "WHERE session_id = :s AND game_slug = :g"
                        ),
                        {"s": target, "g": "hearts"},
                    )
                ).all()
            )
            assert "USING INDEX" in plan and "SCAN" not in plan.replace("USING INDEX", ""), plan

    print(
        f"\ncheck_entitlement median {median_ms:.3f} ms "
        f"(p95 {statistics.quantiles(samples, n=20)[-1]:.3f} ms); "
        f"get_entitled_games {jwt_lookup_ms:.3f} ms; {len(rows)} rows"
    )
    assert median_ms < TARGET_MS
