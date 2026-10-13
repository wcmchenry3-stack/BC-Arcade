"""Google Books Ngram (v3, 20200217) 1-gram reader for the Daily Word generators (#3239).

The 1-gram shards are large (~5 GB per language, gzip). They are streamed: each shard is
hashed while it is decompressed, and the run exits if its SHA-256 differs from the pin.
Nothing is written to the repo. Only 5-letter words survive extraction (see ``fold``), so
the derived table is small; it may be cached outside the repo, keyed by the shard's
SHA-256 and EXTRACT_VERSION, so a rerun does not download 8 GB again.

Ngram v3 line format (tab-separated): ``token`` then ``year,match_count,volume_count``
for every year the token occurs. A token is a plain word (``maison``, ``Maison``) or a
word with a part-of-speech tag (``maison_NOUN``). Plain tokens give the frequency and the
case profile (a word seen mostly capitalized reads as a proper noun); tagged tokens give
the part-of-speech profile.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import sys
import unicodedata
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

from _wordfold import ALPHABETS, fold

NGRAM_BASE = "https://storage.googleapis.com/books/ngrams/books/20200217"
NGRAM_LICENCE = "CC BY 3.0"

# Only these years count: recent usage, so archaic words rank low.
YEAR_MIN = 1950
YEAR_MAX = 2019
EXTRACT_VERSION = 1

POS_TAGS = frozenset(
    ("NOUN", "VERB", "ADJ", "ADV", "PRON", "DET", "ADP", "NUM", "CONJ", "PRT", "X")
)

# One shard (url, sha256); filled in per language by the generator.
Shard = tuple[str, str]


@dataclass
class Counts:
    """Ngram counts (YEAR_MIN..YEAR_MAX) for lowercase NFC word forms.

    ``total[w]``: plain-token matches over every casing of ``w``.
    ``lower[w]``: plain-token matches of exactly ``w`` (lowercase).
    ``pos[w][tag]``: tagged-token matches over every casing of ``w``.
    """

    total: dict[str, int] = field(default_factory=dict)
    lower: dict[str, int] = field(default_factory=dict)
    pos: dict[str, dict[str, int]] = field(default_factory=dict)

    def merge(self, other: Counts) -> None:
        for w, n in other.total.items():
            self.total[w] = self.total.get(w, 0) + n
        for w, n in other.lower.items():
            self.lower[w] = self.lower.get(w, 0) + n
        for w, tags in other.pos.items():
            mine = self.pos.setdefault(w, {})
            for t, n in tags.items():
                mine[t] = mine.get(t, 0) + n

    def freq(self, word: str) -> int:
        return self.total.get(word, 0)

    def lower_share(self, word: str) -> float:
        """Share of a word's matches written in lowercase (low -> reads as a proper noun)."""
        t = self.total.get(word, 0)
        return self.lower.get(word, 0) / t if t else 0.0

    def top_pos(self, word: str) -> str | None:
        tags = self.pos.get(word)
        if not tags:
            return None
        return max(sorted(tags), key=lambda t: tags[t])

    def pos_share(self, word: str, tag: str) -> float:
        tags = self.pos.get(word)
        total = sum(tags.values()) if tags else 0
        return tags.get(tag, 0) / total if total else 0.0

    def to_json(self) -> dict:
        return {"total": self.total, "lower": self.lower, "pos": self.pos}

    @classmethod
    def from_json(cls, data: dict) -> Counts:
        return cls(data["total"], data["lower"], data["pos"])


def wanted(base: str) -> bool:
    """Keep a token whose lowercase fold is 5 letters (either language's alphabet)."""
    key = fold(base)
    return len(key) == 5 and all(ch in ALPHABETS["es"] for ch in key)


def year_total(fields: list[str]) -> int:
    """Sum match_count over YEAR_MIN..YEAR_MAX from ``year,match,volume`` fields."""
    n = 0
    for f in fields:
        y, m, _ = f.split(",")
        if YEAR_MIN <= int(y) <= YEAR_MAX:
            n += int(m)
    return n


