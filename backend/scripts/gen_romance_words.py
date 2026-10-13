#!/usr/bin/env python3
"""Build daily_word/words/{answers,valid}_{fr,es}.txt from public-domain sources (#3239).

Sources (each pinned by URL + SHA-256; the script exits on a mismatch). Sources chosen
in #3198 (option 1); see ATTRIBUTION.md and docs/games/daily_word.md.
  1. French lemmas: Littré headwords, Debian ``stardict-xmlittre`` 1:1.0-2 (public
     domain; XMLittré markup by François Gannaz). The Debian source tarball, fetched
     from the archive.ubuntu.com pool (a byte-identical copy of Debian's: same file
     and SHA-256 as Debian's signed .dsc), because deb.debian.org is not reachable from
     the build container.
  2. Spanish lemmas: Debian ``wspanish`` 1.0.30 (``words.spanish.latin1``, "Word list
     license: Public Domain."). Debian native source tarball, same pool.
  3. Google Books Ngram v3 (20200217) French and Spanish 1-grams, the full shards
     (CC BY 3.0), used only to rank words and to attest generated inflections (see
     _ngram.py).

File format (contract for #3240 / #3241): one display word per line, lowercase NFC,
accents and ñ kept; every line folds (``_wordfold.fold``) to exactly 5 letters of the
language's alphabet; fold keys are unique per file; every answer is in the valid list
with the same display form. Output is sorted by fold key, then display form.

Valid guesses = every PD lemma with a 5-letter key, plus inflections that Ngram
attests (``attested``: at least MIN_ATTEST lowercase matches 1950-2019, mostly written
in lowercase, not tagged mostly as foreign). Inflections are rule-made: plurals, French
feminines, regular conjugations, the conjugations Littré's own verb heads list, and a
short table of Spanish irregular verbs.

Collisions: when several display forms fold to one key (``pêche``/``péché``), the form
Ngram counts most often in lowercase wins; ties go to the form with more accents, then
to code-point order. French also lets the later spelling of a Littré word compete
(``poëme`` -> ``poème``, ``coeur`` -> ``cœur``). Answers use the valid list's display.

Answers = PD lemmas whose key is in the Ngram top ANSWER_TOP_N 5-letter keys, minus
inflected forms, proper-noun-like words (mostly capitalized in Ngram), archaisms (Littré
labels), the hand-curated ANSWER_EXCLUDE list, and the language's blocklist
(answers_blocklist_{fr,es}.txt, read here, never written). Blocklisted words stay valid.

Downloads are streamed and never written to the repo. The Ngram shards (~8 GB) reduce
to a small table that is cached outside the repo (default ~/.cache/bc-arcade/ngram,
keyed by shard SHA-256) unless --no-cache is given.

Usage (run from repo root):
    python backend/scripts/gen_romance_words.py            # both languages
    python backend/scripts/gen_romance_words.py --lang fr  # one language
"""

from __future__ import annotations

import argparse
import hashlib
import io
import os
import sys
import tarfile
import urllib.request
from collections.abc import Callable, Iterable
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import _romance_es as es
import _romance_fr as fr
from _ngram import NGRAM_BASE, Counts, load_counts
from _romance_curation import ANSWER_EXCLUDE
from _wordfold import accent_count, fold, is_key

WORDS_DIR = Path(__file__).parents[1] / "daily_word" / "words"

DEB_MIRROR = "https://archive.ubuntu.com/ubuntu/pool"
LITTRE_URL = f"{DEB_MIRROR}/universe/s/stardict-xmlittre/stardict-xmlittre_1.0.orig.tar.gz"
LITTRE_SHA256 = "1c81a772014646c3fa39048a834297043c5f168ea40ac33503692d889c9d4ac6"
WSPANISH_URL = f"{DEB_MIRROR}/main/w/wspanish/wspanish_1.0.30.tar.xz"
WSPANISH_SHA256 = "ac4eaed4bf67daa8f0ac97c84cee25ad2f4f00fecfaa41e58b28517a57a53a50"

