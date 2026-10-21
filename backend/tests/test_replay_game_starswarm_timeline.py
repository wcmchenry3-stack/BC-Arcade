"""Star Swarm timeline reader and wave-summary reconciliation (#3395, epic #3390).

``starswarm/replay.py`` decodes ``wave_timeline`` rows, joins them to their
``wave_completed`` rows and cross-checks the two
(docs/games/starswarm-diagnostics.md, "Reader and reconciliation").
``fixtures/starswarm_run_lieutenant_7w.json`` is a consistent seven-wave run; the
failure cases mutate a copy of it.
"""

from __future__ import annotations

import copy
import importlib.util
import json
import pathlib
import socket
import sys
import uuid
from collections.abc import Callable
from typing import Any

import pytest

from starswarm import models, replay, timeline
from starswarm.timeline import CODES

FIXTURE = pathlib.Path(__file__).parent / "fixtures" / "starswarm_run_lieutenant_7w.json"
SCRIPT = pathlib.Path(__file__).parent.parent / "scripts" / "replay_game.py"

Events = list[tuple[str, Any]]


def _fixture() -> Events:
    data = json.loads(FIXTURE.read_text())
    return [(e["event_type"], copy.deepcopy(e["data"])) for e in data["events"]]


def _row(events: Events, name: str, wave: int, outcome: str | None = None) -> dict[str, Any]:
    return next(
        d
        for n, d in events
        if n == name and d["wave"] == wave and (outcome is None or d["outcome"] == outcome)
    )


def _summary(events: Events, wave: int) -> dict[str, Any]:
    return _row(events, "wave_completed", wave)


def _tl(events: Events, wave: int) -> dict[str, Any]:
    return _row(events, "wave_timeline", wave)


def _wave(events: Events, number: int) -> replay.Wave:
    waves, _ = replay.analyze(events)
    return next(w for w in waves if w.wave == number)


def _failed(events: Events, number: int) -> list[str]:
    return [f"{c.name}: {c.detail}" for c in _wave(events, number).checks if not c.ok]


# ---------------------------------------------------------------------------- fixture


def test_fixture_rows_pass_the_real_validators():
    events = _fixture()
    assert len({n for n, _ in events}) == 2
    for name, data in events:
        validator = (
            models.validate_wave_completed
            if name == "wave_completed"
            else timeline.validate_wave_timeline
        )
        stored = validator(copy.deepcopy(data))
        assert stored is not None, (name, data["wave"])
        assert "_flags" not in stored
    assert [d["wave"] for n, d in events if n == "wave_completed"] == [1, 2, 3, 4, 5, 6, 7]
    assert {d["difficulty"] for n, d in events if n == "wave_completed"} == {"LieutenantJG"}
    assert sorted(d["wave"] for n, d in events if n == "wave_timeline") == [2, 6, 7]


def test_consistent_fixture_reconciles_clean():
    waves, unreadable = replay.analyze(_fixture())
    assert unreadable == []
    assert [w.wave for w in waves] == [1, 2, 3, 4, 5, 6, 7]
    for w in waves:
        if w.timeline is None:
            assert w.note == "" and w.checks == []  # undamaged cleared waves: no advisory
        else:
            assert w.problem is None and w.note == ""
            assert w.checks and all(c.ok for c in w.checks), (w.wave, w.checks)


# --------------------------------------------------------------------------- decoding


def _sample_entry(code: int) -> list[int]:
    spec = CODES[code]
    return [123, code, *[p.hi if p.hi < 10 else p.lo for p in spec.params]]


