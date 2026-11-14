"""Rebuild a Bottle Sort level from its recorded events (#3388, epic #3383).

Offline and read-only: it takes the ``(event_type, data)`` pairs of one game, in
``event_index`` order, and returns the steps the player took, the board they
ended on and a verdict. ``scripts/replay_game.py <game_id>`` prints it. The wire
form is ``sort/replay.py`` and the app's ``frontend/src/game/sort/replay.ts``;
the pour rules are those of ``frontend/src/game/sort/engine.ts``, checked
against the independent simulator in ``scripts/sort_verify_levels.py`` by
``tests/test_sort_rebuild.py``.

The opening board is never in the events: ``game_started`` carries
``{level, catalog, engine_version}`` and the board is that level of the shipped
catalog file (``frontend/src/game/sort/levels.catalog.json``). There is no
fallback board. A different ``catalog`` version, a level outside the file or an
``engine_version`` this reader does not rebuild (``ENGINES``, the shared
``games/engine_version.py``; a ``game_started`` without the field is version 1)
is reported as incompatible, and nothing is rebuilt. (A catalog bump keeps the
old catalog file, so a later version of this reader can load the file by
version; today only the current file exists.)

Verdict:

- ``complete``: every unit arrived in order, every action applied, and the
  rebuilt moves, undos and win agree with ``game_ended``.
- ``incomplete``: what was read is a clean prefix of the level, but the log
  stops short of its result: no ``game_ended``, a unit or part that never
  arrived (a dropped batch or the recording cap), or a board that has not yet
  reached ``game_ended``'s moves, undos or win. The steps shown are right as far
  as they go.
- ``invalid``: the log cannot be an honest recording: an illegal pour, an undo
  or rewind past the start, a malformed action or envelope, a repeated or
  restarted unit, parts out of line, a result that contradicts the rebuilt board
  (more moves or undos than ``game_ended`` says, a win it does not), or an
  incompatible catalog or engine.

Reading stops at the first problem: a step after a gap or an illegal action
would be guesswork.
"""

from __future__ import annotations

import json
from collections.abc import Iterable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from games.engine_version import ReplayEngines, replay_engines
from games.replay_caps import SORT_MAX_UNITS

CATALOG_PATH = Path(__file__).resolve().parents[2] / "frontend/src/game/sort/levels.catalog.json"

BOTTLE_DEPTH = 4
"""Units a bottle holds (``BOTTLE_DEPTH`` in engine types.ts); a test holds it equal to the app's and the solver's."""
MOVES_VERSION = 1
MAX_BOTTLES = 16
MAX_REWIND = 1000

POUR, UNDO, HINT, REWIND = 0, 1, 2, 3

COMPLETE = "complete"
INCOMPLETE = "incomplete"
INVALID = "invalid"

Board = list[list[str]]


@dataclass(frozen=True)
class Flag:
    """One problem found. ``effect`` is the verdict it forces (``invalid`` or ``incomplete``)."""

    kind: str
    effect: str
    message: str


@dataclass(frozen=True)
class Step:
    """One action, with the state after it."""

    n: int  # 1-based position among the actions
    unit: int
    kind: str  # pour | undo | hint | rewind
    src: int | None = None
    dst: int | None = None
    color: str | None = None
    units: int = 0  # pour: units moved; rewind: moves rewound
    moves: int = 0
    undos: int = 0
    solved: bool = False


@dataclass
class Rebuilt:
    level: int | None = None
    catalog: int | None = None
    opening: Board | None = None
    bottles: Board = field(default_factory=list)
    moves: int = 0
    undos: int = 0
    solved: bool = False
    steps: list[Step] = field(default_factory=list)
    flags: list[Flag] = field(default_factory=list)
    ended: dict[str, Any] | None = None
    verdict: str = INCOMPLETE
    reason: str = ""


def load_catalog(path: Path = CATALOG_PATH) -> dict[str, Any] | None:
    """The shipped catalog file, or ``None`` when it is not there or not JSON."""
    try:
        data = json.loads(path.read_text())
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def decode_level(encoded: str, legend: list[str]) -> Board:
    """A catalog level's bottles, bottom first, as colour names (``decodeBottles`` in catalog.ts)."""
    board: Board = []
    for bottle in encoded.split(","):
        units = []
        for letter in bottle:
            i = ord(letter) - 65
            if not 0 <= i < len(legend):
                raise ValueError(f"unknown colour {_v(letter)}")
            units.append(legend[i])
        board.append(units)
    return board


