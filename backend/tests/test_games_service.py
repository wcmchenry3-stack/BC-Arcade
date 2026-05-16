"""Unit tests for games/service.py covering core write-API paths (#1559).

Calls service functions directly via the DB session (no FastAPI router layer)
to cover code paths that the API-level tests miss.
"""

from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone

import pytest

from db.base import get_session_factory, is_configured

pytestmark = pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"),
    reason="DATABASE_URL not set — skipping service-layer tests",
)


@pytest.fixture()
async def db():
    factory = get_session_factory()
    async with factory() as session:
        yield session


def _sid() -> str:
    return str(uuid.uuid4())


async def _make_game(db, session_id: str, game_type: str = "yacht"):
    from games.service import create_game

    return await create_game(
        db,
        session_id=session_id,
        client_id=None,
        game_type_name=game_type,
        metadata={},
        players=[],
    )


async def _complete(db, game_id, session_id: str, score: int = 100):
    from games.service import complete_game

    return await complete_game(
        db,
        game_id=game_id,
        session_id=session_id,
        final_score=score,
        outcome="win",
        duration_ms=5000,
    )


# ---------------------------------------------------------------------------
# create_game
# ---------------------------------------------------------------------------


async def test_create_game_unknown_type_raises(db):
    from games.service import GameServiceError, create_game

    with pytest.raises(GameServiceError) as exc:
        await create_game(
            db,
            session_id=_sid(),
            client_id=None,
            game_type_name="bogus",
            metadata={},
            players=[],
        )
    assert exc.value.status_code == 400


async def test_create_game_client_id_idempotent(db):
    from games.service import create_game

    sid = _sid()
    cid = uuid.uuid4()
    g1 = await create_game(
        db, session_id=sid, client_id=cid, game_type_name="yacht", metadata={}, players=[]
    )
    g2 = await create_game(
        db, session_id=sid, client_id=cid, game_type_name="yacht", metadata={}, players=[]
    )
    assert g1.id == g2.id


async def test_create_game_cross_session_raises(db):
    from games.service import GameServiceError, create_game

    cid = uuid.uuid4()
    sid1, sid2 = _sid(), _sid()
    await create_game(
        db, session_id=sid1, client_id=cid, game_type_name="yacht", metadata={}, players=[]
    )
    with pytest.raises(GameServiceError) as exc:
        await create_game(
            db, session_id=sid2, client_id=cid, game_type_name="yacht", metadata={}, players=[]
        )
    assert exc.value.status_code == 403


async def test_create_game_started_at_in_window_accepted(db):
    from games.service import create_game

    sid = _sid()
    started = datetime(2026, 5, 1, 12, 0, 0, tzinfo=timezone.utc)
    g = await create_game(
        db,
        session_id=sid,
        client_id=None,
        game_type_name="yacht",
        metadata={},
        players=[],
        started_at=started,
    )
    # SQLite strips tzinfo; compare the naive value
    assert g.started_at.replace(tzinfo=None) == started.replace(tzinfo=None)


async def test_create_game_started_at_out_of_window_ignored(db):
    from games.service import create_game

    sid = _sid()
    started = datetime(2020, 1, 1, tzinfo=timezone.utc)  # over 1 year ago
    g = await create_game(
        db,
        session_id=sid,
        client_id=None,
        game_type_name="yacht",
        metadata={},
        players=[],
        started_at=started,
    )
    assert g.started_at != started


# ---------------------------------------------------------------------------
# append_events
# ---------------------------------------------------------------------------


async def test_append_events_game_not_found_raises(db):
    from games.service import GameServiceError, append_events

    with pytest.raises(GameServiceError) as exc:
        await append_events(db, game_id=uuid.uuid4(), session_id=_sid(), events=[])
    assert exc.value.status_code == 404


async def test_append_events_cross_session_raises(db):
    from games.service import GameServiceError, append_events

    sid = _sid()
    game = await _make_game(db, sid)
    with pytest.raises(GameServiceError) as exc:
        await append_events(db, game_id=game.id, session_id=_sid(), events=[])
    assert exc.value.status_code == 403


