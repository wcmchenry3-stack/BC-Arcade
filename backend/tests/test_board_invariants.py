"""Reporting rules every game follows (#2642, epic #2519 decisions 11 and 12).

Each game's reporting has its own tests; these check that *every* game follows
the same rules, so a new or changed game can't quietly bring back duplicate
rows, the wrong sort direction or a wrong streak. The games come from the
module registry, not a hand-written list: registering a game with an enabled
``BoardDefinition`` (or a ``has_winner`` flag) puts it under these tests.

- Every finished game of a named player (``PUT /players/me``, #2624) is on its
  board; the player appears exactly once, with their best row by the board's
  direction and tie-break; ``GET /games/{id}/rank`` (#2677) and the board's
  ``me`` / ``is_me`` (#2633) report that entry's rank.
- Entries rank in the declared direction, then the tie-break, then the
  earliest completion.
- No board lists an unnamed player or a sentinel ``*-anon`` session.
- ``/stats/me`` win streaks (#2620): ``push`` and ``abandoned`` neither extend
  nor break a run, a ``loss`` ends it, and score-only games report ``null``.
"""

from __future__ import annotations

import os
import uuid
from collections.abc import Iterator
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlencode

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from db.base import get_session_factory, is_configured
from db.models import Game, GameType
from games.board import SCORE_METRIC, BoardDefinition
from games.leaderboard import SENTINEL_SESSION_SUFFIX, enabled_board
from games.registry import get_module
from tests.test_generic_leaderboard import ENABLED_BOARDS, _board, _grant_all, _headers, _seed, _sid
from vocab import GameType as GameTypeEnum

pytestmark = pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"),
    reason="DATABASE_URL not set — skipping live API tests",
)

# Every game type's module; a type with none fails
# test_every_game_type_is_registered rather than dropping out of these lists.
_MODULES = {gt.value: get_module(gt.value) for gt in GameTypeEnum}
HAS_WINNER = sorted(name for name, mod in _MODULES.items() if mod is not None and mod.has_winner)
SCORE_ONLY = sorted(
    name for name, mod in _MODULES.items() if mod is not None and not mod.has_winner
)


@pytest.fixture()
def client() -> Iterator[TestClient]:
    assert is_configured()
    from main import app

    with TestClient(app) as c:
        yield c


def test_every_game_type_is_registered() -> None:
    # The lists below come from the registry: a game type without a module
    # would silently drop out of every test in this file.
    assert [name for name, mod in _MODULES.items() if mod is None] == []
    assert set(HAS_WINNER) | set(SCORE_ONLY) == {gt.value for gt in GameTypeEnum}
    assert HAS_WINNER and SCORE_ONLY
    # ENABLED_BOARDS (shared with test_generic_leaderboard) is every game type
    # whose module declares an enabled board.
    assert ENABLED_BOARDS == sorted(
        name for name, mod in _MODULES.items() if mod is not None and mod.board.enabled
    )
    assert len(ENABLED_BOARDS) >= 8, ENABLED_BOARDS


# ---------------------------------------------------------------------------
# Board helpers, all derived from the BoardDefinition
# ---------------------------------------------------------------------------


def _definition(game: str) -> BoardDefinition:
    board = enabled_board(game)
    assert board is not None, f"{game} has no enabled board"
    return board


def _partition(board: BoardDefinition) -> dict[str, str]:
    """One board of the game: each partition key's default, else its first allowed
    or capped value (Sudoku's ``difficulty`` has neither default nor value list)."""
    out: dict[str, str] = {}
    for key in board.partitions:
        value = board.partition_default(key)
        if value is None:
            allowed = board.allowed_values(key)
            value = allowed[0] if allowed else None
        if value is None:
            value = next((v for k, v, _ in board.partition_max_values if k == key), None)
        assert value is not None, f"pick a test value for partition {key!r}"
        out[key] = value
    return out


def _board_path(game: str) -> str:
    query = urlencode(_partition(_definition(game)))
    return f"{game}?limit=100&{query}" if query else f"{game}?limit=100"


def _better(board: BoardDefinition, steps: int) -> int:
    """A metric value ``steps`` better than 10 in the board's direction.

    Every value used stays in [0, 20], inside every game's cap.
    """
    return 10 + steps if board.direction == "desc" else 10 - steps