@pytest.mark.parametrize("code", sorted(CODES))
def test_every_code_decodes_with_its_parameter_names(code: int):
    spec = CODES[code]
    raw = _sample_entry(code)
    entry = replay.decode_entry(raw)
    assert entry is not None
    assert (entry.t, entry.code, entry.name) == (123, code, spec.name)
    assert list(entry.params) == [p.name for p in spec.params]
    assert list(entry.params.values()) == raw[2:]
    line = replay.entry_line(entry)
    assert line.startswith("    12.3s  " + spec.name)
    assert "?" not in line  # every registry index resolved to a name


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ([160, 1, 0, 12, 0], "   16.0s  HULL_HIT       bullet  x=12/63  hull 1 -> 0"),
        ([187, 2, 1, 50, 1], "   18.7s  LIFE_LOST      rock  x=50/63  lives 2 -> 1"),
        (
            [301, 2, 3, 29, 0],
            "   30.1s  LIFE_LOST      ram  x=29/63  lives 1 -> 0  (lethal blow)",
        ),
        ([301, 9, 3], "   30.1s  RUN_LOST       cause ram"),
        ([40, 3, 2, 4], "    4.0s  BONUS_LIFE     +2 life  lives after 4"),
        ([318, 4, 1], "   31.8s  PLATING_UP     hull after 1"),
        ([371, 10, 3], "   37.1s  PHASE          -> Extraction"),
        ([298, 11, 2], "   29.8s  CARRIER_STAGE  -> finalStand"),
        ([334, 12, 6], "   33.4s  CARRIER_DOWN   by buddy"),
        ([342, 13], "   34.2s  ROUT"),
        ([95, 20, 3], "    9.5s  PICKUP         bomb"),
        ([264, 21, 1], "   26.4s  BUFF_END       shield ran out"),
        ([402, 8], "   40.2s  WAVE_CLEARED"),
    ],
)
def test_entry_labels(raw: list[int], expected: str):
    entry = replay.decode_entry(raw)
    assert entry is not None
    assert replay.entry_line(entry).strip() == expected.strip()


def test_unknown_code_is_decoded_raw_and_bad_entries_are_none():
    entry = replay.decode_entry([50, 99, 1, 2])
    assert entry is not None and entry.name == "UNKNOWN_99" and not entry.known
    assert "raw [50, 99, 1, 2]" in replay.entry_line(entry)
    for bad in ([], [1], "x", [1, 1, 0, 0], [1, 1, 9, 0, 0], [True, 8], [1.0, 8], [5, 9, 0, 0]):
        assert replay.decode_entry(bad) is None


# ------------------------------------------------------------------------------- join


def test_join_by_wave_and_outcome():
    waves, _ = replay.analyze(_fixture())
    by_wave = {w.wave: w for w in waves}
    for n in (2, 6, 7):
        assert by_wave[n].summary is not None and by_wave[n].timeline is not None
        assert by_wave[n].summary["wave"] == by_wave[n].timeline["wave"] == n
        assert by_wave[n].summary["outcome"] == by_wave[n].timeline["outcome"]


def test_cleared_and_died_of_one_wave_number_are_not_confused():
    events = _fixture()
    events.append(("wave_completed", {**copy.deepcopy(_summary(events, 7)), "outcome": "cleared"}))
    waves, _ = replay.analyze(events)
    sevens = [w for w in waves if w.wave == 7]
    assert sorted(w.outcome for w in sevens) == ["cleared", "died"]
    assert next(w for w in sevens if w.outcome == "died").timeline is not None
    assert next(w for w in sevens if w.outcome == "cleared").timeline is None


def _dev_repeat_events() -> tuple[Events, dict[str, Any], dict[str, Any]]:
    """Wave 7 died twice under the dev panel's infinite lives; only the second close has a timeline."""
    events = _fixture()
    first = _summary(events, 7)
    first["dev"] = True
    first["pacing"]["durationMs"] = 21_000
    second = copy.deepcopy(first)
    second["pacing"]["durationMs"] = 30_150  # terminal t 301, the timeline's
    events.insert(7, ("wave_completed", second))
    _tl(events, 7)["dev"] = True
    return events, first, second


def test_dev_repeat_joins_on_the_terminal_t():
    events, first, second = _dev_repeat_events()
    waves, _ = replay.analyze(events)
    died = [w for w in waves if w.wave == 7]
    assert len(died) == 2
    with_tl = next(w for w in died if w.timeline is not None)
    without = next(w for w in died if w.timeline is None)
    assert with_tl.summary is second  # terminal t 301 == floor(30150 / 100)
    assert without.summary is first
    # dev waves are decoded, never checked, and a dev wave with no timeline is not advised on
    assert with_tl.dev and with_tl.checks == [] and without.note == ""
    assert replay.terminal_t(second) == 301