# -- the engine's rules (engine.ts), kept independent of the solver ------------


def is_valid_pour(src: list[str], dst: list[str]) -> bool:
    """``isValidPour``: something to pour, room to take it, and the same top colour (or empty)."""
    return bool(src) and len(dst) < BOTTLE_DEPTH and (not dst or dst[-1] == src[-1])


def apply_pour(board: Board, frm: int, to: int) -> tuple[Board, str, int]:
    """``applyPour``: the maximal same-colour top run, up to the room in ``to``.

    Returns the new board, the colour and the units moved."""
    new = [list(b) for b in board]
    src, dst = new[frm], new[to]
    color = src[-1]
    run = 0
    for c in reversed(src):
        if c != color:
            break
        run += 1
    n = min(run, BOTTLE_DEPTH - len(dst))
    for _ in range(n):
        dst.append(src.pop())
    return new, color, n


def is_solved(board: Board) -> bool:
    """``isComplete``: every bottle empty, or full of one colour."""
    return all(not b or (len(b) == BOTTLE_DEPTH and len(set(b)) == 1) for b in board)


# -- reading -------------------------------------------------------------------


def _v(x: Any) -> str:
    """A client-supplied value, safe to print: ASCII JSON, truncated."""
    text = json.dumps(x, ensure_ascii=True, default=str)
    return text if len(text) <= 40 else text[:40] + "..."


def _is_int(x: Any) -> bool:
    return type(x) is int  # not bool


def _action_problem(a: Any) -> str | None:
    """Why ``a`` is not a well-formed action (``isAction``), or ``None``."""
    if not isinstance(a, list) or not a or not all(_is_int(x) for x in a):
        return "not a list of integers"
    kind = a[0]
    if kind in (POUR, HINT):
        if len(a) != 3:
            return "a pour or hint is [kind, from, to]"
        if not all(0 <= x < MAX_BOTTLES for x in a[1:]):
            return "bottle index out of range"
        if a[1] == a[2]:
            return "from and to are the same bottle"
    elif kind == UNDO:
        if len(a) != 1:
            return "an undo is [1]"
    elif kind == REWIND:
        if len(a) != 2 or not 1 <= a[1] <= MAX_REWIND:
            return "a rewind is [3, n] with 1 <= n <= 1000"
    else:
        return "unknown action kind"
    return None


class _Reader:
    """Applies actions one by one to the board, recording a step for each."""

    def __init__(self, out: Rebuilt, board: Board) -> None:
        self.out = out
        self.board = board
        self.history: list[tuple[Board, int]] = []  # board and move count before each pour
        self.n = 0
        self.stopped = False

    def flag(self, kind: str, effect: str, message: str) -> None:
        self.out.flags.append(Flag(kind, effect, message))
        self.stopped = True

    def _fail(self, kind: str, unit: int, message: str) -> None:
        self.flag(kind, INVALID, f"action #{self.n} (unit {unit}): {message}")

    def apply(self, action: list[int], unit: int) -> None:
        self.n += 1
        out = self.out
        problem = _action_problem(action)
        if problem:
            self._fail("malformed_action", unit, problem)
            return
        kind, board, size = action[0], self.board, len(self.board)
        if kind in (POUR, HINT) and (action[1] >= size or action[2] >= size):
            self._fail("malformed_action", unit, f"bottle index off the board ({size} bottles)")
            return
        step: dict[str, Any] = {"n": self.n, "unit": unit}
        if kind == POUR:
            frm, to = action[1], action[2]
            if not is_valid_pour(board[frm], board[to]):
                self._fail("illegal_pour", unit, f"illegal pour {frm}->{to}")
                return
            self.history.append((board, out.moves))
            self.board, color, units = apply_pour(board, frm, to)
            out.moves += 1
            step.update(kind="pour", src=frm, dst=to, color=color, units=units)
        elif kind == UNDO:
            if not self.history:
                self._fail("undo_past_start", unit, "undo with nothing to undo")
                return
            self.board, out.moves = self.history.pop()
            out.undos += 1
            step.update(kind="undo")
        elif kind == HINT:
            src = board[action[1]]
            step.update(kind="hint", src=action[1], dst=action[2], color=src[-1] if src else None)
        else:
            count = action[1]
            if count > len(self.history):
                self._fail(
                    "undo_past_start",
                    unit,
                    f"rewind of {count} past the start ({len(self.history)} moves to undo)",
                )
                return
            for _ in range(count):
                self.board, out.moves = self.history.pop()
            out.undos += count
            step.update(kind="rewind", units=count)
        out.bottles = self.board
        out.solved = is_solved(self.board)
        out.steps.append(Step(moves=out.moves, undos=out.undos, solved=out.solved, **step))


