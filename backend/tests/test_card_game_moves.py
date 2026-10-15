"""Solitaire and FreeCell ``moves`` events: the game modules' ``validate_event`` (#3289, epic #3273).

The app (``frontend/src/game/{solitaire,freecell}/replay.ts``) sends one ``moves``
event per chunk of up to 25 actions, each a small list of ints whose first number is
the kind, with the GameRecorder's envelope (``v``, ``unit``, ``t_ms``) and ``s``
(the index of the chunk's first action in the game). ``fixtures/solitaire_moves_v1.json``
and ``fixtures/freecell_moves_v1.json`` are the events the app recorded for scripted,
seeded won games (undo, hint, stock recycle and auto-complete included), so a
rejection here would drop a real game's replay.
"""

from __future__ import annotations

import copy
import importlib.util
import json
import re
import sqlite3
import uuid
from pathlib import Path
from typing import Any

import pytest

from freecell import models as freecell_models
from freecell.module import module as freecell_module
from games.registry import get_module
from games.replay_caps import DEFAULT_CAP, apply_cap, event_bytes
from observability import report
from solitaire import models as solitaire_models
from solitaire.module import module as solitaire_module
from tests._alembic_heads import BACKEND, script_heads
from tests._migration_helpers import Alembic

_FIXTURES = Path(__file__).parent / "fixtures"


def _fixture(name: str) -> dict[str, Any]:
    return json.loads((_FIXTURES / name).read_text(encoding="utf-8"))


SOLITAIRE = _fixture("solitaire_moves_v1.json")
FREECELL = _fixture("freecell_moves_v1.json")

# name -> (module, validate_moves)
GAMES = {
    "solitaire": (solitaire_module, solitaire_models.validate_moves),
    "freecell": (freecell_module, freecell_models.validate_moves),
}
EVENTS = {"solitaire": SOLITAIRE["events"], "freecell": FREECELL["events"]}
_REAL = {
    "solitaire": {"v": 1, "unit": 3, "t_ms": 91_234, "s": 50, "m": [[0], [6, 1, 4, 2], [7, 3]]},
    "freecell": {
        "v": 1,
        "unit": 3,
        "t_ms": 91_234,
        "s": 50,
        "m": [[1, 1, 2], [2, 3], [0, 5, 6, 2]],
    },
}


@pytest.fixture(autouse=True)
def sent(monkeypatch: pytest.MonkeyPatch) -> list[tuple[str, dict[str, Any]]]:
    """Sentry messages, captured. The drop throttles are reset so each test sees its own."""
    calls: list[tuple[str, dict[str, Any]]] = []
    monkeypatch.setattr(report.sentry_sdk, "capture_message", lambda m, **kw: calls.append((m, kw)))
    solitaire_models._drop_throttles.clear()
    freecell_models._drop_throttles.clear()
    return calls


def _with(game: str, **changes: Any) -> dict[str, Any]:
    data = copy.deepcopy(_REAL[game])
    data.update(changes)
    return data


both = pytest.mark.parametrize("game", sorted(GAMES))


@both
def test_the_module_checks_moves_and_passes_everything_else_through(game: str) -> None:
    module, _ = GAMES[game]
    assert get_module(game) is module
    assert module.validate_event("moves", copy.deepcopy(_REAL[game])) == _REAL[game]
    assert module.validate_event("moves", {}) is None
    assert module.validate_event("game_started", {"seed": 5, "engine_version": 1}) == {
        "seed": 5,
        "engine_version": 1,
    }
    assert module.validate_event("game_ended", {"a": 1}) == {"a": 1}


@both
def test_accepts_every_event_the_app_recorded_for_a_real_won_game(game: str) -> None:
    _, validate = GAMES[game]
    events = EVENTS[game]
    assert len(events) >= 5
    for data in events:
        assert validate(copy.deepcopy(data)) == data
    # the chunks follow each other: s is the index of each chunk's first action
    assert [e["s"] for e in events] == [
        sum(len(x["m"]) for x in events[:i]) for i in range(len(events))
    ]


