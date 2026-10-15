"""Solitaire metadata and result models (#592)."""

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
    field_validator,
)

from games.metadata import LegacyPlayerName
from int_bounds import INT32_MAX
from observability.report import Throttle, report_event

logger = logging.getLogger(__name__)

DrawMode = Literal[1, 3]


class SolitaireMetadata(BaseModel):
    """Validated metadata shape for Solitaire game rows (#592).

    ``player_name`` is optional: older builds sent it on ``POST /games``;
    since #2624 the name lives on the player (``PUT /players/me``).
    ``draw_mode`` (#2632) is the deal's Draw-1 / Draw-3 mode, sent on
    ``POST /games`` by current builds. It is optional so older builds, which
    send no metadata, still validate. Both modes share one board (#591): it is
    recorded, not a partition. ``extra="forbid"`` rejects unknown keys.
    """

    model_config = ConfigDict(extra="forbid")
    player_name: LegacyPlayerName = ""
    draw_mode: DrawMode | None = None

    @field_validator("draw_mode", mode="before")
    @classmethod
    def _draw_mode_is_an_int(cls, value: Any) -> Any:
        # The metadata is stored as sent, and ``Literal[1, 3]`` alone would let
        # ``true`` (== 1) or ``3.0`` through.
        if value is not None and type(value) is not int:
            raise ValueError("draw_mode must be 1 or 3")
        return value


class SolitaireResult(BaseModel):
    """Validated result block sent on ``PATCH /games/{id}/complete`` (#2449).

    Distinct from the creation-time metadata model. Unknown keys are ignored so
    a newer app build never fails completion. ``won`` is the win signal for
    goal evaluation; ``games.outcome`` semantics live on ``vocab.GameOutcome``.
    """

    won: bool
    moves: int = Field(ge=0)


# --- moves event payload (#3289, epic #3273) ---------------------------------
#
# The app records Solitaire as one ``moves`` event per chunk of up to 25 actions
# (``frontend/src/game/solitaire/replay.ts``), through the shared GameRecorder: a
# stored game rebuilds from the deal seed in ``game_started`` plus its ``moves``
# rows in ``event_index`` order. Solitaire sent no per-move event before, so
# there is no older type to keep. Change the shape in a breaking way -> bump ``v``
# (``MOVES_VERSION``) and the app's registry entry together.
#
# An action is a list of small ints, the first is the kind:
#
#   0 draw  1 recycle  2 undo  3 hint                       [k]
#   4 waste -> tableau                                      [k, to]
#   5 waste -> foundation                                   [k]
#   6 tableau -> tableau (the top ``n`` cards)              [k, from, to, n]
#   7 tableau -> foundation                                 [k, from]
#   8 foundation -> tableau (suit index into SUITS)         [k, suit, to]
#
# An auto-complete step is the same action with 16 added to its kind.

MOVES = "moves"
MOVES_VERSION = 1
MAX_MOVES_BYTES = 512
"""Compact-JSON bytes one ``moves`` event may take. The app's registry holds the
same figure (``CARD_MOVES_MAX_BYTES``): 25 worst-case actions plus the envelope
are ~340 B."""
MAX_ACTIONS_PER_EVENT = 32
"""The app sends 25; the headroom is for a retuned chunk size on a newer build."""
AUTO_OFFSET = 16
RUN_MAX = 13
"""The longest run a column can hold (K..A)."""

# kind -> the inclusive range of each of its arguments.
_COL = (0, 6)
_ARGS: dict[int, tuple[tuple[int, int], ...]] = {
    0: (),
    1: (),
    2: (),
    3: (),
    4: (_COL,),
    5: (),
    6: (_COL, _COL, (1, RUN_MAX)),
    7: (_COL,),
    8: ((0, 3), _COL),
}

_AUTO_KINDS = frozenset({0, 5, 6, 7})
"""An auto-complete step is a stock draw, a move to a foundation or a relocation."""

Arg = Annotated[StrictInt, Field(ge=0, le=INT32_MAX)]