async def test_append_events_game_already_completed_raises(db):
    from games.service import GameServiceError, append_events

    sid = _sid()
    game = await _make_game(db, sid)
    await _complete(db, game.id, sid)
    with pytest.raises(GameServiceError) as exc:
        await append_events(
            db,
            game_id=game.id,
            session_id=sid,
            events=[{"event_index": 0, "event_type": "game_started", "data": {}}],
        )
    assert exc.value.status_code == 409


async def test_append_events_unknown_type_raises(db):
    from games.service import GameServiceError, append_events

    sid = _sid()
    game = await _make_game(db, sid)
    with pytest.raises(GameServiceError) as exc:
        await append_events(
            db,
            game_id=game.id,
            session_id=sid,
            events=[{"event_index": 0, "event_type": "bogus_event", "data": {}}],
        )
    assert exc.value.status_code == 400
    assert "bogus_event" in exc.value.detail["rejected"]


async def test_append_events_happy_path(db):
    from games.service import append_events

    sid = _sid()
    game = await _make_game(db, sid)
    result = await append_events(
        db,
        game_id=game.id,
        session_id=sid,
        events=[
            {"event_index": 0, "event_type": "game_started", "data": {}},
            {"event_index": 1, "event_type": "roll", "data": {"dice": [1, 2, 3, 4, 5]}},
        ],
    )
    assert result.accepted == 2
    assert result.duplicates == 0
    assert result.rejected == []


async def test_append_events_cross_batch_duplicates_counted(db):
    from games.service import append_events

    sid = _sid()
    game = await _make_game(db, sid)
    events = [
        {"event_index": 0, "event_type": "game_started", "data": {}},
        {"event_index": 1, "event_type": "roll", "data": {}},
    ]
    r1 = await append_events(db, game_id=game.id, session_id=sid, events=events)
    assert r1.accepted == 2
    assert r1.duplicates == 0

    r2 = await append_events(db, game_id=game.id, session_id=sid, events=events)
    assert r2.accepted == 0
    assert r2.duplicates == 2


async def test_append_events_intra_batch_dedup(db):
    from games.service import append_events

    sid = _sid()
    game = await _make_game(db, sid)
    # Same event_index twice in one batch — second occurrence silently dropped
    result = await append_events(
        db,
        game_id=game.id,
        session_id=sid,
        events=[
            {"event_index": 0, "event_type": "game_started", "data": {}},
            {"event_index": 0, "event_type": "roll", "data": {}},
        ],
    )
    assert result.accepted == 1
    assert result.duplicates == 0


# ---------------------------------------------------------------------------
# complete_game
# ---------------------------------------------------------------------------


async def test_complete_game_sets_fields(db):
    from games.service import complete_game

    sid = _sid()
    game = await _make_game(db, sid)
    g = await complete_game(
        db,
        game_id=game.id,
        session_id=sid,
        final_score=300,
        outcome="win",
        duration_ms=12000,
    )
    assert g.final_score == 300
    assert g.outcome == "win"
    assert g.duration_ms == 12000
    assert g.completed_at is not None


async def test_complete_game_idempotent(db):
    from games.service import complete_game

    sid = _sid()
    game = await _make_game(db, sid)
    g1 = await complete_game(
        db, game_id=game.id, session_id=sid, final_score=100, outcome="win", duration_ms=None
    )
    g2 = await complete_game(
        db, game_id=game.id, session_id=sid, final_score=999, outcome="loss", duration_ms=None
    )
    assert g2.final_score == 100
    assert g2.outcome == "win"
    assert g1.completed_at == g2.completed_at


async def test_complete_game_invalid_outcome_raises(db):
    from games.service import GameServiceError, complete_game

    sid = _sid()
    game = await _make_game(db, sid)
    with pytest.raises(GameServiceError) as exc:
        await complete_game(
            db,
            game_id=game.id,
            session_id=sid,
            final_score=None,
            outcome="bogus",
            duration_ms=None,
        )
    assert exc.value.status_code == 400