def add_line(counts: Counts, line: str) -> None:
    """Fold one Ngram v3 1-gram line into ``counts`` (pure apart from ``counts``)."""
    token, _, rest = line.rstrip("\n").partition("\t")
    tag = None
    base = token
    if "_" in token:
        base, _, tag = token.rpartition("_")
        if tag not in POS_TAGS or not base:
            return
    base = unicodedata.normalize("NFC", base)
    if not 4 <= len(base) <= 5 or not wanted(base):
        return
    n = year_total(rest.split("\t"))
    if not n:
        return
    w = base.lower()
    if tag:
        tags = counts.pos.setdefault(w, {})
        tags[tag] = tags.get(tag, 0) + n
        return
    counts.total[w] = counts.total.get(w, 0) + n
    if base == w:
        counts.lower[w] = counts.lower.get(w, 0) + n


class _HashingReader:
    """File-like wrapper that SHA-256 hashes every byte read through it."""

    def __init__(self, raw) -> None:
        self.raw = raw
        self.sha = hashlib.sha256()

    def read(self, n: int = -1) -> bytes:
        data = self.raw.read(n)
        self.sha.update(data)
        return data

    def drain(self) -> None:
        while self.read(1 << 20):
            pass


def extract_shard(url: str) -> tuple[str, Counts]:
    """Stream one shard; return (sha256 of the gzip bytes, its 5-letter counts)."""
    counts = Counts()
    req = urllib.request.Request(url, headers={"User-Agent": "bc-arcade-gen-romance-words"})
    with urllib.request.urlopen(req, timeout=300) as resp:
        reader = _HashingReader(resp)
        with gzip.GzipFile(fileobj=reader) as gz:
            for raw in gz:
                tab = raw.find(b"\t")
                # A wanted token is <= 5 chars (<= 10 UTF-8 bytes) plus an optional _TAG.
                if tab < 4 or tab > 16:
                    continue
                add_line(counts, raw.decode("utf-8", "replace"))
        reader.drain()
    return reader.sha.hexdigest(), counts


def _cache_path(cache_dir: Path, sha256: str) -> Path:
    return cache_dir / f"{sha256}-v{EXTRACT_VERSION}-y{YEAR_MIN}-{YEAR_MAX}.json.gz"


def load_shard(shard: Shard, cache_dir: Path | None) -> Counts:
    """Counts for one pinned shard, from the cache when present, else streamed + verified."""
    url, sha256 = shard
    if cache_dir is not None:
        path = _cache_path(cache_dir, sha256)
        if path.exists():
            return Counts.from_json(json.loads(gzip.decompress(path.read_bytes())))
    digest, counts = extract_shard(url)
    if digest != sha256:
        sys.exit(f"checksum mismatch for {url}\n  expected {sha256}\n  got      {digest}")
    if cache_dir is not None:
        cache_dir.mkdir(parents=True, exist_ok=True)
        blob = json.dumps(counts.to_json(), sort_keys=True).encode("utf-8")
        _cache_path(cache_dir, sha256).write_bytes(gzip.compress(blob, mtime=0))
    return counts


def _load_shard_star(args: tuple[Shard, Path | None]) -> Counts:
    return load_shard(*args)


def load_counts(shards: tuple[Shard, ...], cache_dir: Path | None, workers: int) -> Counts:
    """Merge every shard's counts (shards run in parallel; merge order is fixed)."""
    from multiprocessing import Pool

    jobs = [(s, cache_dir) for s in shards]
    if workers <= 1:
        parts = [_load_shard_star(j) for j in jobs]
    else:
        with Pool(min(workers, len(jobs))) as pool:
            parts = pool.map(_load_shard_star, jobs)
    total = Counts()
    for p in parts:
        total.merge(p)
    return total
