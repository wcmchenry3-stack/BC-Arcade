"""Star Swarm GameModule descriptor (#2623).

A ``GameModuleBase`` subclass (``games/module_base.py``).

#3510: ``reconcile_result`` watches for a dev-affected run (``dev_affected``,
a dev-panel action touched it) reaching production: the run is still stored
(and kept off the boards and stats by ``games.filters.not_dev_affected``), and
a throttled Sentry warning says a build with dev tools got to production.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from games.board import SCORE_METRIC, BoardDefinition
from games.filters import DEV_AFFECTED_KEY
from games.module_base import GameModuleBase
from observability.report import Throttle, report_event
from settings import Settings
from starswarm.models import (
    DEFAULT_DIFFICULTY_TIER,
    DIFFICULTY_TIERS,
    WAVE_COMPLETED,
    StarSwarmMetadata,
    StarSwarmResult,
    validate_wave_completed,
)
from starswarm.timeline import WAVE_TIMELINE, validate_wave_timeline
from vocab import GameType

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from db.models import Game

logger = logging.getLogger(__name__)

# #3510: at most one "dev-affected run in production" warning per hour per
# process, one fixed fingerprint: a store build with dev tools left on would
# otherwise send one per run (CLAUDE.md, cost first).
DEV_AFFECTED_WARNING_WINDOW_S = 3600.0
DEV_AFFECTED_FINGERPRINT = "starswarm-dev-affected-in-production"
_dev_affected_throttle = Throttle(DEV_AFFECTED_WARNING_WINDOW_S)

_settings: Settings | None = None


def _is_production() -> bool:
    """``ENVIRONMENT == "production"`` (settings.py), read lazily."""
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings.is_production


def warn_dev_affected_in_production() -> None:
    """A dev-affected run reached the production API: one throttled Sentry warning.

    No identifiers and no values (the privacy policy): the game type and a
    fixed fingerprint only. Outside production (dev, test, the pre-launch API
    the internal builds use) a flagged run is expected and says nothing.
    """
    if not _is_production():
        return
    logger.warning("starswarm: a dev-affected run reached production")
    if not _dev_affected_throttle.allow():
        return
    report_event(
        "starswarm: dev-affected run in production",
        level="warning",
        fingerprint=[DEV_AFFECTED_FINGERPRINT],
        tags={"game_type": "starswarm", "dev_affected": "true"},
    )


class StarSwarmModule(GameModuleBase):
    """GameModule implementation for Star Swarm."""

    game_type = GameType.STARSWARM
    metadata_model = StarSwarmMetadata
    result_model = StarSwarmResult
    # One board per difficulty tier (plan §4.2); no natural ceiling (#2519 decision 14).
    # Only the app's tiers have a board, and a row with no tier counts as
    # LieutenantJG (``DEFAULT_DIFFICULTY_TIER``).
    board = BoardDefinition(
        metric=SCORE_METRIC,
        direction="desc",
        label_key="score",
        partitions=("difficulty_tier",),
        partition_defaults=(("difficulty_tier", DEFAULT_DIFFICULTY_TIER),),
        partition_values=(("difficulty_tier", DIFFICULTY_TIERS),),
    )
    # A run ends when the ship is lost: there is no win.
    has_winner = False

    async def reconcile_result(
        self,
        session: AsyncSession,  # noqa: ARG002 - hook signature
        game: Game,  # noqa: ARG002 - hook signature
        result: dict[str, Any],
    ) -> dict[str, Any]:
        """#3510: a dev-affected run is stored as sent (saved, never rejected);
        in production it also raises a throttled Sentry warning."""
        if result.get(DEV_AFFECTED_KEY) is True:
            warn_dev_affected_in_production()
        return result

    def validate_event(self, name: str, data: dict[str, Any]) -> dict[str, Any] | None:
        """``wave_completed`` (#3250) and ``wave_timeline`` (#3394) are checked
        against their v1 schemas; the lifecycle events pass through."""
        if name == WAVE_COMPLETED:
            return validate_wave_completed(data)
        if name == WAVE_TIMELINE:
            return validate_wave_timeline(data)
        return data


module = StarSwarmModule()