def test_dev_died_with_no_matching_terminal_t_is_an_orphan():
    events, _first, second = _dev_repeat_events()
    second["pacing"]["durationMs"] = 99_000
    waves, _ = replay.analyze(events)
    orphan = next(w for w in waves if w.wave == 7 and w.timeline is not None)
    assert orphan.summary is None and orphan.note.startswith("orphan timeline")


def test_terminal_t_saturates():
    assert replay.terminal_t({"pacing": {"durationMs": 10**9}}) == 65535


# ---------------------------------------------------------------------- reconciliation


def _mutate(wave: int, fn: Callable[[dict[str, Any], dict[str, Any]], None]) -> Events:
    events = _fixture()
    fn(_summary(events, wave), _tl(events, wave))
    return events


def _set_hits(s: dict[str, Any], cause: str, result: str, n: int) -> None:
    s["damage"]["hits"].setdefault(cause, {})[result] = n


CASES: list[tuple[str, int, Callable[[dict[str, Any], dict[str, Any]], None], str]] = [
    (
        "hull hits per cause",
        7,
        lambda s, t: _set_hits(s, "bullet", "plating", 2),
        "HULL_HIT bullet",
    ),
    (
        "hull hit in another cause",
        7,
        lambda s, t: _set_hits(s, "beam", "plating", 1),
        "HULL_HIT beam",
    ),
    ("hull hit total", 7, lambda s, t: _set_hits(s, "bullet", "plating", 0), "HULL_HIT total"),
    ("life loss per cause", 7, lambda s, t: _set_hits(s, "rock", "life", 0), "LIFE_LOST rock"),
    ("life loss total", 6, lambda s, t: _set_hits(s, "beam", "life", 2), "LIFE_LOST total"),
    ("death cause", 7, lambda s, t: s["damage"].update(deathCause="bullet"), "RUN_LOST cause"),
    ("bonus lives", 7, lambda s, t: s["pacing"].update(bonusLives=1), "BONUS_LIFE awarded"),
    ("lives path", 7, lambda s, t: s["pacing"]["end"].update(lives=1), "lives and hull arithmetic"),
    ("hull path", 7, lambda s, t: s["pacing"]["start"].update(hull=0), "lives and hull arithmetic"),
    ("hull end", 2, lambda s, t: s["pacing"]["end"].update(hull=0), "lives and hull arithmetic"),
    ("plating up", 2, lambda s, t: s["powerUps"]["collected"].update(hull=2), "PLATING_UP"),
    ("pickup", 7, lambda s, t: s["powerUps"]["collected"].update(bomb=0), "PICKUP bomb"),
    ("buff end", 7, lambda s, t: s["powerUps"]["expired"].update(shield=0), "BUFF_END shield"),
    (
        "carrier stage t",
        6,
        lambda s, t: s["carrier"]["stageReachedMs"].update(finalStand=31_000),
        "CARRIER_STAGE finalStand t",
    ),
    (
        "carrier stage absent",
        6,
        lambda s, t: s["carrier"]["stageReachedMs"].pop("exposed"),
        "CARRIER_STAGE exposed t",
    ),
    ("rout t", 2, lambda s, t: s["rout"].update(atMs=36_000), "ROUT t"),
    ("rout not triggered", 2, lambda s, t: s["rout"].update(triggered=False), "ROUT t"),
    ("terminal t", 7, lambda s, t: s["pacing"].update(durationMs=31_500), "terminal t"),
    (
        "carrier down without a kill",
        2,
        lambda s, t: s["combat"]["kills"].pop("Carrier"),
        "CARRIER_DOWN",
    ),
]


@pytest.mark.parametrize(("label", "wave", "fn", "check"), CASES, ids=[c[0] for c in CASES])
def test_targeted_mutation_fails_with_a_clear_message(label, wave, fn, check):
    events = _mutate(wave, fn)
    failed = _failed(events, wave)
    assert any(f.startswith(check) for f in failed), (label, failed)
    assert all(": " in f and not f.endswith(": ") for f in failed)  # each says what disagrees
    # ... and it is printed, not fatal
    assert f"FAIL {check}" in "\n".join(replay.render(events))


