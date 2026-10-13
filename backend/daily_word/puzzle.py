"""Daily Word puzzle selection — deterministic, timezone-aware (#1188).

Seeding: answers list is shuffled once at load time with random.Random(SALT),
then index = (int(date.strftime("%Y%m%d")) + SALT) % len(answers).
SALT comes from the DAILY_WORD_SALT env var (int, default 0).
Changing SALT shifts the entire future word schedule.
puzzle_id format: "YYYY-MM-DD:{lang}" for Hindi, "YYYY-MM-DD:{lang}:{version}" for
English, French and Spanish.

French and Spanish (#3240): the word files hold display forms (``était``, ``niño``).
The loader folds each one (``normalize.fold``) and the game works on folded keys
only: answers, valid guesses and scoring. ``_DISPLAY[lang]`` maps a folded key back
to its display form for the API. Each language also gets a day offset
(``_DAY_OFFSET``) so ``en``, ``fr`` and ``es`` don't walk their lists in step.
English and Hindi offsets are 0 so their existing answers do not change. If a
language's list files are absent it is simply not loaded, and every endpoint
answers 422 for it (``is_supported`` is False).

The English id carries the answers-list version (``_LIST_VERSION["en"]``). When the
English lists were replaced with clearly licensed sources (#3155) every date's answer
changed, so the id changed with it: a client holding an in-progress board or a guess
record under the old ``YYYY-MM-DD:en`` id cannot be validated against a different
answer. Old ids are refused as stale (clients then load the current puzzle) and
their stored progress rows are left to age out under ``retention``. Bump the
version whenever the answers list changes.
"""

from __future__ import annotations

import base64
import hashlib
import random
import unicodedata
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

from daily_word.normalize import fold
from settings import Settings

# DAILY_WORD_SALT must be set in production; default 0 makes answer order trivially derivable.
# Read when this module is imported, because the shuffle below needs it; an empty
# or non-integer value raises ValueError here, which stops ``import main`` (#2997).
SALT = int(Settings().daily_word_salt)
_WORDS_DIR = Path(__file__).parent / "words"