def _better_tiebreak(board: BoardDefinition, steps: int) -> int:
    assert board.tiebreak is not None
    return 50 + steps if board.tiebreak[1] == "desc" else 50 - steps


def _outcome(board: BoardDefinition) -> str:
    """An outcome that counts on the board (Daily Word would need ``win``)."""
    return board.qualifying_outcomes[0] if board.qualifying_outcomes else "completed"


def _row(
    board: BoardDefinition, value: int, tiebreak: int | None = None
) -> tuple[int | None, dict[str, Any]]:
    """``(final_score, metadata)`` for a row on ``_partition(board)``."""
    meta: dict[str, Any] = dict(_partition(board))
    score: int | None = None
    if board.metric == SCORE_METRIC:
        score = value
    else:
        meta[board.metric] = value
    if tiebreak is not None:
        assert board.tiebreak is not None
        meta[board.tiebreak[0]] = tiebreak
    return score, meta


async def _seed_row(
    game: str,
    sid: str,
    value: int,
    *,
    name: str | None,
    minutes: int,
    tiebreak: int | None = None,
    meta: dict[str, Any] | None = None,
) -> uuid.UUID:
    board = _definition(game)
    score, row_meta = _row(board, value, tiebreak)
    return await _seed(
        game,
        sid,
        score=score,
        name=name,
        minutes=minutes,
        outcome=_outcome(board),
        meta={**row_meta, **(meta or {})},
    )


def _play(
    client: TestClient,
    sid: str,
    game: str,
    value: int,
    *,
    completed_at: datetime,
    tiebreak: int | None = None,
) -> str:
    """Create and complete one game through the API; returns its id."""
    board = _definition(game)
    r = client.post(
        "/games",
        headers=_headers(sid),
        json={"game_type": game, "metadata": _partition(board)},
    )
    assert r.status_code == 200, r.text
    game_id = r.json()["id"]
    score, meta = _row(board, value, tiebreak)
    result = {k: v for k, v in meta.items() if k not in board.partitions}
    body: dict[str, Any] = {
        "outcome": _outcome(board),
        "completed_at": completed_at.isoformat(),
        "result": result,
    }
    if score is not None:
        body["final_score"] = score
    r = client.patch(f"/games/{game_id}/complete", headers=_headers(sid), json=body)
    assert r.status_code == 200, r.text
    return game_id


def _set_display_name(client: TestClient, sid: str, name: str) -> None:
    r = client.put("/players/me", headers=_headers(sid), json={"display_name": name})
    assert r.status_code == 200, r.text


def _leaderboard(client: TestClient, game: str, sid: str) -> dict:
    return _board(client, _board_path(game), sid)


def _rank(client: TestClient, game_id: Any, sid: str) -> dict:
    r = client.get(f"/games/{game_id}/rank", headers=_headers(sid))
    assert r.status_code == 200, r.text
    return r.json()


def _names(body: dict) -> list[str]:
    return [e["player_name"] for e in body["entries"]]


_RECENT = datetime.now(timezone.utc).replace(microsecond=0) - timedelta(days=1)


def _recent(minutes: int) -> datetime:
    """A completion time the server accepts from a client (within the last year)."""
    return _RECENT + timedelta(minutes=minutes)


def _parse(stamp: str) -> datetime:
    at = datetime.fromisoformat(stamp)
    return at if at.tzinfo else at.replace(tzinfo=timezone.utc)


# ---------------------------------------------------------------------------
# One entry per named player
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("game", ENABLED_BOARDS)
async def test_a_finished_game_ranks_once_its_player_has_a_name(
    client: TestClient, game: str
) -> None:
    sid = _sid()
    await _grant_all(sid)
    game_id = _play(client, sid, game, _better(_definition(game), 0), completed_at=_recent(0))

    # Unnamed: on no board, and the rank route says why.
    body = _leaderboard(client, game, sid)
    assert body["entries"] == []
    assert body["me"] is None
    assert _rank(client, game_id, sid)["reason"] == "no_name"

    _set_display_name(client, sid, "Solo")

    body = _leaderboard(client, game, sid)
    assert [(e["player_name"], e["value"], e["is_me"]) for e in body["entries"]] == [
        ("Solo", _better(_definition(game), 0), True)
    ]
    assert body["me"] == body["entries"][0]
    assert _rank(client, game_id, sid) == {
        "ranked": True,
        "rank": 1,
        "is_best": True,
        "reason": None,
    }


