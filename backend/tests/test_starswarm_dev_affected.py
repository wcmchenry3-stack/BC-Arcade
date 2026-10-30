"""Star Swarm: Guns level in ``wave_completed`` and dev-affected runs (#3510).

- ``pacing.gunsPeak``: optional on the wave record; an older build's wave
  without it still validates, and stores without it.
- ``dev_affected``: the completion's result says a dev-panel action touched the
  run. Owner decision on #3510: the run is saved (never rejected), kept off the
  leaderboards and out of every ``/stats/me`` roll-up, and one reaching
  production raises a throttled Sentry warning.
"""

from __future__ import annotations

import copy
import json
import uuid
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from db.base import get_session_factory
from db.models import GameEntitlement
from games.filters import DEV_AFFECTED_KEY, is_dev_affected
from main import app
from observability import report
from observability.report import Throttle
from settings import Settings
from starswarm import module as starswarm_module
from starswarm.models import StarSwarmResult, validate_wave_completed
from tests._helpers import session_headers as _headers

client = TestClient(app)

_FIXTURE = Path(__file__).parent / "fixtures" / "starswarm_wave_stats_v1.json"


def _wave() -> dict[str, Any]:
    """An older build's wave (the shared v1 fixture has no ``gunsPeak``)."""
    return json.loads(_FIXTURE.read_text(encoding="utf-8"))


# ---------------------------------------------------------------------------
# pacing.gunsPeak
# ---------------------------------------------------------------------------


def test_an_older_builds_wave_without_guns_peak_still_validates_as_sent() -> None:
    data = _wave()
    assert "gunsPeak" not in data["pacing"]
    out = validate_wave_completed(data)
    assert out == data
    assert "gunsPeak" not in out["pacing"]


@pytest.mark.parametrize("level", [1, 2, 3])
def test_a_wave_with_guns_peak_keeps_it(level: int) -> None:
    data = _wave()
    data["pacing"]["gunsPeak"] = level
    out = validate_wave_completed(data)
    assert out is not None
    assert out["pacing"]["gunsPeak"] == level


@pytest.mark.parametrize("bad", [-1, 1.5, "3", True, None])
def test_a_malformed_guns_peak_drops_the_wave_like_any_bad_counter(bad: object) -> None:
    data = _wave()
    data["pacing"]["gunsPeak"] = bad
    assert validate_wave_completed(data) is None


# ---------------------------------------------------------------------------
# dev_affected on the result
# ---------------------------------------------------------------------------


def test_the_result_keeps_the_flag_and_an_older_build_sends_none() -> None:
    assert StarSwarmResult.model_validate({"dev_affected": True}).dev_affected is True
    assert StarSwarmResult.model_validate({"dev_affected": False}).dev_affected is False
    older = StarSwarmResult.model_validate({"wave_reached": 3}).model_dump(exclude_unset=True)
    assert DEV_AFFECTED_KEY not in older


@pytest.mark.parametrize("odd", ["yes", 1, 0, "false", [], {}])
def test_a_non_boolean_flag_reads_as_true_and_never_rejects(odd: object) -> None:
    assert StarSwarmResult.model_validate({"dev_affected": odd}).dev_affected is True


def test_is_dev_affected_reads_only_json_true() -> None:
    assert is_dev_affected({DEV_AFFECTED_KEY: True})
    for meta in ({}, None, {DEV_AFFECTED_KEY: False}, {DEV_AFFECTED_KEY: "true"}):
        assert not is_dev_affected(meta)


# ---------------------------------------------------------------------------
# over HTTP: saved, not ranked, not counted
# ---------------------------------------------------------------------------


@pytest.fixture
def sids() -> list[str]:
    return [str(uuid.uuid4()) for _ in range(2)]


@pytest.fixture(autouse=True)
async def _entitlements(sids: list[str]):
    factory = get_session_factory()
    async with factory() as db:
        for sid in sids:
            db.add(GameEntitlement(session_id=sid, game_slug="starswarm"))
        await db.commit()


@pytest.fixture
def sentry_messages(monkeypatch) -> list[tuple[str, dict]]:
    calls: list[tuple[str, dict]] = []
    monkeypatch.setattr(
        report.sentry_sdk, "capture_message", lambda message, **kw: calls.append((message, kw))
    )
    return calls


@pytest.fixture(autouse=True)
def _fresh_throttle(monkeypatch) -> None:
    monkeypatch.setattr(
        starswarm_module,
        "_dev_affected_throttle",
        Throttle(starswarm_module.DEV_AFFECTED_WARNING_WINDOW_S),
    )


def _environment(monkeypatch, env: str | None) -> None:
    monkeypatch.setattr(starswarm_module, "_settings", Settings.isolated(ENVIRONMENT=env))


