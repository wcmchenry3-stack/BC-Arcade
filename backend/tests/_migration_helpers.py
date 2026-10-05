"""Shared helpers for the Alembic migration tests (#2953).

Not a test module: the leading underscore keeps pytest from collecting it.
``run_alembic`` and ``MigrationDb`` back the ``migration_db`` fixture in
``conftest.py`` and ``pytest_configure``'s ``upgrade head``.
"""

from __future__ import annotations

import os
import subprocess
import sys
from collections.abc import Callable
from pathlib import Path
from typing import NamedTuple

import pytest

from tests._alembic_heads import BACKEND


def run_alembic(db_path: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    """Run ``alembic <args>`` against the scratch SQLite file at ``db_path``.

    stdout/stderr are captured as text on the returned process (alembic logs to
    stderr). With ``check`` (the default) a non-zero exit fails the test with
    Alembic's own output in the message, since its `FAILED: ...` reason is on
    stdout and would otherwise be hidden; with ``check=False`` the caller
    inspects ``returncode`` itself.
    """
    env = os.environ.copy()
    env["DATABASE_URL"] = f"sqlite:///{db_path}"
    result = subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        cwd=BACKEND,
        env=env,
        check=False,
        capture_output=True,
        text=True,
    )
    if check and result.returncode != 0:
        pytest.fail(
            f"`alembic {' '.join(args)}` failed (exit {result.returncode}):\n"
            f"{result.stdout}{result.stderr}",
            pytrace=False,
        )
    return result


class MigrationDb(NamedTuple):
    """What the ``migration_db`` fixture returns: unpack as ``db_path, alembic``."""

    db_path: Path
    alembic: Callable[..., subprocess.CompletedProcess[str]]
