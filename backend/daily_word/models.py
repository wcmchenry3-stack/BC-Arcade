"""Pydantic metadata model for the Daily Word game (#1187)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict


class DailyWordMetadata(BaseModel):
    model_config = ConfigDict(extra="forbid")

    puzzle_id: str
    language: Literal["en", "hi"] = "en"
