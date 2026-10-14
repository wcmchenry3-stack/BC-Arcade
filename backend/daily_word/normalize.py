"""Accent folding for the Romance-language Daily Word puzzles (#3240).

``fold`` turns a display-form word (``était``, ``niño``) into the key the game
validates and scores on (``etait``, ``niño``). It is used both when the word
lists are loaded and on every guess, so a typed ``ETAIT`` and ``était`` land on
the same key.

Hindi is deliberately not folded: stripping combining marks would destroy
Devanagari. ``hi`` only gets the NFC normalisation it has always had.
"""

from __future__ import annotations

import unicodedata

_LIGATURES = {"œ": "oe", "æ": "ae"}
_TILDE = "̃"


def fold(word: str, lang: str) -> str:
    """Return the fold key for ``word`` in ``lang``.

    NFC, lowercase, NFD, strip combining marks (except the tilde on ``n`` for
    ``es``, so ``ñ`` stays a distinct letter), map ``œ``/``æ``, NFC again.
    For ``en`` this is a no-op on ``a-z`` input; ``hi`` is only NFC-normalised.
    """
    word = unicodedata.normalize("NFC", word).lower()
    if lang == "hi":
        return word
    out: list[str] = []
    for ch in unicodedata.normalize("NFD", word):
        if unicodedata.combining(ch):
            if lang == "es" and ch == _TILDE and out and out[-1] == "n":
                out.append(ch)
            continue
        out.append(_LIGATURES.get(ch, ch))
    return unicodedata.normalize("NFC", "".join(out))
