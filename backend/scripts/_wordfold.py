"""Accent folding for the French and Spanish Daily Word lists (#3239, contract for #3240).

``fold`` turns a display word (``était``, ``árbol``, ``cœur``, ``niño``) into its gameplay
key (``etait``, ``arbol``, ``coeur``, ``niño``). It is a pure function with no I/O so the
runtime helper in #3240 can share or mirror it exactly.
"""

from __future__ import annotations

import unicodedata

_TILDE = "\u0303"  # COMBINING TILDE (n + this = ñ)

ALPHABETS = {
    "fr": frozenset("abcdefghijklmnopqrstuvwxyz"),
    "es": frozenset("abcdefghijklmnopqrstuvwxyzñ"),
}


def fold(word: str) -> str:
    """Gameplay key for a display word.

    Lowercase, NFD-decompose, drop every combining mark except the tilde on ``n`` (so
    ``ñ`` survives), recompose to NFC, then map ``œ``->``oe`` and ``æ``->``ae``.
    Language-independent; ``is_key`` applies each language's alphabet.
    """
    out: list[str] = []
    for ch in unicodedata.normalize("NFD", word.lower()):
        if unicodedata.combining(ch):
            if ch == _TILDE and out and out[-1] == "n":
                out.append(ch)
            continue
        out.append(ch)
    s = unicodedata.normalize("NFC", "".join(out))
    return s.replace("œ", "oe").replace("æ", "ae")


def is_key(key: str, lang: str) -> bool:
    """True when ``key`` is exactly 5 letters of ``lang``'s game alphabet."""
    return len(key) == 5 and all(ch in ALPHABETS[lang] for ch in key)


def words(text: str) -> tuple[str, ...]:
    """Whitespace-separated words of a literal (keeps long ending tables readable)."""
    return tuple(text.split())


def accent_count(word: str) -> int:
    """Number of combining marks in ``word`` (used only as a deterministic tie-break)."""
    return sum(1 for ch in unicodedata.normalize("NFD", word) if unicodedata.combining(ch))