ENGINES: ReplayEngines[type[_Reader]] = replay_engines("sort", _Reader)
"""The engine versions this reader rebuilds (today's is ``SORT_REPLAY_ENGINE_VERSION`` in
replay.ts), each with its pour and undo rules: the reader class."""


def _incompatible(out: Rebuilt, kind: str, message: str) -> None:
    out.flags.append(Flag(kind, INVALID, message))


def _opening(
    out: Rebuilt, started: dict[str, Any], catalog: dict[str, Any] | None, reason: str | None
) -> Board | None:
    """The opening board, or ``None`` after flagging why there is none.

    ``reason`` is set when the game's ``engine_version`` is not one ``ENGINES`` rebuilds."""
    level = started.get("level")
    version = started.get("catalog")
    out.level = level if _is_int(level) else None
    out.catalog = version if _is_int(version) else None
    if reason is not None:
        _incompatible(out, "incompatible_engine", reason)
        return None
    if catalog is None or not _is_int(version) or version != catalog.get("version"):
        have = catalog.get("version") if catalog else "no catalog file"
        _incompatible(
            out,
            "incompatible_catalog",
            f"incompatible catalog: the game used catalog {_v(version)}, this reader has {have}",
        )
        return None
    levels = catalog.get("levels")
    if not _is_int(level) or not isinstance(levels, list) or not 1 <= level <= len(levels):
        _incompatible(
            out,
            "incompatible_catalog",
            f"incompatible catalog: level {_v(level)} is not in catalog {version}",
        )
        return None
    try:
        return decode_level(levels[level - 1][0], catalog["legend"])
    except (ValueError, TypeError, KeyError, IndexError, AttributeError) as e:
        _incompatible(
            out, "incompatible_catalog", f"incompatible catalog: level {level} unreadable ({e})"
        )
        return None


class _Units:
    """Checks the unit and part numbering of the ``moves`` events, in order."""

    def __init__(self) -> None:
        self.expected = 1
        self.split: tuple[int, int, int] | None = None  # unit, parts, next part

    def missing_part(self) -> str | None:
        if self.split is None:
            return None
        unit, total, nxt = self.split
        return f"unit {unit}: part {nxt} of {total} is missing"

    def check(self, unit: int, part: int | None, parts: int | None) -> Flag | None:
        """The problem with this event's numbering, or ``None`` (and the state moves on)."""
        if self.split is not None:
            return self._next_part(unit, part, parts)
        if unit > self.expected:
            span = (
                f"{self.expected}" if unit - 1 == self.expected else f"{self.expected}-{unit - 1}"
            )
            return Flag(
                "gap", INCOMPLETE, f"unit {span} missing (a dropped batch or the recording cap)"
            )
        if unit == self.expected - 1:
            return Flag("duplicate_unit", INVALID, f"unit {unit} appears twice in a row")
        if unit < self.expected:
            msg = f"unit numbers restart at {unit} after reaching {self.expected - 1}"
            return Flag("restarted_unit", INVALID, msg)
        if part is None or parts is None:
            self.expected = unit + 1
        elif part != 0:
            return Flag("gap", INCOMPLETE, f"unit {unit}: the parts before {part} are missing")
        else:
            self.split = (unit, parts, 1)
        return None

    def _next_part(self, unit: int, part: int | None, parts: int | None) -> Flag | None:
        assert self.split is not None
        want_unit, total, nxt = self.split
        if part is None or unit != want_unit:
            return Flag("gap", INCOMPLETE, self.missing_part() or "")
        if parts == total and part > nxt:
            # a later part of the same unit: the ones between were dropped (a clean prefix)
            return Flag("gap", INCOMPLETE, f"unit {unit}: part {nxt} of {total} is missing")
        if part != nxt or parts != total:
            msg = f"unit {unit}: expected part {nxt} of {total}, got {part} of {parts}"
            return Flag("bad_parts", INVALID, msg)
        self.split = (unit, total, nxt + 1) if nxt + 1 < total else None
        if self.split is None:
            self.expected = unit + 1
        return None