NGRAM_SHARDS = {
    "fr": tuple(
        (f"{NGRAM_BASE}/fre/1-{i:05d}-of-00006.gz", sha)
        for i, sha in enumerate(
            (
                "c09240100c1d51c479faaf7ecd87163d2460f7f6d8c0244112b2727d96cae8e1",
                "9dcda2040ee9e63333fc515db51dad958725afb9a71b70a707105564ed64eb3b",
                "389f4b15e40a73e1ad57ae807eaec7f0a56725e8897dde533ed77f1dc30140ea",
                "c6a38bbcfb00bdc4ac8cc8e22936d0835bfbb07f798e36dcf21a024dbddf3acd",
                "978359563dceae0dbbe06457c07079eb0209471bef50f64fde2aa3b95534124c",
                "2ccc18b4e6f0bebe62fa2d251265b663e09990eef3827620f445d32cceded64e",
            )
        )
    ),
    "es": tuple(
        (f"{NGRAM_BASE}/spa/1-{i:05d}-of-00003.gz", sha)
        for i, sha in enumerate(
            (
                "c28dfa7f433317baf75429a57b1dab1d6ec016ad325feef0f30ab4f79d63f386",
                "b6396078773aa299ea010d6cfdef437a97055532df7d65c0a90914141e7ef0f6",
                "720b00fde16df0854dd8ccf1a37dcc021d37a568a9c71f063cd995124d001e3e",
            )
        )
    ),
}

# An inflection is a valid guess only when Ngram has it this often in lowercase.
MIN_ATTEST = 2000
# Answers come from the most frequent 5-letter keys of the language.
ANSWER_TOP_N = 5000
# A word written in lowercase less often than this reads as a proper noun.
MIN_LOWER_SHARE = 0.5
# A French verb form that Littré also lists as a noun stays an answer candidate only
# when Ngram tags it NOUN at least this often (``allée`` 0.24 stays; ``dorée`` goes).
MIN_NOUN_SHARE = 0.2


# --- sources -----------------------------------------------------------------------------


def fetch_verified(url: str, sha256: str) -> bytes:
    """Download ``url`` and return its bytes, exiting if the SHA-256 differs."""
    req = urllib.request.Request(url, headers={"User-Agent": "bc-arcade-gen-romance-words"})
    with urllib.request.urlopen(req, timeout=300) as resp:
        data = resp.read()
    digest = hashlib.sha256(data).hexdigest()
    if digest != sha256:
        sys.exit(f"checksum mismatch for {url}\n  expected {sha256}\n  got      {digest}")
    return data


def tar_member(archive: bytes, name: str) -> bytes:
    with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
        member = tar.extractfile(name)
        if member is None:
            sys.exit(f"missing {name} in archive")
        return member.read()


def parse_blocklist(text: str) -> frozenset[str]:
    """Folded keys, one per line; blank lines and ``#`` comments are ignored."""
    out = set()
    for line in text.splitlines():
        line = line.split("#", 1)[0].strip()
        if line:
            out.add(fold(line))
    return frozenset(out)


# --- shared list building ----------------------------------------------------------------


def pick_display(forms: Iterable[str], counts: Counts) -> str:
    """The display form for one fold key: most frequent in lowercase, then most accented,
    then code-point order."""
    return min(forms, key=lambda w: (-counts.lower.get(w, 0), -accent_count(w), w))


def attested(word: str, counts: Counts) -> bool:
    """Ngram has ``word`` at least MIN_ATTEST times, mostly in lowercase, and does not
    tag it mostly ``X`` (foreign or unknown words: ``skies``, ``baths``)."""
    return (
        counts.lower.get(word, 0) >= MIN_ATTEST
        and counts.lower_share(word) >= MIN_LOWER_SHARE
        and counts.top_pos(word) != "X"
    )


def no_variants(_word: str) -> set[str]:
    return set()


def build_valid(
    lemmas: Iterable[str],
    inflections: Iterable[str],
    counts: Counts,
    lang: str,
    variants: Callable[[str], set[str]] = no_variants,
) -> dict[str, str]:
    """{fold key: display} for lemmas plus Ngram-attested inflections.

    ``variants(word)`` gives other spellings of a word (French: ``poëme`` -> ``poème``,
    ``coeur`` -> ``cœur``); attested ones compete for the display of the word's key, so
    the usual modern spelling wins over Littré's 19th-century one.
    """
    groups: dict[str, set[str]] = {}
    for w in lemmas:
        if is_key(fold(w), lang):
            groups.setdefault(fold(w), set()).add(w)
    for w in inflections:
        if is_key(fold(w), lang) and attested(w, counts):
            groups.setdefault(fold(w), set()).add(w)
    for forms in groups.values():
        forms |= {v for w in list(forms) for v in variants(w) if attested(v, counts)}
    return {k: pick_display(v, counts) for k, v in sorted(groups.items())}


