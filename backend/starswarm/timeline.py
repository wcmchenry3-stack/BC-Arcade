"""Star Swarm ``wave_timeline`` event: strict validation (#3394, epic #3390).

One ``wave_timeline`` per kept wave close: the wave's major transitions as
arrays of small non-negative ints ``[t, code, ...params]``, ``t`` being
deciseconds of gameplay time into the wave. The contract (code table, capacity
rules, drop and flag rules) is ``docs/games/starswarm-diagnostics.md``; the
shared fixture ``tests/fixtures/starswarm_wave_timeline_v1.json`` pins the code
table, limits and index lists on both sides.

``validate_wave_timeline`` follows ``models.validate_wave_completed``: it
returns the dict to store, or ``None`` to drop that one event (the batch still
succeeds, so a bad diagnostic never blocks a session or its ``wave_completed``
rows). A drop is logged per event and reported to Sentry at most once an hour
per reason, with field paths and reasons only, never values.
"""

from __future__ import annotations

import json
import logging
from typing import Any, NamedTuple

from games.replay_caps import CAP_REPORT_WINDOW_S
from observability.report import Throttle, report_event
from starswarm import models

logger = logging.getLogger(__name__)

WAVE_TIMELINE = "wave_timeline"
WAVE_TIMELINE_VERSION = 1
MAX_WAVE_TIMELINE_BYTES = 1024

TIMELINE_MAX_ENTRIES = 32
TIMELINE_ORDINARY_SLOTS = 30
TIMELINE_POWERUP_MAX = 8
TIMELINE_TRANSITION_MAX = 8
MAX_TIME = 65535
MAX_X = 63
MAX_ENGINE_VERSION = 65535
MAX_WAVE = 65535
UNKNOWN_CODE_MAX_LEN = 6  # [t, code] plus at most 4 params
UNKNOWN_CODE_MIN_LEN = 2

TIMELINE_PHASES: tuple[str, ...] = ("SwoopIn", "Playing", "ClearAwaitingPickups", "Extraction")

CLASS_DAMAGE = "D"
CLASS_TERMINAL = "T"
CLASS_TRANSITION = "C"
CLASS_POWERUP = "P"

CODE_HULL_HIT = 1
CODE_LIFE_LOST = 2
CODE_WAVE_CLEARED = 8
CODE_RUN_LOST = 9

FLAG_UNKNOWN_CODE = "unknown_code"
FLAG_QUOTA = "quota"
FLAG_DUPLICATE = "duplicate_entry"
_FLAG_ORDER = (FLAG_UNKNOWN_CODE, FLAG_QUOTA, FLAG_DUPLICATE)

_OUTCOMES = ("cleared", "died")
_TERMINAL_FOR_OUTCOME = {"cleared": CODE_WAVE_CLEARED, "died": CODE_RUN_LOST}

REASON_OVERSIZE = "oversize"
REASON_INVALID = "invalid"


class Param(NamedTuple):
    name: str
    lo: int
    hi: int


class Code(NamedTuple):
    name: str
    cls: str
    params: tuple[Param, ...]

    @property
    def arity(self) -> int:
        return 2 + len(self.params)


def _idx(name: str, registry: tuple[str, ...], hi: int | None = None) -> Param:
    return Param(name, 0, len(registry) - 1 if hi is None else hi)


_CAUSE = _idx("cause", models.HIT_CAUSES)
_X = Param("x", 0, MAX_X)

