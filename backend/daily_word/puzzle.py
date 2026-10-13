"""Daily Word puzzle selection — deterministic, timezone-aware (#1188).

Seeding: answers list is shuffled once at load time with random.Random(SALT),
then index = (int(date.strftime("%Y%m%d")) + SALT) % len(answers).
SALT comes from the DAILY_WORD_SALT env var (int, default 0).
Changing SALT shifts the entire future word schedule.
puzzle_id format: "YYYY-MM-DD:{lang}" for Hindi, "YYYY-MM-DD:en:{version}" for English.

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

# Per-language answers-list version, appended to the puzzle_id when non-zero.
_LIST_VERSION: dict[str, int] = {"en": 2, "hi": 0}

_ANSWERS: dict[str, list[str]] = {"en": _ANSWERS_EN, "hi": _ANSWERS_HI}
_VALID: dict[str, frozenset[str]] = {"en": _VALID_EN, "hi": _VALID_HI}


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
    index = (date_int + SALT) % len(answers)
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
    """Return today and the next two local days: puzzle_id, word_length, answer_blob."""
    start = _local_date(tz_offset_minutes, _utc_now)
    out: list[dict] = []
    for offset in range(UPCOMING_DAYS):
        puzzle_id = make_puzzle_id((start + timedelta(days=offset)).strftime("%Y-%m-%d"), lang)
        answer = get_answer(puzzle_id)
        out.append(
            {
                "puzzle_id": puzzle_id,
                "word_length": len(answer),
                "answer_blob": scramble_answer(puzzle_id, answer),
            }
        )
    return out


def get_answer(puzzle_id: str) -> str:
    """Derive the answer for a puzzle_id — used server-side only, never returned."""
    date_str, lang = parse_puzzle_id(puzzle_id)
    answers = _ANSWERS.get(lang, _ANSWERS_EN)
    date_int = int(date_str.replace("-", ""))
    index = (date_int + SALT) % len(answers)
    return answers[index]


def is_valid_guess(word: str, lang: str = "en") -> bool:
    """O(1) frozenset lookup — True if word is a valid guess for the given language."""
    valid = _VALID.get(lang, _VALID_EN)
    if lang == "hi":
        word = unicodedata.normalize("NFC", word)
    return word in valid
