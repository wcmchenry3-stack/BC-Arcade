"""A Sort row's edition in SQL (#4028), the twin of ``definitions.edition_of``.

Sort's catalog levels and the random levels before it are numbered apart (#2761), so a
relative "solve N new levels" goal compares a row only with rows of its own edition
(``definitions.counted_editions``). The readers group their existing aggregate by this
expression (``service.day_start_bests``, history query 3, the metrics script), so it
adds a GROUP BY key, never a statement.
"""

from __future__ import annotations

from sqlalchemy import ColumnElement, case

from daily_challenge.definitions import CATALOG_EDITION, LEGACY_EDITION, SORT_EDITION
from games.boards.sql import edition_matches


def edition_column() -> ColumnElement[int]:
    """``CATALOG_EDITION`` when the row's metadata holds the current catalog version, as
    the leaderboard reads it (``games.boards.sql.edition_matches``: an int, never a bool
    or string), else ``LEGACY_EDITION``. Only Sort rows hold ``catalog_version``, so every
    other game reads as one edition."""
    return case((edition_matches(SORT_EDITION), CATALOG_EDITION), else_=LEGACY_EDITION)