def top_keys(counts: Counts, lang: str, n: int) -> frozenset[str]:
    """The ``n`` most frequent fold keys (lowercase counts summed over display forms)."""
    totals: dict[str, int] = {}
    for w, c in counts.lower.items():
        k = fold(w)
        if is_key(k, lang):
            totals[k] = totals.get(k, 0) + c
    ranked = sorted(totals, key=lambda k: (-totals[k], k))
    return frozenset(ranked[:n])


def collisions(valid: dict[str, str], candidates: Iterable[str]) -> list[str]:
    """Human-readable ``key: kept (dropped, ...)`` lines for the run summary."""
    by_key: dict[str, set[str]] = {}
    for w in candidates:
        k = fold(w)
        if k in valid:
            by_key.setdefault(k, set()).add(w)
    lines = []
    for k, forms in sorted(by_key.items()):
        others = sorted(forms - {valid[k]})
        if others:
            lines.append(f"{k}: {valid[k]} ({', '.join(others)})")
    return lines


def finish_answers(
    candidates: Iterable[str],
    valid: dict[str, str],
    blocklist: frozenset[str],
    exclude: frozenset[str],
    variants: Callable[[str], set[str]] = no_variants,
) -> list[str]:
    """Answers in their valid display, minus the blocklist and the exclusions.

    A candidate stays only when its key's display is the candidate itself or one of its
    spelling variants; when another word won the display (an inflection, another
    lemma), the candidate is dropped.
    """
    out = set()
    for w in candidates:
        k = fold(w)
        display = valid.get(k)
        if display is None or k in blocklist or k in exclude:
            continue
        if display == w or display in variants(w):
            out.add(display)
    return sorted(out, key=lambda w: (fold(w), w))


# --- French ------------------------------------------------------------------------------


def fr_inflection_sources(entries: list[fr.Entry]) -> tuple[set[str], set[str]]:
    """(verb forms, nominal forms) made from every Littré entry.

    Verb forms: regular conjugation rules, plus the forms Littré's own verb heads list
    (``je dors, tu dors...``), transferred to verbs conjugated like them. Nominal forms:
    plurals and feminines, plus a few irregular plurals.
    """
    paradigms = fr.listed_paradigms(entries)
    verbs: set[str] = set()
    nominal: set[str] = set(fr.EXTRA_PLURALS)
    for e in entries:
        if fr.is_verb(e):
            verbs |= fr.verb_forms(e.word) | fr.irregular_forms(e, paradigms)
        nominal |= fr.lemma_forms(e)
    verbs.discard("")
    return verbs, nominal - verbs


def fr_is_inflection(
    word: str, entries: list[fr.Entry], in_verbs: bool, in_nominal: bool, counts: Counts
) -> bool:
    """True when ``word`` is better read as an inflected form than as a lemma.

    ``in_verbs`` / ``in_nominal``: the word is made as a verb form / as a plural or
    feminine of some Littré entry. A verb form stays a lemma only when Littré has it as
    a noun that Ngram tags NOUN often enough (``allée``, ``porte``), or when it is not
    participle-shaped and Ngram does not tag it mostly VERB (``vide``).
    """
    if all(fr.is_participle(e) or e.xref for e in entries):
        return True
    nounish = any(fr.is_noun(e) for e in entries)
    if in_verbs:
        if nounish and counts.pos_share(word, "NOUN") >= MIN_NOUN_SHARE:
            return False
        if counts.top_pos(word) == "VERB" or word.endswith(fr.PARTICIPLE_ENDINGS):
            return True
    if in_nominal:
        plural_only = any(fr.is_plural_only(e) for e in entries)
        return not nounish or (word.endswith(("s", "x")) and not plural_only)
    return False


def fr_answer_ok(
    word: str,
    entries: list[fr.Entry],
    top: frozenset[str],
    counts: Counts,
    is_inflection: Callable[[str], bool],
) -> bool:
    """Every answer rule except the display, blocklist and exclusion checks."""
    if fold(word) not in top:
        return False
    if any(e.archaic for e in entries) or not any(e.pos for e in entries):
        return False
    if counts.lower_share(word) < MIN_LOWER_SHARE or counts.top_pos(word) == "X":
        return False
    return not is_inflection(word)


