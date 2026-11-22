"""Star Swarm ``damage.hitsByTier`` (#3710): accept, absent, unknown key, switch, size."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

import pytest

from settings import Settings
from starswarm import models
from starswarm.models import (
    ENEMY_TIERS,
    HIT_RESULTS,
    MAX_WAVE_STATS_BYTES,
    validate_wave_completed,
)

_FIXTURE = Path(__file__).parent / "fixtures" / "starswarm_wave_stats_v2.json"


def _payload(hits_by_tier: dict[str, Any] | None) -> dict[str, Any]:
    data = json.loads(_FIXTURE.read_text(encoding="utf-8"))
    if hits_by_tier is None:
        data["damage"].pop("hitsByTier", None)
    else:
        data["damage"]["hitsByTier"] = hits_by_tier
    return data


def _switch(monkeypatch: pytest.MonkeyPatch, on: bool) -> None:
    monkeypatch.setattr(models, "_settings", Settings.isolated(STARSWARM_HITS_BY_TIER=on))


GRID = {"Grunt": {"life": 1, "plating": 2}, "Carrier": {"shield": 3}}


def test_hits_by_tier_is_stored(monkeypatch: pytest.MonkeyPatch) -> None:
    _switch(monkeypatch, True)
    out = validate_wave_completed(_payload(GRID))
    assert out is not None
    assert out["damage"]["hitsByTier"] == GRID


def test_a_payload_without_it_is_valid(monkeypatch: pytest.MonkeyPatch) -> None:
    _switch(monkeypatch, True)
    out = validate_wave_completed(_payload(None))
    assert out is not None
    assert "hitsByTier" not in out["damage"]


def test_an_unknown_tier_is_kept_and_logged(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    _switch(monkeypatch, True)
    with caplog.at_level(logging.WARNING, logger="starswarm.models"):
        out = validate_wave_completed(_payload({"Dreadnought": {"life": 1}, "Grunt": {"ghost": 1}}))
    assert out is not None
    assert out["damage"]["hitsByTier"]["Dreadnought"] == {"life": 1}
    assert "damage.hitsByTier.Dreadnought" in caplog.text
    assert "damage.hitsByTier.Grunt.ghost" in caplog.text


def test_the_switch_off_strips_only_the_grid(monkeypatch: pytest.MonkeyPatch) -> None:
    _switch(monkeypatch, True)
    with_grid = validate_wave_completed(_payload(GRID))
    _switch(monkeypatch, False)
    stripped = validate_wave_completed(_payload(GRID))
    assert with_grid is not None and stripped is not None
    assert "hitsByTier" not in stripped["damage"]
    del with_grid["damage"]["hitsByTier"]
    assert stripped == with_grid


def test_the_switch_defaults_on_and_reads_the_env(monkeypatch: pytest.MonkeyPatch) -> None:
    assert Settings.isolated().starswarm_hits_by_tier is True
    monkeypatch.setattr(models, "_settings", None)
    monkeypatch.setenv("STARSWARM_HITS_BY_TIER", "false")
    assert models.hits_by_tier_enabled() is False


def test_a_worst_case_grid_fits_the_wave_cap(monkeypatch: pytest.MonkeyPatch) -> None:
    """All 12 cells at 99,999 is 236 bytes compact; the event stays under the 4 KB cap."""
    _switch(monkeypatch, True)
    grid = {t: {r: 99_999 for r in HIT_RESULTS} for t in ENEMY_TIERS}
    assert len(ENEMY_TIERS) * len(HIT_RESULTS) == 12
    # The key and its comma included: this is what the field adds to a wave.
    added = len(json.dumps({"hitsByTier": grid}, separators=(",", ":")).encode()) - 1
    assert added == 236
    data = _payload(grid)
    assert len(json.dumps(data, separators=(",", ":")).encode()) <= MAX_WAVE_STATS_BYTES
    out = validate_wave_completed(data)
    assert out is not None
    assert out["damage"]["hitsByTier"] == grid