async def test_complete_game_not_found_raises(db):
    from games.service import GameServiceError, complete_game

    with pytest.raises(GameServiceError) as exc:
        await complete_game(
            db,
            game_id=uuid.uuid4(),
            session_id=_sid(),
            final_score=None,
            outcome=None,
            duration_ms=None,
        )
    assert exc.value.status_code == 404


async def test_complete_game_cross_session_raises(db):
    from games.service import GameServiceError, complete_game

    sid = _sid()
    game = await _make_game(db, sid)
    with pytest.raises(GameServiceError) as exc:
        await complete_game(
            db,
            game_id=game.id,
            session_id=_sid(),
            final_score=100,
            outcome="win",
            duration_ms=None,
        )
    assert exc.value.status_code == 403


async def test_complete_game_completed_at_in_window_accepted(db):
    from games.service import complete_game

    sid = _sid()
    game = await _make_game(db, sid)
    ts = datetime(2026, 5, 14, 10, 0, 0, tzinfo=timezone.utc)
    g = await complete_game(
        db,
        game_id=game.id,
        session_id=sid,
        final_score=50,
        outcome="completed",
        duration_ms=None,
        completed_at=ts,
    )
    # SQLite strips tzinfo; compare the naive value
    assert g.completed_at.replace(tzinfo=None) == ts.replace(tzinfo=None)


# ---------------------------------------------------------------------------
# get_stats_for_session
# ---------------------------------------------------------------------------


async def test_get_stats_empty_session(db):
    from games.service import get_stats_for_session

    stats = await get_stats_for_session(db, session_id=_sid())
    assert stats.total_games == 0
    assert stats.by_game == {}
    assert stats.favorite_game is None


async def test_get_stats_aggregates_completed_games(db):
    from games.service import get_stats_for_session

    sid = _sid()
    g1 = await _make_game(db, sid)
    g2 = await _make_game(db, sid)
    await _complete(db, g1.id, sid, score=100)
    await _complete(db, g2.id, sid, score=300)

    stats = await get_stats_for_session(db, session_id=sid)
    assert stats.total_games == 2
    assert "yacht" in stats.by_game
    ys = stats.by_game["yacht"]
    assert ys.played == 2
    assert ys.best == 300
    assert ys.avg == 200.0
    assert stats.favorite_game == "yacht"


async def test_get_stats_excludes_incomplete_games(db):
    from games.service import get_stats_for_session

    sid = _sid()
    await _make_game(db, sid)  # not completed
    stats = await get_stats_for_session(db, session_id=sid)
    assert stats.total_games == 0


async def test_get_stats_multi_game_type_favorite(db):
    from games.service import get_stats_for_session

    sid = _sid()
    for _ in range(3):
        g = await _make_game(db, sid, game_type="yacht")
        await _complete(db, g.id, sid)
    g = await _make_game(db, sid, game_type="twenty48")
    await _complete(db, g.id, sid, score=10000)

    stats = await get_stats_for_session(db, session_id=sid)
    assert stats.total_games == 4
    assert stats.favorite_game == "yacht"
    assert stats.by_game["twenty48"].played == 1


# ---------------------------------------------------------------------------
# list_games_for_session
# ---------------------------------------------------------------------------


async def test_list_games_no_cursor_no_overflow(db):
    from games.service import list_games_for_session

    sid = _sid()
    for _ in range(3):
        await _make_game(db, sid)

    page = await list_games_for_session(db, session_id=sid, limit=10, cursor=None)
    assert len(page.items) == 3
    assert page.next_cursor is None


async def test_list_games_next_cursor_set_when_overflow(db):
    from games.service import list_games_for_session

    sid = _sid()
    for _ in range(3):
        await _make_game(db, sid)

    page = await list_games_for_session(db, session_id=sid, limit=2, cursor=None)
    assert len(page.items) == 2
    assert page.next_cursor is not None


