"""One way to measure a stored JSON payload (#3298).

Event ``data`` and bug-log ``context`` caps, the per-game / per-session ceilings
and the ``games.event_bytes`` counter all use this, so they always agree.
"""

from __future__ import annotations

import json
from typing import Any


def json_bytes(value: Any) -> int:
    """UTF-8 length of ``value`` as compact JSON (non-ASCII kept as-is, not escaped)."""
    return len(
        json.dumps(value, default=str, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    )
