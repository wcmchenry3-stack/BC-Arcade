"""The personal-best seed switch on GET /games/catalog (#3802, epic #3273)."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from observability import personal_best_seed_dial
from settings import Settings


@pytest.fixture(autouse=True)
def _fresh_dial_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(personal_best_seed_dial, "_settings", None)


def test_the_default_is_on(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(personal_best_seed_dial, "_settings", Settings.isolated())
    r = client.get("/games/catalog")
    assert r.status_code == 200
    assert r.json()["personal_best_seed"] == {"enabled": True}


def test_the_env_kill_switch_turns_it_off(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("PERSONAL_BEST_SEED_ENABLED", "false")
    assert client.get("/games/catalog").json()["personal_best_seed"] == {"enabled": False}


def test_the_switch_does_not_change_the_other_dials_or_cache_header(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("PERSONAL_BEST_SEED_ENABLED", "false")
    r = client.get("/games/catalog")
    assert r.headers["Cache-Control"] == "public, max-age=300"
    assert r.json()["client_sentry"] == {"enabled": True, "sample_rate": 1.0}
    assert all("replay" in item for item in r.json()["items"])