def test_timeline_side_mutation_fails_too():
    def drop_life(_s, t):
        t["e"][3][4] = 0  # the rock hit now claims lives 0 while 1 remain

    failed = _failed(_mutate(7, drop_life), 7)
    assert any("lives and hull arithmetic: 18.7s LIFE_LOST says lives 0" in f for f in failed)


def test_lethal_blow_must_be_the_last_hit_of_a_died_wave():
    def reorder(_s, t):
        t["e"][6] = [301, 1, 3, 29, 0]  # the fatal blow is recorded as a plating hit

    failed = _failed(_mutate(7, reorder), 7)
    assert any(f.startswith("last hit is the lethal LIFE_LOST") for f in failed)


def test_a_clean_wave_in_a_broken_run_still_passes():
    events = _mutate(7, lambda s, t: s["damage"].update(deathCause="bullet"))
    assert _failed(events, 2) == [] and _failed(events, 6) == []


# --------------------------------------------------------------------- ovf weakening


def test_damage_ovf_weakens_hit_counts_to_at_most():
    def lose_hull_hit(s, t):
        t["e"].pop(2)  # the HULL_HIT was refused
        t["ovf"][0] = 1

    # without ovf the missing entry is a failure ...
    plain = _mutate(7, lambda s, t: t["e"].pop(2))
    assert any(f.startswith("HULL_HIT bullet") for f in _failed(plain, 7))
    # ... with ovf[0] > 0 it is "at most", so it holds
    events = _mutate(7, lose_hull_hit)
    wave = _wave(events, 7)
    assert _failed(events, 7) == []
    names = [c.name for c in wave.checks]
    assert "HULL_HIT bullet (at most, ovf[0] damage=1)" in names
    assert any("not checkable" in n for n in names)  # lives/hull path cannot be verified


def test_at_most_still_fails_when_the_timeline_exceeds_the_summary():
    def too_many(s, t):
        t["ovf"][0] = 3
        _set_hits(s, "bullet", "plating", 0)

    failed = _failed(_mutate(7, too_many), 7)
    assert any(f.startswith("HULL_HIT bullet (at most") and "more than" in f for f in failed)


def test_death_cause_still_checked_under_damage_ovf():
    def lose_lethal(s, t):
        t["ovf"][0] = 1
        t["e"][-2] = [301, 1, 3, 29, 0]  # last hit is no longer the lethal LIFE_LOST

    events = _mutate(7, lose_lethal)
    names = [c.name for c in _wave(events, 7).checks]
    assert "last hit is the lethal LIFE_LOST (not required, ovf[0] damage=1)" in names


def test_powerup_ovf_weakens_pickups_and_buff_ends():
    def lose_shield(s, t):
        for i in (5, 4):  # BUFF_END shield, PICKUP shield
            t["e"].pop(i)
        t["ovf"][2] = 2

    events = _mutate(7, lose_shield)
    assert _failed(events, 7) == []
    names = [c.name for c in _wave(events, 7).checks]
    assert "PICKUP shield (at most, ovf[2] powerUp=2)" in names
    assert "BUFF_END shield (at most, ovf[2] powerUp=2)" in names
    plain = _mutate(7, lambda s, t: (t["e"].pop(5), t["e"].pop(4)))
    assert {"PICKUP shield", "BUFF_END shield"} <= {f.split(":")[0] for f in _failed(plain, 7)}


def test_plating_up_weakens_with_damage_ovf_not_powerup_ovf():
    def lose_plating(s, t):
        t["e"].pop(6)  # PLATING_UP in wave 2

    plain = _mutate(2, lose_plating)
    assert any(f.startswith("PLATING_UP") for f in _failed(plain, 2))

    def with_pu_ovf(s, t):
        lose_plating(s, t)
        t["ovf"][2] = 5

    assert any(f.startswith("PLATING_UP") for f in _failed(_mutate(2, with_pu_ovf), 2))

    def with_dmg_ovf(s, t):
        lose_plating(s, t)
        t["ovf"][0] = 1

    weakened = _mutate(2, with_dmg_ovf)
    assert not any(f.startswith("PLATING_UP") for f in _failed(weakened, 2))
    assert "PLATING_UP (at most, ovf[0] damage=1)" in [c.name for c in _wave(weakened, 2).checks]


