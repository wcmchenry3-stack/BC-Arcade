"""2048 golden replay: the events a real seeded game produced (#3910, epic #3273).

``fixtures/twenty48_replay_v1.json`` holds the ``game_started`` data, the ``moves``
events and the final board and score of one seeded game played through the app's
real engine and GameRecorder (pinned by
``frontend/src/game/twenty48/__tests__/replay.fixture.test.ts``). A rejection of
one of these events here would drop a real game's replay, and a Python reader that
rebuilds the game from them must reach the same board and score.
"""

from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any

import pytest

from observability import report
from twenty48.models import MAX_MOVES_BYTES, MAX_MOVES_PER_EVENT
from twenty48.module import module as twenty48_module

_FIXTURE = Path(__file__).parent / "fixtures" / "twenty48_replay_v1.json"
_SIZE = 4

# Written out by hand, not read from the fixture: what the seeded game must end on.
_FINAL_BOARD = [4, 2, 32, 4, 32, 64, 4, 8, 4, 16, 2, 4, 2, 32, 8, 2]
_FINAL_SCORE = 768
_FINAL_MOVES = 99


def _game() -> dict[str, Any]:
    return json.loads(_FIXTURE.read_text(encoding="utf-8"))


def _slide_line(line: list[int]) -> tuple[list[int], int]:
    """One line towards index 0: tiles slide, equal neighbours merge once, per the rule."""
    tiles = [v for v in line if v]
    out: list[int] = []
    gained = 0
    i = 0
    while i < len(tiles):
        if i + 1 < len(tiles) and tiles[i] == tiles[i + 1]:
            out.append(tiles[i] * 2)
            gained += tiles[i] * 2
            i += 2
        else:
            out.append(tiles[i])
            i += 1
    return out + [0] * (_SIZE - len(out)), gained


def _slide(board: list[int], direction: int) -> tuple[list[int], int]:
    """``direction``: 0 up, 1 down, 2 left, 3 right. ``board`` is row-major."""
    out = list(board)
    gained = 0
    for i in range(_SIZE):
        if direction in (0, 1):
            idx = [k * _SIZE + i for k in range(_SIZE)]
        else:
            idx = [i * _SIZE + k for k in range(_SIZE)]
        if direction in (1, 3):
            idx.reverse()
        line, score = _slide_line([out[j] for j in idx])
        gained += score
        for j, v in zip(idx, line, strict=True):
            out[j] = v
    return out, gained


def _replay(game: dict[str, Any]) -> tuple[list[int], int, int]:
    """The opening board plus the ``moves`` events -> (final board, score, move count)."""
    board = list(game["game_started"]["initial_board"])
    score = 0
    count = 0
    for event in game["events"]:
        if event["type"] != "moves":
            continue
        for direction, cell, value, gained, total in event["data"]["m"]:
            board, got = _slide(board, direction)
            assert got == gained, (count, direction)
            assert board[cell] == 0 and value in (2, 4), (count, cell, value)
            board[cell] = value
            score += got
            assert score == total, count
            count += 1
    return board, score, count


@pytest.fixture(autouse=True)
def sent(monkeypatch: pytest.MonkeyPatch) -> list[tuple[str, dict[str, Any]]]:
    """Sentry messages, captured: a dropped event reports once, by reason only."""
    calls: list[tuple[str, dict[str, Any]]] = []
    monkeypatch.setattr(report.sentry_sdk, "capture_message", lambda m, **kw: calls.append((m, kw)))
    return calls


def test_the_fixture_is_a_whole_game_in_chunks() -> None:
    game = _game()
    events = game["events"]
    assert {e["type"] for e in events} == {"moves"}
    sizes = [len(e["data"]["m"]) for e in events]
    assert sizes == [25, 25, 25, 24]
    assert [e["data"]["unit"] for e in events] == [1, 2, 3, 4]
    assert len(game["game_started"]["initial_board"]) == _SIZE * _SIZE


def test_every_event_the_app_builds_validates_and_is_stored_as_sent(sent: list) -> None:
    for e in _game()["events"]:
        data = e["data"]
        assert twenty48_module.validate_event(e["type"], copy.deepcopy(data)) == data
        assert len(json.dumps(data, separators=(",", ":")).encode()) <= MAX_MOVES_BYTES
        assert len(data["m"]) <= MAX_MOVES_PER_EVENT
    assert sent == []


def test_game_started_is_the_opening_board_the_app_sends() -> None:
    data = _game()["game_started"]
    assert set(data) == {"initial_board", "engine_version"}
    assert data["engine_version"] == 1  # #3909
    assert twenty48_module.validate_event("game_started", copy.deepcopy(data)) == data
    board = data["initial_board"]
    assert sorted(v for v in board if v) in ([2, 2], [2, 4], [4, 4])  # two spawned tiles


def test_replaying_the_events_gives_the_hard_coded_final_board_and_score() -> None:
    board, score, count = _replay(_game())
    assert board == _FINAL_BOARD
    assert score == _FINAL_SCORE
    assert count == _FINAL_MOVES


def test_the_recorded_final_state_matches_the_replay() -> None:
    game = _game()
    board, score, count = _replay(game)
    assert game["final"] == {"board": board, "score": score, "moves": count}


def test_the_final_board_is_a_game_over() -> None:
    """No empty cell and no equal neighbours: no move is left."""
    board, _, _ = _replay(_game())
    assert 0 not in board
    for direction in range(4):
        assert _slide(board, direction)[0] == board


def test_the_replay_reader_notices_a_wrong_score() -> None:
    """The reader checks every move's points against the recorded ones."""
    tampered = copy.deepcopy(_game())
    tampered["events"][0]["data"]["m"][0][3] += 4
    with pytest.raises(AssertionError):
        _replay(tampered)
