"""Generic leaderboards, driven by each module's ``BoardDefinition`` (#2618).

One query and one rank calculation (``player_standing``, behind
``GET /games/{id}/rank``, and ``viewer_entry``, the caller's own entry on
``GET /games/leaderboard``) serve every game. They replaced the per-game
leaderboard routers and the ``PATCH /games/{id}/name`` route, which #2644
removed; a name is set with ``PUT /players/me``.

Rules every board follows
-------------------------
- **One entry per player** (#2519 decision 12): rows are grouped by
  ``session_id`` and only each session's best row is listed. "Best" is the
  board's metric in its direction, then its tie-break, then the earliest
  ``completed_at``. The same key orders the board and drives the rank, so a
  replay that doesn't beat a player's best never shows up.
- **Only named players rank** (#2624, #2519 decisions 17-18): a session ranks
  only if its player has a display name (a ``players`` row), and then **every**
  eligible finished game of that player counts. The name shown is the
  player's current one, looked up through ``players.names`` (the one place
  #1047's accounts will change), so a rename shows on every entry at once.
  ``metadata.player_name`` plays no part in ranking.
- **Excluded**: abandoned rows (``not_abandoned()``), rows whose outcome is
  not in ``qualifying_outcomes`` (when the board sets it), and every sentinel
  ``*-anon`` session. The legacy ``POST /<game>/score`` routes that wrote
  those rows are gone (#2644) and migrations 0026/0029 deleted the rows
  (#2622), but a deploy runs 0029 while the old instance still serves the
  routes, so rows written in that window survive it. This filter keeps them
  off every board.
- **Only sane values rank**: the metric must be an integer from the board's
  ``min_value`` (0 unless set; Mahjong's clear-time floor, #2747) to the
  row's effective cap (``board.max_value_for``, or ``MAX_BOARD_VALUE`` when
  uncapped). A tie-break that isn't an integer in ``[0, MAX_BOARD_VALUE]``
  counts as missing. Rows stored before these rules were enforced on write
  (negative, over-cap, strings, huge numbers) are filtered on read, so they
  can neither top a board nor break its query.
- **Exact rank**: the number of players whose best beats yours, plus one.

The per-player best uses ``ROW_NUMBER() OVER (PARTITION BY session_id ...)`` so it
runs on SQLite (CI, >= 3.25) and Postgres (prod); ``DISTINCT ON`` is Postgres-only.

Layout (#2992; the former ``games/leaderboard.py`` is gone, nothing re-exports it)
-----------------------------------------------------------------------------------
- ``types``: the result types (``BoardEntry``, ``Standing``, ``GameRank``,
  ``LimitViolation``) and ``LeaderboardError``. ``RankReason`` itself lives in
  ``games/board.py`` so the request schemas can use it without importing the
  query layer.
- ``partitions``: board lookup, partition resolution and the effective cap.
- ``sql``: the SQL building blocks (``metadata_count``, ``metric_expr``,
  ``board_filters``, the best-row window and the board order).
- ``queries``: the board, viewer and rank queries behind the routes.
- ``limits``: the submission limits ``PATCH /games/{id}/complete`` enforces.

``partitions`` and ``queries`` look boards up in ``games.registry``, which
imports every ``<game>/module.py``; ``games/schemas.py`` imports nothing from
this package (``tests/test_import_graph.py``).
"""
