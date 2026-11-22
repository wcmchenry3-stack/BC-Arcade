"""Sort's fixed level catalog, as far as the server needs to know it (#2761).

The levels themselves ship inside the app
(``frontend/src/game/sort/levels.catalog.json``, built by
``scripts/sort_build_catalog.py``); the server never serves them. It only
needs their count, to bound ``level_reached``, and the catalog version, which
the app sends with every scored solve and the leaderboard ranks on: a row
from another catalog (or from before the catalog, when levels were random
per request) is stored but never ranks. ``tests/test_sort_catalog.py`` checks
both match the committed catalog file.
"""

from __future__ import annotations

CATALOG_VERSION = 1
CHAPTER_SIZE = 20
LEVEL_COUNT = 120
