"""Sort Puzzle levels (#1173).

GET /sort/levels — load and return all 23 generated levels.

Legacy (#2761): the app now plays the fixed 120-level catalog it ships with
(``frontend/src/game/sort/levels.catalog.json``) and never calls this. It is
kept, unchanged, for app builds from before the catalog; remove it once they
are no longer supported. Their solves carry no ``catalog_version``, so they
are stored but never rank (``sort.module``).

Sort ranks on the generic session board (``GET /games/leaderboard/sort``,
#2625); its legacy score routes were removed in #2644.
"""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, Request

from entitlements.dependencies import require_entitlement
from limiter import limiter
from rate_limits import (
    SORT_LEVELS_IP_RATE_LIMIT,
)

from .generate_levels import build_levels
from .models import LevelData, LevelsResponse

router = APIRouter(dependencies=[Depends(require_entitlement("sort"))])


@router.get("/levels", response_model=LevelsResponse)
@limiter.limit(SORT_LEVELS_IP_RATE_LIMIT)
async def get_levels(
    request: Request,  # noqa: ARG001 - slowapi resolves `request` by name
) -> LevelsResponse:
    raw = await asyncio.to_thread(build_levels)
    return LevelsResponse(levels=[LevelData(**item) for item in raw])