def test_the_real_games_cover_every_kind_the_app_sends() -> None:
    sol = {a[0] % 16 for e in EVENTS["solitaire"] for a in e["m"]}
    assert {0, 1, 2, 3, 5, 6, 7} <= sol  # draw, recycle, undo, hint, to foundation, runs
    assert any(a[0] >= 16 for e in EVENTS["solitaire"] for a in e["m"])  # auto-complete
    fc = {a[0] % 16 for e in EVENTS["freecell"] for a in e["m"]}
    assert {0, 1, 3, 6, 7} <= fc
    assert any(a[0] >= 16 for e in EVENTS["freecell"] for a in e["m"])


@both
def test_accepts_a_partial_chunk_a_single_action_and_the_part_fields(game: str) -> None:
    _, validate = GAMES[game]
    assert validate(_with(game, m=_REAL[game]["m"][:1])) is not None
    assert validate(_with(game, part=0, parts=2)) is not None


# The longest action of each game, flagged as an auto-complete step where the game
# allows it, 25 of them, with the largest numbers the envelope can carry.
_WORST = {"solitaire": [22, 6, 5, 13], "freecell": [18, 7]}


@both
def test_accepts_the_largest_chunk_the_app_can_send(game: str) -> None:
    _, validate = GAMES[game]
    data = {"v": 1, "unit": 9_999, "t_ms": 7_200_000, "s": 247_000, "m": [_WORST[game]] * 25}
    module = solitaire_models if game == "solitaire" else freecell_models
    assert len(json.dumps(data, separators=(",", ":"))) <= module.MAX_MOVES_BYTES
    assert validate(data) == data


_SOLITAIRE_BAD = [
    pytest.param([15], id="unknown-kind"),
    pytest.param([9], id="kind-past-the-last"),
    pytest.param([24], id="auto-kind-past-the-last"),
    pytest.param([16 + 2], id="undo-is-never-auto"),
    pytest.param([16 + 3], id="hint-is-never-auto"),
    pytest.param([16 + 1], id="recycle-is-never-auto"),
    pytest.param([16 + 4, 0], id="waste-to-tableau-is-never-auto"),
    pytest.param([0, 1], id="draw-with-an-argument"),
    pytest.param([4], id="missing-argument"),
    pytest.param([4, 7], id="column-off-the-board"),
    pytest.param([6, 1, 2], id="short-run-move"),
    pytest.param([6, 1, 2, 3, 4], id="long-run-move"),
    pytest.param([6, 1, 2, 0], id="empty-run"),
    pytest.param([6, 1, 2, 14], id="run-longer-than-a-column-can-hold"),
    pytest.param([6, 3, 3, 1], id="column-onto-itself"),
    pytest.param([8, 4, 1], id="suit-off-the-list"),
    pytest.param([-1], id="negative-kind"),
    pytest.param([7, -1], id="negative-column"),
    pytest.param(["draw"], id="kind-name"),
    pytest.param([True], id="kind-true"),
    pytest.param([4, 0.5], id="fractional-column"),
    pytest.param([], id="empty-action"),
    pytest.param(None, id="null-action"),
    pytest.param(5, id="action-not-a-list"),
]

_FREECELL_BAD = [
    pytest.param([8], id="unknown-kind"),
    pytest.param([16 + 6], id="undo-is-never-auto"),
    pytest.param([16 + 7], id="hint-is-never-auto"),
    pytest.param([16, 1, 2, 1], id="tableau-to-tableau-is-never-auto"),
    pytest.param([16 + 1, 0, 0], id="free-cell-park-is-never-auto"),
    pytest.param([0, 1, 2], id="short-run-move"),
    pytest.param([0, 1, 8, 1], id="column-off-the-board"),
    pytest.param([0, 3, 3, 1], id="column-onto-itself"),
    pytest.param([0, 1, 2, 14], id="run-longer-than-a-column-can-hold"),
    pytest.param([1, 0, 4], id="cell-off-the-board"),
    pytest.param([3, 4, 0], id="cell-off-the-board-2"),
    pytest.param([5, 4, 1], id="suit-off-the-list"),
    pytest.param([6, 0], id="undo-with-an-argument"),
    pytest.param([-1], id="negative-kind"),
    pytest.param([True], id="kind-true"),
    pytest.param([], id="empty-action"),
    pytest.param(None, id="null-action"),
]


