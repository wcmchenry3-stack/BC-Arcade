"""Mahjong ``moves`` event: the replay record of a game (#3285, epic #3273).

The app (``frontend/src/game/mahjong/replay.ts``) records a game through the
shared GameRecorder. ``game_started`` carries the layout and the deal seed
(#3281), so the opening board is dealt again from them; the ``moves`` rows, in
``event_index`` order, rebuild everything after it. A ``moves`` event is one
chunk of up to 25 actions (the recorder's envelope plus ``m``) and one entry of
``m`` is one action:

- ``[a, b]``: a matched pair, the two tile ids (0..143, a different tile each);
- ``"u"``: an undo of whatever the engine's undo stack holds;
- ``"h"``: a hint was shown (it changes nothing);
- ``{"s": [...], "f": [...]}``: a shuffle and the order it produced. The shuffle
  draws from the engine's global RNG, not the deal's seed, so the result is
  recorded. The shuffle renumbers the tiles 0..n-1 in a new order: for new
  tile ``i``, ``s[i]`` is the index, in the board just before the shuffle, of the
  tile whose position it takes (so ``s`` is a permutation of ``0..n-1``), and
  ``f[i]`` its face id (1..42);
- ``"s"``: a shuffle that left the board as it was (a geometric deadlock).

Wire form, schema ``v`` 1. Change it in a breaking way -> bump ``v``
(``MOVES_VERSION``) and the app's registry entry together.

The byte cap on the compact JSON (``MAX_MOVES_BYTES``) is the same figure as the
app's ``MAHJONG_MOVES_MAX_BYTES`` in ``eventQueueConfig.ts`` (a test holds the
two equal). A bad event is dropped, not the batch: the request still succeeds,
with one Sentry report by reason and error types, never values.
"""

from __future__ import annotations

import json
import logging
import threading
from typing import Annotated, Any, Literal

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    StrictInt,
    ValidationError,
    model_validator,
)

from int_bounds import INT32_MAX
from observability.report import Throttle, report_event

logger = logging.getLogger(__name__)

MOVES = "moves"
MOVES_VERSION = 1
MAX_MOVES_BYTES = 2048
"""Compact-JSON bytes one ``moves`` event may take. The app's registry holds the
same figure (``maxBytes``): a worst honest chunk (24 matches and one shuffle of
a full 144-tile board) is about 1.2 KB."""
MAX_ACTIONS_PER_EVENT = 32
"""The app sends 25; the headroom is for a retuned chunk size on a newer build."""
MAX_TILES = 144
"""Every layout has 144 tiles (72 pairs)."""
MAX_FACE_ID = 42
"""The tile faces are numbered 1..42 (``faceId`` in the app's tile set)."""


def _two_different_tiles(pair: tuple[int, int]) -> tuple[int, int]:
    """A tile cannot match itself."""
    if pair[0] == pair[1]:
        raise ValueError("a pair is two different tiles")
    return pair


TileId = Annotated[StrictInt, Field(ge=0, lt=MAX_TILES)]
FaceId = Annotated[StrictInt, Field(ge=1, le=MAX_FACE_ID)]
MatchedPair = Annotated[tuple[TileId, TileId], AfterValidator(_two_different_tiles)]


class MahjongShuffle(BaseModel):
    """A shuffle's resulting order (see the module docstring)."""

    model_config = ConfigDict(extra="forbid")

    s: list[TileId] = Field(min_length=2, max_length=MAX_TILES)
    f: list[FaceId] = Field(min_length=2, max_length=MAX_TILES)

    @model_validator(mode="after")
    def _one_face_and_one_position_per_tile(self) -> MahjongShuffle:
        if len(self.s) != len(self.f):
            raise ValueError("s and f are the same length")
        # s indexes the board just before the shuffle, which has as many tiles as
        # this one: a permutation of 0..n-1, each position taken once.
        if sorted(self.s) != list(range(len(self.s))):
            raise ValueError("s is a permutation of 0..n-1")
        if len(self.s) % 2:
            raise ValueError("tiles come in pairs")
        return self