def _check_action(action: list[int]) -> list[int]:
    """One action: a known kind with exactly its arguments, each in range."""
    kind, args = action[0], action[1:]
    base = kind - AUTO_OFFSET if kind >= AUTO_OFFSET else kind
    if kind >= AUTO_OFFSET and base not in _AUTO_KINDS:
        raise ValueError("this kind is never an auto-complete step")
    limits = _ARGS.get(base)
    if limits is None:
        raise ValueError("unknown action kind")
    if len(args) != len(limits):
        raise ValueError("wrong number of arguments")
    for value, (low, high) in zip(args, limits, strict=True):
        if not low <= value <= high:
            raise ValueError("argument out of range")
    if base == 6 and args[0] == args[1]:
        raise ValueError("a column cannot move onto itself")
    return action


Action = Annotated[list[Arg], Field(min_length=1, max_length=4), AfterValidator(_check_action)]


class SolitaireMoves(BaseModel):
    """One ``moves`` event's ``data`` (wire form, schema ``v`` 1).

    The recorder's envelope (``v``, ``unit``, ``t_ms``) plus ``s`` (the index of
    the chunk's first action in the game) and ``m``; ``part`` / ``parts`` appear
    only when the app had to split an oversized event. ``extra="forbid"``: an
    unknown key means a newer schema, which bumps ``v``.
    """

    model_config = ConfigDict(extra="forbid")

    # StrictInt with equal bounds, not Literal[1]: a Literal accepts True as 1
    v: StrictInt = Field(ge=MOVES_VERSION, le=MOVES_VERSION)
    unit: StrictInt = Field(ge=0, le=INT32_MAX)
    t_ms: StrictInt = Field(ge=0, le=INT32_MAX)
    s: StrictInt = Field(ge=0, le=INT32_MAX)
    m: list[Action] = Field(min_length=1, max_length=MAX_ACTIONS_PER_EVENT)
    part: StrictInt | None = Field(default=None, ge=0, le=MAX_ACTIONS_PER_EVENT)
    parts: StrictInt | None = Field(default=None, ge=1, le=MAX_ACTIONS_PER_EVENT)


# One Sentry report per reason per five minutes per process (#3293): a bad build
# would otherwise send one per chunk. The fingerprint is fixed, so nothing is lost.
_DROP_WINDOW_S = 300.0
_drop_throttles: dict[str, Throttle] = {}
_drop_lock = threading.Lock()


def _drop_throttle(reason: str) -> Throttle:
    with _drop_lock:
        return _drop_throttles.setdefault(reason, Throttle(_DROP_WINDOW_S))


def validate_moves(data: dict[str, Any]) -> dict[str, Any] | None:
    """The ``moves`` ``data`` to store, or ``None`` to drop the event.

    Dropped (logged, reported to Sentry by reason only and throttled, never
    values): more than ``MAX_MOVES_BYTES`` of compact JSON, or any schema
    violation (wrong type, an unknown kind, an argument out of range, an unknown
    key, a wrong ``v``). Otherwise the payload is stored exactly as sent.
    """
    try:
        size = len(json.dumps(data, separators=(",", ":")).encode())
    except (TypeError, ValueError):
        size = MAX_MOVES_BYTES + 1
    if size > MAX_MOVES_BYTES:
        logger.warning("solitaire: dropped an oversize moves event (%d bytes)", size)
        _report_dropped("oversize")
        return None
    try:
        SolitaireMoves.model_validate(data)
    except ValidationError as e:
        types = sorted({err["type"] for err in e.errors()})[:10]
        logger.warning("solitaire: dropped an invalid moves event [%s]", ", ".join(types))
        _report_dropped("invalid", error_types=types)
        return None
    return data


def _report_dropped(reason: str, *, error_types: list[str] | None = None) -> None:
    """Send a dropped ``moves`` event to Sentry: the reason and error types only."""
    if not _drop_throttle(reason).allow():
        return
    report_event(
        f"solitaire event: moves {reason}",
        level="warning",
        fingerprint=["solitaire-moves-dropped", reason],
        tags={"game_type": "solitaire", "reason": reason},
        extras={"error_types": error_types or []},
    )
