#!/usr/bin/env python3
"""Build daily_word/words/{valid_en,answers_en}.txt from clearly licensed sources (#3155).

Sources (each pinned by URL + SHA-256; the script refuses to run on a mismatch):
  1. ENABLE word list (public domain)
     https://github.com/dolph/dictionary — enable1.txt
     -> valid_en.txt: every 5-letter a-z word.
  2. SCOWL 2020.12.07 (Kevin Atkinson; permissive MIT-like licence — the copyright
     notice must travel with the lists, see ATTRIBUTION.md)
     -> answers_en.txt: common American/English words (size levels 10, 20, 35,
     files ``final/english-words.*`` and ``final/american-words.*``; the proper-noun,
     abbreviation, contraction and variant lists are never read), 5 letters a-z,
     also present in ENABLE, minus inflected forms and the blocklist.

Answer filtering (Wordle convention):
  - drop inflected forms (plurals, past tense, -ing, comparatives; see
    inflection_rule) except the explicit INFLECTION_KEEP list;
  - drop anything in daily_word/words/answers_blocklist_en.txt.
Blocklisted words stay valid *guesses* when ENABLE has them; they are only never
the daily answer.

Output is sorted and deterministic. The downloads are held in memory only and are
never written to the repo.

Usage (run from repo root):
    python backend/scripts/gen_english_words.py
"""

from __future__ import annotations

import hashlib
import io
import re
import sys
import tarfile
import urllib.request
from pathlib import Path

WORDS_DIR = Path(__file__).parents[1] / "daily_word" / "words"
VALID_FILE = WORDS_DIR / "valid_en.txt"
ANSWERS_FILE = WORDS_DIR / "answers_en.txt"
BLOCKLIST_FILE = WORDS_DIR / "answers_blocklist_en.txt"

ENABLE_URL = "https://raw.githubusercontent.com/dolph/dictionary/master/enable1.txt"
ENABLE_SHA256 = "3f16130220645692ed49c7134e24a18504c2ca55b3c012f7290e3e77c63b1a89"

SCOWL_URL = "https://downloads.sourceforge.net/wordlist/scowl-2020.12.07.tar.gz"
SCOWL_SHA256 = "5587667caa20c4891390c2d42dbb4d5c4c3f41bee77af1457ece3ba23fb859cc"
SCOWL_PREFIX = "scowl-2020.12.07/final/"
SCOWL_FILES = tuple(
    f"{SCOWL_PREFIX}{dialect}-words.{size}"
    for dialect in ("english", "american")
    for size in (10, 20, 35)
)

WORD_RE = re.compile(r"^[a-z]{5}$")
STEM_RE = re.compile(r"^[a-z]{2,4}$")

# Inflected forms are dropped from the answers (Wordle convention): a word is an
# inflection when stripping a suffix leaves an ENABLE word (ENABLE has no part
# of speech, so the rules over-match and INFLECTION_KEEP rescues real standalone
# words). Rules, with the 2-4 letter stem set:
#   -s     word[:-1]             (cats)         -es   word[:-2]                  (boxes)
#   -ies   word[:-3] + "y"       (cries)        -ied  word[:-3] + "y"            (fried)
#   -ed    word[:-1] / word[:-2] (freed, acted) -ing  word[:-3] / word[:-3] + "e" (cuing, eking)
#   -er    word[:-2] / word[:-1] (wider, wryer) -ier  word[:-3] + "y"            (icier)
#   -est   word[:-3] / word[:-3] + "e" / word[:-2]
INFLECTION_KEEP = frozenset(
    # -s: plural-only or non-plural words
    "abyss amass amiss brass chaos dregs genus jeans kudos lungs mumps pants tongs yours "  # noqa: SIM905
    # -ed: also common standalone adjectives or nouns
    "armed bored breed famed fixed greed jaded mixed tired tweed "
    # -ing
    "being icing thing "
    # -er: standalone nouns and adjectives
    "after alter baker boxer buyer caper cater cover cower dryer diner diver elder ether "
    "fewer fiber foyer hover inner joker lager laser later layer lever liner liter liver "
    "loser lover lower maker meter miner miser mixer never offer outer owner pager paper "
    "peter poker power racer refer rider river ruler saber sewer sheer sober super timer "
    "tower tuner under voter wager water waver wiper".split()
)


