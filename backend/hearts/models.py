"""Hearts metadata and result models, including the optional per-hand score
breakdown of a finished game (#2838)."""

import logging

from pydantic import BaseModel, ConfigDict, Field, ValidationInfo, model_validator

from games.metadata import LegacyPlayerName
from observability.report import report_event

logger = logging.getLogger(__name__)


class HeartsMetadata(BaseModel):
    """Creation-time metadata for a Hearts game row.

    ``ai_difficulty`` is the opponent style the game was played against
    (#2629): one of the app's ``AI_PRESETS`` in
    ``frontend/src/game/hearts/types.ts``, the source of the values. It is
    recorded, not partitioned on: the board ranks every style together
    (#2519 decision 4). Builds before #2629 don't send it, so it is optional;
    any other string is accepted, since rejecting a label would lose the whole
    game in the app. ``extra="forbid"`` rejects unknown keys.
    """

    model_config = ConfigDict(extra="forbid")
    player_name: LegacyPlayerName = ""
    ai_difficulty: str | None = Field(default=None, max_length=32)


MAX_HANDS = 60
"""Upper bound on recorded hands. A game ends at 100 points, so real games run
tens of hands at most; the bound keeps the block far below the 8 KiB result cap."""
SEATS = 4
MAX_HAND_POINTS = 26
"""One hand's applied delta per seat: 0..26 (a moon hand is 0 for the shooter and
26 for each opponent)."""


def _valid_int(v: object) -> bool:
    return isinstance(v, int) and not isinstance(v, bool)


def _hand_row_is_valid(row: object) -> bool:
    """One hand's applied deltas: four ints in 0..26 that sum to 26, or the moon
    pattern (0 for the shooter, 26 for each opponent, sum 78). The engine's
    scoring has no other variants: 13 hearts + the queen of spades are 26 points."""
    if not isinstance(row, list) or len(row) != SEATS:
        return False
    if not all(_valid_int(p) and 0 <= p <= MAX_HAND_POINTS for p in row):
        return False
    return sum(row) == 26 or sorted(row) == [0, 26, 26, 26]


def _breakdown_problem(data: dict, body_score: object = None) -> str | None:
    """Why ``hand_scores`` / ``final_scores`` / ``human_seat`` can't be kept, or
    None when they are well formed and reconcile: every seat's hand deltas sum
    to its final total and, when the block carries ``final_score``, it is an int
    equal to ``max(0, 100 - human total)``."""
    hands = data.get("hand_scores")
    finals = data.get("final_scores")
    seat = data.get("human_seat")
    if not isinstance(hands, list) or not isinstance(finals, list):
        return "missing or non-list breakdown"
    if not 1 <= len(hands) <= MAX_HANDS or len(finals) != SEATS:
        return "wrong hand count or seat count"
    if not _valid_int(seat) or not 0 <= seat < SEATS:
        return "bad human_seat"
    if not all(_hand_row_is_valid(row) for row in hands):
        return "bad hand row"
    if not all(_valid_int(f) and f >= 0 for f in finals):
        return "bad final_scores"
    if any(sum(row[i] for row in hands) != finals[i] for i in range(SEATS)):
        return "hand sums do not match final_scores"
    expected = max(0, 100 - finals[seat])
    if "final_score" in data:
        score = data["final_score"]
        if not _valid_int(score):
            return "final_score is not an int"
        if body_score is not None and score != body_score:
            return "result final_score differs from the completion's"
        if score != expected:
            return "final_score does not match human total"
    if body_score is not None and body_score != expected:
        return "completion final_score does not match human total"
    return None


def _report_dropped_breakdown(reason: str) -> None:
    """Log and send to Sentry a breakdown dropped from a completion (#2838).

    The completion still succeeds; this makes the lost detail visible. Reason
    only: no session id or score values (same privacy rule as
    ``games.sessions._report_rejected_result``).
    """
    logger.warning("hearts result: breakdown dropped (%s)", reason)
    report_event(
        f"PATCH /games/{{id}}/complete dropped hearts breakdown: {reason}",
        level="warning",
        fingerprint=["hearts-result-breakdown-dropped", reason],
        tags={"game_type": "hearts"},
        context={"result_breakdown": {"reason": reason}},
    )


_BREAKDOWN_KEYS = ("hand_scores", "final_scores", "human_seat")


class HeartsResult(BaseModel):
    """Result block sent on ``PATCH /games/{id}/complete`` (#2838).

    The app sends ``{final_score, vs_result}`` (plus ``hands_played`` on an
    abandon). A completed game also carries the round-by-round path to that
    result, from the engine's ``scoreHistory`` (post moon adjustment):

    - ``hand_scores``: one row per resolved hand, four applied penalty deltas
      in seat order (seat 0 is the human; the rest are the computer players,
      so no names are stored). A moon hand is 0 for the shooter, 26 for each
      other seat.
    - ``final_scores``: the four cumulative totals.
    - ``human_seat``: the human's index in those rows.

    The breakdown is all-or-nothing and never rejects the completion: a
    malformed or non-reconciling breakdown (wrong shape or size, a seat's
    deltas not summing to its total, ``final_score`` not ``100 - human total``)
    is dropped and the rest of the result is kept, so a bad breakdown can't
    dead-letter the game's score in the app (a 400 on ``/complete`` is
    dead-lettered). Builds without the fields, and unknown keys, still
    validate; the leaderboard value stays the top-level ``final_score``.
    """

    model_config = ConfigDict(extra="allow")

    hand_scores: list[list[int]] | None = None
    final_scores: list[int] | None = None
    human_seat: int | None = None

    @model_validator(mode="before")
    @classmethod
    def _drop_bad_breakdown(cls, data: object, info: ValidationInfo) -> object:
        if not isinstance(data, dict):
            return data
        if not any(k in data for k in _BREAKDOWN_KEYS):
            return data
        cleaned = dict(data)
        # The completion body's final_score (what becomes games.final_score) when
        # the service passes it; None when validated directly.
        body_score = (info.context or {}).get("final_score")
        problem = _breakdown_problem(cleaned, body_score)
        if problem is not None:
            _report_dropped_breakdown(problem)
            for k in _BREAKDOWN_KEYS:
                cleaned.pop(k, None)
        return cleaned
