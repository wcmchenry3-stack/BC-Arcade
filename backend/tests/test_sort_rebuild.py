"""sort/rebuild.py (#3388, epic #3383): a Sort level rebuilt from its recorded events.

A hand-built catalog and run pins the golden behaviour (a multi-unit pour, a
partial-capacity pour, an undo, a hint, a rewind and a win), each way a log can
be wrong gets its verdict, and the pour rules are held equal to the independent
reference simulator in ``scripts/sort_verify_levels.py`` on the real catalog.
"""

from __future__ import annotations

import copy
import random
import sys
from pathlib import Path
from typing import Any

import pytest

from sort.catalog import CATALOG_VERSION
from sort.fast_solver import solve
from sort.generate_levels import SOLVER_BUDGET
from sort.rebuild import (
    COMPLETE,
    INCOMPLETE,
    INVALID,
    load_catalog,
    rebuild,
    render,
)

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import sort_build_catalog as build
from sort_verify_levels import _apply, _moves, _solved

# Level 1 of this catalog (depth 4), bottles 0..4:
#   0 red red red   1 blue red red   2 red red red   3 blue blue blue   4 (empty)
CATALOG: dict[str, Any] = {
    "version": 7,
    "seed": 0,
    "legend": ["red", "blue"],
    "levels": [["AAA,BAA,AAA,BBB,", 9]],
}

STARTED = {"level": 1, "catalog": 7, "engine_version": 1}
ENDED = {"level": 1, "moves": 4, "undos": 3, "won": True}

GOLDEN_UNITS = [
    # 1: red x2 into the empty bottle; a hint; red x1 (a partial pour: 2 on top, room 1);
    # an undo; the same pour again
    [[0, 1, 4], [2, 1, 3], [0, 4, 0], [1], [0, 4, 0]],
    # 2: the last red; back to last good move x2; the red again, then the last blue
    [[0, 4, 2], [3, 2], [0, 4, 0], [0, 4, 2], [0, 1, 3]],
]


def moves_event(unit: int, actions: list[Any], **extra: Any) -> tuple[str, dict[str, Any]]:
    return "moves", {"v": 1, "unit": unit, "t_ms": unit * 1000, "m": actions, **extra}


def log(
    units: list[list[Any]] | None = None,
    started: dict[str, Any] | None = STARTED,
    ended: dict[str, Any] | None = ENDED,
) -> list[tuple[str, Any]]:
    events: list[tuple[str, Any]] = []
    if started is not None:
        events.append(("game_started", started))
    events += [
        moves_event(i + 1, u) for i, u in enumerate(GOLDEN_UNITS if units is None else units)
    ]
    if ended is not None:
        events.append(("game_ended", ended))
    return events


def run(events: list[tuple[str, Any]]):
    return rebuild(events, CATALOG)


def flags(r) -> list[str]:
    return [f.kind for f in r.flags]


# -- the golden run ------------------------------------------------------------


def test_golden_run_reconstructs_exactly_and_is_complete() -> None:
    r = run(log())
    assert r.verdict == COMPLETE and r.flags == []
    assert [
        (s.kind, s.src, s.dst, s.color, s.units, s.moves, s.undos, s.solved) for s in r.steps
    ] == [
        ("pour", 1, 4, "red", 2, 1, 0, False),  # the whole top run
        ("hint", 1, 3, "blue", 0, 1, 0, False),  # the board does not change
        ("pour", 4, 0, "red", 1, 2, 0, False),  # run of 2, room for 1
        ("undo", None, None, None, 0, 1, 1, False),
        ("pour", 4, 0, "red", 1, 2, 1, False),
        ("pour", 4, 2, "red", 1, 3, 1, False),
        ("rewind", None, None, None, 2, 1, 3, False),
        ("pour", 4, 0, "red", 1, 2, 3, False),
        ("pour", 4, 2, "red", 1, 3, 3, False),
        ("pour", 1, 3, "blue", 1, 4, 3, True),
    ]
    assert [s.n for s in r.steps] == list(range(1, 11))
    assert [s.unit for s in r.steps] == [1] * 5 + [2] * 5
    assert r.bottles == [["red"] * 4, [], ["red"] * 4, ["blue"] * 4, []]
    assert (r.moves, r.undos, r.solved, r.level, r.catalog) == (4, 3, True, 1, 7)
    assert r.opening == [["red"] * 3, ["blue", "red", "red"], ["red"] * 3, ["blue"] * 3, []]


