"""How stored JSON payloads are measured (#3298, #3292).

Two measures, both in UTF-8 bytes with non-ASCII kept as-is (not escaped):

* ``jsonb_bytes``: the length of the stored row's ``jsonb::text``. Game events
  use it everywhere: the per-event ``MAX_EVENT_DATA_BYTES`` cap, the
  ``games.event_bytes`` counter (charged on insert, lowered by a replay cut and
  by retention), the per-game / per-session ceilings and the replay caps in
  ``games.replay_caps``. One measure, so a counter always equals the sum of its
  stored rows and a cut or a prune can never take it below zero.
* ``json_bytes``: compact JSON, for game metadata and bug-log ``context``, whose
  caps are set against the client's own compact-JSON limits.

Both count a float Python prints in exponent form (``1e+300``) at the length
jsonb prints it (301 digits), so a client cannot slip a large stored row past a
cap with exponent floats.
"""

from __future__ import annotations

import json
import math
from decimal import Decimal
from typing import Any


def jsonb_bytes(value: Any) -> int:
    """UTF-8 length of ``value``'s ``jsonb::text`` form.

    That is ``json.dumps``' default ``", "`` / ``": "`` separators (jsonb
    reorders keys, which does not change the length), with exponent floats
    printed in full and ``-0.0`` as ``0.0``, as Postgres' ``numeric`` prints them.
    """
    size = len(json.dumps(value, ensure_ascii=False, default=str).encode("utf-8"))
    return size + _float_extra(value, negative_zero=-1)


def json_bytes(value: Any) -> int:
    """UTF-8 length of ``value`` as compact JSON, exponent floats printed in full."""
    size = len(
        json.dumps(value, default=str, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    )
    return size + _float_extra(value, negative_zero=0)


def _float_extra(value: Any, *, negative_zero: int) -> int:
    """Bytes jsonb prints beyond Python's ``repr`` for the floats in ``value``."""
    if isinstance(value, float):
        if not math.isfinite(value):
            return 0
        if value == 0 and math.copysign(1.0, value) < 0:
            return negative_zero  # numeric has no negative zero: "-0.0" is stored as "0.0"
        text = repr(value)
        if "e" not in text:
            return 0
        return max(0, len(format(Decimal(text), "f")) - len(text))
    if isinstance(value, dict):
        return sum(_float_extra(v, negative_zero=negative_zero) for v in value.values())
    if isinstance(value, list | tuple):
        return sum(_float_extra(v, negative_zero=negative_zero) for v in value)
    return 0
