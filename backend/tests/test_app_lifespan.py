"""App startup/shutdown runs through one lifespan handler (#2668)."""

from __future__ import annotations

import json
import logging
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


def test_no_on_event_hooks_remain() -> None:
    """Once a lifespan is set FastAPI stops running @app.on_event handlers, so
    a hook added the old way would silently never fire."""
    import main

    # (FastAPI wraps the lifespan when merging included routers', so it is not
    # compared by identity; the startup/shutdown tests show it runs.)
    assert main.app.router.on_startup == []
    assert main.app.router.on_shutdown == []


def test_importing_main_raises_no_on_event_deprecation() -> None:
    """Checked in a fresh interpreter, not with importlib.reload: re-running
    main.py re-applies its @limiter.limit decorators to the shared limiter
    under the same route names, doubling every limit for the rest of the run
    (it made test_health_db's 30/minute trip at 15)."""
    probe = (
        "import warnings\n"
        "warnings.simplefilter('always')\n"
        "with warnings.catch_warnings(record=True) as caught:\n"
        "    warnings.simplefilter('always')\n"
        "    import main  # noqa: F401\n"
        "print(sum('on_event' in str(w.message) for w in caught))\n"
    )
    result = subprocess.run(
        [sys.executable, "-c", probe],
        cwd=Path(__file__).resolve().parent.parent,
        capture_output=True,
        text=True,
        check=False,
        timeout=120,
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip().splitlines()[-1] == "0", result.stdout + result.stderr


def test_startup_still_logs_db_reachability(caplog: pytest.LogCaptureFixture) -> None:
    import main

    with caplog.at_level(logging.INFO, logger="audit"), TestClient(main.app):
        pass
    events = []
    for record in caplog.records:
        try:
            events.append(json.loads(record.getMessage()).get("event"))
        except ValueError:
            continue
    assert "db_connected" in events