def inflection_rule(w: str, stems: frozenset[str]) -> str | None:
    """Name of the inflection rule that matches ``w``, else None (before INFLECTION_KEEP)."""
    if w.endswith("s") and w[:-1] in stems:
        return "s"
    if w.endswith(("ies", "ied")) and w[:-3] + "y" in stems:
        return w[-3:]
    if w.endswith("es") and w[:-2] in stems:
        return "es"
    if w.endswith("ed") and (w[:-1] in stems or w[:-2] in stems):
        return "ed"
    if w.endswith("ing") and (w[:-3] in stems or w[:-3] + "e" in stems):
        return "ing"
    if w.endswith("er") and (w[:-2] in stems or w[:-1] in stems):
        return "er"
    if w.endswith("ier") and w[:-3] + "y" in stems:
        return "ier"
    if w.endswith("est") and (w[:-3] in stems or w[:-3] + "e" in stems or w[:-2] in stems):
        return "est"
    return None


def fetch_verified(url: str, sha256: str) -> bytes:
    """Download ``url`` and return its bytes, exiting if the SHA-256 differs."""
    req = urllib.request.Request(url, headers={"User-Agent": "bc-arcade-gen-english-words"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        data = resp.read()
    digest = hashlib.sha256(data).hexdigest()
    if digest != sha256:
        sys.exit(f"checksum mismatch for {url}\n  expected {sha256}\n  got      {digest}")
    return data


def parse_enable(text: str) -> tuple[frozenset[str], frozenset[str]]:
    """Return (5-letter words, 2- to 4-letter words) of an ENABLE listing."""
    words = {w.strip() for w in text.splitlines()}
    return (
        frozenset(w for w in words if WORD_RE.match(w)),
        frozenset(w for w in words if STEM_RE.match(w)),
    )


def parse_blocklist(text: str) -> frozenset[str]:
    """One word per line; blank lines and ``#`` comments are ignored."""
    out = set()
    for line in text.splitlines():
        line = line.split("#", 1)[0].strip().lower()
        if line:
            out.add(line)
    return frozenset(out)


def build_answers(
    candidates: set[str] | frozenset[str],
    enable5: frozenset[str],
    stems: frozenset[str],
    blocklist: frozenset[str],
) -> list[str]:
    """Filter SCOWL candidates down to the sorted answers list."""
    answers = set()
    for w in candidates:
        if not WORD_RE.match(w) or w not in enable5:
            continue
        if inflection_rule(w, stems) and w not in INFLECTION_KEEP:
            continue
        if w in blocklist:
            continue
        answers.add(w)
    return sorted(answers)


def read_scowl(archive: bytes) -> set[str]:
    """5-letter a-z words from the pinned SCOWL files (ISO-8859-1; accented words drop out)."""
    words: set[str] = set()
    with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as tar:
        for name in SCOWL_FILES:
            member = tar.extractfile(name)
            if member is None:
                sys.exit(f"missing {name} in SCOWL archive")
            text = io.TextIOWrapper(member, encoding="latin-1").read()
            words.update(
                w for w in (line.strip() for line in text.splitlines()) if WORD_RE.match(w)
            )
    return words


def main() -> None:
    enable_text = fetch_verified(ENABLE_URL, ENABLE_SHA256).decode("ascii")
    scowl = fetch_verified(SCOWL_URL, SCOWL_SHA256)
    enable5, stems = parse_enable(enable_text)
    blocklist = parse_blocklist(BLOCKLIST_FILE.read_text(encoding="utf-8"))
    candidates = read_scowl(scowl)
    answers = build_answers(candidates, enable5, stems, blocklist)

    VALID_FILE.write_text("\n".join(sorted(enable5)) + "\n", encoding="utf-8")
    ANSWERS_FILE.write_text("\n".join(answers) + "\n", encoding="utf-8")
    print(f"ENABLE 5-letter words (valid_en.txt): {len(enable5)}")
    print(f"SCOWL 5-letter candidates:            {len(candidates)}")
    print(f"answers_en.txt:                       {len(answers)}")


if __name__ == "__main__":
    main()
