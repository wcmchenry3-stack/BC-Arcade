"""Schema smoke tests for #363.

Skipped unless DATABASE_URL is set. Verifies:
  1. Seed data present (5 game_types, 17 baseline event_types).
  2. A game + events + bug_log round-trip via SQLAlchemy ORM.
  3. Unknown event_type_id fails the FK constraint.
  4. Invalid games.outcome fails the CHECK constraint.
  5. Invalid bug_logs.level fails the CHECK constraint.
"""

from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.orm import selectinload

from db.base import get_session_factory
from db.models import BugLog, EventType, Game, GameEvent, GameType

pytestmark = pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"),
    reason="DATABASE_URL not set — skipping live DB schema tests",
)


@pytest.mark.asyncio
async def test_seed_data_present() -> None:
    factory = get_session_factory()
    async with factory() as s:
        gt_names = (await s.execute(select(GameType.name).order_by(GameType.id))).scalars().all()
        assert gt_names == [
            "yacht",
            "twenty48",
            "blackjack",
            "cascade",
            "solitaire",
            "hearts",
            "sudoku",
            "mahjong",
            "starswarm",
            "freecell",
            "sort",
            "daily_word",
        ]

        total = (await s.execute(select(func.count()).select_from(EventType))).scalar_one()
        assert total >= 17

        yacht_events = (
            (
                await s.execute(
                    select(EventType.name)
                    .join(GameType)
                    .where(GameType.name == "yacht")
                    .order_by(EventType.name)
                )
            )
            .scalars()
            .all()
        )
        assert set(yacht_events) >= {"game_started", "roll", "score", "game_ended"}

        # Every game_type must have at least the two lifecycle events (#746).
        for gt_name in gt_names:
            gt_events = (
                (
                    await s.execute(
                        select(EventType.name)
                        .join(GameType)
                        .where(GameType.name == gt_name)
                        .order_by(EventType.name)
                    )
                )
                .scalars()
                .all()
            )
            assert {"game_started", "game_ended"} <= set(
                gt_events
            ), f"{gt_name!r} is missing lifecycle event_types; found: {sorted(gt_events)}"


@pytest.mark.asyncio
async def test_game_events_and_buglog_roundtrip() -> None:
    factory = get_session_factory()
    async with factory() as s:
        yacht = (await s.execute(select(GameType).where(GameType.name == "yacht"))).scalar_one()
        roll_type = (
            await s.execute(
                select(EventType).where(
                    EventType.game_type_id == yacht.id, EventType.name == "roll"
                )
            )
        ).scalar_one()

        sid = f"test-session-{uuid.uuid4().hex[:8]}"
        game = Game(
            session_id=sid,
            game_type_id=yacht.id,
            final_score=123,
            outcome="win",
            game_metadata={"note": "smoke test"},
        )
        s.add(game)
        await s.flush()

        # Add events via session.add() rather than game.events.append() —
        # the latter triggers an implicit lazy load of the collection, which
        # fails under the async driver without a greenlet context.
        s.add(
            GameEvent(
                game_id=game.id,
                event_index=0,
                event_type_id=roll_type.id,
                data={"dice": [1, 2, 3, 4, 5]},
            )
        )
        s.add(
            GameEvent(
                game_id=game.id,
                event_index=1,
                event_type_id=roll_type.id,
                data={"dice": [6, 6, 6, 6, 6]},
            )
        )

        bug = BugLog(
            session_id=sid,
            logged_at=datetime.now(timezone.utc),
            level="warn",
            source="yacht.engine",
            message="dice reroll invariant violated",
            context={"turn": 3},
        )
        s.add(bug)
        await s.commit()

        fetched = (
            await s.execute(
                select(Game).options(selectinload(Game.events)).where(Game.session_id == sid)
            )
        ).scalar_one()
        assert fetched.final_score == 123
        assert fetched.outcome == "win"
        assert fetched.game_metadata == {"note": "smoke test"}
        assert len(fetched.events) == 2
        assert fetched.events[0].data == {"dice": [1, 2, 3, 4, 5]}

        fetched_bug = (await s.execute(select(BugLog).where(BugLog.session_id == sid))).scalar_one()
        assert fetched_bug.level == "warn"
        assert fetched_bug.context == {"turn": 3}

        # cleanup
        await s.delete(fetched)
        await s.delete(fetched_bug)
        await s.commit()


@pytest.mark.asyncio
async def test_unknown_event_type_id_fails_fk() -> None:
    factory = get_session_factory()
    async with factory() as s:
        yacht = (await s.execute(select(GameType).where(GameType.name == "yacht"))).scalar_one()
        game = Game(session_id="fk-test", game_type_id=yacht.id)
        s.add(game)
        await s.flush()

        s.add(GameEvent(game_id=game.id, event_index=0, event_type_id=999_999, data={}))
        with pytest.raises((IntegrityError, DBAPIError)):
            await s.commit()
        await s.rollback()


@pytest.mark.asyncio
async def test_invalid_outcome_fails_check() -> None:
    factory = get_session_factory()
    async with factory() as s:
        yacht = (await s.execute(select(GameType).where(GameType.name == "yacht"))).scalar_one()
        game = Game(session_id="outcome-test", game_type_id=yacht.id, outcome="bogus")
        s.add(game)
        with pytest.raises((IntegrityError, DBAPIError)):
            await s.commit()
        await s.rollback()


@pytest.mark.asyncio
async def test_invalid_level_fails_check() -> None:
    factory = get_session_factory()
    async with factory() as s:
        bug = BugLog(
            session_id="level-test",
            logged_at=datetime.now(timezone.utc),
            level="info",  # not in ('warn','error','fatal')
            source="test",
            message="should fail",
        )
        s.add(bug)
        with pytest.raises((IntegrityError, DBAPIError)):
            await s.commit()
        await s.rollback()
