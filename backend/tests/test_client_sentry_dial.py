"""The app's Sentry dial on GET /games/catalog (#3437, epic #3273).

``CLIENT_SENTRY_ENABLED`` / ``CLIENT_SENTRY_SAMPLE_RATE`` (env, Render) are served
as ``client_sentry: {enabled, sample_rate}``: the no-release dial for the app's
Sentry volume. Defaults are today's behaviour (on, every event).
"""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from observability import client_sentry_dial
from settings import Settings


@pytest.fixture(autouse=True)
def _fresh_dial_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(client_sentry_dial, "_settings", None)


def _dial(client: TestClient) -> dict[str, Any]:
    r = client.get("/games/catalog")
    assert r.status_code == 200
    return r.json()["client_sentry"]


def test_the_default_is_on_at_every_event(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(client_sentry_dial, "_settings", Settings.isolated())
    assert _dial(client) == {"enabled": True, "sample_rate": 1.0}


def test_the_env_kill_switch_turns_it_off(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("CLIENT_SENTRY_ENABLED", "false")
    assert _dial(client)["enabled"] is False


def test_the_env_sample_rate_is_served(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CLIENT_SENTRY_SAMPLE_RATE", "0.25")
    assert _dial(client) == {"enabled": True, "sample_rate": 0.25}


def test_the_rate_is_rounded_to_four_places(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        client_sentry_dial, "_settings", Settings.isolated(CLIENT_SENTRY_SAMPLE_RATE=0.123456)
    )
    assert client_sentry_dial.client_sentry_dial() == (True, 0.1235)


def test_a_rate_below_the_fourth_place_is_served_as_zero(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        client_sentry_dial, "_settings", Settings.isolated(CLIENT_SENTRY_SAMPLE_RATE=0.00004)
    )
    assert client_sentry_dial.client_sentry_dial() == (True, 0.0)


@pytest.mark.parametrize("bad", [-0.1, 1.5, "lots"])
def test_an_out_of_range_rate_fails_settings_validation(bad: object) -> None:
    # A bad value on Render fails the deploy (Settings is built at startup), so the
    # running instance keeps serving the last good dial.
    with pytest.raises(ValidationError):
        Settings.isolated(CLIENT_SENTRY_SAMPLE_RATE=bad)


def test_the_dial_does_not_change_the_replay_items_or_cache_header(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("CLIENT_SENTRY_ENABLED", "false")
    r = client.get("/games/catalog")
    assert r.headers["Cache-Control"] == "public, max-age=300"
    assert all("replay" in item for item in r.json()["items"])
