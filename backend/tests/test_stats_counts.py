"""Comparable per-game counts and win streaks in /stats/me (#2620).

Rows are written straight through the ORM so each test controls outcome,
timestamps, duration and metadata exactly.
"""

from __future__ import annotations

import os
import uuid
from collections.abc import Iterator
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event, select

from db.base import get_session_factory, is_configured
from db.models import Game, GameType
from games.progression import compute_progression
from games.service import MAX_TIME_PLAYED_PER_GAME_MS, get_stats_for_session, win_streaks

pytestmark = pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"),
    reason="DATABASE_URL not set — skipping stats tests",
)

_T0 = datetime(2026, 9, 1, 12, 0, tzinfo=timezone.utc)
_MINUTE_MS = 60_000


def _sid() -> str:
    return str(uuid.uuid4())


async def _add(
    sid: str,
    game_type: str,
    *,
    at: int = 0,
    outcome: str | None = "completed",
    final_score: int | None = None,
    duration_ms: int | None = _MINUTE_MS,
    elapsed: timedelta = timedelta(minutes=5),
    metadata: dict | None = None,
) -> None:
    """One finished row, completed ``at`` minutes after ``_T0``."""
    completed_at = _T0 + timedelta(minutes=at)
    factory = get_session_factory()
    async with factory() as db:
        gt_id = (
            await db.execute(select(GameType.id).where(GameType.name == game_type))
        ).scalar_one()
        db.add(
            Game(
                session_id=sid,
                game_type_id=gt_id,
                started_at=completed_at - elapsed,
                completed_at=completed_at,
                outcome=outcome,
                final_score=final_score,
                duration_ms=duration_ms,
                game_metadata=metadata or {},
            )
        )
        await db.commit()


async def _stats(sid: str):
    factory = get_session_factory()
    async with factory() as db:
        return await get_stats_for_session(db, session_id=sid)


async def _game(sid: str, game_type: str):
    return (await _stats(sid)).by_game[game_type]


async def _outcomes(sid: str, game_type: str, outcomes: list[str]) -> None:
    for i, outcome in enumerate(outcomes):
        await _add(sid, game_type, at=i, outcome=outcome, final_score=10)


# ---------------------------------------------------------------------------
# sessions vs completed
# ---------------------------------------------------------------------------


async def test_sessions_count_abandons_and_completed_does_not() -> None:
    sid = _sid()
    await _add(sid, "cascade", at=0, final_score=100)
    await _add(sid, "cascade", at=1, final_score=200)
    await _add(sid, "cascade", at=2, outcome="abandoned", final_score=900)
    await _add(sid, "cascade", at=3, outcome="kept_playing", final_score=50)

    s = await _game(sid, "cascade")
    assert s.sessions == 4
    assert s.completed_played == 3
    # The deprecated alias keeps its meaning.
    assert s.played == 4


async def test_open_games_are_not_sessions() -> None:
    sid = _sid()
    await _add(sid, "cascade", final_score=100)
    factory = get_session_factory()
    async with factory() as db:
        gt_id = (
            await db.execute(select(GameType.id).where(GameType.name == "cascade"))
        ).scalar_one()
        db.add(Game(session_id=sid, game_type_id=gt_id, started_at=_T0))
        await db.commit()

    assert (await _game(sid, "cascade")).sessions == 1


# ---------------------------------------------------------------------------
# won / lost / tied
# ---------------------------------------------------------------------------


async def test_won_lost_tied_count_result_outcomes() -> None:
    sid = _sid()
    await _outcomes(sid, "hearts", ["win", "win", "loss", "push", "abandoned", "win"])

    s = await _game(sid, "hearts")
    assert (s.won, s.lost, s.tied) == (3, 1, 1)
    assert s.sessions == 6
    assert s.completed_played == 5


async def test_score_only_game_reports_null_win_fields() -> None:
    sid = _sid()
    await _outcomes(sid, "cascade", ["completed", "kept_playing", "abandoned"])

    s = await _game(sid, "cascade")
    assert (s.won, s.lost, s.tied) == (None, None, None)
    assert (s.current_win_streak, s.best_win_streak) == (None, None)


