"""Unit tests for daily_word.progress: guess-state transitions and race recovery (#2958).

The rules under test (#2197): a session gets ``MAX_GUESSES`` scored guesses on a
puzzle, the answer is released only once they are spent or the puzzle is solved,
and a re-sent guess is idempotent. These call the functions directly against the
test database; the HTTP surface is covered in ``test_daily_word_api.py``.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable, Coroutine
from typing import Any

import pytest
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from daily_word.progress import (
    MAX_GUESSES,
    GuessOutcome,
    may_see_answer,
    record_guess,
    recorded_guess_count,
)
from db.base import get_session_factory
from db.models import DailyWordProgress

PUZZLE = "2026-09-20:en"
# Distinct five-letter words: the first MAX_GUESSES spend a board, one more is refused.
WORDS = ["nymph", "crwth", "phlox", "xylem", "squib", "jumbo", "vexed"]
assert len(WORDS) > MAX_GUESSES, "WORDS needs more than MAX_GUESSES distinct words"
assert len(set(WORDS)) == len(WORDS)


async def _guess(sid: str, guess: str, *, won: bool = False, puzzle: str = PUZZLE) -> GuessOutcome:
    async with get_session_factory()() as db:
        return await record_guess(db, session_id=sid, puzzle_id=puzzle, guess=guess, won=won)


async def _may_see(sid: str, puzzle: str = PUZZLE) -> bool:
    async with get_session_factory()() as db:
        return await may_see_answer(db, session_id=sid, puzzle_id=puzzle)


async def _count(sid: str, puzzle: str = PUZZLE) -> int | None:
    async with get_session_factory()() as db:
        return await recorded_guess_count(db, session_id=sid, puzzle_id=puzzle)


async def _rows(sid: str) -> list[DailyWordProgress]:
    async with get_session_factory()() as db:
        result = await db.execute(
            select(DailyWordProgress).where(DailyWordProgress.session_id == sid)
        )
        return list(result.scalars())


# ---------------------------------------------------------------------------
# record_guess
# ---------------------------------------------------------------------------


async def test_first_guess_is_allowed_and_counted(session_id: str) -> None:
    out = await _guess(session_id, WORDS[0])
    assert out == GuessOutcome(allowed=True, replay=False, guesses_used=1, solved=False)
    assert await _count(session_id) == 1


async def test_guesses_accumulate_in_order(session_id: str) -> None:
    for i, word in enumerate(WORDS[:3], start=1):
        out = await _guess(session_id, word)
        assert (out.allowed, out.replay, out.guesses_used) == (True, False, i)
    (row,) = await _rows(session_id)
    assert row.guesses == WORDS[:3]
    assert row.solved is False


async def test_a_winning_guess_marks_the_puzzle_solved(session_id: str) -> None:
    await _guess(session_id, WORDS[0])
    out = await _guess(session_id, WORDS[1], won=True)
    assert out == GuessOutcome(allowed=True, replay=False, guesses_used=2, solved=True)
    (row,) = await _rows(session_id)
    assert row.solved is True


async def test_a_solved_puzzle_refuses_further_new_guesses(session_id: str) -> None:
    await _guess(session_id, WORDS[0], won=True)
    out = await _guess(session_id, WORDS[1])
    assert out == GuessOutcome(allowed=False, replay=False, guesses_used=1, solved=True)
    assert await _count(session_id) == 1, "a refused guess must not be recorded"


async def test_the_guess_after_the_last_is_refused(session_id: str) -> None:
    for word in WORDS[:MAX_GUESSES]:
        assert (await _guess(session_id, word)).allowed is True
    out = await _guess(session_id, WORDS[MAX_GUESSES])
    assert out == GuessOutcome(allowed=False, replay=False, guesses_used=MAX_GUESSES, solved=False)
    assert await _count(session_id) == MAX_GUESSES


async def test_a_replayed_guess_is_free_and_leaves_the_count_alone(session_id: str) -> None:
    await _guess(session_id, WORDS[0])
    out = await _guess(session_id, WORDS[0])
    assert out == GuessOutcome(allowed=True, replay=True, guesses_used=1, solved=False)
    assert await _count(session_id) == 1


async def test_a_replay_is_still_allowed_when_the_board_is_spent(session_id: str) -> None:
    """A lost response on the last guess must not lock the player out of re-reading it."""
    for word in WORDS[:MAX_GUESSES]:
        await _guess(session_id, word)
    out = await _guess(session_id, WORDS[MAX_GUESSES - 1])
    assert out.allowed is True
    assert out.replay is True
    assert out.guesses_used == MAX_GUESSES


async def test_a_replay_of_the_winning_guess_reports_solved(session_id: str) -> None:
    await _guess(session_id, WORDS[0], won=True)
    out = await _guess(session_id, WORDS[0], won=True)
    assert out == GuessOutcome(allowed=True, replay=True, guesses_used=1, solved=True)


async def test_progress_is_per_session_and_per_puzzle(session_id: str) -> None:
    other = str(uuid.uuid4())
    await _guess(session_id, WORDS[0], won=True)
    assert (await _guess(other, WORDS[0])).replay is False
    assert (await _guess(session_id, WORDS[1], puzzle="2026-09-21:en")).allowed is True
    assert (await _guess(session_id, WORDS[0], puzzle="2026-09-20:hi")).replay is False


# ---------------------------------------------------------------------------
# may_see_answer
# ---------------------------------------------------------------------------


async def test_no_record_means_no_answer(session_id: str) -> None:
    assert await _may_see(session_id) is False


async def test_an_unfinished_board_does_not_release_the_answer(session_id: str) -> None:
    for word in WORDS[: MAX_GUESSES - 1]:
        await _guess(session_id, word)
    assert await _may_see(session_id) is False


async def test_a_solved_puzzle_releases_the_answer(session_id: str) -> None:
    await _guess(session_id, WORDS[0], won=True)
    assert await _may_see(session_id) is True


async def test_a_spent_board_releases_the_answer(session_id: str) -> None:
    for word in WORDS[:MAX_GUESSES]:
        await _guess(session_id, word)
    assert await _may_see(session_id) is True


async def test_the_answer_is_not_released_across_sessions_or_puzzles(session_id: str) -> None:
    await _guess(session_id, WORDS[0], won=True)
    assert await _may_see(str(uuid.uuid4())) is False
    assert await _may_see(session_id, "2026-09-21:en") is False


# ---------------------------------------------------------------------------
# recorded_guess_count
# ---------------------------------------------------------------------------


async def test_recorded_guess_count_is_none_without_a_row(session_id: str) -> None:
    assert await _count(session_id) is None


async def test_recorded_guess_count_is_zero_for_an_empty_row(session_id: str) -> None:
    async with get_session_factory()() as db:
        db.add(DailyWordProgress(session_id=session_id, puzzle_id=PUZZLE, guesses=[], solved=False))
        await db.commit()
    assert await _count(session_id) == 0


# ---------------------------------------------------------------------------
# _get_or_create: two concurrent first guesses (the unique constraint's loser)
# ---------------------------------------------------------------------------

Hook = Callable[[int], Coroutine[Any, Any, None]]


async def _drop_rows(sid: str) -> None:
    async with get_session_factory()() as db:
        await db.execute(delete(DailyWordProgress).where(DailyWordProgress.session_id == sid))
        await db.commit()


def _race_the_insert(
    monkeypatch: pytest.MonkeyPatch,
    db: AsyncSession,
    *,
    times: int,
    rival_lands: Hook,
    rival_rolls_back: Hook | None = None,
) -> None:
    """Make ``db``'s first ``times`` explicit flushes collide with a rival's committed row.

    ``rival_lands(n)`` runs before the n-th flush (1-based) and commits the rival's row
    through its own session, so the real flush then fails with the real UNIQUE violation.
    ``rival_rolls_back(n)`` runs right after ``db``'s n-th rollback: it is where a winner
    whose transaction later vanished takes its row back out.
    """
    real_flush, real_rollback = db.flush, db.rollback
    flushes = rollbacks = 0

    async def flush(*args: Any, **kwargs: Any) -> None:
        nonlocal flushes
        flushes += 1
        if flushes <= times:
            await rival_lands(flushes)
        await real_flush(*args, **kwargs)

    async def rollback() -> None:
        nonlocal rollbacks
        rollbacks += 1
        await real_rollback()
        if rival_rolls_back is not None:
            await rival_rolls_back(rollbacks)

    monkeypatch.setattr(db, "flush", flush)
    monkeypatch.setattr(db, "rollback", rollback)


async def test_a_lost_insert_race_reuses_the_winners_row(
    session_id: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Both first guesses count: the loser re-reads the winner's row and appends to it."""

    async def winner_commits(_n: int) -> None:
        await _guess(session_id, WORDS[0])

    async with get_session_factory()() as db:
        _race_the_insert(monkeypatch, db, times=1, rival_lands=winner_commits)
        out = await record_guess(
            db, session_id=session_id, puzzle_id=PUZZLE, guess=WORDS[1], won=False
        )

    assert out == GuessOutcome(allowed=True, replay=False, guesses_used=2, solved=False)
    (row,) = await _rows(session_id)
    assert row.guesses == [WORDS[0], WORDS[1]]


