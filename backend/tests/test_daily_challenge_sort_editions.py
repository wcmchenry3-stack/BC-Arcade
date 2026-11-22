"""Bottle Sort "solve N new levels" (#4028), review round 1 on #4038: the catalog and
pre-catalog editions kept apart (``definitions.edition_of`` / ``counted_editions``),
today's partial pace, and dev-affected runs in the metrics script (#4039).

A migrated install keeps its old random-level rows (no ``catalog_version``) next to its
catalog rows; the device empties its bests on migration, so its "new levels" count from
its catalog best. The server must too, with the switch on and off.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import pytest

from daily_challenge.definitions import CATALOG_EDITION, LEGACY_EDITION, NEW_LEVELS_KIND
from daily_challenge.history import load_install_history
from daily_challenge.personal import options_for
from daily_challenge.streak import compute_streak
from db.base import get_session_factory
from tests.test_daily_challenge_personal import _add
from tests.test_daily_challenge_sort_levels import (  # noqa: F401 - _cleanup is a fixture
    _CAT,
    _CATALOG,
    _DAY,
    _DW,
    _LEGACY,
    _LOCAL,
    _START,
    _2048,
    _catalog,
    _cleanup,
    _fresh_settings,
    _goal,
    _pin,
    _sid,
    _sort_history,
    _statements,
    _status,
    metrics,
)


def test_todays_partial_standing_is_not_a_days_pace(monkeypatch: pytest.MonkeyPatch) -> None:
    _catalog(monkeypatch, True)
    h = _sort_history({3: 32, 2: 34, 1: 36}, before=30)
    h.daily_best["sort"][_DAY] = 37  # today, still being played: one level so far
    tomorrow = _DAY + timedelta(days=1)
    assert h.sort_new_levels_per_day(tomorrow) == [2, 2, 2]  # not [2, 2, 2, 1]
    h.now = datetime(2026, 11, 22, 1, tzinfo=UTC)  # the loader's clock: today is 11-22
    assert h.sort_new_levels_per_day(tomorrow) == [2, 2, 2, 1]


@pytest.mark.parametrize("on", [True, False], ids=["switch on", "switch off"])
@pytest.mark.usefixtures("_cleanup")
async def test_status_scores_a_migrated_install_from_its_catalog_best(
    on: bool, monkeypatch: pytest.MonkeyPatch
) -> None:
    _catalog(monkeypatch, on)
    sid = _sid()
    await _pin(sid, _LOCAL, (_DW, _goal(2), _2048))
    await _add(sid, "sort", _START - timedelta(days=30), final_score=18)  # random levels
    await _add(sid, "sort", _START - timedelta(hours=1), final_score=5, metadata=_CAT)
    await _add(sid, "sort", _START + timedelta(hours=1), final_score=6, metadata=_CAT)
    assert not (await _status(sid)).goals[1].completed  # 6 - 5 = 1
    await _add(sid, "sort", _START + timedelta(hours=2), final_score=7, metadata=_CAT)
    seen, stop = _statements()
    try:
        status = await _status(sid)
    finally:
        stop()
    assert status.goals[1].completed  # 7 - 5 = 2, never 7 - 18
    # Still one aggregate for the baselines, grouped by edition.
    assert len([s for s in seen if "max(" in s.lower()]) == 1


@pytest.mark.usefixtures("_cleanup")
async def test_status_ignores_pre_catalog_rows_once_the_switch_is_on(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sid = _sid()
    await _pin(sid, _LOCAL, (_DW, _goal(1), _2048))
    await _add(sid, "sort", _START - timedelta(days=3), final_score=10)
    await _add(sid, "sort", _START + timedelta(hours=1), final_score=11)  # pre-catalog build
    _catalog(monkeypatch, True)
    assert not (await _status(sid)).goals[1].completed
    _catalog(monkeypatch, False)  # off: scored on its own edition, 11 - 10
    assert (await _status(sid)).goals[1].completed


@pytest.mark.usefixtures("_cleanup")
async def test_the_loader_reads_the_installs_own_sort_edition(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sid = _sid()
    # Random levels up to 18 a while ago, then the catalog: 3, 5, 7 on the last three days.
    await _add(sid, "sort", datetime(2026, 11, 1, 12, tzinfo=UTC), final_score=18)
    for back, level in ((3, 3), (2, 5), (1, 7)):
        d = _DAY - timedelta(days=back)
        when = datetime(d.year, d.month, d.day, 12, tzinfo=UTC)
        await _add(sid, "sort", when, final_score=level, metadata=_CAT)
    now = datetime(2026, 11, 21, 6, tzinfo=UTC)
    for on in (True, False):  # off: the latest row is a catalog row, so the catalog too
        _catalog(monkeypatch, on)
        async with get_session_factory()() as db:
            h = await load_install_history(db, sid, _DAY, now=now)
        assert h.sort_edition == CATALOG_EDITION
        assert h.best_final_score("sort", _DAY) == 7  # not 18
        assert h.edition_bests[_DAY] == {_LEGACY: 18, _CATALOG: 7}
        assert h.sort_new_levels_per_day(_DAY) == [3, 2, 2]  # not [0, 0, 0] against 18
        [option] = options_for("sort", h, _DAY, pct=12)
        assert option.goal == _goal(2)  # median 2 x 1.12
    # Switch off, the latest row from a pre-catalog build: its own edition.
    _catalog(monkeypatch, False)
    await _add(sid, "sort", datetime(2026, 11, 20, 18, tzinfo=UTC), final_score=19)
    async with get_session_factory()() as db:
        h = await load_install_history(db, sid, _DAY, now=now)
    assert h.sort_edition == LEGACY_EDITION
    assert h.best_final_score("sort", _DAY) == 19


@pytest.mark.usefixtures("_cleanup")
async def test_the_streak_keeps_editions_apart(monkeypatch: pytest.MonkeyPatch) -> None:
    _catalog(monkeypatch, True)
    sid = _sid()
    now = datetime(2025, 3, 1, 12, tzinfo=UTC)
    yesterday = datetime(2025, 2, 28, 12, tzinfo=UTC)
    await _add(sid, "sort", datetime(2025, 2, 20, 12, tzinfo=UTC), final_score=40)  # legacy
    await _add(sid, "sort", datetime(2025, 2, 21, 12, tzinfo=UTC), final_score=4, metadata=_CAT)
    await _pin(sid, yesterday.date(), (_DW, _goal(1), _2048))
    await _add(sid, "twenty48", yesterday, final_score=600)
    await _add(sid, "sort", yesterday + timedelta(minutes=1), final_score=5, metadata=_CAT)
    async with get_session_factory()() as db:
        assert await compute_streak(db, sid, 0, now) == 1  # 5 - 4, not 5 - 40


@pytest.mark.usefixtures("_cleanup")
async def test_the_metrics_never_count_a_dev_affected_run(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """#4039: a dev-affected in-window run neither raises the running baseline nor meets a
    goal, as in /status and the streak. Same query count."""
    monkeypatch.setattr(metrics, "CHUNK_INSTALLS", 1)
    d1, d2 = date(2024, 5, 2), date(2024, 5, 3)
    now = datetime(2024, 5, 20, tzinfo=UTC)
    sid = _sid()
    dev = {"dev_affected": True}
    await _pin(sid, d1, (_DW, _goal(1), _2048))
    await _add(sid, "sort", datetime(2024, 5, 2, 12, tzinfo=UTC), final_score=50, metadata=dev)
    await _add(sid, "twenty48", datetime(2024, 5, 2, 13, tzinfo=UTC), final_score=900, metadata=dev)
    await _pin(sid, d2, (_DW, _goal(1), _2048))
    await _add(sid, "sort", datetime(2024, 5, 3, 12, tzinfo=UTC), final_score=1)
    seen, stop = _statements()
    try:
        async with get_session_factory()() as db:
            report = await metrics.collect(db, d1, d2, 0, now)
    finally:
        stop()
    rows = {(g["game_type"], g["kind"]): g for g in report["core_goals"]}
    levels = rows[("sort", NEW_LEVELS_KIND)]
    # Day 1: only dev runs, so nothing offered or met. Day 2: 1 - 0 = 1, met; had the dev
    # 50 raised the running baseline it would be 1 - 50.
    assert (levels["assigned"], levels["offered"], levels["met"]) == (2, 1, 1)
    assert rows[("twenty48", "final_score_at_least")]["met"] == 0
    assert len(seen) == 4 + 1  # one chunk with a relative goal, then the empty id page