@pytest.mark.parametrize("game", ENABLED_BOARDS)
async def test_a_session_with_several_games_appears_once_with_its_best(
    client: TestClient, game: str
) -> None:
    board = _definition(game)
    tb = board.tiebreak is not None
    # Rivals either side, so the player's rank (2) is not trivially 1. Top has
    # two better rows: a rank counts players, not rows.
    top = _sid()
    await _seed_row(game, top, _better(board, 8), name="Top", minutes=0)
    await _seed_row(game, top, _better(board, 7), name="Top", minutes=1)
    await _seed_row(game, _sid(), _better(board, -8), name="Bottom", minutes=0)

    sid = _sid()
    await _grant_all(sid)
    _set_display_name(client, sid, "Me")
    games = {
        "mid": _play(client, sid, game, _better(board, 0), completed_at=_recent(1)),
        # Equal best values: the tie-break decides (the later one has the better
        # tie-break); without one, the earlier completion is the best.
        "best_early": _play(
            client,
            sid,
            game,
            _better(board, 5),
            completed_at=_recent(2),
            tiebreak=_better_tiebreak(board, 0) if tb else None,
        ),
        "best_late": _play(
            client,
            sid,
            game,
            _better(board, 5),
            completed_at=_recent(3),
            tiebreak=_better_tiebreak(board, 9) if tb else None,
        ),
        "worst": _play(client, sid, game, _better(board, -5), completed_at=_recent(4)),
    }
    best = games["best_late" if tb else "best_early"]

    body = _leaderboard(client, game, sid)
    assert _names(body) == ["Top", "Me", "Bottom"]
    entry = body["entries"][1]
    assert (entry["rank"], entry["value"], entry["is_me"]) == (2, _better(board, 5), True)
    assert body["me"] == entry
    assert _parse(entry["completed_at"]) == _recent(3 if tb else 2)

    # Every game of the session reports the entry's rank; only the best is it.
    for game_id in games.values():
        assert _rank(client, game_id, sid) == {
            "ranked": True,
            "rank": entry["rank"],
            "is_best": game_id == best,
            "reason": None,
        }


# ---------------------------------------------------------------------------
# Ordering
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("game", ENABLED_BOARDS)
async def test_entries_rank_in_the_declared_direction_then_the_tiebreak(
    client: TestClient, game: str
) -> None:
    board = _definition(game)
    tb = board.tiebreak is not None
    good_tb = _better_tiebreak(board, 9) if tb else None
    poor_tb = _better_tiebreak(board, 0) if tb else None
    # (name, metric steps better than 10, tie-break, minutes): listed in the
    # order the board must show them. Rows are seeded in another order below.
    expected: list[tuple[str, int, int | None, int]] = [("First", 6, None, 9)]
    if tb:
        expected += [
            # Equal metric: the better tie-break wins although it finished later.
            ("TieBreakWins", 3, good_tb, 8),
            ("TieBreakLoses", 3, poor_tb, 1),
            # A missing tie-break sorts after every real one, whatever the direction.
            ("NoTieBreak", 3, None, 0),
        ]
    expected += [
        # Equal metric and tie-break: the earlier completion wins.
        ("Earlier", 0, poor_tb, 2),
        ("Later", 0, poor_tb, 7),
        ("Last", -6, None, 0),
    ]

    ids: dict[str, tuple[str, uuid.UUID]] = {}
    for name, steps, tiebreak, minutes in reversed(expected):
        sid = _sid()
        ids[name] = (
            sid,
            await _seed_row(
                game, sid, _better(board, steps), name=name, minutes=minutes, tiebreak=tiebreak
            ),
        )

    viewer = _sid()
    await _grant_all(viewer)
    body = _leaderboard(client, game, viewer)
    assert _names(body) == [name for name, *_ in expected]
    assert [e["rank"] for e in body["entries"]] == list(range(1, len(expected) + 1))
    values = [e["value"] for e in body["entries"]]
    assert values == sorted(values, reverse=board.direction == "desc")

    # The rank route agrees with the board for every player.
    for position, (name, *_rest) in enumerate(expected, start=1):
        sid, game_id = ids[name]
        await _grant_all(sid)
        assert _rank(client, game_id, sid)["rank"] == position, name


