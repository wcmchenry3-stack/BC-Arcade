"""Star Swarm ``wave_timeline`` code table, limits and index lists vs the shared fixture (#3394).

``fixtures/starswarm_wave_timeline_v1.json`` is read by both sides: here the
backend's ``starswarm.timeline`` must equal it exactly; the app's
``waveTimeline.parity.test.ts`` (#3392) holds the TS table to the same file.
A code, range, limit or registry changed on one side only fails CI. Registry
index lists also have to agree with the ``wave_completed`` registries fixture.
"""

from __future__ import annotations

import json
from pathlib import Path

from starswarm import models, timeline

_DIR = Path(__file__).parent / "fixtures"
_FIXTURE = json.loads((_DIR / "starswarm_wave_timeline_v1.json").read_text(encoding="utf-8"))
_WAVE_REGISTRIES = json.loads(
    (_DIR / "starswarm_wave_stats_v1_registries.json").read_text(encoding="utf-8")
)["registries"]

_BACKEND_REGISTRIES = {
    "HIT_CAUSES": models.HIT_CAUSES,
    "POWERUP_TYPES": models.POWERUP_TYPES,
    "CARRIER_STAGES": models.CARRIER_STAGES,
    "KILL_METHODS": models.KILL_METHODS,
    "TIMELINE_PHASES": timeline.TIMELINE_PHASES,
}


def test_the_fixture_is_for_this_schema_version() -> None:
    assert _FIXTURE["v"] == timeline.WAVE_TIMELINE_VERSION == 1


def test_the_index_lists_equal_the_fixture() -> None:
    assert {k: list(v) for k, v in _BACKEND_REGISTRIES.items()} == _FIXTURE["registries"]


def test_the_shared_index_lists_equal_the_wave_stats_registries() -> None:
    for name, values in _FIXTURE["registries"].items():
        if name in _WAVE_REGISTRIES:
            assert values == _WAVE_REGISTRIES[name], name


def test_the_code_table_equals_the_fixture() -> None:
    backend = {
        code: {
            "code": code,
            "name": spec.name,
            "class": spec.cls,
            "arity": spec.arity,
            "params": [{"name": p.name, "min": p.lo, "max": p.hi} for p in spec.params],
        }
        for code, spec in timeline.CODES.items()
    }
    shared = {}
    for c in _FIXTURE["codes"]:
        params = [{k: p[k] for k in ("name", "min", "max")} for p in c["params"]]
        shared[c["code"]] = {**c, "params": params}
    assert backend == shared
    assert len(shared) == 12


def test_registry_backed_parameters_span_their_index_list() -> None:
    for c in _FIXTURE["codes"]:
        for p in c["params"]:
            registry = p.get("registry")
            if registry is None:
                continue
            n = len(_FIXTURE["registries"][registry])
            assert 0 <= p["min"] <= p["max"] <= n - 1, (c["name"], p["name"])
            # A parameter limited to a subset of its list says so. PHASE records the phase
            # entered (never SwoopIn, index 0); a stage is the one first reached (never
            # protected); pickups are indices 0..3 (salvage is not recorded, hull is
            # PLATING_UP) and a timed buff is lightning or shield.
            subset = {"PHASE", "CARRIER_STAGE", "PICKUP", "BUFF_END"}
            if (p["min"], p["max"]) != (0, n - 1):
                assert c["name"] in subset, (c["name"], p["name"])
    by_name = {c["name"]: c["params"][0] for c in _FIXTURE["codes"] if c["params"]}
    assert (by_name["PHASE"]["min"], by_name["PHASE"]["max"]) == (1, 3)
    assert (by_name["CARRIER_STAGE"]["min"], by_name["CARRIER_STAGE"]["max"]) == (1, 2)
    assert (by_name["PICKUP"]["min"], by_name["PICKUP"]["max"]) == (0, 3)
    assert (by_name["BUFF_END"]["min"], by_name["BUFF_END"]["max"]) == (0, 1)


def test_codes_are_unique_and_the_gaps_are_unassigned() -> None:
    codes = [c["code"] for c in _FIXTURE["codes"]]
    assert len(codes) == len(set(codes))
    for gap in (5, 6, 7, *range(14, 20), *range(22, 30)):
        assert gap not in timeline.CODES


def test_the_limits_equal_the_fixture() -> None:
    lim = _FIXTURE["limits"]
    assert lim["maxEntries"] == timeline.TIMELINE_MAX_ENTRIES == 32
    assert lim["ordinarySlots"] == timeline.TIMELINE_ORDINARY_SLOTS == 30
    assert lim["lethalSlot"] == 31 and lim["terminalSlot"] == 32
    assert lim["powerUpMax"] == timeline.TIMELINE_POWERUP_MAX == 8
    assert lim["transitionMax"] == timeline.TIMELINE_TRANSITION_MAX == 8
    assert lim["maxEventBytes"] == timeline.MAX_WAVE_TIMELINE_BYTES == 1024
    assert lim["tMax"] == timeline.MAX_TIME == 65535
    assert lim["ovfMax"] == 65535
    assert lim["evMax"] == timeline.MAX_ENGINE_VERSION == 65535
    assert lim["xMax"] == timeline.MAX_X == 63
    assert lim["unknownCodeMinLen"] == timeline.UNKNOWN_CODE_MIN_LEN == 2
    assert lim["unknownCodeMaxLen"] == timeline.UNKNOWN_CODE_MAX_LEN == 6
    assert lim["runMaxBytes"] == 16 * 1024 and lim["runMaxWaves"] == 64


def test_the_terminal_codes_are_the_ones_marked_terminal() -> None:
    terminal = {c["code"] for c in _FIXTURE["codes"] if c["class"] == "T"}
    assert terminal == {timeline.CODE_WAVE_CLEARED, timeline.CODE_RUN_LOST} == {8, 9}
