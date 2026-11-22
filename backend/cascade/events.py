"""Cascade's replay events, ``drop`` and ``merge`` (#3858, epic #3273).

The app records a Cascade game through the shared GameRecorder
(``frontend/src/game/cascade/replay.ts``), one unit per 30 drops (fewer when the game
ends or the app goes to the background), each unit a ``drop`` and a ``merge`` event:

- ``drop``: ``{"d": [[step, x_tenths, tier], ...], "z": [[start, peak], ...]?, "rs": 1?}``.
  ``step`` is the engine's fixed-step index (60 a second), ``x_tenths`` the drop's x in tenths
  of a world pixel, ``tier`` the piece dropped. ``z`` holds the danger moments (the lid's
  overflow count ran from fixed step ``start`` and reached ``peak`` of ``OVERFLOW_TICKS``
  steps); ``rs`` marks the first unit after a restored game (its steps restart on a restored
  board). ``d`` may be empty when the unit carries only ``z`` or ``rs``. Never split.
- ``merge``: ``{"m": [[step, tier_from, chain], ...]}``: two ``tier_from`` pieces merged in
  fixed step ``step``, the ``chain``-th merge since the last drop (from 1). Split into parts
  (``part`` / ``parts``) when over its cap.

Each also carries the recorder's envelope (``v``, ``unit``, ``t_ms``). Wire form, schema
``v`` 1; change it in a breaking way -> bump ``v`` and the app's registry entry together.

The byte caps (``MAX_DROP_BYTES``, ``MAX_MERGE_BYTES``) are the app's
``CASCADE_DROP_MAX_BYTES`` / ``CASCADE_MERGE_MAX_BYTES`` (``eventQueueConfig.ts``; a test
holds them equal). A bad event is dropped, not the batch: the request still succeeds, with
at most one Sentry report per reason per five minutes, by reason and error types, never
values. Builds from before #3858 (never shipped: Cascade was not released) sent one event per
drop and merge with no envelope; those are dropped as invalid.
"""

from __future__ import annotations

import json
import logging
import threading
from typing import Annotated, Any

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StrictInt,
    ValidationError,
    model_validator,
)

from cascade.models import MAX_TIER
from int_bounds import INT32_MAX
from observability.report import Throttle, report_event

logger = logging.getLogger(__name__)

DROP = "drop"
MERGE = "merge"
SCHEMA_VERSION = 1

MAX_DROP_BYTES = 1024
"""Compact-JSON bytes one ``drop`` event may take: 30 drops, 32 danger moments and the
envelope are about 940 B at the widest."""
MAX_MERGE_BYTES = 1024
"""Compact-JSON bytes one ``merge`` event (or part) may take."""
MAX_DROPS_PER_EVENT = 32
"""The app sends 30 (``CASCADE_DROPS_PER_UNIT``, #3967; 20 before); the headroom is for a cut unit."""
MAX_DANGER_PER_EVENT = 32
"""The app records at most 32 danger moments a game (``CASCADE_MAX_DANGER``)."""
MAX_MERGES_PER_EVENT = 128
"""A 1 KB part holds at most about 75 merges."""
MAX_CHAIN = 1000
"""Merges since one drop: the board holds about 90 pieces, so a chain is far shorter."""
X_TENTHS_MAX = 4000
"""The bin is 400 world pixels wide (``WORLD_WIDTH``): x in tenths is 0..4000."""
OVERFLOW_TICKS = 180
"""The lid's count ends the game at this many fixed steps (``OVERFLOW_TICKS_THRESHOLD``)."""

Step = Annotated[StrictInt, Field(ge=0, le=INT32_MAX)]
# Two tier-10 pieces make the capstone (tier 11, #3960): a merge is from 0..10, a drop is never the
# capstone.
Tier = Annotated[StrictInt, Field(ge=0, lt=MAX_TIER)]
XTenths = Annotated[StrictInt, Field(ge=0, le=X_TENTHS_MAX)]
Peak = Annotated[StrictInt, Field(ge=1, le=OVERFLOW_TICKS)]
Chain = Annotated[StrictInt, Field(ge=1, le=MAX_CHAIN)]


