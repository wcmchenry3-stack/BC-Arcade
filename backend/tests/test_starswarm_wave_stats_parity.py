"""Star Swarm ``wave_completed`` registry parity with the app (#3252).

``fixtures/starswarm_wave_stats_v1_registries.json`` is the app's registries
(``frontend/src/game/starswarm/engine/registries.ts``), held equal to them by the
frontend's ``waveStats.parity.test.ts``. Here every ``StarSwarmWaveStats``
Literal set must cover the fixture's values (and, today, equal them), so a
power-up, enemy tier or hit cause added on one side only fails CI.
See docs/games/starswarm.md#adding-content.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from starswarm import models

_FIXTURE_NAME = "backend/tests/fixtures/starswarm_wave_stats_v1_registries.json"
_FIXTURE = Path(__file__).parent / "fixtures" / "starswarm_wave_stats_v1_registries.json"

# fixture registry -> the backend's Literal set (models.py)
_BACKEND: dict[str, tuple[str, ...]] = {
    "POWERUP_TYPES": models.POWERUP_TYPES,
    "POWERUP_SOURCES": models.POWERUP_SOURCES,
    "ENEMY_TIERS": models.ENEMY_TIERS,
    "ASTEROID_KINDS": models.ASTEROID_KINDS,
    "ROCK_BREAKERS": models.ROCK_BREAKERS,
    "HIT_CAUSES": models.HIT_CAUSES,
    "BUDDY_HIT_CAUSES": models.BUDDY_HIT_CAUSES,
    "HIT_RESULTS": models.HIT_RESULTS,
    "KILL_METHODS": models.KILL_METHODS,
    "CARRIER_STAGES": models.CARRIER_STAGES,
}


def _registries() -> dict[str, list[str]]:
    data = json.loads(_FIXTURE.read_text(encoding="utf-8"))
    assert data["v"] == models.WAVE_STATS_VERSION, f"{_FIXTURE_NAME} is for another v"
    return data["registries"]


def _missing(backend: dict[str, tuple[str, ...]], shared: dict[str, list[str]]) -> list[str]:
    """Why the backend falls short of the fixture, naming the file to edit."""
    gaps: list[str] = []
    for name in sorted(set(backend) | set(shared)):
        if name not in backend:
            gaps.append(
                f"{name} is in {_FIXTURE_NAME} but has no Literal in backend/starswarm/models.py "
                "— add one (and to _BACKEND in this test)"
            )
            continue
        if name not in shared:
            gaps.append(f"{name} is in backend/starswarm/models.py but not in {_FIXTURE_NAME}")
            continue
        lacking = [v for v in shared[name] if v not in backend[name]]
        if lacking:
            gaps.append(
                f"{name} lacks {lacking}: add them to its Literal in backend/starswarm/models.py "
                f"(the app has them, per {_FIXTURE_NAME})"
            )
    return gaps


def test_the_backend_literals_cover_the_app_registries() -> None:
    gaps = _missing(_BACKEND, _registries())
    assert not gaps, "\n".join(gaps)


@pytest.mark.parametrize("name", sorted(_BACKEND))
def test_the_backend_literals_equal_the_app_registries(name: str) -> None:
    shared = _registries()
    assert sorted(_BACKEND[name]) == sorted(shared[name]), (
        f"{name}: backend/starswarm/models.py has {list(_BACKEND[name])}, "
        f"{_FIXTURE_NAME} has {shared[name]} — make them match"
    )


def test_an_app_only_value_fails_naming_the_literal_to_edit() -> None:
    shared = _registries()
    shared["POWERUP_TYPES"] = [*shared["POWERUP_TYPES"], "magnet"]
    gaps = _missing(_BACKEND, shared)
    assert len(gaps) == 1
    assert gaps[0].startswith("POWERUP_TYPES lacks ['magnet']")
    assert "backend/starswarm/models.py" in gaps[0]


def test_an_app_only_registry_fails() -> None:
    shared = {**_registries(), "LOOT_TABLES": ["a"]}
    expected = (
        f"LOOT_TABLES is in {_FIXTURE_NAME} but has no Literal in backend/starswarm/models.py "
        "— add one (and to _BACKEND in this test)"
    )
    assert _missing(_BACKEND, shared) == [expected]