@pytest.mark.parametrize("bad", _SOLITAIRE_BAD)
def test_solitaire_rejects_a_malformed_action(bad: Any, sent: list) -> None:
    assert solitaire_models.validate_moves(_with("solitaire", m=[bad])) is None
    assert len(sent) == 1 and "invalid" in sent[0][0]


@pytest.mark.parametrize("bad", _FREECELL_BAD)
def test_freecell_rejects_a_malformed_action(bad: Any, sent: list) -> None:
    assert freecell_models.validate_moves(_with("freecell", m=[bad])) is None
    assert len(sent) == 1 and "invalid" in sent[0][0]


@both
@pytest.mark.parametrize(
    "change",
    [
        pytest.param({"v": 2}, id="unknown-version"),
        pytest.param({"v": True}, id="version-true"),
        pytest.param({"v": 1.0}, id="version-float"),
        pytest.param({"m": []}, id="empty-chunk"),
        pytest.param({"m": "LRUD"}, id="moves-not-a-list"),
        pytest.param({"unit": -1}, id="negative-unit"),
        pytest.param({"t_ms": -5}, id="negative-time"),
        pytest.param({"t_ms": "soon"}, id="time-not-a-number"),
        pytest.param({"s": -1}, id="negative-first-index"),
        pytest.param({"s": 2**31}, id="first-index-past-int32"),
        pytest.param({"extra": 1}, id="unknown-key"),
        pytest.param({"actor": {"seat": 0, "kind": "human"}}, id="actor-key"),
        pytest.param({"part": -1}, id="negative-part"),
        pytest.param({"parts": 0}, id="zero-parts"),
    ],
)
def test_rejects_a_malformed_envelope(game: str, change: dict[str, Any], sent: list) -> None:
    _, validate = GAMES[game]
    assert validate(_with(game, **change)) is None
    assert len(sent) == 1 and "invalid" in sent[0][0]


@both
@pytest.mark.parametrize("missing", ["v", "unit", "t_ms", "s", "m"])
def test_rejects_a_missing_field(game: str, missing: str) -> None:
    _, validate = GAMES[game]
    data = copy.deepcopy(_REAL[game])
    del data[missing]
    assert validate(data) is None


@both
def test_rejects_more_actions_than_a_chunk_can_hold(game: str) -> None:
    _, validate = GAMES[game]
    module = solitaire_models if game == "solitaire" else freecell_models
    assert (
        validate(
            _with(game, m=[[2 if game == "solitaire" else 6]] * (module.MAX_ACTIONS_PER_EVENT + 1))
        )
        is None
    )


@both
def test_rejects_an_oversized_payload_by_bytes(game: str, sent: list) -> None:
    _, validate = GAMES[game]
    module = solitaire_models if game == "solitaire" else freecell_models
    huge = _with(game, pad="x" * module.MAX_MOVES_BYTES)
    assert validate(huge) is None
    assert len(sent) == 1 and "oversize" in sent[0][0]


@both
def test_an_unserialisable_payload_is_dropped_not_raised(game: str) -> None:
    _, validate = GAMES[game]
    assert validate({"v": 1, "m": [object()]}) is None


@both
def test_drop_reports_carry_no_player_data(game: str, sent: list) -> None:
    _, validate = GAMES[game]
    bad = _with(game, m=[[99, 424_242]], unit=777)
    assert validate(bad) is None
    text = json.dumps(sent, default=str)
    assert "424242" not in text
    assert "777" not in text


@both
def test_drop_reports_are_throttled_per_reason(game: str, sent: list) -> None:
    """A bad build sending a bad chunk per game must not send a Sentry event per chunk."""
    _, validate = GAMES[game]
    for _ in range(50):
        assert validate(_with(game, v=2)) is None
    assert len(sent) == 1
    # a different reason has its own window
    assert validate(_with(game, pad="x" * 600)) is None
    assert len(sent) == 2


@both
def test_a_real_game_and_a_runaway_one_fit_the_per_game_cap_and_the_40_kb_plan(game: str) -> None:
    """Both games use ``DEFAULT_CAP`` (500 events / 160 KB). A real won game is a few KB; the
    most the app sends (its 20 KB session cap: 59 worst-case chunks) is under 40 KB stored."""
    real = [event_bytes(e) for e in EVENTS[game]]
    assert apply_cap(DEFAULT_CAP, 0, 0, real).dropped == 0
    assert sum(real) < 10_000
    worst = {"v": 1, "unit": 80, "t_ms": 3_600_000, "s": 1_975, "m": [_WORST[game]] * 25}
    runaway = [event_bytes(worst)] * 59
    assert apply_cap(DEFAULT_CAP, 0, 0, runaway).dropped == 0
    assert sum(runaway) < 40_000