MoveEntry = MatchedPair | Literal["u", "h", "s"] | MahjongShuffle


class MahjongMoves(BaseModel):
    """One ``moves`` event's ``data`` (wire form, schema ``v`` 1).

    The recorder's envelope (``v``, ``unit``, ``t_ms``) plus ``m``; ``part`` /
    ``parts`` appear only when the app had to split an oversized event.
    ``extra="forbid"``: an unknown key means a newer schema, which bumps ``v``.
    """

    model_config = ConfigDict(extra="forbid")

    # StrictInt with equal bounds, not Literal[1]: a Literal accepts True as 1
    v: StrictInt = Field(ge=MOVES_VERSION, le=MOVES_VERSION)
    # units count from 1 (the app's MahjongReplay numbers the first chunk 1)
    unit: StrictInt = Field(ge=1, le=INT32_MAX)
    t_ms: StrictInt = Field(ge=0, le=INT32_MAX)
    m: list[MoveEntry] = Field(min_length=1, max_length=MAX_ACTIONS_PER_EVENT)
    part: StrictInt | None = Field(default=None, ge=0, lt=MAX_ACTIONS_PER_EVENT)
    parts: StrictInt | None = Field(default=None, ge=2, le=MAX_ACTIONS_PER_EVENT)

    @model_validator(mode="after")
    def _a_split_event_says_which_part(self) -> MahjongMoves:
        """The recorder writes ``part`` and ``parts`` together, on a split event only,
        and a split makes at least two parts: ``0 <= part < parts``."""
        if (self.part is None) != (self.parts is None):
            raise ValueError("part and parts come together")
        if self.part is not None and self.parts is not None and self.part >= self.parts:
            raise ValueError("part is below parts")
        return self


def validate_moves(data: dict[str, Any]) -> dict[str, Any] | None:
    """The ``moves`` ``data`` to store, or ``None`` to drop the event.

    Dropped (logged, reported to Sentry by reason only, never values): more
    than ``MAX_MOVES_BYTES`` of compact JSON, or any schema violation (wrong
    type, a tile id off the board, a pair of one tile, a shuffle whose arrays
    differ in length, an unknown key, a wrong ``v``). Otherwise the payload is
    stored exactly as sent.
    """
    try:
        size = len(json.dumps(data, separators=(",", ":")).encode())
    except (TypeError, ValueError):
        size = MAX_MOVES_BYTES + 1
    if size > MAX_MOVES_BYTES:
        logger.warning("mahjong: dropped an oversize moves event (%d bytes)", size)
        _report_dropped("oversize")
        return None
    try:
        MahjongMoves.model_validate(data)
    except ValidationError as e:
        types = sorted({err["type"] for err in e.errors()})[:10]
        logger.warning("mahjong: dropped an invalid moves event [%s]", ", ".join(types))
        _report_dropped("invalid", error_types=types)
        return None
    return data


# One throttle per reason: a bad build sends a bad event every chunk of every
# game, and must not send one Sentry event each (#3293). The fingerprint is fixed,
# so a throttled call loses no grouping.
_DROP_REPORT_WINDOW_S = 300.0
_drop_throttles: dict[str, Throttle] = {}
_drop_throttles_lock = threading.Lock()


def _drop_throttle(reason: str) -> Throttle:
    throttle = _drop_throttles.get(reason)
    if throttle is None:
        with _drop_throttles_lock:
            throttle = _drop_throttles.setdefault(reason, Throttle(_DROP_REPORT_WINDOW_S))
    return throttle


def _report_dropped(reason: str, *, error_types: list[str] | None = None) -> None:
    """Send a dropped ``moves`` event to Sentry: the reason and error types only.

    At most one event per reason per five minutes per process; the drop itself
    is always logged.
    """
    if not _drop_throttle(reason).allow():
        return
    report_event(
        f"mahjong event: moves {reason}",
        level="warning",
        fingerprint=["mahjong-moves-dropped", reason],
        tags={"game_type": "mahjong", "reason": reason},
        extras={"error_types": error_types or []},
    )