def test_golden_run_prints_each_step_readably() -> None:
    text = "\n".join(render(run(log())))
    for line in (
        "#1 pour 1→4  red ×2  moves 1 undos 0",
        "#2 hint 1→3  (blue)",
        "#3 pour 4→0  red ×1  moves 2 undos 0",
        "#4 undo  moves 1 undos 1",
        "#7 back to last good move ×2  moves 1 undos 3",
        "#10 pour 1→3  blue ×1  moves 4 undos 3  SOLVED",
        "solved  yes   moves 4   undos 3",
        "verdict complete:",
    ):
        assert line in text


def test_an_abandoned_level_with_matching_counts_is_complete() -> None:
    ended = {"level": 1, "moves": 1, "undos": 0, "won": False}
    r = run(log([[[0, 1, 4]]], ended=ended))
    assert r.verdict == COMPLETE and not r.solved


def test_a_level_with_no_actions_and_no_moves_is_complete() -> None:
    ended = {"level": 1, "moves": 0, "undos": 0, "won": False}
    assert run(log([], ended=ended)).verdict == COMPLETE


# -- tampered, gapped, truncated -----------------------------------------------


@pytest.mark.parametrize(
    "action",
    [[0, 0, 3], [0, 4, 0], [0, 3, 0]],
    ids=["colour clash", "pour from empty", "pour into a different colour"],
)
def test_an_illegal_pour_is_invalid(action: list[int]) -> None:
    r = run(log([[action]]))
    assert r.verdict == INVALID and flags(r) == ["illegal_pour"]
    assert r.steps == []  # reading stops at the first illegal action
    assert "illegal pour" in r.reason


def test_a_pour_into_a_full_bottle_is_invalid() -> None:
    r = run(log([[[0, 1, 4], [0, 4, 0], [0, 2, 0]]]))  # bottle 0 is full after the second
    assert r.verdict == INVALID and flags(r) == ["illegal_pour"] and len(r.steps) == 2


def test_a_step_after_the_illegal_one_is_not_applied() -> None:
    r = run(log([[[0, 1, 4], [0, 0, 3], [0, 4, 0]]]))
    assert r.verdict == INVALID
    assert [s.n for s in r.steps] == [1]


def test_undo_and_rewind_past_the_start_are_invalid() -> None:
    for action in ([1], [3, 1]):
        r = run(log([[action]]))
        assert r.verdict == INVALID and flags(r) == ["undo_past_start"]
    r = run(log([[[0, 1, 4], [3, 2]]]))
    assert r.verdict == INVALID and "rewind of 2 past the start" in r.reason


@pytest.mark.parametrize(
    "action",
    [
        [0, 1],
        [9],
        [],
        [0, True, 2],
        [0, 1.0, 2],
        [0, "1", 2],
        [0, 1, 1],
        [0, 1, 16],
        [3, 0],
        [1, 1],
        "x",
    ],
)
def test_a_malformed_action_is_invalid(action: Any) -> None:
    r = run(log([[action]]))
    assert r.verdict == INVALID and flags(r) == ["malformed_action"]


def test_a_bottle_index_off_this_board_is_invalid() -> None:
    for action in ([0, 1, 9], [2, 9, 1]):
        r = run(log([[action]]))
        assert r.verdict == INVALID and "off the board" in r.reason


def test_a_non_integer_envelope_version_is_invalid() -> None:
    for v in (True, 1.0, "1"):
        data = {"v": v, "unit": 1, "m": [[0, 1, 4]]}
        r = run([("game_started", STARTED), ("moves", data), ("game_ended", ENDED)])
        assert r.verdict == INVALID and flags(r) == ["malformed_action"]


def test_a_bad_envelope_is_invalid() -> None:
    for data in (
        {"v": 2, "unit": 1, "m": []},
        {"v": 1, "unit": 0, "m": []},
        {"v": 1, "unit": 1, "m": 3},
    ):
        r = run([("game_started", STARTED), ("moves", data), ("game_ended", ENDED)])
        assert r.verdict == INVALID and flags(r) == ["malformed_action"]


def test_a_missing_unit_is_a_gap_and_incomplete() -> None:
    events = log()
    del events[1]  # unit 1
    r = run(events)
    assert r.verdict == INCOMPLETE and flags(r) == ["gap"]
    assert "unit 1 missing" in r.reason and r.steps == []
    events = [("game_started", STARTED), moves_event(1, [[0, 1, 4]]), moves_event(4, [[0, 4, 0]])]
    r = run(events)
    assert r.verdict == INCOMPLETE and "unit 2-3 missing" in r.reason and len(r.steps) == 1


def test_a_duplicated_unit_is_invalid() -> None:
    events = log()
    events.insert(2, events[1])
    r = run(events)
    assert r.verdict == INVALID and flags(r) == ["duplicate_unit"]
    assert len(r.steps) == 5  # unit 1 once