def test_transition_ovf_allows_a_missing_carrier_stage_and_rout():
    def lose_transitions(s, t):
        t["e"] = [e for e in t["e"] if e[1] not in (11, 13)]
        t["ovf"][1] = 2

    plain = _mutate(2, lambda s, t: t.update(e=[e for e in t["e"] if e[1] not in (11, 13)]))
    assert {"CARRIER_STAGE exposed t", "ROUT t"} <= {f.split(":")[0] for f in _failed(plain, 2)}
    assert _failed(_mutate(2, lose_transitions), 2) == []


def test_ovf_is_shown_in_the_output():
    events = _mutate(7, lambda s, t: t["ovf"].__setitem__(0, 4))
    assert "ovf damage=4 transition=0 powerUp=0  (entries were refused" in "\n".join(
        replay.render(events)
    )


# ------------------------------------------------- orphan / missing / flagged / invalid


def test_orphan_timeline_is_decoded_printed_and_not_reconciled():
    events = [(n, d) for n, d in _fixture() if not (n == "wave_completed" and d["wave"] == 6)]
    wave = _wave(events, 6)
    assert wave.summary is None and wave.timeline is not None and wave.checks == []
    text = "\n".join(replay.render(events))
    assert "ORPHAN: orphan timeline: no matching wave_completed, decoded but not reconciled" in text
    assert "29.8s  CARRIER_STAGE  -> finalStand" in text  # still decoded and printed
    assert "1 orphan timelines" in text


def test_timeline_with_the_wrong_outcome_is_an_orphan():
    events = _fixture()
    _summary(events, 7)["outcome"] = "cleared"
    assert _wave(events, 7).timeline is None or _wave(events, 7).summary is None


def test_missing_timeline_is_advisory_for_died_and_damaged_cleared_waves():
    events = [(n, d) for n, d in _fixture() if n != "wave_timeline"]
    waves, _ = replay.analyze(events)
    noted = {w.wave: w.note for w in waves}
    assert noted[7].startswith("no timeline (advisory")
    assert noted[2].startswith("no timeline (advisory")  # damaged cleared
    assert noted[6].startswith("no timeline (advisory")
    assert noted[1] == noted[3] == noted[4] == noted[5] == ""  # undamaged cleared: nothing to say
    assert all(w.checks == [] for w in waves)  # advisory only, never a failed check
    text = "\n".join(replay.render(events))
    assert "3 without a timeline (advisory)" in text and "0 failed checks" in text


def test_flagged_rows_are_labelled():
    events = _fixture()
    tl = _tl(events, 2)
    tl["_flags"] = ["unknown_code", "quota", "duplicate_entry"]
    tl["e"].insert(5, [270, 99, 1, 2])
    _summary(events, 2)["_flags"] = ["score_mismatch"]
    text = "\n".join(replay.render(events))
    assert "FLAGGED wave_timeline row: unknown_code, quota, duplicate_entry" in text
    assert "FLAGGED wave_completed row: score_mismatch" in text
    assert "UNKNOWN_99" in text and "raw [270, 99, 1, 2]" in text
    assert "older than the app" in text


def test_invalid_timeline_entry_is_flagged_and_not_reconciled():
    events = _fixture()
    _tl(events, 7)["e"][2] = [160, 1, 0, 99, 0]  # x out of range
    wave = _wave(events, 7)
    assert wave.problem == "e.2.3" and wave.checks == []
    text = "\n".join(replay.render(events))
    assert "INVALID timeline row (first fault at e.2.3); not reconciled" in text
    assert "INVALID entry [160, 1, 0, 99, 0]" in text


def test_unreadable_timeline_rows_are_listed_separately():
    events = _fixture()
    broken = copy.deepcopy(_tl(events, 7))
    del broken["wave"]
    events.append(("wave_timeline", broken))
    events.append(("wave_timeline", "not an object"))
    waves, unreadable = replay.analyze(events)
    assert len(unreadable) == 2 and len(waves) == 7
    text = "\n".join(replay.render(events))
    assert "INVALID wave_timeline row, not decoded (first fault at wave)" in text
    assert "INVALID wave_timeline row, not decoded (payload is not an object)" in text
    assert "2 invalid timeline rows" in text


