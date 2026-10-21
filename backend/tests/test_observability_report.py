"""``observability.report``: ``report_event`` and ``Throttle`` (#2994)."""

from __future__ import annotations

from typing import Any

import pytest

from observability import report
from observability.report import Throttle, report_event


@pytest.fixture
def sent(monkeypatch: pytest.MonkeyPatch) -> list[tuple[str, dict[str, Any]]]:
    calls: list[tuple[str, dict[str, Any]]] = []
    monkeypatch.setattr(
        report.sentry_sdk, "capture_message", lambda msg, **kw: calls.append((msg, kw))
    )
    return calls


def test_report_event_passes_message_level_fingerprint_and_tags(sent) -> None:
    report_event("boom", level="warning", fingerprint=["a", "b"], tags={"k": "v"})
    assert sent == [("boom", {"level": "warning", "fingerprint": ["a", "b"], "tags": {"k": "v"}})]


def test_report_event_forwards_context_and_extras_when_given(sent) -> None:
    report_event(
        "boom",
        level="error",
        fingerprint=["a"],
        tags={},
        context={"result_rejection": {"fields": "x"}},
        extras={"n": 1},
    )
    kw = sent[0][1]
    assert kw["contexts"] == {"result_rejection": {"fields": "x"}}
    assert kw["extras"] == {"n": 1}


def test_report_event_reaches_sentry_with_scope_data_and_does_not_leak() -> None:
    import sentry_sdk
    from sentry_sdk.transport import Transport

    events: list[dict[str, Any]] = []

    class _Capture(Transport):
        def capture_envelope(self, envelope) -> None:  # type: ignore[no-untyped-def]
            event = envelope.get_event()
            if event is not None:
                events.append(event)

    old_client = sentry_sdk.get_client()
    sentry_sdk.init(dsn="https://k@o0.ingest.sentry.io/0", transport=_Capture)
    try:
        report_event(
            "rejected",
            level="error",
            fingerprint=["f", "g"],
            tags={"game_type": "yacht"},
            context={"c": {"a": 1}},
            extras={"e": 2},
        )
        sentry_sdk.capture_message("plain")
        sentry_sdk.flush()
    finally:
        sentry_sdk.get_client().close()
        sentry_sdk.get_global_scope().set_client(old_client)

    first, second = events
    assert first["message"] == "rejected" and first["level"] == "error"
    assert first["fingerprint"] == ["f", "g"]
    assert first["tags"]["game_type"] == "yacht"
    assert first["contexts"]["c"] == {"a": 1}
    assert first["extra"]["e"] == 2
    assert "game_type" not in second.get("tags", {})
    assert "c" not in second.get("contexts", {})


def test_throttle_allows_one_call_per_window(monkeypatch: pytest.MonkeyPatch) -> None:
    now = [100.0]
    monkeypatch.setattr(report.time, "monotonic", lambda: now[0])
    throttle = Throttle(600.0)
    assert throttle.allow() is True
    now[0] += 599.9
    assert throttle.allow() is False
    now[0] += 0.1
    assert throttle.allow() is True  # exactly one window later
    assert throttle.allow() is False


def test_throttles_are_independent() -> None:
    a, b = Throttle(60.0), Throttle(60.0)
    assert a.allow() is True
    assert b.allow() is True


def test_report_rejected_result_builds_the_shared_event(monkeypatch) -> None:
    sent: list[tuple[tuple, dict]] = []
    monkeypatch.setattr(report, "report_event", lambda *a, **kw: sent.append((a, kw)))
    report.report_rejected_result("yacht", "scorecard dropped", {"fields": "x"})
    assert sent == [
        (
            ("PATCH /games/{id}/complete rejected: scorecard dropped (yacht)",),
            {
                "level": "error",
                "fingerprint": ["games-complete-result-rejected", "yacht", "scorecard dropped"],
                "tags": {"game_type": "yacht"},
                "context": {"result_rejection": {"fields": "x"}},
            },
        )
    ]


def test_report_rejected_result_is_throttled_per_game_and_reason(monkeypatch) -> None:
    sent: list[tuple[tuple, dict]] = []
    monkeypatch.setattr(report, "report_event", lambda *a, **kw: sent.append((a, kw)))
    now = [100.0]
    monkeypatch.setattr(report.time, "monotonic", lambda: now[0])
    for _ in range(50):
        report.report_rejected_result("yacht", "result too large", {})
    assert len(sent) == 1  # a flood of one reason is one event
    report.report_rejected_result("yacht", "final_score mismatch", {})
    report.report_rejected_result("hearts", "result too large", {})
    assert len(sent) == 3  # other reasons / games still report
    now[0] += report._REJECTED_WINDOW_S
    report.report_rejected_result("yacht", "result too large", {})
    assert len(sent) == 4  # window reset
    assert {tuple(kw["fingerprint"]) for _, kw in sent} == {
        ("games-complete-result-rejected", "yacht", "result too large"),
        ("games-complete-result-rejected", "yacht", "final_score mismatch"),
        ("games-complete-result-rejected", "hearts", "result too large"),
    }


