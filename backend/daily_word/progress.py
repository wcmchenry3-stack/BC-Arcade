"""Server-side Daily Word guess state (#2197).

The puzzle itself is deterministic and public — ``puzzle_id`` is just
``YYYY-MM-DD:{lang}`` — so the only thing that can gate the answer is a record
of what the caller has actually done. That record lives here.

Two rules, both previously client-only:

* a session gets ``MAX_GUESSES`` scored guesses on a puzzle, and no more;
* the answer is released only once those are spent, or the puzzle is solved.

Retries are idempotent on the guess text. ``httpClient``'s ``withRetry`` can
replay a guess that actually reached the server, and a replay must never cost
the player a turn.
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import DailyWordProgress

# Matches MAX_ROWS in frontend/src/game/daily_word/engine.ts. The client still
# enforces its own limit for immediate feedback; this is the one that counts.
MAX_GUESSES = 6


@dataclass(frozen=True)
class GuessOutcome:
    """What the caller is allowed to do next.

    ``replay`` marks a guess already on record: it is re-scored and returned as
    it was, without spending a turn.
    """

    allowed: bool
    replay: bool
    guesses_used: int
    solved: bool


async def record_guess(
    session: AsyncSession, *, session_id: str, puzzle_id: str, guess: str, won: bool
) -> GuessOutcome:
    """Spend one guess, or report why the caller cannot.

    Returns ``allowed=False`` when the puzzle is already solved or the session
    is out of guesses. Commits on success.
    """
    row = await _get_or_create(session, session_id=session_id, puzzle_id=puzzle_id)
    guesses: list[str] = list(row.guesses or [])

    if guess in guesses:
        # A replay of a guess that already landed — hand back the same scoring.
        return GuessOutcome(allowed=True, replay=True, guesses_used=len(guesses), solved=row.solved)

    if row.solved or len(guesses) >= MAX_GUESSES:
        return GuessOutcome(
            allowed=False, replay=False, guesses_used=len(guesses), solved=row.solved
        )

    guesses.append(guess)
    # Reassign rather than mutate: the JSON column only tracks whole-value
    # changes, so an in-place append would not be flushed.
    row.guesses = guesses
    if won:
        row.solved = True
    await session.commit()
    return GuessOutcome(allowed=True, replay=False, guesses_used=len(guesses), solved=row.solved)


async def may_see_answer(session: AsyncSession, *, session_id: str, puzzle_id: str) -> bool:
    """True once this session has solved the puzzle or spent every guess.

    A session with no row has not played: it gets nothing. This deliberately
    also refuses answers for past puzzles the caller never attempted.
    """
    row = (
        await session.execute(
            select(DailyWordProgress).where(
                DailyWordProgress.session_id == session_id,
                DailyWordProgress.puzzle_id == puzzle_id,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        return False
    return bool(row.solved) or len(row.guesses or []) >= MAX_GUESSES


async def _get_or_create(
    session: AsyncSession, *, session_id: str, puzzle_id: str
) -> DailyWordProgress:
    """Fetch this session's row for the puzzle, creating it on first guess.

    Two concurrent first guesses both miss the SELECT and both insert; the
    unique constraint rejects the loser, which then re-reads the winner's row.
    """
    stmt = select(DailyWordProgress).where(
        DailyWordProgress.session_id == session_id,
        DailyWordProgress.puzzle_id == puzzle_id,
    )
    row = (await session.execute(stmt)).scalar_one_or_none()
    if row is not None:
        return row

    row = DailyWordProgress(session_id=session_id, puzzle_id=puzzle_id, guesses=[], solved=False)
    session.add(row)
    try:
        await session.flush()
    except IntegrityError:
        await session.rollback()
        return (await session.execute(stmt)).scalar_one()
    return row
