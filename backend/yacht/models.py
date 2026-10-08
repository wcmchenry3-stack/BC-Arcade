"""Yacht metadata and result models: solo or vs-the-computer games, and the
scorecard sent on completion."""

import logging
from typing import Any, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StrictInt,
    ValidationError,
    ValidationInfo,
    model_validator,
)

from observability.report import report_event

AiDifficulty = Literal["easy", "medium", "hard"]
YachtMode = Literal["solo", "vs"]

logger = logging.getLogger(__name__)


class YachtMetadata(BaseModel):
    """``games.metadata`` for a Yacht session, validated on ``POST /games``.

    Recorded, not partitioned: solo and vs-the-computer games share one board
    (#2519 decision 2). ``difficulty`` is the computer's, so a vs game must
    have one and a solo game must not. Installed builds that predate #2630
    send no ``mode`` (``{}``, or only a ``difficulty``); those keep validating.
    """

    model_config = ConfigDict(extra="forbid")
    mode: YachtMode | None = None
    difficulty: AiDifficulty | None = None

    @model_validator(mode="after")
    def _difficulty_matches_mode(self) -> "YachtMetadata":
        if self.mode == "vs" and self.difficulty is None:
            raise ValueError("a vs game needs the computer's difficulty")
        if self.mode == "solo" and self.difficulty is not None:
            raise ValueError("a solo game has no difficulty")
        return self


# ---------------------------------------------------------------------------
# Result block (#2839)
# ---------------------------------------------------------------------------

CATEGORY_MAX: dict[str, int] = {
    "ones": 5,
    "twos": 10,
    "threes": 15,
    "fours": 20,
    "fives": 25,
    "sixes": 30,
    "three_of_a_kind": 30,
    "four_of_a_kind": 30,
    "full_house": 25,
    "small_straight": 30,
    "large_straight": 40,
    "yacht": 50,
    "chance": 30,
}
"""Highest value each category can hold, Joker scores included (a Joker prices
Full House / Small / Large Straight at their flat 25 / 30 / 40 and the sum
categories at the dice sum, all within these). Keys mirror ``CATEGORIES`` in
``frontend/src/game/yacht/engine.ts`` (``test_yacht_result.py::test_category_keys_match_the_engine`` parses both)."""

UPPER_CATEGORIES = ("ones", "twos", "threes", "fours", "fives", "sixes")
UPPER_BONUS_THRESHOLD = 63
UPPER_BONUS_VALUE = 35
YACHT_BONUS_VALUE = 100
MAX_YACHT_BONUS_COUNT = 12
"""Yacht scored at 50 in one category, then a Joker in each of the other 12."""


class YachtCategories(BaseModel):
    """Category -> score. ``None`` (or absent) is a category not yet filled.

    An abandoned game has a partial card. ``extra="forbid"`` rejects a key that
    is not a Yacht category. Strict ints: a string or bool is not a score.
    """

    model_config = ConfigDict(extra="forbid")

    ones: StrictInt | None = Field(default=None, ge=0, le=CATEGORY_MAX["ones"])
    twos: StrictInt | None = Field(default=None, ge=0, le=CATEGORY_MAX["twos"])
    threes: StrictInt | None = Field(default=None, ge=0, le=CATEGORY_MAX["threes"])
    fours: StrictInt | None = Field(default=None, ge=0, le=CATEGORY_MAX["fours"])
    fives: StrictInt | None = Field(default=None, ge=0, le=CATEGORY_MAX["fives"])
    sixes: StrictInt | None = Field(default=None, ge=0, le=CATEGORY_MAX["sixes"])
    three_of_a_kind: StrictInt | None = Field(
        default=None, ge=0, le=CATEGORY_MAX["three_of_a_kind"]
    )
    four_of_a_kind: StrictInt | None = Field(default=None, ge=0, le=CATEGORY_MAX["four_of_a_kind"])
    full_house: StrictInt | None = Field(default=None, ge=0, le=CATEGORY_MAX["full_house"])
    small_straight: StrictInt | None = Field(default=None, ge=0, le=CATEGORY_MAX["small_straight"])
    large_straight: StrictInt | None = Field(default=None, ge=0, le=CATEGORY_MAX["large_straight"])
    yacht: StrictInt | None = Field(default=None, ge=0, le=CATEGORY_MAX["yacht"])
    chance: StrictInt | None = Field(default=None, ge=0, le=CATEGORY_MAX["chance"])

    def filled_total(self) -> int:
        return sum(v for v in self.model_dump().values() if v is not None)

    def upper_subtotal(self) -> int:
        return sum(getattr(self, c) or 0 for c in UPPER_CATEGORIES)

    def upper_complete(self) -> bool:
        return all(getattr(self, c) is not None for c in UPPER_CATEGORIES)


