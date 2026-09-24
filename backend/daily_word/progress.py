"""Server-side Daily Word guess state (#2197).

The puzzle itself is deterministic and public — ``puzzle_id`` is just
``YYYY-MM-DD:{lang}`` — so the only thing that can gate the answer is a record
of what the caller has actually done. That record lives here.

Two rules, both previously client-only:

* a session gets ``MAX_GUESSES`` scored guesses on a puzzle, and no more;
* the answer is released only once those are spent, or the puzzle is solved.

A re-sent guess is idempotent on the guess text: if a guess reaches the server
but its response is lost, the player re-types the same word and must not be
charged twice for it. Note this is *manual* re-entry — ``submitGuess`` is not
wrapped in ``withRetry`` (only ``getToday`` is), so nothing replays the request
automatically.

The client pairs this with a duplicate-word guard, and the two belong together:
because a repeat costs no server-side turn, a *deliberate* repeat would advance
the board past the recorded count and leave the player short of the answer they
earned. Do not remove one without the other.
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

    The row is locked for the caller's transaction, because ``record_guess``
    read-modify-writes the whole ``guesses`` value: without it, two concurrent
    guesses would both read the same list, both append their own, and the later
    UPDATE would drop the earlier guess — under-counting, and letting more than
    MAX_GUESSES scored guesses through. ``with_for_update`` is a no-op on
    SQLite, which is fine: the test suite is single-threaded and Postgres is
    what serves concurrent traffic.
    """
    stmt = (
        select(DailyWordProgress)
        .where(
            DailyWordProgress.session_id == session_id,
            DailyWordProgress.puzzle_id == puzzle_id,
        )
        .with_for_update()
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
    else:
        return row

    # The insert lost the race. Normally the winner's row is now visible — but
    # it is not guaranteed: the transaction that took the constraint can still
    # roll back (an error between flush and commit, a dropped connection, a
    # statement timeout), leaving nothing to read. Falling back to a second
    # insert keeps a recoverable race from surfacing as a 500 on a legitimate
    # guess.
    existing = (await session.execute(stmt)).scalar_one_or_none()
    if existing is not None:
        return existing

    row = DailyWordProgress(session_id=session_id, puzzle_id=puzzle_id, guesses=[], solved=False)
    session.add(row)
    try:
        await session.flush()
    except IntegrityError:
        # Guarded like the first attempt: the whole point of this block is to
        # keep a recoverable race off the player's 500 path, so it must not
        # itself raise. If this loses too, the winner has committed by now.
        await session.rollback()
        return (await session.execute(stmt)).scalar_one()
    return row
