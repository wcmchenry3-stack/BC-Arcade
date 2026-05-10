"""Pydantic request/response schemas for the games write API (#364)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field, model_validator

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
    def validate_game_metadata(self) -> "CreateGameRequest":
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
    played: int
    best: int | None = None
    avg: float | None = None
    last_played_at: datetime | None = None
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