class YachtScorecard(BaseModel):
    """One player's final card: category scores plus the two bonus components.

    Accounting (mirrors ``totalScore`` in ``engine.ts``)::

        total = sum(filled categories) + upper_bonus + yacht_bonus_total

    * ``categories`` already hold every Joker-scored value: an extra Yacht is
      written into a normal category at its Joker price, so those points are
      in the category sum and are **not** part of ``yacht_bonus_total``.
    * ``upper_bonus`` is 35 once all six upper categories are filled with a
      subtotal of at least 63, else 0. It is never inside ``categories``.
    * ``yacht_bonus_total`` is 100 per extra Yacht (``yacht_bonus_count``,
      0 to 12), earned only once the Yacht category holds 50. It is on top of
      the Joker category score, not instead of it.

    This model is the *validity test* for a card, not a gate on the request:
    ``YachtResult`` drops a card that fails it and completes the game anyway
    (a 400 on ``/complete`` dead-letters the game in the app). A card that is
    valid but does not add up is kept and flagged. Unknown keys beside
    ``categories`` are ignored, so a newer build can add to the card.
    """

    model_config = ConfigDict(extra="ignore")

    categories: YachtCategories
    upper_bonus: StrictInt = Field(default=0, ge=0, le=UPPER_BONUS_VALUE)
    yacht_bonus_count: StrictInt = Field(default=0, ge=0, le=MAX_YACHT_BONUS_COUNT)
    yacht_bonus_total: StrictInt = Field(
        default=0, ge=0, le=MAX_YACHT_BONUS_COUNT * YACHT_BONUS_VALUE
    )

    def total(self) -> int:
        return self.categories.filled_total() + self.upper_bonus + self.yacht_bonus_total

    def is_consistent(self) -> bool:
        cats = self.categories
        expected_upper = (
            UPPER_BONUS_VALUE
            if cats.upper_complete() and cats.upper_subtotal() >= UPPER_BONUS_THRESHOLD
            else 0
        )
        return (
            self.upper_bonus == expected_upper
            and self.yacht_bonus_total == self.yacht_bonus_count * YACHT_BONUS_VALUE
            and (self.yacht_bonus_count == 0 or cats.yacht == CATEGORY_MAX["yacht"])
        )


def _is_int(v: Any) -> bool:
    return isinstance(v, int) and not isinstance(v, bool)


class YachtResult(BaseModel):
    """Result block sent on ``PATCH /games/{id}/complete`` (#2449, #2839).

    Mirrors ``endedPayload`` in ``GameScreen.tsx``. This model **never rejects
    a completion**: a 400 is dead-lettered by the app's sync worker, losing the
    score, the leaderboard row and the XP. Every field but the two cards is
    undeclared, so ``final_score``, ``upper_bonus``, ``yacht_bonus_total``,
    ``outcome``, ``opponent_score``, ``vs_result`` and any unknown key are
    stored exactly as sent, as they were before this model existed (the 8 KiB
    cap in ``games.sessions`` bounds them).

    ``scorecard`` is the player's card and ``opponent_scorecard`` the
    computer's, sent only when the computer finished (the same condition as
    ``opponent_score``: a vs game completed while the computer is still
    playing, e.g. on unmount, has no opponent card). Every abandon
    (New Game, or the hook's unmount abandon via the progress snapshot)
    carries the partial card; abandoned rows never rank. The player's card is
    reconciled against the ``/complete`` body's ``final_score`` when the
    service passes it as validation context (else the result's own copy), and
    the result's copy must agree. The top level ``final_score`` still means the player's, and ranking is untouched.

    A card is validated as ``YachtScorecard`` (category keys, integer bounds).
    One that fails is dropped, ``scorecard_reconciled`` is set false and the
    drop is reported (log + Sentry); the game still completes. A valid card
    that does not add up to its total, or breaks the bonus rules, is stored
    and flagged the same way. ``scorecard_reconciled`` is server-written (a
    client's value is discarded): true only when every card present is valid
    and reconciles. It is left out when no card came.
    """

    model_config = ConfigDict(extra="allow")

    scorecard: Any = None
    opponent_scorecard: Any = None
    scorecard_reconciled: bool | None = None

    @model_validator(mode="before")
    @classmethod
    def _server_owns_the_flag(cls, data: Any) -> Any:
        if isinstance(data, dict) and "scorecard_reconciled" in data:
            data = {k: v for k, v in data.items() if k != "scorecard_reconciled"}
        return data

    def _drop(self, field: str) -> None:
        setattr(self, field, None)
        self.__pydantic_fields_set__.discard(field)

    @model_validator(mode="after")
    def _validate_and_reconcile(self, info: ValidationInfo) -> "YachtResult":
        extra = self.model_extra or {}
        # ``final_score`` of the /complete body, when the service passes it as
        # validation context (it may not, or may be None: an abandon has none).
        context = info.context if isinstance(info.context, dict) else {}
        body_score = context.get("final_score")
        checks: list[bool] = []
        for field, total_key in (
            ("scorecard", "final_score"),
            ("opponent_scorecard", "opponent_score"),
        ):
            raw = getattr(self, field)
            if raw is None:
                self._drop(field)  # `null` is "no card"
                continue
            try:
                card = YachtScorecard.model_validate(raw)
            except ValidationError as e:
                errors = e.errors()
                _report_dropped_card(
                    field,
                    ", ".join(".".join(str(p) for p in err["loc"]) for err in errors),
                    sorted({err["type"] for err in errors}),
                )
                self._drop(field)
                checks.append(False)
                continue
            setattr(self, field, card.model_dump(exclude_unset=True))
            checks.append(card.is_consistent())
            total = extra.get(total_key)
            if field == "scorecard" and _is_int(body_score):
                # The row's ``final_score`` (the /complete body) is what ranks,
                # so the card must explain it, and the result's copy must agree.
                checks.append(card.total() == body_score)
                checks.append(total is None or total == body_score)
            else:
                checks.append(_is_int(total) and card.total() == total)
        if checks:
            self.scorecard_reconciled = all(checks)
        return self


def _report_dropped_card(field: str, fields: str, error_types: list[str]) -> None:
    """Log and send to Sentry a card dropped from an otherwise valid result.

    Same Sentry event as a rejected result (``games.sessions``), but the game still
    completes. Field paths and error types only, no values or identifiers.
    """
    logger.warning("Yacht %s dropped from the result: %s", field, fields)
    report_event(
        f"PATCH /games/{{id}}/complete rejected: {field} dropped (yacht)",
        level="error",
        fingerprint=["games-complete-result-rejected", "yacht", f"{field} dropped"],
        tags={"game_type": "yacht"},
        context={"result_rejection": {"fields": fields, "error_types": error_types}},
    )
