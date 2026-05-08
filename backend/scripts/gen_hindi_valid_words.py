#!/usr/bin/env python3
"""Build daily_word/words/valid_hi.txt from public Hindi frequency corpora.

Rules (mirror the English valid_en.txt conventions):
  - Exactly 5 NFC code points
  - Every character in the Devanagari Unicode block (U+0900–U+097F)
  - NFC-normalised, sorted, deduplicated
  - All answers_hi.txt entries are force-included

Sources (no extra dependencies — stdlib urllib only):
  1. hermitdave/FrequencyWords hi_50k  — subtitle-corpus frequency list
  2. hermitdave/FrequencyWords hi_full — larger frequency list
  3. Hindi Wiktionary title dump        — curated dictionary headwords (CC BY-SA 4.0)
  4. Existing valid_hi.txt              — preserves any hand-curated entries

Attribution: The Hindi Wiktionary title dump is licensed under CC BY-SA 4.0.
See https://creativecommons.org/licenses/by-sa/4.0/ and
https://dumps.wikimedia.org/hiwiktionary/ for licensing details.

Usage (run from repo root):
    python backend/scripts/gen_hindi_valid_words.py
"""

from __future__ import annotations

import gzip
import sys
import time
import unicodedata
import urllib.error
import urllib.request
from pathlib import Path

WORDS_DIR = Path(__file__).parents[1] / "daily_word" / "words"
ANSWERS_FILE = WORDS_DIR / "answers_hi.txt"
VALID_FILE = WORDS_DIR / "valid_hi.txt"

DEVANAGARI_START = 0x0900
DEVANAGARI_END = 0x097F

SOURCES = [
    (
        "hermitdave_50k",
        "https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/hi/hi_50k.txt",
        "frequency",
    ),
    (
        "hermitdave_full",
        "https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/hi/hi_full.txt",
        "frequency",
    ),
    (
        "wiktionary_titles",
        "https://dumps.wikimedia.org/hiwiktionary/latest/hiwiktionary-latest-all-titles-in-ns0.gz",
        "gzip_titles",
    ),
]

TARGET_MIN = 3_000
TARGET_IDEAL = 5_000


def nfc(word: str) -> str:
    return unicodedata.normalize("NFC", word)


def is_devanagari_5cp(word: str) -> bool:
    """True iff word is exactly 5 NFC code points, all in Devanagari block."""
    return len(word) == 5 and all(DEVANAGARI_START <= ord(c) <= DEVANAGARI_END for c in word)


def fetch(url: str) -> bytes:
    """Fetch URL with exponential backoff retry (Wikimedia rate-limiting compliance)."""
    max_retries = 3
    base_delay = 1.0  # seconds

    for attempt in range(max_retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "bc-arcade-wordlist-builder/1.0"})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except (urllib.error.HTTPError, urllib.error.URLError) as exc:
            if attempt == max_retries - 1:
                raise
            delay = base_delay * (2 ** attempt)
            print(f"  Retry {attempt + 1}/{max_retries - 1} after {delay}s (error: {exc})", file=sys.stderr)
            time.sleep(delay)


def extract_words(raw: bytes, fmt: str) -> list[str]:
    if fmt == "gzip_titles":
        text = gzip.decompress(raw).decode("utf-8", errors="ignore")
        # Wiktionary dumps use underscores for spaces; skip multi-word entries
        return [line.strip().replace("_", " ") for line in text.splitlines()]
    # "frequency" format: "word count" per line
    words = []
    for line in raw.decode("utf-8", errors="ignore").splitlines():
        parts = line.strip().split()
        if parts:
            words.append(parts[0])
    return words


def load_existing(path: Path) -> set[str]:
    if not path.exists():
        return set()
    return {nfc(w) for w in path.read_text("utf-8").splitlines() if w.strip()}


def main() -> None:
    answers = load_existing(ANSWERS_FILE)
    existing_valid = load_existing(VALID_FILE)
    print(f"Loaded {len(answers)} answers, {len(existing_valid)} existing valid words")

    candidates: set[str] = set(answers) | existing_valid

    for name, url, fmt in SOURCES:
        print(f"Fetching {name}…", flush=True)
        try:
            raw = fetch(url)
            words = extract_words(raw, fmt)
            before = len(candidates)
            for w in words:
                w = nfc(w.strip())
                if is_devanagari_5cp(w):
                    candidates.add(w)
            print(f"  +{len(candidates) - before:,} new words (raw: {len(words):,})")
        except Exception as exc:
            print(f"  WARN: {exc}", file=sys.stderr)

    result = sorted(candidates)
    VALID_FILE.write_text("\n".join(result) + "\n", encoding="utf-8")

    extra = len(candidates) - len(answers)
    print(f"\nWrote {len(result):,} total words to {VALID_FILE}")
    print(f"  {len(answers):,} forced answers")
    print(f"  {extra:,} additional valid guesses")

    missing_answers = answers - candidates
    if missing_answers:
        print(f"\nERROR: {len(missing_answers)} answers missing from valid list!", file=sys.stderr)
        sys.exit(1)

    if len(result) < TARGET_MIN:
        print(f"\nERROR: only {len(result):,} words — minimum is {TARGET_MIN:,}", file=sys.stderr)
        sys.exit(1)
    elif len(result) < TARGET_IDEAL:
        print(f"\nNOTE: {len(result):,} words; ideal target is {TARGET_IDEAL:,} — add more sources if possible")
    else:
        print(f"Target met: {len(result):,} >= {TARGET_IDEAL:,}")


if __name__ == "__main__":
    main()