async def test_solo_only_yacht_reports_null_win_fields() -> None:
    sid = _sid()
    await _outcomes(sid, "yacht", ["completed", "completed"])

    s = await _game(sid, "yacht")
    assert (s.won, s.lost, s.tied) == (None, None, None)
    assert (s.current_win_streak, s.best_win_streak) == (None, None)


async def test_one_vs_game_gives_yacht_win_fields() -> None:
    sid = _sid()
    await _outcomes(sid, "yacht", ["completed", "loss", "completed"])

    s = await _game(sid, "yacht")
    assert (s.won, s.lost, s.tied) == (0, 1, 0)
    assert (s.current_win_streak, s.best_win_streak) == (0, 0)


async def test_ties_only_still_have_win_fields() -> None:
    sid = _sid()
    await _outcomes(sid, "hearts", ["push"])

    s = await _game(sid, "hearts")
    assert (s.won, s.lost, s.tied) == (0, 0, 1)
    assert (s.current_win_streak, s.best_win_streak) == (0, 0)


async def test_win_fields_are_per_game() -> None:
    sid = _sid()
    await _outcomes(sid, "hearts", ["win"])
    await _outcomes(sid, "cascade", ["completed"])

    stats = await _stats(sid)
    assert stats.by_game["hearts"].won == 1
    assert stats.by_game["cascade"].won is None


# ---------------------------------------------------------------------------
# win streaks
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("outcomes", "current", "best"),
    [
        (["win", "abandoned", "win"], 2, 2),
        (["win", "push", "win"], 2, 2),
        (["win", "loss", "win"], 1, 1),
        (["win", "completed", "win"], 2, 2),
        (["win", "kept_playing", "win"], 2, 2),
        (["win", "win", "win", "loss", "win"], 1, 3),
        (["win", "win", "loss"], 0, 2),
        (["loss", "push"], 0, 0),
        ([], 0, 0),
        # Legacy `blackjack` outcome: not a win, never moves a streak. #2619
        # migrates stored rows to `win` and drops it from the CHECK constraint,
        # so this is checked here rather than by inserting such a row.
        (["win", "blackjack", "loss", "blackjack", "win"], 1, 1),
    ],
)
def test_win_streak_rules(outcomes: list[str], current: int, best: int) -> None:
    assert win_streaks(outcomes) == (current, best)


@pytest.mark.parametrize(
    ("game_type", "outcomes", "current", "best"),
    [
        ("hearts", ["win", "abandoned", "win"], 2, 2),
        ("hearts", ["win", "push", "win"], 2, 2),
        ("hearts", ["win", "loss", "win"], 1, 1),
        ("yacht", ["win", "completed", "win"], 2, 2),
        ("hearts", ["win", "win", "win", "loss", "win"], 1, 3),
    ],
)
async def test_win_streaks_from_the_db(
    game_type: str, outcomes: list[str], current: int, best: int
) -> None:
    sid = _sid()
    await _outcomes(sid, game_type, outcomes)

    s = await _game(sid, game_type)
    assert (s.current_win_streak, s.best_win_streak) == (current, best)


async def test_streak_follows_completed_at_not_insert_order() -> None:
    sid = _sid()
    # Inserted loss last but completed first: the two wins after it are a run.
    await _add(sid, "hearts", at=5, outcome="win")
    await _add(sid, "hearts", at=6, outcome="win")
    await _add(sid, "hearts", at=1, outcome="loss")

    s = await _game(sid, "hearts")
    assert (s.current_win_streak, s.best_win_streak) == (2, 2)


async def test_streaks_are_per_game() -> None:
    sid = _sid()
    await _add(sid, "hearts", at=0, outcome="win")
    await _add(sid, "mahjong", at=1, outcome="loss")
    await _add(sid, "hearts", at=2, outcome="win")

    stats = await _stats(sid)
    assert stats.by_game["hearts"].current_win_streak == 2
    assert stats.by_game["mahjong"].current_win_streak == 0


async def test_another_sessions_rows_do_not_count() -> None:
    sid, other = _sid(), _sid()
    await _add(sid, "hearts", at=0, outcome="win")
    await _add(other, "hearts", at=1, outcome="loss")
    await _add(sid, "hearts", at=2, outcome="win")

    s = await _game(sid, "hearts")
    assert (s.won, s.lost) == (2, 0)
    assert s.current_win_streak == 2


