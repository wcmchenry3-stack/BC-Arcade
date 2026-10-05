"""Plain helpers shared by the backend tests (#2953).

Not a test module and not a conftest: tests import from here directly (importing
from ``conftest`` is unsupported by pytest). Fixtures live in ``conftest.py``.
"""

from __future__ import annotations


def session_headers(sid: str) -> dict[str, str]:
    """JSON request headers for session ``sid``."""
    return {"X-Session-ID": sid, "Content-Type": "application/json"}
