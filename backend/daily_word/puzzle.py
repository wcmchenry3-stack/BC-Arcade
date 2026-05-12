"""Daily Word puzzle selection — deterministic, timezone-aware (#1188).

Seeding: index = (int(date.strftime("%Y%m%d")) + SALT) % len(answers)
SALT comes from the DAILY_WORD_SALT env var (int, default 0).
puzzle_id format: "YYYY-MM-DD:{lang}"
"""

from __future__ import annotations

import os
import unicodedata
from datetime import datetime, timedelta, timezone
from pathlib import Path

# DAILY_WORD_SALT must be set in production; default 0 makes answer order trivially derivable.
SALT = int(os.environ.get("DAILY_WORD_SALT", "0"))
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

_ANSWERS: dict[str, list[str]] = {"en": _ANSWERS_EN, "hi": _ANSWERS_HI}
_VALID: dict[str, frozenset[str]] = {"en": _VALID_EN, "hi": _VALID_HI}


def _local_date(tz_offset_minutes: int, utc_now: datetime | None = None) -> datetime:
    if utc_now is None:
        utc_now = datetime.now(timezone.utc)
    return utc_now + timedelta(minutes=tz_offset_minutes)


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
        "puzzle_id": f"{date_str}:{lang}",
        "word_length": len(answers[index]),
    }


def get_answer(puzzle_id: str) -> str:
    """Derive the answer for a puzzle_id — used server-side only, never returned."""
    date_str, lang = puzzle_id.rsplit(":", 1)
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
