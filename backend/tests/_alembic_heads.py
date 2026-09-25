"""Alembic head discovery for the test suite (#2585).

Read from the migration scripts themselves, so no test has to pin the latest
revision id by hand — a pin every migration PR had to edit, and one that could
not tell when two PRs had each added a "latest" migration on the same parent
(#2535 vs ``0020_swap_yacht_blackjack``). Not a test module: the leading
underscore keeps pytest from collecting it.
"""

from __future__ import annotations

from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory

_BACKEND = Path(__file__).resolve().parent.parent


def script_heads() -> list[str]:
    """Every head revision in ``alembic/versions``, sorted. One is healthy."""
    cfg = Config(str(_BACKEND / "alembic.ini"))
    # alembic.ini's `script_location = alembic` is relative to the working
    # directory; pin it so this works from wherever pytest is launched.
    cfg.set_main_option("script_location", str(_BACKEND / "alembic"))
    return sorted(ScriptDirectory.from_config(cfg).get_heads())


def multiple_heads_message(heads: list[str]) -> str:
    """Explain a head count other than one, naming every head."""
    if not heads:
        return "Alembic has no head revision — alembic/versions is empty or unreadable."
    return (
        f"Alembic has {len(heads)} heads: {', '.join(heads)}. Two migrations revise "
        "the same parent, so `alembic upgrade head` refuses to run and the next "
        "deploy's migration step would fail. Renumber the newer migration and set "
        "its down_revision to the other head."
    )
