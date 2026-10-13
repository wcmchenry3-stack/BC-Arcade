"""Server side of the Daily Word scoring parity check (#3230).

The app scores guesses on the device when offline (``scoreGuess`` in
``frontend/src/game/daily_word/localScoring.ts``) and decodes the
``/upcoming`` answer blobs itself (``decodeAnswerBlob``). Both suites read
``tests/fixtures/daily_word_parity.json``, so a change to either side's rules
fails one of them.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from daily_word.puzzle import scramble_answer
from daily_word.router import _score_guess

_FIXTURE = json.loads(
    (Path(__file__).parent / "fixtures" / "daily_word_parity.json").read_text(encoding="utf-8")
)


@pytest.mark.parametrize("case", _FIXTURE["scoring"], ids=lambda c: f"{c['answer']}/{c['guess']}")
def test_score_guess_matches_fixture(case: dict) -> None:
    tiles = _score_guess(case["answer"], case["guess"])
    assert [t["status"] for t in tiles] == case["tiles"]
    assert [t["letter"] for t in tiles] == list(case["guess"])


@pytest.mark.parametrize("case", _FIXTURE["answer_blobs"], ids=lambda c: c["puzzle_id"])
def test_scramble_answer_matches_fixture(case: dict) -> None:
    assert scramble_answer(case["puzzle_id"], case["answer"]) == case["answer_blob"]