def test_restarted_unit_numbers_are_invalid() -> None:
    events = [("game_started", STARTED), moves_event(1, [[0, 1, 4]]), moves_event(2, [[1]])]
    events.append(moves_event(1, [[0, 1, 4]]))
    r = run(events)
    assert r.verdict == INVALID and flags(r) == ["restarted_unit"]


def test_a_split_unit_reads_as_one_and_missing_or_wrong_parts_are_flagged() -> None:
    parts = [
        moves_event(1, [[0, 1, 4], [2, 1, 3]], part=0, parts=2),
        moves_event(1, [[0, 4, 0]], part=1, parts=2),
    ]
    ok = run([("game_started", STARTED), *parts, moves_event(2, [[1]])])
    assert ok.verdict == INCOMPLETE and flags(ok) == ["truncated"]  # no game_ended, nothing else
    assert [s.n for s in ok.steps] == [1, 2, 3, 4]

    lost_last = run([("game_started", STARTED), parts[0], ("game_ended", ENDED)])
    assert lost_last.verdict == INCOMPLETE and "part 1 of 2 is missing" in lost_last.reason
    lost_middle = run([("game_started", STARTED), parts[0], moves_event(2, [[1]])])
    assert lost_middle.verdict == INCOMPLETE and flags(lost_middle) == ["gap"]
    lost_first = run([("game_started", STARTED), parts[1]])
    assert lost_first.verdict == INCOMPLETE and "parts before 1" in lost_first.reason
    out_of_order = run(
        [("game_started", STARTED), parts[0], moves_event(1, [[0, 4, 0]], part=0, parts=2)]
    )
    assert out_of_order.verdict == INVALID and flags(out_of_order) == ["bad_parts"]
    for extra in (
        {"part": 0},
        {"part": 2, "parts": 2},
        {"part": True, "parts": 2},
        {"part": 0, "parts": 1},
    ):
        bad = run([("game_started", STARTED), moves_event(1, [[0, 1, 4]], **extra)])
        assert bad.verdict == INVALID


def test_a_log_with_no_game_ended_is_truncated_and_incomplete() -> None:
    r = run(log(ended=None))
    assert r.verdict == INCOMPLETE and flags(r) == ["truncated"]
    assert len(r.steps) == 10 and r.solved  # what was read still prints


def test_a_cut_off_log_is_incomplete_against_game_ended() -> None:
    r = run(log(GOLDEN_UNITS[:1]))  # the cap, or a lost last batch: unit 2 never arrived
    assert r.verdict == INCOMPLETE and flags(r) == ["truncated", "truncated", "truncated"]
    assert r.reason == "log reaches 1 of 3 undos (cut off, or past the cap)"
    assert [f.message for f in r.flags[1:]] == [
        "log reaches 2 moves, game_ended says 4 (cut off, or past the cap)",
        "log stops before the winning move",
    ]


def test_a_prefix_with_more_moves_but_fewer_undos_is_incomplete_not_invalid() -> None:
    # moves go back down on an undo, so only undos tell a prefix: this log has 2 moves and
    # 1 undo, the final result 1 move and 3 undos, and it is not solved
    ended = {"level": 1, "moves": 1, "undos": 3, "won": True}
    r = run(log(GOLDEN_UNITS[:1], ended=ended))
    assert r.verdict == INCOMPLETE and all(f.effect == INCOMPLETE for f in r.flags)
    assert r.reason == "log reaches 1 of 3 undos (cut off, or past the cap)"
    assert "log stops before the winning move" in [f.message for f in r.flags]
    # the same moves with undos equal or higher is a contradiction
    ended = {"level": 1, "moves": 1, "undos": 1, "won": False}
    assert run(log(GOLDEN_UNITS[:1], ended=ended)).verdict == INVALID


def test_an_abandon_without_undos_and_a_lost_undo_is_incomplete_not_invalid() -> None:
    # Codex on #3874: an abandon sends {won: false, level, moves} and no undos. Two pours were
    # recorded, the last chunk (one undo) was lost: the log shows 2 moves, the result 1.
    # Without an undo count that is a possible prefix, not a contradiction.
    ended = {"level": 1, "moves": 1, "won": False}
    r = run(log([[[0, 1, 4], [0, 4, 0]]], ended=ended))
    assert r.verdict == INCOMPLETE and flags(r) == ["truncated"]
    assert r.reason == "log reaches 2 moves, game_ended says 1 (cut off, or past the cap)"


