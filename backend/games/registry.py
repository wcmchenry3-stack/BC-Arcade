"""Game module registry (#540).

Maps each ``GameType`` string value to its ``GameModule`` instance.
``service.py`` uses this for generic dispatch instead of ``if name ==`` branches.

To register a new game: import its module singleton and add it to ``_MODULES``.
"""

from __future__ import annotations

from blackjack.module import module as blackjack_module
from cascade.module import module as cascade_module
from daily_word.module import module as daily_word_module
from freecell.module import module as freecell_module
from games.protocol import GameModule
from hearts.module import module as hearts_module
from mahjong.module import module as mahjong_module
from solitaire.module import module as solitaire_module
from sort.module import module as sort_module
from starswarm.module import module as starswarm_module
from sudoku.module import module as sudoku_module
from twenty48.module import module as twenty48_module
from yacht.module import module as yacht_module

# Every game module, one per ``GameType`` (``tests/test_game_module_base.py``
# checks that each ``<game>/module.py`` is here).
_MODULES: tuple[GameModule, ...] = (
    blackjack_module,
    cascade_module,
    daily_word_module,
    freecell_module,
    hearts_module,
    mahjong_module,
    solitaire_module,
    sort_module,
    starswarm_module,
    sudoku_module,
    twenty48_module,
    yacht_module,
)

# Keyed by GameType.value (str) so lookups work directly against the name
# column returned by DB queries.
_REGISTRY: dict[str, GameModule] = {m.game_type.value: m for m in _MODULES}


def get_module(game_type_name: str) -> GameModule | None:
    """Return the GameModule for *game_type_name*, or None if unregistered."""
    return _REGISTRY.get(game_type_name)
