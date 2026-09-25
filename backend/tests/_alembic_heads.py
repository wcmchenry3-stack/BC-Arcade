"""Alembic head discovery for the test suite (#2585).

Read from the migration scripts themselves, so no test has to pin the latest
revision id by hand — a pin every migration PR had to edit, and one that could
not tell when a branch carried two "latest" migrations on the same parent
(#2535 vs ``0020_swap_yacht_blackjack``). Not a test module: the leading
underscore keeps pytest from collecting it.
"""

from __future__ import annotations

import functools
from collections.abc import Sequence
from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory

BACKEND = Path(__file__).resolve().parent.parent


@functools.cache
def script_heads() -> tuple[str, ...]:
    """Every head revision in ``alembic/versions``, sorted. One is healthy.

    Cached: the graph cannot change during a test run, and each load imports
    every migration file. Raises if the graph cannot be built (a migration that
    fails to import, or a ``down_revision`` naming a revision that is missing).
    """
    cfg = Config(str(BACKEND / "alembic.ini"))
    # alembic.ini's `script_location = alembic` is relative to the working
    # directory; pin it so this works from wherever pytest is launched.
    cfg.set_main_option("script_location", str(BACKEND / "alembic"))
    # alembic.ini's `prepend_sys_path = .` is for the CLI. Here it would push a
    # cwd-relative "." onto the test process's sys.path on every load (and warn
    # about the legacy path splitting); the migrations import only alembic and
    # sqlalchemy, so they need none of it (#2616 review).
    cfg.set_main_option("prepend_sys_path", "")
    return tuple(sorted(ScriptDirectory.from_config(cfg).get_heads()))


def multiple_heads_message(heads: Sequence[str]) -> str:
    """Explain a head count other than one, naming every head."""
    if not heads:
        return "Alembic found no head revision: alembic/versions has no migration files."
    return (
        f"Alembic has {len(heads)} heads: {', '.join(heads)}. Two migrations revise "
        "the same parent, so `alembic upgrade head` refuses to run and the next "
        "deploy's migration step would fail. Renumber the newer migration and set "
        "its down_revision to the other head."
    )
