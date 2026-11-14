"""Which rules replay a recorded game: its ``engine_version`` (#3912, epic #3273).

Every game that records its play puts an integer ``engine_version`` in its
``game_started`` data (#3909): the version of the rules that produced it. A
reader (a rebuilder in ``<game>/replay.py`` / ``sort/rebuild.py``, and
``scripts/replay_game.py``) asks its game's ``ReplayEngines`` which rules to
replay a game with, and gets one of three answers:

- ``current``: the version the app records today; replayed with today's rules.
- ``legacy``: an older version still supported; replayed with that version's
  frozen rules, registered next to the current ones (``with_legacy``).
- ``incompatible``: any other value (unknown, sunset, not an integer). The
  reader rebuilds nothing and says so with ``reason``
  (``"incompatible engine: engine_version X, this reader rebuilds Y"``), never a
  plausible but wrong board.

A ``game_started`` without the field, or a log without a ``game_started``, is
version 1 (``MISSING_ENGINE_VERSION``): builds from before the field recorded
version-1 rules. A field that is present but null is not "missing": it is
incompatible.

Policy (#3908): when a rule change bumps a game's version, its old-rules path
stays registered (with its frozen fixture) for at least ``REPLAY_RETENTION_DAYS``
(30 by default, ``settings.py``; docs/DATA-INVENTORY.md §2a) after the new version is the only one in
production; after that it may be removed, and its version then reads as
incompatible. The app's twin is ``frontend/src/game/_shared/replayEngine.ts``;
``tests/test_engine_version.py`` holds ``CURRENT_ENGINE_VERSIONS`` equal to the
app's constants. Reading only: nothing here changes what is recorded.
"""

from __future__ import annotations

import json
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from typing import Any, Generic, Literal, TypeVar

R = TypeVar("R")

MISSING_ENGINE_VERSION = 1
"""The version of a ``game_started`` without ``engine_version`` (a build from before #3909)."""

CURRENT = "current"
LEGACY = "legacy"
INCOMPATIBLE = "incompatible"

Kind = Literal["current", "legacy", "incompatible"]

CURRENT_ENGINE_VERSIONS: dict[str, int] = {
    "blackjack": 1,
    "daily_word": 1,
    "freecell": 1,
    "hearts": 1,
    "mahjong": 1,
    "solitaire": 1,
    "sort": 1,
    "sudoku": 1,
    "twenty48": 1,
    "yacht": 1,
}
"""Game type -> the ``engine_version`` the app records today (``ENGINE_VERSION`` in the
game's ``engine.ts``; Sort's ``SORT_REPLAY_ENGINE_VERSION`` in ``replay.ts``)."""


def printable(value: Any) -> str:
    """A client-supplied value, safe to print: ASCII JSON, truncated."""
    text = json.dumps(value, ensure_ascii=True, default=str)
    return text if len(text) <= 40 else text[:40] + "..."


def _is_version(value: Any) -> bool:
    return type(value) is int and value >= 0  # not bool


def engine_version_of(started: Mapping[str, Any] | None) -> Any:
    """The recorded ``engine_version`` as sent; ``MISSING_ENGINE_VERSION`` when there is none."""
    if not isinstance(started, Mapping):
        return MISSING_ENGINE_VERSION
    return started.get("engine_version", MISSING_ENGINE_VERSION)


def incompatible_reason(version: Any, supported: Iterable[int]) -> str:
    """The one wording every reader uses for a version it does not rebuild."""
    have = ", ".join(str(v) for v in sorted(supported))
    return f"incompatible engine: engine_version {printable(version)}, this reader rebuilds {have}"


def first_game_started(events: Iterable[tuple[str, Any]]) -> Mapping[str, Any] | None:
    """The data of the first ``game_started`` among ``(event_type, data)`` pairs, if any."""
    for name, data in events:
        if name == "game_started" and isinstance(data, Mapping):
            return data
    return None


@dataclass(frozen=True)
class EngineResolution(Generic[R]):
    """Which rules replay a game. ``rules`` is set unless ``kind`` is ``incompatible``."""

    kind: Kind
    version: Any
    rules: R | None = None
    reason: str | None = None

    @property
    def ok(self) -> bool:
        return self.kind != INCOMPATIBLE

    def describe(self) -> str:
        """One line for a report."""
        if self.kind == CURRENT:
            return f"engine_version {self.version} (current)"
        if self.kind == LEGACY:
            return f"engine_version {self.version} (older, replayed with its frozen rules)"
        return f"INCOMPATIBLE: {self.reason}; nothing rebuilt"


@dataclass(frozen=True)
class ReplayEngines(Generic[R]):
    """One game's replayable versions: ``current`` and any older ones still supported."""

    game: str
    current: int
    rules: Mapping[int, R] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not _is_version(self.current) or self.current not in self.rules:
            raise ValueError(f"{self.game}: no rules for the current engine_version")
        if not all(_is_version(v) for v in self.rules):
            raise ValueError(f"{self.game}: engine versions are non-negative integers")

    @property
    def supported(self) -> tuple[int, ...]:
        return tuple(sorted(self.rules))

    def with_legacy(self, version: int, rules: R) -> ReplayEngines[R]:
        """A copy that also replays ``version`` (an older one) with ``rules``."""
        if not _is_version(version) or version == self.current:
            raise ValueError(f"{self.game}: {version!r} cannot be a legacy engine_version")
        return ReplayEngines(self.game, self.current, {**self.rules, version: rules})

    def resolve(self, started: Mapping[str, Any] | None) -> EngineResolution[R]:
        """Which rules replay a game whose ``game_started`` data is ``started`` (``None``: no event)."""
        version = engine_version_of(started)
        if _is_version(version) and version in self.rules:
            kind: Kind = CURRENT if version == self.current else LEGACY
            return EngineResolution(kind, version, self.rules[version])
        return EngineResolution(
            INCOMPATIBLE, version, reason=incompatible_reason(version, self.supported)
        )

    def resolve_events(self, events: Iterable[tuple[str, Any]]) -> EngineResolution[R]:
        """``resolve`` on the first ``game_started`` among ``(event_type, data)`` pairs."""
        return self.resolve(first_game_started(events))


def replay_engines(game: str, rules: R) -> ReplayEngines[R]:
    """``game``'s engines: today's version (``CURRENT_ENGINE_VERSIONS``) replayed with ``rules``."""
    current = CURRENT_ENGINE_VERSIONS[game]
    return ReplayEngines(game, current, {current: rules})