def test_a_dropped_middle_part_is_a_gap_not_invalid() -> None:
    # Codex on #3874: part 0 then part 2 of a three-part unit is a clean prefix with a hole
    r = run(
        [
            ("game_started", STARTED),
            moves_event(1, [[0, 1, 4]], part=0, parts=3),
            moves_event(1, [[1]], part=2, parts=3),
            ("game_ended", ENDED),
        ]
    )
    assert r.verdict == INCOMPLETE and flags(r)[0] == "gap"
    assert r.reason == "unit 1: part 1 of 3 is missing"
    assert [s.kind for s in r.steps] == ["pour"]  # nothing after the hole is applied


@pytest.mark.parametrize(
    ("ended", "text"),
    [
        ({"level": 1, "moves": 3, "undos": 3, "won": True}, "4 moves, game_ended says 3"),
        ({"level": 1, "moves": 4, "undos": 2, "won": True}, "3 undos, game_ended says 2"),
        ({"level": 1, "moves": 4, "undos": 3, "won": False}, "says not won"),
        ({"level": 2, "moves": 4, "undos": 3, "won": True}, "level 2"),
    ],
)
def test_a_result_the_log_contradicts_is_invalid(ended: dict[str, Any], text: str) -> None:
    r = run(log(ended=ended))
    assert r.verdict == INVALID and flags(r) == ["mismatch"] and text in r.reason


def test_won_but_the_board_is_not_solved_is_invalid() -> None:
    ended = {"level": 1, "moves": 1, "undos": 0, "won": True}
    r = run(log([[[0, 1, 4]]], ended=ended))
    assert r.verdict == INVALID and "not solved" in r.reason


def test_result_fields_the_game_did_not_send_are_not_compared() -> None:
    assert run(log(ended={"won": True})).verdict == COMPLETE
    abandon = {"level": 1, "moves": 1, "won": False}  # an abandon sends no undos
    assert run(log([[[0, 1, 4]]], ended=abandon)).verdict == COMPLETE


def test_a_game_ended_with_no_result_is_incomplete_not_complete() -> None:
    for ended in ({"outcome": "abandoned"}, {}, {"level": 1, "undos": 0}):
        r = run(log([[[0, 1, 4]]], ended=ended))
        assert r.verdict == INCOMPLETE
        assert r.reason == "game_ended has no result to check against"


def test_a_completed_outcome_needs_a_solved_board() -> None:
    r = run(log([[[0, 1, 4]]], ended={"outcome": "completed"}))
    assert r.verdict == INVALID and "not solved" in r.reason
    assert run(log(ended={"outcome": "completed"})).verdict == INCOMPLETE  # solved, but no result


# -- incompatible --------------------------------------------------------------


def test_a_different_catalog_version_is_incompatible_and_nothing_is_rebuilt() -> None:
    r = run(log(started={**STARTED, "catalog": 6}))
    assert r.verdict == INVALID and flags(r) == ["incompatible_catalog"]
    assert "incompatible catalog" in r.reason and r.opening is None and r.steps == []
    assert "incompatible catalog" in "\n".join(render(r))


def test_a_level_outside_the_catalog_is_incompatible() -> None:
    for level in (0, 2, "1", None, True):
        r = run(log(started={**STARTED, "level": level}))
        assert r.verdict == INVALID and flags(r) == ["incompatible_catalog"]


@pytest.mark.parametrize("engine", [2, 0, "1", None, True])
def test_a_different_engine_version_is_incompatible(engine: Any) -> None:
    r = run(log(started={**STARTED, "engine_version": engine}))
    assert r.verdict == INVALID and flags(r) == ["incompatible_engine"]
    assert "incompatible engine" in r.reason and r.steps == []


def test_a_game_with_no_game_started_is_invalid() -> None:
    r = run(log(started=None))
    assert r.verdict == INVALID and flags(r) == ["no_start"]


def test_an_unreadable_catalog_level_is_incompatible() -> None:
    broken = {**CATALOG, "levels": [["AZ,,", 1]]}
    r = rebuild(log(), broken)
    assert r.verdict == INVALID and flags(r) == ["incompatible_catalog"]


@pytest.mark.parametrize("entry", [[None, 1], [5, 1], [[], 1], [{"a": 1}, 1], None, 3])
def test_a_malformed_catalog_entry_is_incompatible_not_a_traceback(entry: Any) -> None:
    r = rebuild(log(), {**CATALOG, "levels": [entry]})
    assert r.verdict == INVALID and flags(r) == ["incompatible_catalog"]


