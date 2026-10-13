"""Fold keys for the French and Spanish Daily Word generator (#3239).

``fold`` is the runtime's own ``daily_word.normalize.fold`` (#3240), imported rather than
copied so the generated lists and the game can never disagree on a key: ``était`` ->
``etait``, ``cœur`` -> ``coeur``, ``niño`` -> ``niño`` in ``es`` (``nino`` in ``fr``).
"""

from __future__ import annotations

import sys
import unicodedata
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from daily_word.normalize import fold

__all__ = ["ALPHABETS", "accent_count", "fold", "is_key", "words"]

ALPHABETS = {
    "fr": frozenset("abcdefghijklmnopqrstuvwxyz"),
    "es": frozenset("abcdefghijklmnopqrstuvwxyzñ"),
}


def is_key(key: str, lang: str) -> bool:
    """True when ``key`` is exactly 5 letters of ``lang``'s game alphabet."""
    return len(key) == 5 and all(ch in ALPHABETS[lang] for ch in key)


def words(text: str) -> tuple[str, ...]:
    """Whitespace-separated words of a literal (keeps long ending tables readable)."""
    return tuple(text.split())


def accent_count(word: str) -> int:
    """Number of combining marks in ``word`` (used only as a deterministic tie-break)."""
    return sum(1 for ch in unicodedata.normalize("NFD", word) if unicodedata.combining(ch))