CODES: dict[int, Code] = {
    1: Code("HULL_HIT", CLASS_DAMAGE, (_CAUSE, _X, Param("hullAfter", 0, 1))),
    2: Code("LIFE_LOST", CLASS_DAMAGE, (_CAUSE, _X, Param("livesAfter", 0, 255))),
    3: Code("BONUS_LIFE", CLASS_DAMAGE, (Param("awarded", 1, 255), Param("livesAfter", 1, 255))),
    4: Code("PLATING_UP", CLASS_DAMAGE, (Param("hullAfter", 1, 2),)),
    8: Code("WAVE_CLEARED", CLASS_TERMINAL, ()),
    9: Code("RUN_LOST", CLASS_TERMINAL, (_CAUSE,)),
    10: Code("PHASE", CLASS_TRANSITION, (Param("phase", 1, len(TIMELINE_PHASES) - 1),)),
    11: Code("CARRIER_STAGE", CLASS_TRANSITION, (Param("stage", 1, 2),)),
    12: Code("CARRIER_DOWN", CLASS_TRANSITION, (_idx("method", models.KILL_METHODS),)),
    13: Code("ROUT", CLASS_TRANSITION, ()),
    # lightning, shield, buddy, bomb (salvage is not recorded; hull is PLATING_UP)
    20: Code("PICKUP", CLASS_POWERUP, (_idx("type", models.POWERUP_TYPES, 3),)),
    21: Code("BUFF_END", CLASS_POWERUP, (Param("type", 0, 1),)),
}

_TERMINAL_CODES = frozenset(c for c, spec in CODES.items() if spec.cls == CLASS_TERMINAL)

# Throttled drop reports: one throttle per reason, like ``replay_caps._throttles``.
_throttles: dict[str, Throttle] = {}


def _is_int(value: Any) -> bool:
    """A JSON integer: ``bool`` is an ``int`` subclass and a float is not one."""
    return type(value) is int


def _report_dropped(reason: str, path: str) -> None:
    """Sentry, at most once per reason per window. Reason and path only."""
    throttle = _throttles.setdefault(reason, Throttle(CAP_REPORT_WINDOW_S))
    if not throttle.allow():
        return
    report_event(
        f"starswarm event: wave_timeline {reason}",
        level="warning",
        fingerprint=["starswarm-wave-timeline-dropped", reason],
        tags={"game_type": "starswarm", "reason": reason},
        extras={"fields": path},
    )


def _drop(reason: str, path: str) -> None:
    logger.warning("starswarm: dropped a wave_timeline (%s) at %s", reason, path)
    _report_dropped(reason, path)


def _entry_problem(i: int, entry: Any) -> tuple[str | None, bool]:
    """``(path of the first problem or None, entry has an unknown code)``."""
    if not isinstance(entry, list) or not entry:
        return f"e.{i}", False
    if not all(_is_int(v) for v in entry):
        return f"e.{i}", False
    if len(entry) < UNKNOWN_CODE_MIN_LEN:
        return f"e.{i}", False
    if not 0 <= entry[0] <= MAX_TIME:
        return f"e.{i}.0", False
    spec = CODES.get(entry[1])
    if spec is None:
        # a code this build does not know: kept and flagged, ints in range only
        if len(entry) > UNKNOWN_CODE_MAX_LEN:
            return f"e.{i}", True
        for j, v in enumerate(entry):
            if not 0 <= v <= MAX_TIME:
                return f"e.{i}.{j}", True
        return None, True
    if len(entry) != spec.arity:
        return f"e.{i}", False
    for j, p in enumerate(spec.params, start=2):
        if not p.lo <= entry[j] <= p.hi:
            return f"e.{i}.{j}", False
    return None, False


def _header_problem(data: dict[str, Any]) -> str | None:
    """Path of the first bad top-level field, or ``None``."""
    if not isinstance(data, dict):
        return "<payload>"
    v, ev, wave = data.get("v"), data.get("ev"), data.get("wave")
    if not _is_int(v) or v != WAVE_TIMELINE_VERSION:
        return "v"
    if not _is_int(ev) or not 1 <= ev <= MAX_ENGINE_VERSION:
        return "ev"
    if not _is_int(wave) or not 1 <= wave <= MAX_WAVE:
        return "wave"
    if data.get("outcome") not in _OUTCOMES:
        return "outcome"
    if not isinstance(data.get("dev"), bool):
        return "dev"
    ovf = data.get("ovf")
    if (
        not isinstance(ovf, list)
        or len(ovf) != 3
        or not all(_is_int(n) and 0 <= n <= MAX_TIME for n in ovf)
    ):
        return "ovf"
    entries = data.get("e")
    if not isinstance(entries, list) or not 1 <= len(entries) <= TIMELINE_MAX_ENTRIES:
        return "e"
    return None