def test_the_bottle_depth_is_the_solvers_and_the_apps() -> None:
    import re

    from sort import fast_solver
    from sort import rebuild as module

    types_ts = Path(__file__).resolve().parents[2] / "frontend/src/game/sort/types.ts"
    app = re.search(r"export const BOTTLE_DEPTH = (\d+);", types_ts.read_text())
    assert app is not None
    assert module.BOTTLE_DEPTH == fast_solver.DEPTH == int(app.group(1))


def test_client_supplied_values_are_printed_safely() -> None:
    r = run(log(started={**STARTED, "engine_version": "\x1b[31m" + "x" * 100}))
    assert "\x1b" not in r.reason and len(r.reason) < 200


# -- parity with the reference simulator, on the real catalog -------------------

_CATALOG = load_catalog()
assert _CATALOG is not None
REAL = {
    "level": 0,
    "catalog": CATALOG_VERSION,
    "engine_version": 1,
}


def _real_level(n: int) -> list[list[str]]:
    return build.decode(_CATALOG["levels"][n - 1][0])


def _events(n: int, actions: list[list[int]]) -> list[tuple[str, Any]]:
    return [
        ("game_started", {**REAL, "level": n}),
        *(
            moves_event(i + 1, actions[a : a + 25])
            for i, a in enumerate(range(0, len(actions), 25))
        ),
    ]


def test_the_shipped_catalog_is_the_one_this_reader_knows() -> None:
    assert _CATALOG["version"] == CATALOG_VERSION


@pytest.mark.parametrize("n", [1, 2, 8, 20, 37, 61, 84, 120])
def test_a_catalog_level_solution_agrees_with_the_reference_simulator_at_every_state(
    n: int,
) -> None:
    level = _real_level(n)
    result = solve(level, SOLVER_BUDGET)
    assert result.solvable is True and result.pours is not None
    actions = [[0, i, j] for i, j in result.pours]

    assert rebuild(_events(n, []), None).opening == level
    state = level
    for k, (i, j) in enumerate(result.pours, start=1):
        state = _apply(state, i, j)  # the reference
        r = rebuild(_events(n, actions[:k]), None)
        assert r.flags[0].kind == "truncated"  # no game_ended, nothing else wrong
        assert r.bottles == state, f"level {n}, pour {k}"
        assert (r.moves, r.undos) == (k, 0)
        assert r.solved == _solved(state)
    assert r.solved and _solved(state)
    ended = {"level": n, "moves": len(actions), "undos": 0, "won": True}
    assert rebuild([*_events(n, actions), ("game_ended", ended)], None).verdict == COMPLETE


@pytest.mark.parametrize("n", [1, 5, 20, 61, 120])
def test_every_pour_the_reference_calls_legal_is_legal_here_and_no_other(n: int) -> None:
    level = _real_level(n)
    legal = set(_moves(level))
    size = len(level)
    for i in range(size):
        for j in range(size):
            if i == j:
                continue
            r = rebuild(_events(n, [[0, i, j]]), None)
            assert (not any(f.kind == "illegal_pour" for f in r.flags)) == ((i, j) in legal)


@pytest.mark.parametrize("n", [3, 17, 45, 99])
def test_a_random_walk_with_undos_and_rewinds_agrees_with_the_reference(n: int) -> None:
    rng = random.Random(n)
    level = _real_level(n)
    state, trail = level, []  # trail: reference states before each standing pour
    actions: list[list[int]] = []
    undos = 0
    for _ in range(60):
        roll = rng.random()
        if roll < 0.15 and trail:
            state = trail.pop()
            actions.append([1])
            undos += 1
        elif roll < 0.25 and len(trail) >= 2:
            k = rng.randint(2, min(len(trail), 5))
            state = trail[-k]
            del trail[-k:]
            actions.append([3, k])
            undos += k
        else:
            options = _moves(state)
            if not options:
                continue
            i, j = rng.choice(options)
            trail.append(state)
            state = _apply(state, i, j)
            actions.append([0, i, j])
        r = rebuild(_events(n, actions), None)
        assert r.bottles == state
        assert (r.moves, r.undos, r.solved) == (len(trail), undos, _solved(state))
        assert not any(f.effect == INVALID for f in r.flags)


def test_the_catalog_decoder_matches_the_build_script_for_every_level() -> None:
    # decode_level mirrors catalog.ts; build.decode is the generator's own
    from sort.rebuild import decode_level

    for encoded, _par in _CATALOG["levels"]:
        assert decode_level(encoded, _CATALOG["legend"]) == build.decode(encoded)


def test_rebuild_does_not_modify_its_inputs() -> None:
    events = log()
    before = copy.deepcopy(events)
    run(events)
    assert events == before