def build_fr(littre_tar: bytes, counts: Counts, blocklist: frozenset[str]):
    idx = tar_member(littre_tar, "XMLittre/XMLittre.idx")
    dz = tar_member(littre_tar, "XMLittre/XMLittre.dict.dz")
    entries = fr.parse_littre(idx, dz)
    by_word: dict[str, list[fr.Entry]] = {}
    for e in entries:
        if is_key(fold(e.word), "fr"):
            by_word.setdefault(e.word, []).append(e)
    verbs, nominal = fr_inflection_sources(entries)
    inflections = verbs | nominal

    def variants(w: str) -> set[str]:
        # A respelling that reads as an inflected form is another word (faîte -> faite);
        # one Ngram tags mostly NOUN is the same word respelled (piége -> piège).
        return {
            v
            for v in fr.spelling_variants(w)
            if v not in inflections or counts.top_pos(v) == "NOUN"
        }

    valid = build_valid(by_word, inflections, counts, "fr", variants)
    top = top_keys(counts, "fr", ANSWER_TOP_N)

    def is_infl(w: str) -> bool:
        return fr_is_inflection(w, by_word[w], w in verbs, w in nominal, counts)

    cands = [w for w in by_word if fr_answer_ok(w, by_word[w], top, counts, is_infl)]
    answers = finish_answers(cands, valid, blocklist, ANSWER_EXCLUDE["fr"], variants)
    return valid, answers, collisions(valid, set(by_word) | inflections)


# --- Spanish -----------------------------------------------------------------------------


def es_is_inflection(word: str, lemmas: frozenset[str], counts: Counts) -> bool:
    """True when ``word`` is better read as an inflected form of another lemma."""
    pos = counts.top_pos(word)
    if word.endswith("s") and any(word in es.plurals(w) for w in _singulars(word, lemmas)):
        return True
    if es.feminine_of(word, lemmas) and pos == "ADJ":
        return True
    return pos == "VERB" and not word.endswith(("ar", "er", "ir"))


def _singulars(word: str, lemmas: frozenset[str]) -> list[str]:
    cands = {word[:-1], word[:-2], word[:-3] + "z"}
    for i, ch in enumerate(word[:-2]):
        if ch in "aeiou":
            cands.add(word[:i] + "áéíóú"["aeiou".index(ch)] + word[i + 1 : -2])
    return sorted(c for c in cands if c in lemmas)


def build_es(wspanish_tar: bytes, counts: Counts, blocklist: frozenset[str]):
    data = tar_member(wspanish_tar, "wspanish-1.0.30/words.spanish.latin1")
    lemmas5 = es.parse_wspanish(data)
    every = frozenset(es.parse_wspanish_all(data))
    infl: set[str] = set()
    for w in every:
        infl |= es.lemma_forms(w)
    valid = build_valid(lemmas5, infl, counts, "es")
    top = top_keys(counts, "es", ANSWER_TOP_N)
    cands = [
        w
        for w in lemmas5
        if fold(w) in top
        and counts.lower_share(w) >= MIN_LOWER_SHARE
        and counts.top_pos(w) != "X"
        and not es_is_inflection(w, every, counts)
    ]
    answers = finish_answers(cands, valid, blocklist, ANSWER_EXCLUDE["es"])
    return valid, answers, collisions(valid, set(lemmas5) | infl)


# --- main --------------------------------------------------------------------------------


def write_list(path: Path, words: Iterable[str]) -> None:
    path.write_text("\n".join(words) + "\n", encoding="utf-8")


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    ap.add_argument("--lang", choices=("fr", "es"), action="append")
    ap.add_argument(
        "--cache-dir",
        type=Path,
        default=Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache"))
        / "bc-arcade"
        / "ngram",
    )
    ap.add_argument("--no-cache", action="store_true", help="always stream the Ngram shards")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--show-collisions", action="store_true")
    args = ap.parse_args(argv)
    cache = None if args.no_cache else args.cache_dir
    for lang in args.lang or ("fr", "es"):
        counts = load_counts(NGRAM_SHARDS[lang], cache, args.workers)
        blocklist = parse_blocklist(
            (WORDS_DIR / f"answers_blocklist_{lang}.txt").read_text(encoding="utf-8")
        )
        if lang == "fr":
            src = fetch_verified(LITTRE_URL, LITTRE_SHA256)
            valid, answers, coll = build_fr(src, counts, blocklist)
        else:
            src = fetch_verified(WSPANISH_URL, WSPANISH_SHA256)
            valid, answers, coll = build_es(src, counts, blocklist)
        write_list(WORDS_DIR / f"valid_{lang}.txt", (valid[k] for k in sorted(valid)))
        write_list(WORDS_DIR / f"answers_{lang}.txt", answers)
        print(f"{lang}: valid {len(valid)}, answers {len(answers)}, collisions {len(coll)}")
        if args.show_collisions:
            print("\n".join(f"  {c}" for c in coll))


if __name__ == "__main__":
    main()