def _run(sid: str, score: int, *, dev: object = None, tier: str = "Captain") -> str:
    """A run as the app records it: created, then completed with its result."""
    r = client.post(
        "/games",
        headers=_headers(sid),
        json={"game_type": "starswarm", "metadata": {"difficulty_tier": tier}},
    )
    assert r.status_code == 200, r.text
    gid = r.json()["id"]
    result: dict[str, Any] = {"outcome": "completed", "wave_reached": 4, "difficulty_tier": tier}
    if dev is not None:
        result[DEV_AFFECTED_KEY] = dev
    r = client.patch(
        f"/games/{gid}/complete",
        headers=_headers(sid),
        json={
            "final_score": score,
            "outcome": "completed",
            "duration_ms": 60_000,
            "result": result,
        },
    )
    assert r.status_code == 200, r.text
    return gid


def _join(sid: str) -> str:
    r = client.put("/players/me", headers=_headers(sid))
    assert r.status_code == 200, r.text
    return r.json()["display_name"]


def _board(sid: str) -> list[tuple[str, int]]:
    r = client.get("/games/leaderboard/starswarm?difficulty_tier=Captain", headers=_headers(sid))
    assert r.status_code == 200, r.text
    return [(e["player_name"], e["value"]) for e in r.json()["entries"]]


def _starswarm_stats(sid: str) -> dict | None:
    r = client.get("/stats/me", headers=_headers(sid))
    assert r.status_code == 200, r.text
    return r.json()["by_game"].get("starswarm")


def test_a_flagged_run_is_saved_with_its_flag_and_score(sids: list[str]) -> None:
    gid = _run(sids[0], 9000, dev=True)
    detail = client.get(f"/games/{gid}", headers=_headers(sids[0])).json()
    assert detail["final_score"] == 9000
    assert detail["metadata"][DEV_AFFECTED_KEY] is True


def test_a_flagged_run_never_ranks_while_a_clean_one_does(sids: list[str]) -> None:
    dev_sid, clean_sid = sids
    dev_gid = _run(dev_sid, 9000, dev=True)
    clean_gid = _run(clean_sid, 100)
    _join(dev_sid)
    clean_name = _join(clean_sid)

    assert _board(clean_sid) == [(clean_name, 100)]
    r = client.get(f"/games/{dev_gid}/rank", headers=_headers(dev_sid))
    assert r.status_code == 200, r.text
    assert r.json()["ranked"] is False
    assert r.json()["reason"] == "not_rankable"
    r = client.get(f"/games/{clean_gid}/rank", headers=_headers(clean_sid))
    assert r.json()["ranked"] is True


def test_a_flagged_best_does_not_hide_the_players_clean_best(sids: list[str]) -> None:
    sid = sids[0]
    _run(sid, 9000, dev=True)
    _run(sid, 300)
    name = _join(sid)
    assert _board(sid) == [(name, 300)]


def test_a_run_flagged_false_or_without_the_flag_ranks(sids: list[str]) -> None:
    _run(sids[0], 500, dev=False)
    _run(sids[1], 400)
    names = {_join(sids[0]): 500, _join(sids[1]): 400}
    assert dict(_board(sids[0])) == names


def test_stats_leave_flagged_runs_out(sids: list[str]) -> None:
    sid = sids[0]
    _run(sid, 9000, dev=True)
    _run(sid, 300)
    stats = _starswarm_stats(sid)
    assert stats is not None
    assert stats["sessions"] == 1
    assert stats["completed"] == 1
    assert stats["best_value"] == 300
    assert stats["time_played_ms"] == 60_000


def test_a_player_with_only_flagged_runs_has_no_starswarm_stats(sids: list[str]) -> None:
    sid = sids[0]
    _run(sid, 9000, dev=True)
    assert _starswarm_stats(sid) is None


def _abandon(sid: str, *, dev: bool) -> str:
    """A run abandoned for a new one (``syncRestart``): no score, the app's progress snapshot
    as the result — ``{dev_affected: true}`` for a dev run, nothing for a clean one."""
    r = client.post(
        "/games",
        headers=_headers(sid),
        json={"game_type": "starswarm", "metadata": {"difficulty_tier": "Captain"}},
    )
    assert r.status_code == 200, r.text
    gid = r.json()["id"]
    body: dict[str, Any] = {"outcome": "abandoned", "duration_ms": 30_000}
    if dev:
        body["result"] = {DEV_AFFECTED_KEY: True}
    r = client.patch(f"/games/{gid}/complete", headers=_headers(sid), json=body)
    assert r.status_code == 200, r.text
    return gid