async def test_a_lost_race_whose_winner_rolled_back_inserts_again(
    session_id: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The winner's transaction can vanish after the constraint fired; the guess still lands."""

    async def winner_inserts(_n: int) -> None:
        await _guess(session_id, WORDS[0])

    async def winner_vanishes(_n: int) -> None:
        await _drop_rows(session_id)

    async with get_session_factory()() as db:
        _race_the_insert(
            monkeypatch,
            db,
            times=1,
            rival_lands=winner_inserts,
            rival_rolls_back=winner_vanishes,
        )
        out = await record_guess(
            db, session_id=session_id, puzzle_id=PUZZLE, guess=WORDS[1], won=False
        )

    assert out == GuessOutcome(allowed=True, replay=False, guesses_used=1, solved=False)
    (row,) = await _rows(session_id)
    assert row.guesses == [WORDS[1]], "the vanished winner's guess is gone, ours is recorded"


async def test_losing_both_inserts_falls_back_to_the_committed_row(
    session_id: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """If the retry loses too, the winner has committed by then: use its row, never a 500."""

    async def winner_inserts(_n: int) -> None:
        await _guess(session_id, WORDS[0])

    async def first_winner_vanishes(n: int) -> None:
        if n == 1:  # the second winner stays committed
            await _drop_rows(session_id)

    async with get_session_factory()() as db:
        _race_the_insert(
            monkeypatch,
            db,
            times=2,
            rival_lands=winner_inserts,
            rival_rolls_back=first_winner_vanishes,
        )
        out = await record_guess(
            db, session_id=session_id, puzzle_id=PUZZLE, guess=WORDS[1], won=False
        )

    assert out == GuessOutcome(allowed=True, replay=False, guesses_used=2, solved=False)
    (row,) = await _rows(session_id)
    assert row.guesses == [WORDS[0], WORDS[1]]