def test_dev_wave_is_labelled_decoded_and_not_checked():
    events = _fixture()
    _summary(events, 7)["dev"] = True
    _tl(events, 7)["dev"] = True
    _summary(events, 7)["damage"]["deathCause"] = "bullet"  # would fail if it were checked
    wave = _wave(events, 7)
    assert wave.dev and wave.checks == []
    assert "wave 7 died  [dev wave: decoded, not checked]" in "\n".join(replay.render(events))


def test_no_starswarm_wave_events():
    assert (
        replay.render([("game_started", {})])[-1] == "  no wave_completed or wave_timeline events"
    )


# --------------------------------------------------------------------------- output


def test_wave_7_death_answers_when_where_how():
    text = "\n".join(replay.render(_fixture()))
    wave7 = text[text.index("wave 7 died") :]
    lines = [ln.strip() for ln in wave7.splitlines()]
    assert "SUMMARY (wave_completed, authoritative)" in lines
    assert "TIMELINE (sampled diagnostic, not a replay)" in lines
    assert lines.index("SUMMARY (wave_completed, authoritative)") < lines.index(
        "TIMELINE (sampled diagnostic, not a replay)"
    )
    # when, where and how the plating went, then the lives, in order
    hull = lines.index("16.0s  HULL_HIT       bullet  x=12/63  hull 1 -> 0")
    rock = lines.index("18.7s  LIFE_LOST      rock  x=50/63  lives 2 -> 1")
    ram = lines.index("30.1s  LIFE_LOST      ram  x=29/63  lives 1 -> 0  (lethal blow)")
    lost = lines.index("30.1s  RUN_LOST       cause ram")
    assert hull < rock < ram < lost
    assert "9.5s  PICKUP         bomb" in lines
    assert (
        "21.4s  PICKUP         shield" in lines and "26.4s  BUFF_END       shield ran out" in lines
    )
    assert "lives 2 -> 0  hull 1 -> 0  bonus lives 0" in lines
    assert "hits: bullet plating 1, rock life 1, ram life 1  deathCause: ram" in lines
    assert "RECONCILIATION: 26/26 checks hold" in lines


def test_output_has_the_disclaimer_and_never_claims_a_replay():
    text = "\n".join(replay.render(_fixture()))
    assert replay.DISCLAIMER in text
    assert "not a frame-by-frame or projectile replay" in text
    assert "rebuilt" not in text.lower() and "reconstruct" not in text.lower().replace(
        "cannot rebuild", ""
    )


def test_render_makes_no_network_calls(monkeypatch):
    def refuse(*_a, **_k):
        raise AssertionError("network access")

    monkeypatch.setattr(socket.socket, "connect", refuse)
    monkeypatch.setattr(socket, "create_connection", refuse)
    monkeypatch.setattr(socket, "getaddrinfo", refuse)
    assert "wave 7 died" in "\n".join(replay.render(_fixture()))


# ---------------------------------------------------------- replay_game.py integration


def _script():
    spec = importlib.util.spec_from_file_location("replay_game_sw", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    sys.modules["replay_game_sw"] = module
    spec.loader.exec_module(module)
    return module


def test_replay_game_report_includes_the_starswarm_section():
    rg = _script()
    rows = [rg.EventRow(i, n, None, d) for i, (n, d) in enumerate(_fixture())]
    game = rg.GameRow(uuid.uuid4(), "starswarm", None, None, "died", 22900, 30150, {})
    out = rg.render(game, rows)
    assert "starswarm waves: summaries and sampled timelines (#3395)" in out
    assert "30.1s  LIFE_LOST      ram  x=29/63  lives 1 -> 0  (lethal blow)" in out
    assert out.index("summary\n") < out.index("starswarm waves:")


def test_replay_game_leaves_other_games_alone():
    rg = _script()
    game = rg.GameRow(uuid.uuid4(), "hearts", None, None, None, None, None, {})
    assert "starswarm waves" not in rg.render(game, [])
