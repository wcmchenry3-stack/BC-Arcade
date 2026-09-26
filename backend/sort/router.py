"""Sort Puzzle levels (#1173).

GET /sort/levels — load and return all 23 generated levels.

Sort ranks on the generic session board (``GET /games/leaderboard/sort``,
#2625); its legacy score routes were removed in #2644.
"""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, Request

from entitlements.dependencies import require_entitlement
from limiter import limiter

from .generate_levels import build_levels
from .models import LevelData, LevelsResponse

router = APIRouter(dependencies=[Depends(require_entitlement("sort"))])


@router.get("/levels", response_model=LevelsResponse)
@limiter.limit("60/minute")
async def get_levels(request: Request) -> LevelsResponse:
    raw = await asyncio.to_thread(build_levels)
    return LevelsResponse(levels=[LevelData(**item) for item in raw])
