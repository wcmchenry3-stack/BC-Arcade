"""Replay payloads for the ingestion load test (#3400, epic #3273). No Locust import.

Builds whole games out of the backend's golden fixtures (``tests/fixtures/``), so
every event is a shape the server's own validators accept. ``tests/test_replay_load.py``
sends the same games through the TestClient: a fixture or validator change that makes
a payload invalid fails there, not only in a manual load run.

A game is ``game_started`` (index 0), replay events, ``game_ended``, cut into batches
of up to ``BATCH_SIZE`` events the way the app's queue flushes them. Sizes stay inside
each game type's cap (``games/replay_caps.py``); ``over_cap_game`` is the one plan that
deliberately goes over.
"""

from __future__ import annotations

import copy
import json
import random
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

FIXTURES = Path(__file__).resolve().parents[2] / "tests" / "fixtures"
BATCH_SIZE = 10  # events per POST /games/{id}/events (the server accepts up to 200)

# Share of games per type in the load mix (relative weights).
MIX: dict[str, int] = {
    "yacht": 3,
    "solitaire": 3,
    "blackjack": 2,
    "sudoku": 2,
    "starswarm": 2,
    "daily_word": 2,
}

# Daily Word's replay cap (``DAILY_WORD_CAP.max_events``); tests/test_replay_load.py
# checks it still matches.
DAILY_WORD_CAP_EVENTS = 4

_LIFECYCLE = frozenset({"game_started", "game_ended", "hand_resolved"})


@dataclass
class ReplayGame:
    game_type: str
    metadata: dict[str, Any]
    events: list[dict[str, Any]] = field(default_factory=list)  # in event_index order
    # Body of ``PATCH /games/{id}/complete``; a game's scoring may want a ``result``.
    complete: dict[str, Any] = field(
        default_factory=lambda: {"final_score": 100, "outcome": "completed", "duration_ms": 60_000}
    )

    def batches(self, size: int = BATCH_SIZE) -> list[list[dict[str, Any]]]:
        return [self.events[i : i + size] for i in range(0, len(self.events), size)]

    @property
    def replay_events(self) -> int:
        return sum(1 for e in self.events if e["event_type"] not in _LIFECYCLE)


def _fixture(name: str) -> Any:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def _assemble(
    game_type: str,
    metadata: dict[str, Any],
    started: dict[str, Any],
    replay: list[tuple[str, dict[str, Any]]],
) -> ReplayGame:
    rows = [("game_started", started), *replay, ("game_ended", {})]
    events = [
        {"event_index": i, "event_type": name, "data": copy.deepcopy(data)}
        for i, (name, data) in enumerate(rows)
    ]
    return ReplayGame(game_type, metadata, events)


def _yacht() -> ReplayGame:
    turns = [(e["type"], e["data"]) for e in _fixture("yacht_turn_events_v1.json")["events"]]
    return _assemble("yacht", {"mode": "vs", "difficulty": "hard"}, {}, turns)


def _solitaire() -> ReplayGame:
    fx = _fixture("solitaire_moves_v1.json")
    rows = []
    for i in range(12):  # a typical 300-action game is 12 rows (replay_caps.py)
        data = copy.deepcopy(fx["events"][i % len(fx["events"])])
        data.update(s=25 * i, unit=i + 1)
        rows.append(("moves", data))
    return _assemble("solitaire", {"draw_mode": fx["draw_mode"]}, {"seed": fx["seed"]}, rows)


def _blackjack() -> ReplayGame:
    run = _fixture("blackjack_replay_v1.json")
    game = _assemble("blackjack", {}, {}, [(e["type"], e["data"]) for e in run["events"]])
    game.complete = {
        "final_score": run["final_chips"],
        "outcome": "completed",
        "duration_ms": 60_000,
        "result": {
            "hands_won": 4,
            "hands_played": 6,
            "starting_chips": run["starting_chips"],
            "final_chips": run["final_chips"],
        },
    }
    return game


def _sudoku() -> ReplayGame:
    game = _fixture("sudoku_entries_v1.json")["classic_hard"]
    rows = [(e["type"], e["data"]) for e in game["events"]]
    meta = {"difficulty": game["game_started"]["difficulty"], "variant": "classic"}
    return _assemble("sudoku", meta, game["game_started"], rows)


def _starswarm() -> ReplayGame:
    wave = _fixture("starswarm_wave_stats_v1.json")
    rows = []
    for n in range(1, 21):  # a 20-wave run; the cap is 200 waves
        data = copy.deepcopy(wave)
        data["wave"] = n
        rows.append(("wave_completed", data))
    return _assemble("starswarm", {"difficulty_tier": "Captain"}, {}, rows)


def _daily_word() -> ReplayGame:
    game = _fixture("daily_word_guess_events_v1.json")["games"][0]
    meta = {"puzzle_id": game["puzzle"]["puzzle_id"], "language": game["puzzle"]["language"]}
    rows = [(e["type"], e["data"]) for e in game["events"]]
    return _assemble("daily_word", meta, {}, rows)


_BUILDERS = {
    "yacht": _yacht,
    "solitaire": _solitaire,
    "blackjack": _blackjack,
    "sudoku": _sudoku,
    "starswarm": _starswarm,
    "daily_word": _daily_word,
}


def build_game(game_type: str) -> ReplayGame:
    """One whole, in-cap game of ``game_type`` (one of ``MIX``)."""
    return _BUILDERS[game_type]()


def pick_game_type(rng: random.Random | None = None) -> str:
    return (rng or random).choices(list(MIX), weights=list(MIX.values()))[0]


def over_cap_game(extra: int = 4) -> ReplayGame:
    """A Daily Word game with ``extra`` more ``guess_submitted`` events than its cap holds.

    ``game_started`` / ``game_ended`` are lifecycle and not counted, so
    ``DAILY_WORD_CAP_EVENTS + extra`` replay events are stored as the cap and the rest
    dropped on a 2xx.
    """
    game = _daily_word()
    guess = game.events[1]
    game.events = [game.events[0]]
    for i in range(DAILY_WORD_CAP_EVENTS + extra):
        game.events.append({**copy.deepcopy(guess), "event_index": i + 1})
    game.events.append({"event_index": len(game.events), "event_type": "game_ended", "data": {}})
    return game
