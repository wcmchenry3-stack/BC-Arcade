"""Where a board finds a player's display name (#2624, #2519 decisions 17-18).

Every board, the rank query and the name route resolve names through
:func:`name_lookup` and nothing else. Today a player is one session id and the
name is that session's ``players`` row. Accounts (#1047) will map several
session ids to one account and its name: that is a change to ``name_lookup``
alone, and every board follows.
"""

from __future__ import annotations

from sqlalchemy import ColumnElement, Exists, ScalarSelect, Select, select

from db.models import Player


def name_lookup(session_id: ColumnElement[str]) -> Select[tuple[str]]:
    """The display name of the player behind ``session_id`` (no row: no name).

    ``session_id`` is a column of the enclosing query (``games.session_id``
    or a subquery's), so the select is correlated. It is a primary-key lookup
    on ``players``.
    """
    return select(Player.display_name).where(Player.session_id == session_id)


def has_display_name(session_id: ColumnElement[str]) -> Exists:
    """``EXISTS``: the player behind ``session_id`` has a display name.

    A filter, so it composes into the board, best-row and rank queries (which
    read ``games`` only) without adding a join.
    """
    return name_lookup(session_id).exists()


def display_name_of(session_id: ColumnElement[str]) -> ScalarSelect[str]:
    """The player's display name as a column (NULL when there is none)."""
    return name_lookup(session_id).scalar_subquery()