# ---------------------------------------------------------------------------
# best_value / best_label_key
# ---------------------------------------------------------------------------


async def test_freecell_best_value_is_fewest_moves() -> None:
    sid = _sid()
    await _add(sid, "freecell", at=0, final_score=120)
    await _add(sid, "freecell", at=1, final_score=87)
    await _add(sid, "freecell", at=2, final_score=140)
    await _add(sid, "freecell", at=3, outcome="abandoned", final_score=3)

    s = await _game(sid, "freecell")
    assert s.best_value == 87
    assert s.best_label_key == "moves"
    # The deprecated alias keeps its old meaning (highest final_score).
    assert s.best == 140


async def test_desc_board_best_value_is_highest_score() -> None:
    sid = _sid()
    await _add(sid, "cascade", at=0, final_score=400)
    await _add(sid, "cascade", at=1, final_score=900)
    await _add(sid, "cascade", at=2, outcome="abandoned", final_score=5000)

    s = await _game(sid, "cascade")
    assert s.best_value == 900
    assert s.best_label_key == "score"


async def test_metadata_metric_best_value_uses_the_board_metric_and_direction() -> None:
    # Daily Word ranks guesses_used ascending; final_score stays null.
    sid = _sid()
    await _add(sid, "daily_word", at=0, outcome="win", metadata={"guesses_used": 4})
    await _add(sid, "daily_word", at=1, outcome="win", metadata={"guesses_used": 3})
    await _add(sid, "daily_word", at=2, outcome="loss", metadata={"guesses_used": 6})

    s = await _game(sid, "daily_word")
    assert s.best_value == 3
    assert s.best_label_key == "guesses"
    assert s.best is None


async def test_daily_word_best_ignores_losses() -> None:
    # qualifying_outcomes=("win",): the best is the fewest guesses in a won
    # game. A loss is never a best, even with a lower guesses_used.
    sid = _sid()
    await _add(sid, "daily_word", at=0, outcome="win", metadata={"guesses_used": 5})
    await _add(sid, "daily_word", at=1, outcome="loss", metadata={"guesses_used": 2})
    await _add(sid, "daily_word", at=2, outcome=None, metadata={"guesses_used": 1})

    assert (await _game(sid, "daily_word")).best_value == 5


async def test_daily_word_with_only_losses_has_no_best() -> None:
    sid = _sid()
    await _add(sid, "daily_word", at=0, outcome="loss", metadata={"guesses_used": 6})
    await _add(sid, "daily_word", at=1, outcome="loss", metadata={"guesses_used": 6})

    s = await _game(sid, "daily_word")
    assert s.best_value is None
    assert s.best_label_key == "guesses"
    assert (s.won, s.lost) == (0, 2)


