"""Shared helpers for the Alembic migration tests (#2953).

Not a test module: the leading underscore keeps pytest from collecting it.
``run_alembic`` backs the ``alembic`` fixture in ``conftest.py`` and
``pytest_configure``'s ``upgrade head``.
"""

from __future__ import annotations

import os
import subprocess
import sys
from collections.abc import Callable
from pathlib import Path

from tests._alembic_heads import BACKEND

# The ``alembic`` fixture: ``alembic("upgrade", rev)`` against the scratch DB.
Alembic = Callable[..., subprocess.CompletedProcess[str]]


class AlembicError(RuntimeError):
    """An ``alembic`` invocation exited non-zero (message carries its output)."""


def run_alembic(db_path: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    """Run ``alembic <args>`` against the scratch SQLite file at ``db_path``.

    stdout/stderr are captured as text on the returned process (alembic logs to
    stderr). With ``check`` (the default) a non-zero exit raises ``AlembicError``
    naming the command and exit code and carrying Alembic's own output, since its
    `FAILED: ...` reason is on stdout and would otherwise be hidden; with
    ``check=False`` the caller inspects ``returncode`` itself.
    """
    return run_alembic_url(f"sqlite:///{db_path}", *args, check=check)


def run_alembic_url(url: str, *args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    """``run_alembic`` against any database URL (the Postgres EXPLAIN gate, #2965)."""
    env = os.environ.copy()
    env["DATABASE_URL"] = url
    result = subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        cwd=BACKEND,
        env=env,
        check=False,
        capture_output=True,
        text=True,
    )
    if check and result.returncode != 0:
        raise AlembicError(
            f"`alembic {' '.join(args)}` failed (exit {result.returncode}):\n"
            f"{result.stdout}{result.stderr}"
        )
    return result
