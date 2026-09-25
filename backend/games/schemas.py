"""Pydantic request/response schemas for the games write API (#364)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field, field_validator, model_validator

from games.registry import get_module

# ---------------------------------------------------------------------------
# Shared sub-models
# ---------------------------------------------------------------------------


class PlayerRef(BaseModel):
    """A player participating in a game (#543).

    Today all games are single-player, so ``players`` is always length 1.
    The model is intentionally minimal so multiplayer can extend it without
    a breaking change (add ``display_name``, ``role``, etc. later).
    """

    player_id: str = Field(..., min_length=1, max_length=128)


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------


class CreateGameRequest(BaseModel):
    id: uuid.UUID | None = None
    game_type: str = Field(..., min_length=1, max_length=64)
    metadata: dict[str, Any] = Field(default_factory=dict)
    players: list[PlayerRef] = Field(default_factory=list)
    started_at: datetime | None = None

    @model_validator(mode="after")
    def validate_game_metadata(self) -> CreateGameRequest:
        """Validate metadata against the per-game model if one is registered.

        Unregistered game types (e.g. future games not yet in the registry)
        skip validation so new game types can be seeded in the DB before their
        module is implemented.
        """
        mod = get_module(self.game_type)
        if mod is not None:
            mod.metadata_model.model_validate(self.metadata)
        return self


class EventIn(BaseModel):
    event_index: int = Field(..., ge=0)
    event_type: str = Field(..., min_length=1, max_length=64)
    data: dict[str, Any] = Field(default_factory=dict)


class AppendEventsRequest(BaseModel):
    events: list[EventIn] = Field(..., min_length=1, max_length=200)


class CompleteGameRequest(BaseModel):
    final_score: int | None = None
    outcome: str | None = None
    duration_ms: int | None = Field(default=None, ge=0)
    completed_at: datetime | None = None
    result: dict[str, Any] = Field(default_factory=dict)

    @field_validator("result", mode="before")
    @classmethod
    def _null_result_is_empty(cls, v: Any) -> Any:
        # A client serialising an absent result as `null` must not 422 — the
        # sync worker dead-letters non-403 4xx, which would lose the completion.
        return {} if v is None else v


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------


class CreateGameResponse(BaseModel):
    id: uuid.UUID
    started_at: datetime


class AppendEventsResponse(BaseModel):
    accepted: int
    duplicates: int
    rejected: list[str] = Field(default_factory=list)


class GameStateResponse(BaseModel):
    id: uuid.UUID
    game_type: str
    session_id: str
    started_at: datetime
    completed_at: datetime | None
    final_score: int | None
    outcome: str | None
    duration_ms: int | None


# ---------------------------------------------------------------------------
# Read-side (#365)
# ---------------------------------------------------------------------------


class GameTypeStatsResponse(BaseModel):
    """One game's stats for the session, in ``StatsResponse.by_game``.

    Comparable fields (#2620), the same meaning for every game:

    - ``sessions``: finished rows (``completed_at`` set), abandons included.
    - ``completed``: ``sessions`` minus abandons. Also the Arcade XP input.
    - ``won`` / ``lost`` / ``tied``: rows with ``outcome`` ``win`` / ``loss`` /
      ``push``. All three are ``null`` when the player has no row of this game
      with any of those outcomes (score-only games, solo-only Yacht); clients
      show "—".
    - **Win rate** = ``won / (won + lost + tied)``. ``completed`` and
      ``kept_playing`` rows are not in the denominator. Undefined (show "—")
      when the win fields are ``null``.
    - ``current_win_streak`` / ``best_win_streak``: runs of consecutive
      ``win`` rows in ``completed_at`` order. A ``loss`` ends a run; ``push``,
      ``abandoned``, ``completed`` and ``kept_playing`` rows are skipped (they
      neither extend nor break it). ``null`` when the win fields are ``null``.
    - ``time_played_ms``: reported play time only. The sum over ``sessions``
      of ``duration_ms`` where it is > 0, each row capped at 24 h as a sanity
      bound. Rows with a null or 0 ``duration_ms`` add nothing: there is no
      ``completed_at − started_at`` fallback, so idle or backgrounded time is
      never counted. It undercounts until each game reports its active time.
    - ``best_value``: best value of the game's board metric, in the board's
      direction (lowest moves for FreeCell), over non-abandoned rows whose
      ``outcome`` is in the board's ``qualifying_outcomes`` (any outcome when
      that is ``None``; Daily Word counts wins only). ``best_label_key`` is
      the board's ``label_key`` (``"score"``, ``"moves"``, …) saying what the
      number is. ``null`` value when no qualifying row carries the metric.
    - ``extras``: game-specific figures from ``stats_shape()``, e.g.
      Blackjack's ``best_chips``, ``current_chips``, ``best_run_chips``,
      ``total_runs``, ``runs_completed``, ``current_table``.

    Deprecated (kept for app builds already in the stores; #2644 removes them
    once #2637 ships): ``played`` (= ``sessions``), ``best`` (highest
    ``final_score`` whatever the direction), ``avg``, and the top-level
    Blackjack fields, which mirror ``extras``.
    """

    played: int
    best: int | None = None
    avg: float | None = None
    last_played_at: datetime | None = None
    sessions: int = 0
    completed: int = 0
    won: int | None = None
    lost: int | None = None
    tied: int | None = None
    current_win_streak: int | None = None
    best_win_streak: int | None = None
    time_played_ms: int = 0
    best_value: int | float | None = None
    best_label_key: str | None = None
    extras: dict[str, Any] = Field(default_factory=dict)
    best_chips: int | None = None
    current_chips: int | None = None
    best_run_chips: int | None = None
    total_runs: int | None = None
    runs_completed: int | None = None
    current_table: str | None = None


class StatsResponse(BaseModel):
    total_games: int
    by_game: dict[str, GameTypeStatsResponse]
    favorite_game: str | None
    # Arcade XP + player level (#2391) — derived by games.progression from the
    # same summary; see that module for the max-level convention.
    arcade_xp: int
    arcade_level: int
    xp_into_level: int
    xp_for_next_level: int
    # Consecutive days with >= 2 of 3 daily goals met (#2456) — see
    # daily_challenge.streak. Capped at its LOOKBACK_DAYS; a count only, no reward.
    streak_days: int


class GameRowResponse(BaseModel):
    id: uuid.UUID
    game_type: str
    started_at: datetime
    completed_at: datetime | None
    final_score: int | None
    outcome: str | None
    duration_ms: int | None
    metadata: dict[str, Any] = Field(default_factory=dict)
    players: list[PlayerRef] = Field(default_factory=list)


class GameHistoryResponse(BaseModel):
    items: list[GameRowResponse]
    next_cursor: str | None


class GameEventResponse(BaseModel):
    event_index: int
    event_type: str
    occurred_at: datetime
    data: dict[str, Any]


class GameDetailResponse(GameRowResponse):
    events: list[GameEventResponse] | None = None


# ---------------------------------------------------------------------------
# Catalog (#1049)
# ---------------------------------------------------------------------------


class GameTypeOut(BaseModel):
    id: int
    name: str
    display_name: str
    icon_emoji: str | None
    sort_order: int
    is_active: bool
    is_premium: bool
    category: str


class CatalogResponse(BaseModel):
    items: list[GameTypeOut]


class PatchGameTypeRequest(BaseModel):
    is_premium: bool | None = None
    category: str | None = Field(default=None, min_length=1, max_length=64)