def test_the_byte_cap_matches_the_apps_registry() -> None:
    ts = (
        BACKEND.parent / "frontend" / "src" / "game" / "_shared" / "eventQueueConfig.ts"
    ).read_text(encoding="utf-8")
    m = re.search(r"export const CARD_MOVES_MAX_BYTES\s*=\s*(\d+)\s*;", ts)
    assert m, "CARD_MOVES_MAX_BYTES not found in eventQueueConfig.ts"
    assert int(m.group(1)) == solitaire_models.MAX_MOVES_BYTES == freecell_models.MAX_MOVES_BYTES


# ---------------------------------------------------------------------------
# migration 0044
# ---------------------------------------------------------------------------

_REVISION = "0044_card_game_moves_events"
_SOLITAIRE_ID, _FREECELL_ID = 6, 11


def _revises() -> str:
    spec = importlib.util.spec_from_file_location(
        "m0044", BACKEND / "alembic" / "versions" / f"{_REVISION}.py"
    )
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    assert mod.revision == _REVISION
    return mod.down_revision


def _names(db_path: Path, game_type_id: int) -> list[str]:
    with sqlite3.connect(db_path) as conn:
        return [
            r[0]
            for r in conn.execute(
                "SELECT name FROM event_types WHERE game_type_id = ? ORDER BY name",
                (game_type_id,),
            )
        ]


def test_the_alembic_graph_has_a_single_head() -> None:
    assert len(script_heads()) == 1


def test_the_migration_adds_and_removes_only_the_two_moves_types(
    migration_db_path: Path, alembic: Alembic
) -> None:
    alembic("upgrade", _revises())
    before = {g: _names(migration_db_path, g) for g in (_SOLITAIRE_ID, _FREECELL_ID)}
    assert all("moves" not in names for names in before.values())

    alembic("upgrade", _REVISION)
    with sqlite3.connect(migration_db_path) as conn:
        rows = conn.execute(
            "SELECT game_type_id, display_name FROM event_types WHERE name = 'moves' "
            "AND game_type_id IN (6, 11) ORDER BY game_type_id"
        ).fetchall()
        # other games' event types are untouched: 2048's, Star Swarm's wave type
        others = conn.execute(
            "SELECT COUNT(*) FROM event_types WHERE name = 'moves' AND game_type_id NOT IN (6, 11)"
        ).fetchone()[0]
        # stored moves rows of both games, and a lifecycle row each, to prove the downgrade
        # clears the dependants and nothing else
        gids = {}
        for game in (_SOLITAIRE_ID, _FREECELL_ID):
            gid = uuid.uuid4().hex
            gids[game] = gid
            conn.execute(
                "INSERT INTO games (id, session_id, game_type_id, metadata) "
                "VALUES (?, 's', ?, '{}')",
                (gid, game),
            )
            for idx, name in ((0, "game_started"), (1, "moves")):
                type_id = conn.execute(
                    "SELECT id FROM event_types WHERE game_type_id = ? AND name = ?",
                    (game, name),
                ).fetchone()[0]
                conn.execute(
                    "INSERT INTO game_events (game_id, event_index, event_type_id, data) "
                    "VALUES (?, ?, ?, '{}')",
                    (gid, idx, type_id),
                )
    assert rows == [(_SOLITAIRE_ID, "Moves"), (_FREECELL_ID, "Moves")]
    assert others == 0
    for game in (_SOLITAIRE_ID, _FREECELL_ID):
        assert _names(migration_db_path, game) == sorted([*before[game], "moves"])

    alembic("downgrade", "-1")
    for game in (_SOLITAIRE_ID, _FREECELL_ID):
        assert _names(migration_db_path, game) == before[game]
    with sqlite3.connect(migration_db_path) as conn:
        assert conn.execute(
            "SELECT event_index FROM game_events ORDER BY game_id, event_index"
        ).fetchall() == [(0,), (0,)]