def _envelope_problem(data: dict[str, Any]) -> str | None:
    unit, part, parts = data.get("unit"), data.get("part"), data.get("parts")
    if (
        not _is_int(data.get("v"))
        or data.get("v") != MOVES_VERSION
        or not _is_int(unit)
        or unit < 1
    ):
        return "a moves event has a bad envelope (v or unit)"
    if not isinstance(data.get("m"), list):
        return f"unit {unit}: m is not a list"
    if (part is None) != (parts is None):
        return f"unit {unit}: part and parts come together"
    if part is not None and not (
        _is_int(part) and _is_int(parts) and parts >= 2 and 0 <= part < parts
    ):
        return f"unit {unit}: part {_v(part)} of {_v(parts)} makes no sense"
    return None


def _units(r: _Reader, events: list[dict[str, Any]]) -> int:
    """Feed the ``moves`` events to the reader, checking unit and part numbering.

    Returns the last whole unit read (0 when none)."""
    units = _Units()
    for data in events:
        bad = _envelope_problem(data)
        if bad:
            r.flag("malformed_action", INVALID, bad)
            return units.expected - 1
        problem = units.check(data["unit"], data.get("part"), data.get("parts"))
        if problem:
            r.flag(problem.kind, problem.effect, problem.message)
            return units.expected - 1
        for action in data["m"]:
            r.apply(action, data["unit"])
            if r.stopped:
                return units.expected - 1
    gone = units.missing_part()
    if gone:
        r.flag("gap", INCOMPLETE, gone)
    return units.expected - 1


def _check_tail(out: Rebuilt, ended: dict[str, Any], last_unit: int) -> None:
    """A lost last unit of hints only changes no count, so the counts alone cannot see it:
    ``game_ended``'s recorder summary (``replay.u``, the last unit the recorder handed
    over, from ``GameRecorder.stats()``) can, when the app sent it."""
    if last_unit >= SORT_MAX_UNITS:
        # the app records at most SORT_MAX_UNITS units a level and then stops without a
        # marker: what came after (hints, say, that change no count) cannot be ruled out
        out.flags.append(
            Flag(
                "truncated",
                INCOMPLETE,
                f"the log reached the recording cap ({SORT_MAX_UNITS} units): later actions may be missing",
            )
        )
        return
    summary = ended.get("replay")
    u = summary.get("u") if isinstance(summary, dict) else None
    if _is_int(u) and u > last_unit:
        span = f"{last_unit + 1}" if u == last_unit + 1 else f"{last_unit + 1}-{u}"
        out.flags.append(
            Flag("truncated", INCOMPLETE, f"unit {span} never arrived (game_ended counts {u})")
        )


def _check_result(out: Rebuilt, ended: dict[str, Any]) -> None:
    """Compare the rebuilt level with ``game_ended``'s result."""
    flags = out.flags
    if _is_int(ended.get("level")) and out.level is not None and ended["level"] != out.level:
        flags.append(
            Flag(
                "mismatch",
                INVALID,
                f"game_ended is for level {ended['level']}, the log is level {out.level}",
            )
        )
    want_moves, want_undos = ended.get("moves"), ended.get("undos")
    won, outcome = ended.get("won"), ended.get("outcome")
    if not _is_int(want_moves) and not isinstance(won, bool):
        flags.append(Flag("truncated", INCOMPLETE, "game_ended has no result to check against"))
    # undos only ever grow, moves do not (an undo takes one back): fewer undos than the
    # result says means the log is a prefix, whatever its move count
    prefix = False
    if _is_int(want_undos):
        if out.undos > want_undos:
            flags.append(
                Flag(
                    "mismatch", INVALID, f"log has {out.undos} undos, game_ended says {want_undos}"
                )
            )
        elif out.undos < want_undos:
            prefix = True
            flags.append(
                Flag(
                    "truncated",
                    INCOMPLETE,
                    f"log reaches {out.undos} of {want_undos} undos (cut off, or past the cap)",
                )
            )
    if _is_int(want_moves) and out.moves != want_moves:
        # without an undo count (an abandon sends none) a lost tail of undos can leave the
        # log above the final move count, so only a log with every undo accounted for is
        # proven wrong by having more moves
        if out.moves < want_moves or prefix or not _is_int(want_undos):
            prefix = True
            flags.append(
                Flag(
                    "truncated",
                    INCOMPLETE,
                    f"log reaches {out.moves} moves, game_ended says {want_moves} "
                    "(cut off, or past the cap)",
                )
            )
        else:
            flags.append(
                Flag(
                    "mismatch", INVALID, f"log has {out.moves} moves, game_ended says {want_moves}"
                )
            )
    claims_win = won is True or (won is None and outcome == "completed")
    if claims_win and not out.solved:
        if prefix:
            flags.append(Flag("truncated", INCOMPLETE, "log stops before the winning move"))
        else:
            flags.append(
                Flag("mismatch", INVALID, "game_ended says won, the rebuilt board is not solved")
            )
    elif won is False and out.solved:
        flags.append(
            Flag("mismatch", INVALID, "game_ended says not won, the rebuilt board is solved")
        )