def test_a_flagged_abandoned_run_is_saved_and_left_out_of_stats(sids: list[str]) -> None:
    sid = sids[0]
    gid = _abandon(sid, dev=True)
    detail = client.get(f"/games/{gid}", headers=_headers(sid)).json()
    assert detail["outcome"] == "abandoned"
    assert detail["metadata"][DEV_AFFECTED_KEY] is True
    # a clean abandon still counts as a session and its play time; the flagged one adds nothing
    _abandon(sid, dev=False)
    stats = _starswarm_stats(sid)
    assert stats is not None
    assert stats["sessions"] == 1
    assert stats["time_played_ms"] == 30_000


def test_a_flagged_abandon_in_production_warns_like_a_completion(
    monkeypatch, sids: list[str], sentry_messages
) -> None:
    _environment(monkeypatch, "production")
    _abandon(sids[0], dev=True)
    assert len(sentry_messages) == 1


def test_a_retried_flagged_abandon_does_not_warn_again(
    monkeypatch, sids: list[str], sentry_messages
) -> None:
    """A retried abandon PATCH returns the stored row before validating, so even
    with a fresh throttle it can't add a second warning."""
    _environment(monkeypatch, "production")
    gid = _abandon(sids[0], dev=True)
    monkeypatch.setattr(
        starswarm_module,
        "_dev_affected_throttle",
        Throttle(starswarm_module.DEV_AFFECTED_WARNING_WINDOW_S),
    )
    r = client.patch(
        f"/games/{gid}/complete",
        headers=_headers(sids[0]),
        json={
            "outcome": "abandoned",
            "duration_ms": 30_000,
            "result": {DEV_AFFECTED_KEY: True},
        },
    )
    assert r.status_code == 200, r.text
    assert len(sentry_messages) == 1


def test_the_flag_cannot_be_set_at_creation(sids: list[str]) -> None:
    r = client.post(
        "/games",
        headers=_headers(sids[0]),
        json={"game_type": "starswarm", "metadata": {DEV_AFFECTED_KEY: True}},
    )
    assert r.status_code in (400, 422), r.text


# ---------------------------------------------------------------------------
# Sentry: a flagged run in production
# ---------------------------------------------------------------------------


def test_a_flagged_run_in_production_raises_one_warning(
    monkeypatch, sids: list[str], sentry_messages
) -> None:
    _environment(monkeypatch, "production")
    _run(sids[0], 9000, dev=True)
    assert len(sentry_messages) == 1
    message, kw = sentry_messages[0]
    assert message == "starswarm: dev-affected run in production"
    assert kw["level"] == "warning"
    assert kw["fingerprint"] == [starswarm_module.DEV_AFFECTED_FINGERPRINT]
    assert kw["tags"] == {"game_type": "starswarm", "dev_affected": "true"}
    # no identifiers: no session or game id anywhere in the event
    assert sids[0] not in json.dumps(kw, default=str)


def test_the_warning_is_throttled_to_one_per_window(
    monkeypatch, sids: list[str], sentry_messages
) -> None:
    _environment(monkeypatch, "production")
    for i in range(3):
        _run(sids[i % 2], 100 + i, dev=True)
    assert len(sentry_messages) == 1


@pytest.mark.parametrize("env", [None, "development", "test"])
def test_a_flagged_run_outside_production_says_nothing(
    monkeypatch, sids: list[str], sentry_messages, env: str | None
) -> None:
    _environment(monkeypatch, env)
    _run(sids[0], 9000, dev=True)
    assert sentry_messages == []


def test_a_clean_run_in_production_says_nothing(
    monkeypatch, sids: list[str], sentry_messages
) -> None:
    _environment(monkeypatch, "production")
    _run(sids[0], 9000)
    _run(sids[1], 9000, dev=False)
    assert sentry_messages == []


def test_a_repeated_completion_does_not_warn_again(
    monkeypatch, sids: list[str], sentry_messages
) -> None:
    """The completion is idempotent: a retried PATCH returns the stored row
    without validating again, so it can't add a warning (the throttle aside)."""
    _environment(monkeypatch, "production")
    gid = _run(sids[0], 9000, dev=True)
    monkeypatch.setattr(
        starswarm_module,
        "_dev_affected_throttle",
        Throttle(starswarm_module.DEV_AFFECTED_WARNING_WINDOW_S),
    )
    r = client.patch(
        f"/games/{gid}/complete",
        headers=_headers(sids[0]),
        json={
            "final_score": 9000,
            "outcome": "completed",
            "result": {DEV_AFFECTED_KEY: True},
        },
    )
    assert r.status_code == 200, r.text
    assert len(sentry_messages) == 1


def test_the_flag_rides_the_result_block_only() -> None:
    """``StarSwarmResult`` carries it; the wave record does not (it has its own per-wave ``dev``)."""
    data = copy.deepcopy(_wave())
    data[DEV_AFFECTED_KEY] = True
    out = validate_wave_completed(data)
    assert out is not None
    assert DEV_AFFECTED_KEY not in out