# ---------------------------------------------------------------------------
# Who may appear
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("game", ENABLED_BOARDS)
async def test_no_board_lists_an_unnamed_or_sentinel_row(client: TestClient, game: str) -> None:
    board = _definition(game)
    await _seed_row(game, _sid(), _better(board, 0), name="Shown", minutes=0)

    # Better rows that must never show:
    unnamed = _sid()  # no players row; a legacy name on the row itself
    await _seed_row(
        game, unnamed, _better(board, 5), name=None, minutes=1, meta={"player_name": "Ghost"}
    )
    # Sentinel sessions, even with a players row naming them.
    for sentinel in (f"{game}{SENTINEL_SESSION_SUFFIX}", f"{_sid()}{SENTINEL_SESSION_SUFFIX}"):
        await _seed_row(game, sentinel, _better(board, 6), name="Anon", minutes=2)
    # A player who clears their name leaves every board.
    cleared = _sid()
    await _seed_row(game, cleared, _better(board, 7), name="Gone", minutes=3)
    r = client.delete("/players/me", headers=_headers(cleared))
    assert r.status_code == 204, r.text

    await _grant_all(unnamed)
    body = _leaderboard(client, game, unnamed)
    assert [(e["player_name"], e["value"]) for e in body["entries"]] == [
        ("Shown", _better(board, 0))
    ]
    assert body["me"] is None
    assert not any(e["is_me"] for e in body["entries"])


# ---------------------------------------------------------------------------
# Win streaks (/stats/me)
# ---------------------------------------------------------------------------

_T0 = datetime(2026, 9, 1, 12, 0, tzinfo=timezone.utc)


async def _add_outcomes(sid: str, game: str, outcomes: list[str]) -> None:
    """One finished row per outcome, oldest first, a minute apart."""
    factory = get_session_factory()
    async with factory() as db:
        gt_id = (await db.execute(select(GameType.id).where(GameType.name == game))).scalar_one()
        for i, outcome in enumerate(outcomes):
            completed_at = _T0 + timedelta(minutes=i)
            db.add(
                Game(
                    session_id=sid,
                    game_type_id=gt_id,
                    started_at=completed_at - timedelta(seconds=30),
                    completed_at=completed_at,
                    outcome=outcome,
                    final_score=10,
                    game_metadata={},
                )
            )
        await db.commit()


def _game_stats(client: TestClient, sid: str, game: str) -> dict:
    r = client.get("/stats/me", headers=_headers(sid))
    assert r.status_code == 200, r.text
    return r.json()["by_game"][game]


@pytest.mark.parametrize(
    ("outcomes", "current", "best"),
    [
        (["win", "abandoned", "win"], 2, 2),
        (["win", "push", "win"], 2, 2),
        (["win", "win", "loss"], 0, 2),
        (["win", "loss", "win"], 1, 1),
        (["win", "win", "abandoned"], 2, 2),
        (["win", "win", "push"], 2, 2),
    ],
    ids=[
        "abandon-skipped",
        "push-skipped",
        "loss-ends-run",
        "loss-resets",
        "trailing-abandon",
        "trailing-push",
    ],
)
@pytest.mark.parametrize("game", HAS_WINNER)
async def test_win_streaks(
    client: TestClient, game: str, outcomes: list[str], current: int, best: int
) -> None:
    sid = _sid()
    await _add_outcomes(sid, game, outcomes)
    stats = _game_stats(client, sid, game)
    assert (stats["current_win_streak"], stats["best_win_streak"]) == (current, best)


@pytest.mark.parametrize("game", SCORE_ONLY)
async def test_score_only_games_have_no_win_streak(client: TestClient, game: str) -> None:
    sid = _sid()
    await _add_outcomes(sid, game, ["completed", "kept_playing", "abandoned", "completed"])
    stats = _game_stats(client, sid, game)
    assert stats["sessions"] == 4
    assert (stats["current_win_streak"], stats["best_win_streak"]) == (None, None)
    assert (stats["won"], stats["lost"], stats["tied"]) == (None, None, None)