def _entries_problem(data: dict[str, Any]) -> tuple[str | None, bool]:
    """``(path of the first bad entry or ordering fault, any unknown code)``."""
    entries = data["e"]
    unknown = False
    for i, entry in enumerate(entries):
        problem, is_unknown = _entry_problem(i, entry)
        unknown = unknown or is_unknown
        if problem:
            return problem, unknown
    for i in range(1, len(entries)):
        if entries[i][0] < entries[i - 1][0]:
            return f"e.{i}.0", unknown
    terminals = [i for i, e in enumerate(entries) if e[1] in _TERMINAL_CODES]
    last = len(entries) - 1
    if terminals != [last] or entries[last][1] != _TERMINAL_FOR_OUTCOME[data["outcome"]]:
        return f"e.{last}", unknown
    return None, unknown


def _quota_exceeded(entries: list[list[int]]) -> bool:
    """More than 8 power-ups or 8 transitions, or 31 ordinary entries with no lethal blow."""
    classes = [CODES[e[1]].cls for e in entries if e[1] in CODES]
    if classes.count(CLASS_POWERUP) > TIMELINE_POWERUP_MAX:
        return True
    if classes.count(CLASS_TRANSITION) > TIMELINE_TRANSITION_MAX:
        return True
    body = entries[:-1]
    if len(body) > TIMELINE_MAX_ENTRIES - 1:
        return True
    lethal = any(e[1] == CODE_LIFE_LOST and e[4] == 0 for e in body if len(e) == 5)
    return len(body) == TIMELINE_MAX_ENTRIES - 1 and not lethal


def validate_wave_timeline(data: dict[str, Any]) -> dict[str, Any] | None:
    """The ``wave_timeline`` ``data`` to store, or ``None`` to drop the event.

    Dropped (logged; Sentry once per reason per hour, paths and reasons only):
    more than ``MAX_WAVE_TIMELINE_BYTES`` of compact JSON (``oversize``), or
    any schema violation (``invalid``): a bad header field, a bool or float
    where an int belongs, a known code with the wrong arity or an out-of-range
    parameter, ``t`` decreasing, more than 32 entries, or not exactly one
    terminal entry, last, matching ``outcome``.

    Kept, with a top-level ``_flags`` list: an unknown code (``unknown_code``),
    a class quota or the ordinary-slot count exceeded (``quota``) and two
    identical consecutive entries (``duplicate_entry``). Unknown top-level keys
    and a client-sent ``_flags`` are not stored.
    """
    try:
        size = len(json.dumps(data, separators=(",", ":")).encode())
    except (TypeError, ValueError):
        size = MAX_WAVE_TIMELINE_BYTES + 1
    if size > MAX_WAVE_TIMELINE_BYTES:
        _drop(REASON_OVERSIZE, "<payload>")
        return None
    path = _header_problem(data)
    unknown = False
    if path is None:
        path, unknown = _entries_problem(data)
    if path is not None:
        _drop(REASON_INVALID, path)
        return None
    entries = data["e"]
    flags = set()
    if unknown:
        flags.add(FLAG_UNKNOWN_CODE)
    if _quota_exceeded(entries):
        flags.add(FLAG_QUOTA)
    if any(entries[i] == entries[i - 1] for i in range(1, len(entries))):
        flags.add(FLAG_DUPLICATE)
    stored: dict[str, Any] = {
        "v": data["v"],
        "ev": data["ev"],
        "wave": data["wave"],
        "outcome": data["outcome"],
        "dev": data["dev"],
        "ovf": list(data["ovf"]),
        "e": [list(e) for e in entries],
    }
    if flags:
        ordered = [f for f in _FLAG_ORDER if f in flags]
        logger.warning("starswarm: wave_timeline is odd: %s", ", ".join(ordered))
        stored["_flags"] = ordered
    return stored


# Public names for the offline reader (starswarm/replay.py).
entry_problem = _entry_problem
header_problem = _header_problem
entries_problem = _entries_problem