def rebuild(
    events: Iterable[tuple[str, Any]],
    catalog: dict[str, Any] | None = None,
    engines: ReplayEngines[type[_Reader]] | None = None,
) -> Rebuilt:
    """Rebuild one Sort game from its ``(event_type, data)`` pairs, in ``event_index`` order.

    ``catalog`` is the parsed catalog file; omitted, the shipped file is read.
    ``engines`` is the versions this reader rebuilds (``ENGINES`` when omitted).
    """
    out = Rebuilt()
    started: dict[str, Any] | None = None
    moves: list[dict[str, Any]] = []
    for name, data in events:
        if not isinstance(data, dict):
            continue
        if name == "game_started" and started is None:
            started = data
        elif name == "moves":
            moves.append(data)
        elif name == "game_ended" and out.ended is None:
            out.ended = data
    if started is None:
        out.flags.append(
            Flag("no_start", INVALID, "no game_started event: the opening board is unknown")
        )
    else:
        engine = (engines or ENGINES).resolve(started)
        opening = _opening(
            out, started, catalog if catalog is not None else load_catalog(), engine.reason
        )
        if opening is not None and engine.rules is not None:
            out.opening = out.bottles = opening
            out.solved = is_solved(opening)
            reader = engine.rules(out, opening)
            last_unit = _units(reader, moves)
            if not reader.stopped:
                if out.ended is None:
                    out.flags.append(
                        Flag("truncated", INCOMPLETE, "no game_ended: the log may be cut short")
                    )
                else:
                    _check_tail(out, out.ended, last_unit)
                    _check_result(out, out.ended)
    _verdict(out)
    return out


def _verdict(out: Rebuilt) -> None:
    bad = [f for f in out.flags if f.effect == INVALID]
    cut = [f for f in out.flags if f.effect == INCOMPLETE]
    if bad:
        out.verdict, out.reason = INVALID, bad[0].message
    elif cut:
        out.verdict, out.reason = INCOMPLETE, cut[0].message
    else:
        out.verdict, out.reason = (
            COMPLETE,
            "every unit read in order and the result matches game_ended",
        )


def _step_line(s: Step) -> str:
    head = f"#{s.n}"
    if s.kind == "pour":
        tail = "  SOLVED" if s.solved else ""
        return f"  {head} pour {s.src}→{s.dst}  {s.color} ×{s.units}  moves {s.moves} undos {s.undos}{tail}"
    if s.kind == "undo":
        return f"  {head} undo  moves {s.moves} undos {s.undos}"
    if s.kind == "hint":
        what = f"  ({s.color})" if s.color else ""
        return f"  {head} hint {s.src}→{s.dst}{what}"
    return f"  {head} back to last good move ×{s.units}  moves {s.moves} undos {s.undos}"


def _board_line(i: int, bottle: list[str]) -> str:
    return f"    {i:>2}  " + (" ".join(bottle) if bottle else "(empty)")


def render(out: Rebuilt) -> list[str]:
    """The rebuilt level as plain text lines."""
    level = out.level if out.level is not None else "?"
    catalog = out.catalog if out.catalog is not None else "?"
    lines = [f"sort level {level} (catalog {catalog}), rebuilt from the events:"]
    if out.opening is not None:
        lines.append("  opening board (bottle, bottom first):")
        lines += [_board_line(i, b) for i, b in enumerate(out.opening)]
        lines.append("  steps (bottles are numbered from 0):")
        lines += [_step_line(s) for s in out.steps] or ["  (no actions)"]
        lines.append("  final board:")
        lines += [_board_line(i, b) for i, b in enumerate(out.bottles)]
        lines.append(
            f"  solved  {'yes' if out.solved else 'no'}   moves {out.moves}   undos {out.undos}"
        )
    lines += [f"  FLAG    {f.kind}: {f.message}" for f in out.flags]
    lines.append(f"  verdict {out.verdict}: {out.reason}")
    return lines
