from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictInt, model_validator

AiDifficulty = Literal["easy", "medium", "hard"]
YachtMode = Literal["solo", "vs"]


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
``frontend/src/game/yacht/engine.ts`` (``test_yacht_models.py`` parses both)."""

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

    A card that breaks these rules is stored and flagged
    (``YachtResult.scorecard_reconciled``), never rejected: a 400 on
    ``/complete`` dead-letters the game in the app.
    """

    model_config = ConfigDict(extra="forbid")

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


class YachtResult(BaseModel):
    """Result block sent on ``PATCH /games/{id}/complete`` (#2449, #2839).

    Mirrors ``endedPayload`` in ``GameScreen.tsx``. Builds before #2839 send
    only ``final_score``, ``upper_bonus``, ``yacht_bonus_total`` and
    ``outcome`` (plus, for a finished vs game, ``opponent_score`` and
    ``vs_result``); those stay valid, and unknown keys are kept as they were
    before this model existed (the 8 KiB cap in ``games.service`` bounds them).

    ``scorecard`` is the player's card and ``opponent_scorecard`` the
    computer's, sent only when the computer finished (the same condition as
    ``opponent_score``). An abandoned game sends whatever is filled. The top
    level ``final_score`` / ``upper_bonus`` / ``yacht_bonus_total`` still mean
    the player's, and the ranking (``games.final_score``) is untouched.

    ``scorecard_reconciled`` is written by the server, never trusted from the
    client: true when every scorecard present adds up to its total
    (``final_score`` / ``opponent_score``) and follows the bonus rules. It is
    left out when no scorecard came. Only the shape and bounds are enforced
    (a 400 there means the sender is not a Yacht client); a card that does not
    add up is stored and flagged, so a client bug cannot dead-letter a game.
    """

    model_config = ConfigDict(extra="allow")

    final_score: int | None = Field(default=None, ge=0)
    upper_bonus: int | None = Field(default=None, ge=0)
    yacht_bonus_total: int | None = Field(default=None, ge=0)
    outcome: str | None = Field(default=None, max_length=32)
    opponent_score: int | None = Field(default=None, ge=0)
    vs_result: str | None = Field(default=None, max_length=32)
    scorecard: YachtScorecard | None = None
    opponent_scorecard: YachtScorecard | None = None
    scorecard_reconciled: bool | None = None

    @model_validator(mode="before")
    @classmethod
    def _server_owns_the_flag(cls, data: Any) -> Any:
        if isinstance(data, dict) and "scorecard_reconciled" in data:
            data = {k: v for k, v in data.items() if k != "scorecard_reconciled"}
        return data

    @model_validator(mode="after")
    def _reconcile(self) -> "YachtResult":
        checks: list[bool] = []
        if self.scorecard is not None:
            checks.append(self.scorecard.is_consistent())
            if self.final_score is not None:
                checks.append(self.scorecard.total() == self.final_score)
        if self.opponent_scorecard is not None:
            checks.append(self.opponent_scorecard.is_consistent())
            if self.opponent_score is not None:
                checks.append(self.opponent_scorecard.total() == self.opponent_score)
        if checks:
            self.scorecard_reconciled = all(checks)
        return self