class _Envelope(BaseModel):
    """The recorder's envelope. ``extra="forbid"``: an unknown key means a newer schema."""

    model_config = ConfigDict(extra="forbid")

    # StrictInt with equal bounds, not Literal[1]: a Literal accepts True as 1
    v: StrictInt = Field(ge=SCHEMA_VERSION, le=SCHEMA_VERSION)
    unit: StrictInt = Field(ge=1, le=INT32_MAX)
    t_ms: StrictInt = Field(ge=0, le=INT32_MAX)


class CascadeDrop(_Envelope):
    """One ``drop`` event's ``data`` (wire form, schema ``v`` 1). Never split."""

    d: list[tuple[Step, XTenths, Tier]] = Field(max_length=MAX_DROPS_PER_EVENT)
    z: list[tuple[Step, Peak]] | None = Field(
        default=None, min_length=1, max_length=MAX_DANGER_PER_EVENT
    )
    rs: StrictInt | None = Field(default=None, ge=1, le=1)

    @model_validator(mode="after")
    def _says_something(self) -> CascadeDrop:
        if not self.d and self.z is None and self.rs is None:
            raise ValueError("a drop event holds a drop, a danger moment or the restored mark")
        return self


class CascadeMerge(_Envelope):
    """One ``merge`` event's ``data`` (wire form, schema ``v`` 1), or one part of a split one."""

    m: list[tuple[Step, Tier, Chain]] = Field(min_length=1, max_length=MAX_MERGES_PER_EVENT)
    part: StrictInt | None = Field(default=None, ge=0, lt=MAX_MERGES_PER_EVENT)
    parts: StrictInt | None = Field(default=None, ge=2, le=MAX_MERGES_PER_EVENT)

    @model_validator(mode="after")
    def _a_split_event_says_which_part(self) -> CascadeMerge:
        """The recorder writes ``part`` and ``parts`` together, on a split event only."""
        if (self.part is None) != (self.parts is None):
            raise ValueError("part and parts come together")
        if self.part is not None and self.parts is not None and self.part >= self.parts:
            raise ValueError("part is below parts")
        return self


_MODELS: dict[str, tuple[type[BaseModel], int]] = {
    DROP: (CascadeDrop, MAX_DROP_BYTES),
    MERGE: (CascadeMerge, MAX_MERGE_BYTES),
}


def validate_replay_event(name: str, data: dict[str, Any]) -> dict[str, Any] | None:
    """A ``drop`` / ``merge`` event's ``data`` to store (exactly as sent), or ``None`` to drop it.

    Dropped (logged, reported to Sentry by reason only, never values): more than the type's
    byte cap of compact JSON, or any schema violation (a wrong type, a tier or x out of range,
    a capstone dropped, a chain from 0, an unknown key, a wrong ``v``).
    """
    model, cap = _MODELS[name]
    try:
        size = len(json.dumps(data, separators=(",", ":")).encode())
    except (TypeError, ValueError):
        size = cap + 1
    if size > cap:
        logger.warning("cascade: dropped an oversize %s event (%d bytes)", name, size)
        _report_dropped(name, "oversize")
        return None
    try:
        model.model_validate(data)
    except ValidationError as e:
        types = sorted({err["type"] for err in e.errors()})[:10]
        logger.warning("cascade: dropped an invalid %s event [%s]", name, ", ".join(types))
        _report_dropped(name, "invalid", error_types=types)
        return None
    return data


# One throttle per (type, reason): a bad build sends a bad event every unit of every game
# and must not send one Sentry event each (#3293).
_DROP_REPORT_WINDOW_S = 300.0
_throttles: dict[tuple[str, str], Throttle] = {}
_throttles_lock = threading.Lock()


def _report_dropped(name: str, reason: str, *, error_types: list[str] | None = None) -> None:
    with _throttles_lock:
        throttle = _throttles.setdefault((name, reason), Throttle(_DROP_REPORT_WINDOW_S))
    if not throttle.allow():
        return
    report_event(
        f"cascade event: {name} {reason}",
        level="warning",
        fingerprint=["cascade-replay-dropped", name, reason],
        tags={"game_type": "cascade", "event_type": name, "reason": reason},
        extras={"error_types": error_types or []},
    )