def test_report_rejected_result_sends_the_suppressed_count_with_the_next_event(monkeypatch) -> None:
    sent: list[tuple[tuple, dict]] = []
    monkeypatch.setattr(report, "report_event", lambda *a, **kw: sent.append((a, kw)))
    now = [100.0]
    monkeypatch.setattr(report.time, "monotonic", lambda: now[0])
    for _ in range(4):
        report.report_rejected_result("yacht", "result too large", {"keys": "a"})
    assert "suppressed" not in sent[0][1]["context"]["result_rejection"]
    now[0] += report._REJECTED_WINDOW_S
    report.report_rejected_result("yacht", "result too large", {"keys": "a"})
    assert sent[1][1]["context"]["result_rejection"] == {"keys": "a", "suppressed": 3}
    now[0] += report._REJECTED_WINDOW_S
    report.report_rejected_result("yacht", "result too large", {"keys": "a"})
    assert "suppressed" not in sent[2][1]["context"]["result_rejection"]


# --- KeyedThrottle and the reporters that use it (#3313) ---------------------


def _clock(monkeypatch: pytest.MonkeyPatch) -> list[float]:
    now = [1000.0]
    monkeypatch.setattr(report.time, "monotonic", lambda: now[0])
    return now


def test_keyed_throttle_allows_one_call_per_key_per_window(monkeypatch) -> None:
    now = _clock(monkeypatch)
    t = report.KeyedThrottle(window_s=60.0, max_per_hour=100)
    assert t.allow("a") == 0
    assert t.allow("b") == 0
    assert t.allow("a") is None
    assert t.allow("a") is None
    now[0] += 59.0
    assert t.allow("a") is None
    now[0] += 1.0
    assert t.allow("a") == 3  # the calls held back since the last event


def test_keyed_throttle_global_cap_holds_across_distinct_keys(monkeypatch) -> None:
    now = _clock(monkeypatch)
    t = report.KeyedThrottle(window_s=3600.0, max_per_hour=10)
    allowed = [k for k in range(500) if t.allow(k) is not None]
    assert len(allowed) == 10
    now[0] += 3600.0
    assert t.allow("new") == 0


def test_reset_keyed_throttles_clears_every_instance(monkeypatch) -> None:
    _clock(monkeypatch)
    t = report.KeyedThrottle(window_s=3600.0, max_per_hour=1)
    assert t.allow("a") == 0
    assert t.allow("b") is None
    report.reset_keyed_throttles()
    assert t.allow("b") == 0


def test_keyed_throttle_registry_does_not_keep_instances_alive() -> None:
    import gc
    import weakref

    t = report.KeyedThrottle(window_s=1.0, max_per_hour=1)
    ref = weakref.ref(t)
    del t
    gc.collect()
    assert ref() is None
    report.reset_keyed_throttles()  # a dead instance is simply gone


def test_store_misconfigured_is_capped_with_a_fixed_fingerprint(sent, monkeypatch) -> None:
    from purchases import _common

    now = _clock(monkeypatch)
    for _ in range(1000):
        _common.misconfigured("google", "service_account")
    assert len(sent) == 1
    message, kw = sent[0]
    assert message == "google_play_misconfigured: service_account"
    assert kw["fingerprint"] == ["google_play_misconfigured", "service_account"]
    assert kw["tags"] == {"platform": "google", "reason": "service_account"}

    now[0] += _common.MISCONFIGURED_WINDOW_S
    _common.misconfigured("google", "service_account")
    assert sent[1][1]["extras"] == {"suppressed": 999}
    assert sent[1][1]["fingerprint"] == kw["fingerprint"]


def test_store_misconfigured_global_cap_across_reasons(sent, monkeypatch) -> None:
    from purchases import _common

    _clock(monkeypatch)
    for i in range(50):
        _common.misconfigured("apple", f"reason_{i}")
    assert len(sent) == _common.MISCONFIGURED_MAX_PER_HOUR


def test_stats_missing_module_capped_with_one_fingerprint(sent, monkeypatch) -> None:
    from games import stats

    _clock(monkeypatch)
    for i in range(50):
        for _ in range(3):
            stats._report_missing_module(f"game_{i}")
    assert len(sent) == stats.MISSING_MODULE_MAX_PER_HOUR
    assert {tuple(kw["fingerprint"]) for _, kw in sent} == {(stats.MISSING_MODULE_FINGERPRINT,)}
