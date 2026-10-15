"""Print one game's metadata and recorded events, in order, as plain text (#3277).

From a Sentry issue tagged ``game.id`` (or a bug report whose context has
``game_id``) to the game's recorded events:

    cd backend
    python scripts/replay_game.py <game_id>
    python scripts/replay_game.py <game_id> --max-chars 0     # full payloads

Reads ``DATABASE_URL`` the way the app does (``settings.Settings``, ``backend/.env``
and the environment), through the app's own session factory. Read-only: it issues
SELECTs only, and on Postgres the transaction is also ``READ ONLY``.

Output: the game's row (id, type, timestamps, outcome, score, duration, metadata;
never the player's session id), then each event in ``event_index`` order, tagged
``lifecycle`` (``game_started``, ``game_ended``, ``hand_resolved``) or ``replay``
(everything else), with a ``GAP`` line wherever ``event_index`` skips (indexes
start at 0). A summary closes the report. A game with a gap was not fully
recorded (a dropped batch, a size cap, or events still on the device).

A Blackjack game also gets its rounds, rebuilt from the events (``blackjack/replay.py``):
every card dealt and drawn, split hands and the dealer's play included, with the
bets, outcomes and chips. That section is never truncated by ``--max-chars``.

A Yacht game (solo or vs the computer) is also rebuilt from its ``turn_completed``
events alone (#3282, ``yacht/replay.py``): both scorecards are printed after the
summary, with every place a recorded turn disagrees with the replay.

Exit codes: 0 printed (gaps do not change it), 1 no such game, 2 bad argument.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from blackjack.replay import render_rounds
from db.models import EventType, Game, GameEvent, GameType

#: Event types that mark the game's life rather than its play.
LIFECYCLE_EVENTS = frozenset({"game_started", "game_ended", "hand_resolved"})
DEFAULT_MAX_CHARS = 300


@dataclass(frozen=True)
class GameRow:
    id: uuid.UUID
    game_type: str
    started_at: datetime | None
    completed_at: datetime | None
    outcome: str | None
    final_score: int | None
    duration_ms: int | None
    metadata: dict[str, Any]


@dataclass(frozen=True)
class EventRow:
    event_index: int
    event_type: str
    occurred_at: datetime | None
    data: Any


def find_gaps(indexes: Sequence[int]) -> list[tuple[int, int]]:
    """Missing ``event_index`` ranges as inclusive ``(first, last)``; indexes start at 0."""
    gaps: list[tuple[int, int]] = []
    expected = 0
    for idx in sorted(set(indexes)):
        if idx > expected:
            gaps.append((expected, idx - 1))
        expected = idx + 1
    return gaps


def _when(value: datetime | None) -> str:
    return value.isoformat() if value is not None else "-"


def _payload(data: Any, max_chars: int) -> str:
    text_ = json.dumps(data, sort_keys=True, separators=(",", ":"), default=str)
    if max_chars > 0 and len(text_) > max_chars:
        return f"{text_[:max_chars]}... (+{len(text_) - max_chars} chars)"
    return text_


def _gap_line(first: int, last: int) -> str:
    n = last - first + 1
    span = f"{first}" if n == 1 else f"{first}-{last}"
    return f"  GAP     event_index {span} missing ({n} event{'s' if n != 1 else ''})"


def render(game: GameRow, events: Sequence[EventRow], max_chars: int = DEFAULT_MAX_CHARS) -> str:
    """The whole report as plain text."""
    lines = [
        f"game        {game.id}",
        f"type        {game.game_type}",
        f"started     {_when(game.started_at)}",
        f"completed   {_when(game.completed_at)}",
        f"outcome     {game.outcome if game.outcome is not None else '-'}",
        f"final_score {game.final_score if game.final_score is not None else '-'}",
        f"duration_ms {game.duration_ms if game.duration_ms is not None else '-'}",
        f"metadata    {_payload(game.metadata, max_chars)}",
        "",
        f"events ({len(events)}), in event_index order:",
    ]
    ordered = sorted(events, key=lambda e: e.event_index)
    gaps = find_gaps([e.event_index for e in ordered])
    gap_after = {first - 1: (first, last) for first, last in gaps}
    if 0 in {first for first, _ in gaps}:
        first, last = next(g for g in gaps if g[0] == 0)
        lines.append(_gap_line(first, last))
    for e in ordered:
        kind = "lifecycle" if e.event_type in LIFECYCLE_EVENTS else "replay"
        lines.append(
            f"  {e.event_index:>5}  {_when(e.occurred_at)}  {kind:<9}  {e.event_type}  "
            f"{_payload(e.data, max_chars)}"
        )
        if e.event_index in gap_after:
            lines.append(_gap_line(*gap_after[e.event_index]))

    if game.game_type == "blackjack":
        rounds = render_rounds((e.event_type, e.data) for e in ordered if isinstance(e.data, dict))
        if rounds:
            lines += ["", "blackjack rounds, rebuilt from the events:", *rounds]

    names = {e.event_type for e in ordered}
    lifecycle = sum(1 for e in ordered if e.event_type in LIFECYCLE_EVENTS)
    missing = sum(last - first + 1 for first, last in gaps)
    lines += [
        "",
        "summary",
        f"  events     {len(ordered)} ({lifecycle} lifecycle, {len(ordered) - lifecycle} replay)",
        f"  gaps       {len(gaps)} ({missing} events missing)" if gaps else "  gaps       none",
        f"  game_started {'present' if 'game_started' in names else 'MISSING'}",
        f"  game_ended   {'present' if 'game_ended' in names else 'absent'}",
    ]
    lines.extend(_rebuilt_state(game, ordered))
    return "\n".join(lines) + "\n"


def _rebuilt_state(game: GameRow, events: Sequence[EventRow]) -> list[str]:
    """The game's state rebuilt from its events, for a game that records enough to (Yacht: #3282)."""
    if game.game_type != "yacht":
        return []
    from yacht.replay import rebuild as rebuild_yacht
    from yacht.replay import render_scorecards

    rebuilt = rebuild_yacht((e.event_type, e.data) for e in events)
    return ["", *render_scorecards(rebuilt, game.final_score)]


