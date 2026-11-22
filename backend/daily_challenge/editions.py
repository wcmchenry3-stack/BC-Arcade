"""A Sort row's edition in SQL (#4028), the twin of ``definitions.edition_of``.

Sort's catalog levels and the random levels before it are numbered apart (#2761), so a
relative "solve N new levels" goal compares a row only with rows of its own edition
(``definitions.counted_editions``). The readers group their existing aggregate by this
expression (``service.day_start_bests``, history query 3, the metrics script), so it
adds a GROUP BY key, never a statement.

Group by ``edition_group()`` (the label), never by the expression again: the expression
holds bound parameters (the JSON key, the version, the cap), and each copy of it binds
its own, so Postgres does not see the SELECT's CASE as the one grouped and raises
``GroupingError`` (SQLite does not notice). Postgres and SQLite both accept an output
column's name in GROUP BY; no ``games`` or ``game_types`` column shares it
(``tests/test_daily_challenge_sort_pg.py`` runs every reader on Postgres).
"""

from __future__ import annotations

from sqlalchemy import ColumnElement, Label, case, literal_column

from daily_challenge.definitions import CATALOG_EDITION, LEGACY_EDITION, SORT_EDITION
from games.boards.sql import edition_matches

EDITION_LABEL = "sort_edition"


def edition_column() -> Label[int]:
    """``CATALOG_EDITION`` when the row's metadata holds the current catalog version, as
    the leaderboard reads it (``games.boards.sql.edition_matches``: an int, never a bool
    or string), else ``LEGACY_EDITION``, labelled ``EDITION_LABEL`` for the SELECT list.
    Only Sort rows hold ``catalog_version``, so every other game reads as one edition."""
    return case((edition_matches(SORT_EDITION), CATALOG_EDITION), else_=LEGACY_EDITION).label(
        EDITION_LABEL
    )


def edition_group() -> ColumnElement[int]:
    """The GROUP BY key for ``edition_column``: its label (module docstring)."""
    return literal_column(EDITION_LABEL)