async def test_list_games_cursor_filters_results(db):
    from datetime import timedelta

    from games.service import list_games_for_session

    sid = _sid()
    for _ in range(3):
        await _make_game(db, sid)

    page1 = await list_games_for_session(db, session_id=sid, limit=2, cursor=None)
    assert page1.next_cursor is not None

    # Parse the ISO cursor and use it to fetch the next page
    cursor_dt = datetime.fromisoformat(page1.next_cursor)
    page2 = await list_games_for_session(db, session_id=sid, limit=2, cursor=cursor_dt)
    assert len(page2.items) >= 1


# ---------------------------------------------------------------------------
# get_game_detail
# ---------------------------------------------------------------------------


async def test_get_game_detail_happy_path(db):
    from games.service import get_game_detail

    sid = _sid()
    game = await _make_game(db, sid)
    await _complete(db, game.id, sid, score=150)

    detail = await get_game_detail(db, game_id=game.id, session_id=sid, include_events=False)
    assert detail.row.id == game.id
    assert detail.row.final_score == 150
    assert detail.events is None


async def test_get_game_detail_include_events(db):
    from games.service import append_events, get_game_detail

    sid = _sid()
    game = await _make_game(db, sid)
    await append_events(
        db,
        game_id=game.id,
        session_id=sid,
        events=[
            {"event_index": 0, "event_type": "game_started", "data": {}},
            {"event_index": 1, "event_type": "roll", "data": {"dice": [6, 6, 6, 6, 6]}},
        ],
    )

    detail = await get_game_detail(db, game_id=game.id, session_id=sid, include_events=True)
    assert detail.events is not None
    assert len(detail.events) == 2
    assert detail.events[0]["event_type"] == "game_started"
    assert detail.events[1]["event_type"] == "roll"


async def test_get_game_detail_not_found_raises(db):
    from games.service import GameServiceError, get_game_detail

    with pytest.raises(GameServiceError) as exc:
        await get_game_detail(db, game_id=uuid.uuid4(), session_id=_sid(), include_events=False)
    assert exc.value.status_code == 404


async def test_get_game_detail_cross_session_raises(db):
    from games.service import GameServiceError, get_game_detail

    sid = _sid()
    game = await _make_game(db, sid)
    with pytest.raises(GameServiceError) as exc:
        await get_game_detail(db, game_id=game.id, session_id=_sid(), include_events=False)
    assert exc.value.status_code == 403


# ---------------------------------------------------------------------------
# patch_game_type
# ---------------------------------------------------------------------------


async def test_patch_game_type_not_found_raises(db):
    from games.service import GameServiceError, patch_game_type

    with pytest.raises(GameServiceError) as exc:
        await patch_game_type(db, game_type_id=9999, is_premium=None, category=None)
    assert exc.value.status_code == 404


async def test_patch_game_type_updates_is_premium(db):
    from sqlalchemy import select

    from db.models import GameType
    from games.service import patch_game_type

    gt_row = (await db.execute(select(GameType).where(GameType.name == "yacht"))).scalar_one()
    original_premium = gt_row.is_premium
    updated = await patch_game_type(
        db, game_type_id=gt_row.id, is_premium=not original_premium, category=None
    )
    assert updated.is_premium is not original_premium

    # Restore
    await patch_game_type(
        db, game_type_id=gt_row.id, is_premium=original_premium, category=None
    )


async def test_patch_game_type_updates_category(db):
    from sqlalchemy import select

    from db.models import GameType
    from games.service import patch_game_type

    gt_row = (await db.execute(select(GameType).where(GameType.name == "yacht"))).scalar_one()
    original_cat = gt_row.category

    updated = await patch_game_type(db, game_type_id=gt_row.id, is_premium=None, category="dice")
    assert updated.category == "dice"

    # Restore
    await patch_game_type(db, game_type_id=gt_row.id, is_premium=None, category=original_cat)
