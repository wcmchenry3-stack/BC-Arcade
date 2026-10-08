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