async def test_qualifying_outcomes_apply_to_a_score_board(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # The rule is generic: a final_score board with qualifying_outcomes set
    # takes its best from qualifying rows only.
    from games import service
    from hearts.module import module as hearts_module

    board = hearts_module.board.model_copy(update={"qualifying_outcomes": ("win",)})
    monkeypatch.setattr(hearts_module, "board", board)
    service._best_candidate.cache_clear()
    try:
        sid = _sid()
        await _add(sid, "hearts", at=0, outcome="win", final_score=40)
        await _add(sid, "hearts", at=1, outcome="loss", final_score=90)
        await _add(sid, "hearts", at=2, outcome="push", final_score=80)

        assert (await _game(sid, "hearts")).best_value == 40
    finally:
        monkeypatch.undo()
        service._best_candidate.cache_clear()


async def test_a_malformed_metadata_metric_is_ignored() -> None:
    # Sort has no result_model, so any result block is stored as sent.
    sid = _sid()
    await _add(sid, "sort", at=0, metadata={"level_reached": "twelve"})
    await _add(sid, "sort", at=1, metadata={"level_reached": True})
    await _add(sid, "sort", at=2, metadata={"level_reached": 7})
    await _add(sid, "sort", at=3, metadata={})

    s = await _game(sid, "sort")
    assert s.best_value == 7
    assert s.best_label_key == "level"


async def test_best_value_is_null_without_the_metric() -> None:
    sid = _sid()
    await _add(sid, "sort", metadata={})

    s = await _game(sid, "sort")
    assert s.best_value is None
    assert s.best_label_key == "level"


async def test_a_game_without_a_board_falls_back_to_highest_score() -> None:
    # Twenty48 has no module (and so no board) until #2623.
    sid = _sid()
    await _add(sid, "twenty48", at=0, final_score=2048)
    await _add(sid, "twenty48", at=1, final_score=1024)

    s = await _game(sid, "twenty48")
    assert s.best_value == 2048
    assert s.best_label_key == "score"


# ---------------------------------------------------------------------------
# time_played_ms
# ---------------------------------------------------------------------------


async def test_time_played_sums_duration_ms() -> None:
    sid = _sid()
    await _add(sid, "cascade", at=0, duration_ms=90_000)
    await _add(sid, "cascade", at=1, duration_ms=30_000, outcome="abandoned")

    assert (await _game(sid, "cascade")).time_played_ms == 120_000


@pytest.mark.parametrize("duration_ms", [None, 0])
async def test_time_played_ignores_rows_without_reported_time(duration_ms: int | None) -> None:
    # Only reported play time counts: no wall-clock completed_at − started_at
    # fallback, so a game left open or backgrounded adds nothing.
    sid = _sid()
    await _add(sid, "cascade", at=0, duration_ms=duration_ms, elapsed=timedelta(hours=7))
    await _add(sid, "cascade", at=1, duration_ms=1_000)

    assert (await _game(sid, "cascade")).time_played_ms == 1_000


async def test_time_played_is_zero_when_no_row_reports_time() -> None:
    sid = _sid()
    await _add(sid, "cascade", at=0, duration_ms=None, elapsed=timedelta(days=3))
    await _add(sid, "cascade", at=1, duration_ms=0)

    assert (await _game(sid, "cascade")).time_played_ms == 0


async def test_swept_abandoned_rows_add_no_time() -> None:
    # #2621 sweeps stale open games to abandoned with no duration_ms; their
    # completed_at − started_at can be days, and none of it is play time.
    sid = _sid()
    await _add(
        sid, "hearts", at=0, outcome="abandoned", duration_ms=None, elapsed=timedelta(days=2)
    )
    await _add(sid, "hearts", at=1, outcome="win", duration_ms=4_000)

    assert (await _game(sid, "hearts")).time_played_ms == 4_000


async def test_time_played_is_capped_at_24_hours_per_row() -> None:
    sid = _sid()
    await _add(sid, "cascade", at=0, duration_ms=10 * MAX_TIME_PLAYED_PER_GAME_MS)
    await _add(sid, "cascade", at=1, duration_ms=MAX_TIME_PLAYED_PER_GAME_MS + 1)
    await _add(sid, "cascade", at=2, duration_ms=5_000)

    assert (await _game(sid, "cascade")).time_played_ms == 2 * MAX_TIME_PLAYED_PER_GAME_MS + 5_000


async def test_negative_duration_adds_nothing() -> None:
    sid = _sid()
    await _add(sid, "cascade", at=0, duration_ms=-5_000)
    await _add(sid, "cascade", at=1, duration_ms=2_000)

    assert (await _game(sid, "cascade")).time_played_ms == 2_000


# ---------------------------------------------------------------------------
# XP input and stats_shape
# ---------------------------------------------------------------------------


async def test_stats_shape_cannot_change_xp_or_comparable_fields(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from cascade.module import module as cascade_module

    sid = _sid()
    await _outcomes(sid, "cascade", ["completed", "abandoned"])
    baseline = await _stats(sid)

    def greedy_shape(raw: dict) -> dict:
        return {
            **raw,
            "played": 99,
            "completed_played": 99,
            "sessions": 99,
            "completed": 99,
            "won": 99,
            "best_value": 99,
            "time_played_ms": 99,
        }

    monkeypatch.setattr(cascade_module, "stats_shape", greedy_shape)
    s = (await _stats(sid)).by_game["cascade"]
    assert s.completed_played == 1
    assert s.sessions == 2
    assert s.won is None
    assert s.best_value == 10
    assert s.time_played_ms == 2 * _MINUTE_MS
    assert (
        compute_progression(await _stats(sid)).arcade_xp == compute_progression(baseline).arcade_xp
    )


# ---------------------------------------------------------------------------
# query count
# ---------------------------------------------------------------------------


async def _statements_for_stats(sid: str) -> list[str]:
    statements: list[str] = []
    factory = get_session_factory()
    async with factory() as db:
        engine = db.sync_session.get_bind()

        def record(_conn, _cursor, statement, *_rest) -> None:
            statements.append(statement)

        event.listen(engine, "before_cursor_execute", record)
        try:
            await get_stats_for_session(db, session_id=sid)
        finally:
            event.remove(engine, "before_cursor_execute", record)
    return statements


async def test_streaks_add_one_query_however_many_games() -> None:
    # Aggregate + latest score + latest metadata, plus one streak scan.
    sid = _sid()
    for game_type in ("hearts", "mahjong", "yacht", "daily_word"):
        await _outcomes(sid, game_type, ["win", "loss", "win", "push", "win"])
    await _outcomes(sid, "cascade", ["completed"] * 5)

    assert len(await _statements_for_stats(sid)) == 4


async def test_no_streak_query_without_results() -> None:
    sid = _sid()
    await _outcomes(sid, "cascade", ["completed", "abandoned"])
    await _outcomes(sid, "hearts", ["push"])

    assert len(await _statements_for_stats(sid)) == 3


# ---------------------------------------------------------------------------
# API — /stats/me
# ---------------------------------------------------------------------------


@pytest.fixture()
def client() -> Iterator[TestClient]:
    assert is_configured()
    from main import app

    with TestClient(app) as c:
        yield c


def _headers(sid: str) -> dict[str, str]:
    return {"X-Session-ID": sid, "Content-Type": "application/json"}


async def test_stats_me_returns_the_comparable_fields(client: TestClient) -> None:
    sid = _sid()
    await _add(sid, "freecell", at=0, outcome="completed", final_score=90)
    await _add(sid, "freecell", at=1, outcome="abandoned", final_score=2)
    await _outcomes(sid, "hearts", ["win", "loss", "win", "win"])

    body = client.get("/stats/me", headers=_headers(sid)).json()
    freecell = body["by_game"]["freecell"]
    assert freecell["sessions"] == 2
    assert freecell["completed"] == 1
    assert freecell["won"] is None
    assert freecell["lost"] is None
    assert freecell["tied"] is None
    assert freecell["current_win_streak"] is None
    assert freecell["best_win_streak"] is None
    assert freecell["time_played_ms"] == 2 * _MINUTE_MS
    assert freecell["best_value"] == 90
    assert freecell["best_label_key"] == "moves"
    assert freecell["extras"] == {}
    # Deprecated aliases are still there for current app builds.
    assert freecell["played"] == 2
    assert freecell["best"] == 90

    hearts = body["by_game"]["hearts"]
    assert (hearts["won"], hearts["lost"], hearts["tied"]) == (3, 1, 0)
    assert (hearts["current_win_streak"], hearts["best_win_streak"]) == (2, 2)


async def test_stats_me_blackjack_chips_are_in_extras_and_the_old_fields(
    client: TestClient,
) -> None:
    sid = _sid()
    meta = {"best_run_chips": 3000, "total_runs": 5, "runs_completed": 2}
    await _add(sid, "blackjack", at=0, final_score=2400, metadata=meta)
    await _add(sid, "blackjack", at=1, final_score=1800, metadata={**meta, "total_runs": 6})

    bj = client.get("/stats/me", headers=_headers(sid)).json()["by_game"]["blackjack"]
    assert bj["extras"] == {
        "best_chips": 2400,
        "current_chips": 1800,
        "best_run_chips": 3000,
        "total_runs": 6,
        "runs_completed": 2,
        "current_table": None,
    }
    for key, value in bj["extras"].items():
        assert bj[key] == value
    assert bj["best_value"] == 2400
    assert bj["best_label_key"] == "chips"
    assert bj["best"] is None
    assert bj["avg"] is None
