"""Gameplay event-type contract: app registry <-> seeded ``event_types`` <-> validation (#3278).

``gameEventRegistry`` in ``frontend/src/game/_shared/eventQueueConfig.ts`` is the
one table of every event type each game sends. This test parses it (text, as
``test_migration_invariants`` parses the same file) and holds it equal to the
backend, per game, so an event type added on one side only fails CI:

* every registered type is seeded in ``event_types`` (Alembic migrations), or
  the backend answers ``400 unknown_event_type`` and the queue dead-letters it;
* every seeded type is registered, or the app's caps and priority never see it;
* every registered type has a validation decision: the game module's
  ``validate_event`` handles it (``VALIDATED``) or it is stored as sent on
  purpose (``STORED_AS_SENT``). Both lists are probed against the real module,
  so a validator added or removed without updating them fails too.

A real mismatch that cannot be fixed in the same change goes in ``KNOWN_GAPS``
with a tracking issue; a gap that has since been closed fails as stale.
Generalises the Star Swarm ``wave_completed`` payload parity (#3252,
``test_starswarm_wave_stats_parity.py``), which still checks that payload's
vocabulary. See docs/GAME-CONTRACT.md#adding-an-event-type.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest

from games.module_base import GameModuleBase
from games.registry import get_module
from tests.test_migration_invariants import _run_all_upgrades
from vocab import GameType

_TS = (
    Path(__file__).parent.parent.parent
    / "frontend"
    / "src"
    / "game"
    / "_shared"
    / "eventQueueConfig.ts"
)
_TS_NAME = "frontend/src/game/_shared/eventQueueConfig.ts"

Pair = tuple[str, str]  # (game, event type)

# Types the game module's ``validate_event`` checks. Each is probed: an empty
# payload must be rejected (``None``), so a type listed here is really validated.
VALIDATED: frozenset[Pair] = frozenset(
    {
        ("starswarm", "wave_completed"),
        ("twenty48", "moves"),
        ("yacht", "turn_completed"),
        ("solitaire", "moves"),
        ("freecell", "moves"),
    }
)

# Types stored exactly as sent, on purpose (the default ``validate_event``).
# Each is probed: a payload must come back unchanged, so adding a validator to
# one of these without moving it to VALIDATED fails.
# Not listed (and so unregistered here) = a new type must make this choice.
STORED_AS_SENT: frozenset[Pair] = frozenset(
    {
        # lifecycle events, every game (gameEventClient.startGame / completeGame)
        *((g.value, n) for g in GameType for n in ("game_started", "game_ended")),
        ("yacht", "roll"),
        ("yacht", "score"),
        # the per-swipe type older app builds still send (#3286: new builds send "moves")
        ("twenty48", "move"),
        ("blackjack", "bet_placed"),
        ("blackjack", "hand_dealt"),
        ("blackjack", "player_action"),
        ("blackjack", "hand_resolved"),
        ("cascade", "drop"),
        ("cascade", "merge"),
    }
)

SEEDED_NOT_REGISTERED = "seeded_not_registered"
REGISTERED_NOT_SEEDED = "registered_not_seeded"

# Known one-sided types, each with the direction of the mismatch it excuses (only
# that exact discrepancy is filtered) and the reason. Remove the entry when fixed.
KNOWN_GAPS: dict[tuple[str, str, str], str] = {
    # Seeded by 0017_add_daily_word_game_type but no screen sends it: the Daily
    # Word screen records only the lifecycle events.
    # TODO(#3287): Daily Word starts sending it and registers it in
    # gameEventRegistry; drop this entry then.
    ("daily_word", "guess_submitted", SEEDED_NOT_REGISTERED): "seeded, not in the app's registry",
}


# --- reading the app's registry ------------------------------------------------


def _block(text: str, open_at: int) -> tuple[str, int]:
    """The text inside the ``{...}`` opening at ``open_at``, and the index after it."""
    assert text[open_at] == "{"
    depth = 0
    for i in range(open_at, len(text)):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                return text[open_at + 1 : i], i + 1
    raise AssertionError("unbalanced braces in the registry")


def _members(body: str) -> dict[str, str]:
    """``name: { ... }`` members at the top level of ``body``, name -> inner text."""
    out: dict[str, str] = {}
    pos = 0
    while True:
        m = re.compile(r"\b(\w+)\s*:\s*\{").search(body, pos)
        if not m:
            return out
        inner, end = _block(body, m.end() - 1)
        out[m.group(1)] = inner
        pos = end


@dataclass(frozen=True)
class AppEvent:
    tier: str
    chunkable: bool


def parse_app_registry(text: str) -> dict[str, dict[str, AppEvent]]:
    """``gameEventRegistry`` as game -> event type -> (tier, chunkable)."""
    m = re.search(r"export const gameEventRegistry\b[^=]*=\s*\{", text)
    assert m, f"no `export const gameEventRegistry` in {_TS_NAME}"
    body, _ = _block(text, m.end() - 1)
    registry: dict[str, dict[str, AppEvent]] = {}
    for game, game_body in _members(body).items():
        em = re.search(r"\bevents\s*:\s*\{", game_body)
        assert em, f"{game} has no `events` object in gameEventRegistry"
        events_body, _ = _block(game_body, em.end() - 1)
        events: dict[str, AppEvent] = {}
        for name, spec in _members(events_body).items():
            tier = re.search(r"\btier\s*:\s*Priority\.(\w+)", spec)
            assert tier, f"{game}.{name} has no `tier: Priority.X` in gameEventRegistry"
            events[name] = AppEvent(tier.group(1), bool(re.search(r"\bchunkField\s*:", spec)))
        registry[game] = events
    return registry


# --- the contract ---------------------------------------------------------------


def contract_gaps(
    app: dict[str, dict[str, AppEvent]],
    seeded: dict[str, set[str]],
    games: set[str],
    validated: frozenset[Pair],
    stored_as_sent: frozenset[Pair],
    known_gaps: dict[tuple[str, str, str], str],
) -> list[str]:
    """Every way the app registry, the seeded rows and the validation lists disagree."""
    gaps: list[str] = []
    for game in sorted(games - set(app)):
        gaps.append(f"{game}: no entry in gameEventRegistry ({_TS_NAME})")
    for game in sorted(set(app) - games):
        gaps.append(f"{game}: in gameEventRegistry but not a backend GameType")

    found: set[tuple[str, str, str]] = set()
    for game in sorted(games & set(app)):
        registered, in_db = set(app[game]), seeded.get(game, set())
        for name in sorted(registered - in_db):
            found.add((game, name, REGISTERED_NOT_SEEDED))
            gaps.append(
                f"{game}.{name}: registered in the app but not seeded in event_types "
                "(add an Alembic migration; the server would 400 unknown_event_type)"
            )
        for name in sorted(in_db - registered):
            found.add((game, name, SEEDED_NOT_REGISTERED))
            gaps.append(
                f"{game}.{name}: seeded in event_types but not in gameEventRegistry "
                f"({_TS_NAME})"
            )
        for name in sorted(registered):
            pair = (game, name)
            if pair in validated and pair in stored_as_sent:
                gaps.append(f"{game}.{name}: in both VALIDATED and STORED_AS_SENT")
            elif pair not in validated and pair not in stored_as_sent:
                gaps.append(
                    f"{game}.{name}: no validation decision — validate it in the game "
                    "module's validate_event and add it to VALIDATED, or add it to "
                    "STORED_AS_SENT (stored as sent)"
                )

    # A known gap hides only its own direction of mismatch for that type.
    excused = {_message(k) for k in known_gaps}
    gaps = [g for g in gaps if g not in excused]
    for key in sorted(known_gaps):
        if key not in found:
            gaps.append(
                f"{key[0]}.{key[1]}: in KNOWN_GAPS as {key[2]} but no longer a gap — remove it"
            )
    for pair in sorted((validated | stored_as_sent) - {(g, n) for g in app for n in app[g]}):
        gaps.append(f"{pair[0]}.{pair[1]}: listed for validation but not in gameEventRegistry")
    return gaps


def _message(key: tuple[str, str, str]) -> str:
    game, name, direction = key
    if direction == REGISTERED_NOT_SEEDED:
        return (
            f"{game}.{name}: registered in the app but not seeded in event_types "
            "(add an Alembic migration; the server would 400 unknown_event_type)"
        )
    assert direction == SEEDED_NOT_REGISTERED, f"unknown KNOWN_GAPS direction {direction!r}"
    return f"{game}.{name}: seeded in event_types but not in gameEventRegistry ({_TS_NAME})"


def _seeded_by_game() -> dict[str, set[str]]:
    recorder = _run_all_upgrades()
    by_id = {v: k for k, v in recorder._name_to_id.items()}
    live = {g.value for g in GameType}
    out: dict[str, set[str]] = {}
    for gid, name in recorder.event_pairs:
        game = by_id.get(gid)
        if game in live:
            out.setdefault(game, set()).add(name)
    return out


def _live_gaps() -> list[str]:
    return contract_gaps(
        parse_app_registry(_TS.read_text(encoding="utf-8")),
        _seeded_by_game(),
        {g.value for g in GameType},
        VALIDATED,
        STORED_AS_SENT,
        KNOWN_GAPS,
    )


def test_the_app_event_registry_matches_the_backend() -> None:
    gaps = _live_gaps()
    assert not gaps, "\n".join(gaps)


def test_the_registry_is_parsed_not_empty() -> None:
    app = parse_app_registry(_TS.read_text(encoding="utf-8"))
    assert {g.value for g in GameType} == set(app)
    assert app["starswarm"]["wave_completed"] == AppEvent("REPLAY", False)
    assert app["blackjack"]["hand_resolved"].tier == "LIFECYCLE"
    # 2048's chunked moves (#3286): replay tier, split on the `m` array if oversized
    assert app["twenty48"]["moves"] == AppEvent("REPLAY", True)
    assert app["twenty48"]["move"] == AppEvent("REPLAY", False)
    # Solitaire's and FreeCell's chunked moves (#3289): replay tier, split on the `m` array
    assert app["solitaire"]["moves"] == AppEvent("REPLAY", True)
    assert app["freecell"]["moves"] == AppEvent("REPLAY", True)


@pytest.mark.parametrize(("game", "name"), sorted(VALIDATED))
def test_a_validated_type_rejects_an_empty_payload(game: str, name: str) -> None:
    module = get_module(game)
    assert module is not None
    assert type(module).validate_event is not GameModuleBase.validate_event
    assert module.validate_event(name, {}) is None


@pytest.mark.parametrize(("game", "name"), sorted(STORED_AS_SENT))
def test_a_stored_as_sent_type_comes_back_unchanged(game: str, name: str) -> None:
    module = get_module(game)
    assert module is not None
    probe: dict[str, Any] = {"probe": 1, "nested": {"a": [1, 2]}}
    assert module.validate_event(name, dict(probe)) == probe


# --- the check checking itself --------------------------------------------------
#
# Frozen in-test registries, never the live file: a one-sided type must fail.

_APP = {"g": {"game_started": AppEvent("LIFECYCLE", False), "tap": AppEvent("GRANULAR", False)}}
_SEEDED = {"g": {"game_started", "tap"}}
_STORED = frozenset({("g", "game_started"), ("g", "tap")})


def _gaps(app=_APP, seeded=_SEEDED, validated=frozenset(), stored=_STORED, known=None) -> list[str]:
    return contract_gaps(app, seeded, {"g"}, validated, stored, known or {})


def test_the_fixture_is_clean() -> None:
    assert _gaps() == []


def test_a_type_only_in_the_app_fails() -> None:
    app = {"g": {**_APP["g"], "swipe": AppEvent("GRANULAR", False)}}
    out = _gaps(app=app, stored=_STORED | {("g", "swipe")})
    assert len(out) == 1 and "g.swipe" in out[0] and "not seeded" in out[0]


def test_a_type_only_in_the_database_fails() -> None:
    out = _gaps(seeded={"g": {"game_started", "tap", "swipe"}})
    assert len(out) == 1 and "g.swipe" in out[0] and "not in gameEventRegistry" in out[0]


def test_a_registered_type_with_no_validation_decision_fails() -> None:
    out = _gaps(stored=frozenset({("g", "game_started")}))
    assert len(out) == 1 and "g.tap" in out[0] and "no validation decision" in out[0]


def test_a_validation_entry_for_an_unregistered_type_fails() -> None:
    out = _gaps(validated=frozenset({("g", "ghost")}))
    assert len(out) == 1 and "g.ghost" in out[0]


def test_a_game_missing_from_the_app_registry_fails() -> None:
    out = contract_gaps({}, {}, {"g"}, frozenset(), frozenset(), {})
    assert out == [f"g: no entry in gameEventRegistry ({_TS_NAME})"]


def test_a_known_gap_is_tolerated_until_it_is_fixed() -> None:
    seeded = {"g": {"game_started", "tap", "swipe"}}
    known = {("g", "swipe", SEEDED_NOT_REGISTERED): "tracked"}
    assert _gaps(seeded=seeded, known=known) == []
    stale = _gaps(known=known)
    assert len(stale) == 1 and "no longer a gap" in stale[0]


def test_a_known_gap_does_not_hide_the_opposite_direction() -> None:
    # swipe is registered but not seeded; the known gap says the reverse
    app = {"g": {**_APP["g"], "swipe": AppEvent("GRANULAR", False)}}
    stored = _STORED | {("g", "swipe")}
    wrong = {("g", "swipe", SEEDED_NOT_REGISTERED): "tracked"}
    out = _gaps(app=app, stored=stored, known=wrong)
    assert any("registered in the app but not seeded" in m for m in out)
    assert any("no longer a gap" in m and SEEDED_NOT_REGISTERED in m for m in out)
    # the matching direction is hidden
    right = {("g", "swipe", REGISTERED_NOT_SEEDED): "tracked"}
    assert _gaps(app=app, stored=stored, known=right) == []


def test_the_parser_reads_a_registry_literal() -> None:
    text = """
    export const gameEventRegistry: Readonly<Record<GameType, X>> = {
      g: {
        sessionMaxBytes: 10,
        events: {
          game_started: { tier: Priority.LIFECYCLE },
          big: { tier: Priority.MID, maxBytes: 4096, chunkField: "rows" },
        },
      },
    };
    """
    assert parse_app_registry(text) == {
        "g": {"game_started": AppEvent("LIFECYCLE", False), "big": AppEvent("MID", True)}
    }