async def fetch(db: AsyncSession, game_id: uuid.UUID) -> tuple[GameRow, list[EventRow]] | None:
    """The game and its events, or ``None``. SELECTs only."""
    row = (
        await db.execute(
            select(Game, GameType.name)
            .join(GameType, GameType.id == Game.game_type_id)
            .where(Game.id == game_id)
        )
    ).first()
    if row is None:
        return None
    g, type_name = row
    game = GameRow(
        id=g.id,
        game_type=type_name,
        started_at=g.started_at,
        completed_at=g.completed_at,
        outcome=g.outcome,
        final_score=g.final_score,
        duration_ms=g.duration_ms,
        metadata=g.game_metadata,
    )
    rows = (
        await db.execute(
            select(GameEvent.event_index, EventType.name, GameEvent.occurred_at, GameEvent.data)
            .join(EventType, EventType.id == GameEvent.event_type_id)
            .where(GameEvent.game_id == game_id)
            .order_by(GameEvent.event_index)
        )
    ).all()
    return game, [EventRow(*r) for r in rows]


async def run(game_id: uuid.UUID, max_chars: int) -> tuple[int, str]:
    """Look the game up; returns ``(exit_code, text)``."""
    from db.base import get_engine, get_session_factory, is_configured

    if not is_configured():
        return 2, "DATABASE_URL is not set.\n"
    try:
        async with get_session_factory()() as db:
            if db.get_bind().dialect.name == "postgresql":
                await db.execute(text("SET TRANSACTION READ ONLY"))
            found = await fetch(db, game_id)
            await db.rollback()
    finally:
        await get_engine().dispose()
    if found is None:
        return 1, f"No game {game_id}.\n"
    return 0, render(*found, max_chars=max_chars)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Print a game's metadata and recorded events.")
    parser.add_argument("game_id", help="the game's UUID (Sentry tag game.id)")
    parser.add_argument(
        "--max-chars",
        type=int,
        default=DEFAULT_MAX_CHARS,
        help=f"truncate each payload to this many characters (0 = full; default {DEFAULT_MAX_CHARS})",
    )
    args = parser.parse_args(argv)
    try:
        game_id = uuid.UUID(args.game_id)
    except ValueError:
        print(f"Not a valid game id: {args.game_id!r}", file=sys.stderr)
        return 2
    load_dotenv()
    code, out = asyncio.run(run(game_id, args.max_chars))
    print(out, end="", file=sys.stderr if code else sys.stdout)
    return code


if __name__ == "__main__":
    sys.exit(main())
