"""Game module registry (#540).

Maps each ``GameType`` string value to its ``GameModule`` instance.
``service.py`` uses this for generic dispatch instead of ``if name ==`` branches.

To register a new game: import its module singleton and add an entry below.
"""

from __future__ import annotations

from blackjack.module import module as blackjack_module
from cascade.module import module as cascade_module
from daily_word.module import module as daily_word_module
from hearts.module import module as hearts_module
from mahjong.module import module as mahjong_module
from solitaire.module import module as solitaire_module
from sort.module import module as sort_module
from sudoku.module import module as sudoku_module

from games.protocol import GameModule

# Keyed by GameType.value (str) so lookups work directly against the name
# column returned by DB queries.
_REGISTRY: dict[str, GameModule] = {
    blackjack_module.game_type.value: blackjack_module,
    cascade_module.game_type.value: cascade_module,
    daily_word_module.game_type.value: daily_word_module,
    hearts_module.game_type.value: hearts_module,
    mahjong_module.game_type.value: mahjong_module,
    solitaire_module.game_type.value: solitaire_module,
    sort_module.game_type.value: sort_module,
    sudoku_module.game_type.value: sudoku_module,
}


def get_module(game_type_name: str) -> GameModule | None:
    """Return the GameModule for *game_type_name*, or None if unregistered."""
    return _REGISTRY.get(game_type_name)