def _load_list(filename: str) -> list[str]:
    path = _WORDS_DIR / filename
    return [line.strip() for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


_ANSWERS_EN: list[str] = _load_list("answers_en.txt")
_VALID_EN: frozenset[str] = frozenset(_load_list("valid_en.txt")) | frozenset(_ANSWERS_EN)

_ANSWERS_HI: list[str] = [unicodedata.normalize("NFC", w) for w in _load_list("answers_hi.txt")]
# valid_hi.txt intentionally includes proper nouns — accepted as guesses but excluded from answers
_VALID_HI: frozenset[str] = frozenset(
    unicodedata.normalize("NFC", w) for w in _load_list("valid_hi.txt")
) | frozenset(_ANSWERS_HI)

# Shuffle each answers list so consecutive days pick pseudo-random entries rather than
# sequential list positions. Each language uses an independent seeded RNG so their
# schedules don't depend on each other's list length.
random.Random(SALT).shuffle(_ANSWERS_EN)
random.Random(SALT).shuffle(_ANSWERS_HI)


def _load_romance(lang: str) -> tuple[list[str], frozenset[str], dict[str, str]] | None:
    """Load a display-form fr/es list pair as (folded answers, folded valid, display map).

    Returns None if either file is missing (the language is then unsupported).
    The first display form seen for a fold key wins; #3239 guarantees unique keys.
    """
    if not (
        (_WORDS_DIR / f"answers_{lang}.txt").is_file()
        and (_WORDS_DIR / f"valid_{lang}.txt").is_file()
    ):
        return None
    display: dict[str, str] = {}
    answers: list[str] = []
    for w in _load_list(f"answers_{lang}.txt"):
        key = fold(w, lang)
        if key not in display:
            answers.append(key)
            display[key] = unicodedata.normalize("NFC", w)
    for w in _load_list(f"valid_{lang}.txt"):
        display.setdefault(fold(w, lang), unicodedata.normalize("NFC", w))
    return answers, frozenset(display), display


# Per-language answers-list version, appended to the puzzle_id when non-zero.
_LIST_VERSION: dict[str, int] = {"en": 2, "hi": 0, "fr": 1, "es": 1}

# Added to the day number before indexing, so languages don't share an index
# pattern. en/hi stay 0: changing them would change every existing answer.
_DAY_OFFSET: dict[str, int] = {"en": 0, "hi": 0, "fr": 7919, "es": 104729}

_ANSWERS: dict[str, list[str]] = {"en": _ANSWERS_EN, "hi": _ANSWERS_HI}
_VALID: dict[str, frozenset[str]] = {"en": _VALID_EN, "hi": _VALID_HI}
# folded key -> display form, fr/es only. en/hi display the answer itself.
_DISPLAY: dict[str, dict[str, str]] = {}


def _register_romance(lang: str) -> None:
    loaded = _load_romance(lang)
    if loaded is None:
        return
    answers, valid, display = loaded
    random.Random(SALT).shuffle(answers)
    _ANSWERS[lang] = answers
    _VALID[lang] = valid
    _DISPLAY[lang] = display


for _lang in ("fr", "es"):
    _register_romance(_lang)


def is_supported(lang: str) -> bool:
    """True if puzzles can be served for ``lang`` (its lists are loaded)."""
    return lang in _ANSWERS


def _index(date_int: int, lang: str, size: int) -> int:
    return (date_int + SALT + _DAY_OFFSET.get(lang, 0)) % size


def get_display(word: str, lang: str) -> str:
    """Display form (accents kept) of a folded ``word``; ``word`` itself for en/hi."""
    return _DISPLAY.get(lang, {}).get(word, word)


def _local_date(tz_offset_minutes: int, utc_now: datetime | None = None) -> datetime:
    if utc_now is None:
        utc_now = datetime.now(UTC)
    return utc_now + timedelta(minutes=tz_offset_minutes)


def make_puzzle_id(date_str: str, lang: str) -> str:
    version = _LIST_VERSION.get(lang, 0)
    return f"{date_str}:{lang}:{version}" if version else f"{date_str}:{lang}"


class StalePuzzleId(ValueError):
    """A well-formed id whose list version is not current (e.g. a pre-#3155 ``YYYY-MM-DD:en``)."""


def parse_puzzle_id(puzzle_id: str) -> tuple[str, str]:
    """Split a puzzle_id into (date_str, lang).

    Raises ``ValueError`` if it is malformed: wrong shape, a date that is not a real
    ASCII ``YYYY-MM-DD`` calendar date, or an unsupported language. Raises
    ``StalePuzzleId`` (a ``ValueError``) if it is well formed but carries a list
    version other than the current one for that language.
    """
    parts = puzzle_id.split(":")
    if len(parts) not in (2, 3):
        raise ValueError("invalid_puzzle_id")
    date_str, lang = parts[0], parts[1]
    if lang not in _ANSWERS:
        raise ValueError("invalid_puzzle_id")
    try:
        # Round-trip: rejects week dates (2026-W05-1) and non-ASCII digits that
        # fromisoformat would otherwise accept.
        if date.fromisoformat(date_str).isoformat() != date_str:
            raise ValueError("invalid_puzzle_id")
    except ValueError as exc:
        raise ValueError("invalid_puzzle_id") from exc
    if make_puzzle_id(date_str, lang) != puzzle_id:
        raise StalePuzzleId("stale_puzzle_id")
    return date_str, lang


def get_today_meta(
    tz_offset_minutes: int, lang: str = "en", _utc_now: datetime | None = None
) -> dict:
    """Return puzzle metadata for today — never includes the answer."""
    answers = _ANSWERS.get(lang, _ANSWERS_EN)
    local_ts = _local_date(tz_offset_minutes, _utc_now)
    date_str = local_ts.strftime("%Y-%m-%d")
    date_int = int(local_ts.strftime("%Y%m%d"))
    index = _index(date_int, lang, len(answers))
    return {
        "puzzle_id": make_puzzle_id(date_str, lang),
        "word_length": len(answers[index]),
    }


UPCOMING_DAYS = 3  # today + 2


def scramble_answer(puzzle_id: str, answer: str) -> str:
    """Obfuscate ``answer`` for the offline /upcoming payload (#3229).

    XOR the UTF-8 answer with SHA-256(puzzle_id as UTF-8), repeated cyclically
    (the digest is 32 bytes; the key index is ``i % 32``), then standard base64.
    This only stops casual spoilers (a glance at the network tab): anyone who
    knows this scheme can decode it. It is NOT security (#3022 accepted that).
    Decoding is the same XOR, so the client reverses it with the same key.
    """
    key = hashlib.sha256(puzzle_id.encode("utf-8")).digest()
    raw = answer.encode("utf-8")
    return base64.b64encode(bytes(b ^ key[i % len(key)] for i, b in enumerate(raw))).decode("ascii")


def get_upcoming(
    tz_offset_minutes: int, lang: str = "en", _utc_now: datetime | None = None
) -> list[dict]:
    """Return today and the next two local days: puzzle_id, word_length, answer_blob (+ display_blob for fr/es)."""
    start = _local_date(tz_offset_minutes, _utc_now)
    out: list[dict] = []
    for offset in range(UPCOMING_DAYS):
        puzzle_id = make_puzzle_id((start + timedelta(days=offset)).strftime("%Y-%m-%d"), lang)
        answer = get_answer(puzzle_id)
        entry = {
            "puzzle_id": puzzle_id,
            "word_length": len(answer),
            "answer_blob": scramble_answer(puzzle_id, answer),
        }
        if lang in _DISPLAY:  # fr/es only; en/hi payloads are unchanged (#3240)
            entry["display_blob"] = scramble_answer(puzzle_id, get_display(answer, lang))
        out.append(entry)
    return out


def get_answer(puzzle_id: str) -> str:
    """Derive the answer for a puzzle_id — used server-side only, never returned."""
    date_str, lang = parse_puzzle_id(puzzle_id)
    answers = _ANSWERS.get(lang, _ANSWERS_EN)
    date_int = int(date_str.replace("-", ""))
    return answers[_index(date_int, lang, len(answers))]


def is_valid_guess(word: str, lang: str = "en") -> bool:
    """O(1) frozenset lookup — True if word is a valid guess for the given language."""
    valid = _VALID.get(lang, _VALID_EN)
    if lang == "hi":
        word = unicodedata.normalize("NFC", word)
    elif lang in ("fr", "es"):
        word = fold(word, lang)
    return word in valid
