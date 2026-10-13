"""French lemmas (Littré) and rule-based French inflections for gen_romance_words.py (#3239).

Littré source: Debian ``stardict-xmlittre`` 1.0 (XMLittré by François Gannaz, from Émile
Littré's *Dictionnaire de la langue française*, 1863-1877, public domain). The StarDict
index gives the headwords; the first line of each article gives the grammar
(``s. m.``, ``adj.``, ``v. a.``, ``part. passé``...).

Every function here is pure: bytes or strings in, data out.
"""

from __future__ import annotations

import gzip
import re
import struct
import unicodedata
from collections.abc import Iterable
from dataclasses import dataclass, replace

from _wordfold import accent_count, fold, words


@dataclass(frozen=True)
class Entry:
    """One Littré headword (lowercase NFC display form) and what its article says."""

    word: str
    pos: frozenset[str]  # subset of POS_NAMES
    feminine: str | None = None  # from a "FRÉQUENT, ENTE" style headword
    forms: tuple[str, ...] = ()  # conjugated forms the article head lists ("je dors, ...")
    model: str | None = None  # "se conjugue comme mettre" -> "mettre"
    xref: bool = False  # the article is only "Voy. OTHER." (a variant or inflected form)
    archaic: bool = False  # the article opens with an archaism label


POS_NAMES = ("noun", "plural", "both", "adj", "verb", "adv", "part")
_POS_RES = (
    ("noun", re.compile(r"\bs\.\s?[mf]\.")),
    ("plural", re.compile(r"\bs\.\s?[mf]\.\s?(?:pl|plur)\.")),
    ("both", re.compile(r"\bs\.\s?m\.\s?et\s?f\.")),
    ("adj", re.compile(r"\b(?:adj|ajd)\.")),
    ("verb", re.compile(r"\b[vV]\.\s?(?:a|n|réfl|pron|impers|act|neut)\.")),
    ("adv", re.compile(r"\badv\.")),
)
_HEAD_RE = re.compile(r"^<i><small>(.*?)</small></i>", re.DOTALL)
_PRON_RE = re.compile(r"^\s*\((?:[^()]|\([^()]*\))*\)")
_PAREN_RE = re.compile(r"\([^()]*\)")
_TAG_RE = re.compile(r"<[^>]+>")
_MODEL_RE = re.compile(r"[Ss]e conjugue comme (\w+)")
_SUBJECT_RE = re.compile(
    r"^(?:que |qu'|qu’)?(?:je |j'|j’|tu |il |elle |on |nous |vous |ils |elles )?", re.IGNORECASE
)
_HOMOGRAPH_RE = re.compile(r"\.\d+$")
_XREF_RE = re.compile(r"^\s*(?:Voy\.|Voyez)\s", re.IGNORECASE)
# Littré's own usage labels at the top of an article.
_ARCHAIC_RE = re.compile(
    r"\b(?:Vieux mot|Vieux terme|Vieux langage|Vieilli|Inusité|Peu usité|"
    r"Ancien terme|Ancien mot|Archaïsme|Vieux et inusité)\b",
    re.IGNORECASE,
)
_BODY_SCAN = 400


def parse_idx(idx: bytes) -> list[tuple[str, int, int]]:
    """StarDict ``.idx`` (32-bit offsets) -> [(headword, offset, size)]."""
    out = []
    i = 0
    while i < len(idx):
        j = idx.index(b"\0", i)
        off, size = struct.unpack(">II", idx[j + 1 : j + 9])
        out.append((idx[i:j].decode("utf-8"), off, size))
        i = j + 9
    return out


def split_headword(head: str) -> tuple[str, str | None]:
    """``"FRÉQUENT, ENTE.1"`` -> (``"fréquent"``, ``"ente"``); lowercase NFC."""
    head = unicodedata.normalize("NFC", _HOMOGRAPH_RE.sub("", head.strip()).lower())
    word, _, suffix = head.partition(",")
    suffix = suffix.strip()
    return word.strip(), (suffix or None)


def feminine_from_suffix(word: str, suffix: str) -> str | None:
    """Apply a Littré feminine suffix: ``actif, ive`` -> ``active``.

    A suffix that repeats the word's first two letters is a whole word (``veuf, veuve``,
    ``sec, sèche``). Otherwise it replaces ``word`` from the last letter that folds to
    the suffix's first letter (``fréquent, ente`` -> ``fréqu`` + ``ente``).
    """
    if not suffix.isalpha():
        return None
    if fold(suffix[:2]) == fold(word[:2]):
        return suffix
    first = fold(suffix[0])
    for i in range(len(word) - 1, -1, -1):
        if fold(word[i]) == first:
            return word[:i] + suffix
    return None


def grammar_pos(label: str) -> frozenset[str]:
    """Parts of speech named by a Littré grammar label (``"s. m. et f."``, ``"v. a."``)."""
    pos = {name for name, rx in _POS_RES if rx.search(label)}
    if label.lstrip(", ").lower().startswith("part"):
        pos.add("part")
    return frozenset(pos)


def listed_forms(label: str) -> tuple[str, ...]:
    """Single-word conjugated forms in a verb head: ``"je dors, tu dors ; dormant"``."""
    out = []
    for piece in re.split(r"[,;]", _PAREN_RE.sub(" ", label)):
        rest = _SUBJECT_RE.sub("", piece.strip())
        if rest.isalpha() and rest.islower():
            out.append(unicodedata.normalize("NFC", rest))
    return tuple(dict.fromkeys(out))


def parse_head(article: str) -> Entry:
    """Grammar facts from the opening of one article (``word`` left empty)."""
    m = _HEAD_RE.match(article)
    head = " ".join(m.group(1).split()) if m else ""
    pron = _PRON_RE.match(head)
    label = head[pron.end() :] if pron else head
    body = article[m.end() : m.end() + _BODY_SCAN] if m else article[:_BODY_SCAN]
    first_para = _TAG_RE.sub("", body).strip().split("\n", 1)[0]
    pos = grammar_pos(label)
    if not pos - {"part"}:
        pos |= grammar_pos(first_para[:120])  # "1° V. n. Mettre fin à..."
    model = _MODEL_RE.search(head)
    return Entry(
        word="",
        pos=pos,
        forms=listed_forms(label) if "verb" in pos else (),
        model=model.group(1).lower() if model else None,
        xref=bool(_XREF_RE.match(first_para)),
        archaic=bool(_ARCHAIC_RE.search(first_para)),
    )


def parse_littre(idx: bytes, dict_dz: bytes) -> list[Entry]:
    """Every single-word Littré headword (any length; verbs inflect to 5 letters).

    An article is indexed under several keys, including unaccented search aliases
    (``ABCES`` for ``ABCÈS``); for each article and fold key only the most-accented
    spelling is kept, so aliases never become display forms.
    """
    text = gzip.decompress(dict_dz)
    by_article: dict[int, list[tuple[str, int]]] = {}
    for head, off, size in parse_idx(idx):
        by_article.setdefault(off, []).append((head, size))
    out: dict[tuple, Entry] = {}
    for off in sorted(by_article):
        heads = by_article[off]
        info = parse_head(text[off : off + heads[0][1]].decode("utf-8", "replace"))
        best: dict[str, tuple[str, str | None]] = {}
        for head, _ in heads:
            word, suffix = split_headword(head)
            if not word.isalpha():
                continue
            fem = feminine_from_suffix(word, suffix) if suffix else None
            prev = best.get(fold(word))
            rank = (accent_count(word), word, fem or "")
            if prev is None or rank > (accent_count(prev[0]), prev[0], prev[1] or ""):
                best[fold(word)] = (word, fem)
        for word, fem in best.values():
            e = replace(info, word=word, feminine=fem)
            out.setdefault((word, e.pos, e.forms, e.model, e.xref, e.archaic, fem), e)
    return sorted(out.values(), key=lambda e: (e.word, sorted(e.pos), e.forms, e.feminine or ""))


# Littré (1863-1877) spells some words the 19th-century way. These substitutions give
# the later spelling (poëme -> poème, grége -> grège, gaîne -> gaine, arome -> arôme,
# coeur -> cœur); Ngram frequency then picks the display.
_RESPELL = {"ë": ("è",), "é": ("è",), "î": ("i",), "û": ("u",), "ï": ("i",), "o": ("ô",)}
_LIGATURES = (("oe", "œ"), ("ae", "æ"))


def spelling_variants(word: str) -> set[str]:
    """Other spellings of ``word`` under the substitutions above (not ``word`` itself)."""
    out = {""}
    for ch in word:
        out = {p + c for p in out for c in (ch, *_RESPELL.get(ch, ()))}
    for w in list(out):
        for plain, lig in _LIGATURES:
            if plain in w:
                out.add(w.replace(plain, lig))
    out.discard(word)
    return out


# --- part of speech --------------------------------------------------------------------


PARTICIPLE_ENDINGS = ("é", "ée", "és", "ées", "i", "ie", "is", "it", "u", "ue", "us")


def is_participle(e: Entry) -> bool:
    return "part" in e.pos


def is_verb(e: Entry) -> bool:
    return "verb" in e.pos


def is_noun(e: Entry) -> bool:
    return "noun" in e.pos and "part" not in e.pos


def is_adj(e: Entry) -> bool:
    return "adj" in e.pos


def is_plural_only(e: Entry) -> bool:
    return "plural" in e.pos


# --- inflection --------------------------------------------------------------------------


def plurals(word: str) -> set[str]:
    """Candidate plurals (``cheval`` -> ``chevaux``; ``feu`` -> ``feux``; ``chat`` -> ``chats``)."""
    if word.endswith(("s", "x", "z")):
        return set()
    out = {word + "s"}
    if word.endswith("al"):
        out.add(word[:-2] + "aux")
    if word.endswith("ail"):
        out.add(word[:-3] + "aux")
    if word.endswith(("au", "eu", "ou")):
        out.add(word + "x")
    return out


def feminines(word: str) -> set[str]:
    """Candidate feminines of an adjective without a Littré feminine suffix."""
    if word.endswith("e"):
        return set()
    rules = (
        ("er", ("ère",)),
        ("if", ("ive",)),
        ("eux", ("euse",)),
        ("eur", ("euse", "rice")),
        ("el", ("elle",)),
        ("eil", ("eille",)),
        ("en", ("enne",)),
        ("on", ("onne",)),
        ("et", ("ette", "ète")),
        ("c", ("che", "que")),
        ("x", ("se",)),
    )
    for end, repl in rules:
        if word.endswith(end):
            return {word[: -len(end)] + r for r in repl} | {word + "e"}
    return {word + "e"}


_ER_ENDINGS = words(
    "e es ons ez ent ai as a âmes âtes èrent ais ait ions iez aient "
    "erai eras era erons erez eront erais erait erions eriez eraient "
    "asse asses ât assions assiez assent é ée és ées ant"
)
_IR2_ENDINGS = words(
    "is it issons issez issent issais issait issions issiez issaient îmes îtes irent "
    "irai iras ira irons irez iront irais irait isse isses ît i ie ies issant"
)
_IR3_ENDINGS = words(
    "ons ez ent ais ait ions iez aient is it îmes îtes irent "
    "irai iras ira irons irez iront irais irait e es i ie ies ant"
)
_RE_ENDINGS = words(
    "s ons ez ent ais ait ions iez aient is it îmes îtes irent "
    "rai ras ra rons rez ront rais rait e es u ue us ues ant"
)


def _er_stems(stem: str) -> set[str]:
    """Stem spelling variants: ``lev``->``lèv``, ``préfér``->``préfèr``, ``pay``->``pai``."""
    out = {stem}
    m = re.search(r"([eé])([^aeiouyéèêëîïôûù]+)$", stem)
    if m:
        out.add(stem[: m.start(1)] + "è" + m.group(2))
    if stem.endswith(("l", "t")) and stem[-2:-1] == "e":
        out.add(stem + stem[-1])  # appeler -> appelle, jeter -> jette
    if stem.endswith("y"):
        out.add(stem[:-1] + "i")
    return out


def verb_forms(inf: str) -> set[str]:
    """Regular conjugations of a French infinitive (all candidates; Ngram decides)."""
    out: set[str] = set()
    if inf.endswith("er") and len(inf) > 3:
        stem = inf[:-2]
        for s in _er_stems(stem):
            for e in _ER_ENDINGS:
                form = s + e
                if stem.endswith("c") and e[:1] in "aâo":
                    form = s[:-1] + "ç" + e
                elif stem.endswith("g") and e[:1] in "aâo":
                    form = s + "e" + e
                out.add(form)
    elif inf.endswith("ir") and len(inf) > 3:
        stem = inf[:-2]
        out.update(stem + e for e in _IR2_ENDINGS)
        out.update(stem + e for e in _IR3_ENDINGS)
        out.update({stem[:-1] + "s", stem[:-1] + "t"})  # partir -> pars, part
    elif inf.endswith("re") and len(inf) > 3:
        stem = inf[:-2]
        out.update(stem + e for e in _RE_ENDINGS)
        if not stem.endswith(("d", "t")):
            out.add(stem + "t")
        out.add(stem)  # il vend / il bat
    out.discard(inf)
    return out


def transfer_forms(inf: str, model: str, model_forms: Iterable[str]) -> set[str]:
    """Conjugate ``inf`` like ``model`` from the model's listed forms.

    The shared ending is kept and the differing start swapped: ``admettre`` like
    ``mettre`` (``mets`` -> ``admets``), ``craindre`` like ``peindre`` (``peins`` ->
    ``crains``, ``peignons`` -> ``craignons``).
    """
    n = 0
    while n < min(len(inf), len(model)) and inf[-1 - n] == model[-1 - n]:
        n += 1
    if n < 3:
        return set()
    p_inf, p_model = inf[: len(inf) - n], model[: len(model) - n]
    return {p_inf + f[len(p_model) :] for f in model_forms if f.startswith(p_model)}


def listed_paradigms(entries: Iterable[Entry]) -> dict[str, tuple[str, ...]]:
    """{infinitive: forms} for every Littré verb whose head lists its conjugation."""
    out: dict[str, tuple[str, ...]] = {}
    for e in entries:
        if is_verb(e) and e.forms:
            out[e.word] = tuple(dict.fromkeys(out.get(e.word, ()) + e.forms))
    return out


# A listed first-person form names a whole tense: its stem takes these endings.
_TENSES = (
    ("rai", "rai ras ra rons rez ront rais rait rions riez raient"),  # future, conditional
    ("ais", "ais ait ions iez aient"),  # imperfect
    ("ins", "ins int înmes întes inrent insse înt"),  # je vins
    ("us", "us ut ûmes ûtes urent usse ût"),  # je reçus
    ("is", "is it îmes îtes irent isse ît"),  # je mis
)


def expand_tenses(forms: Iterable[str]) -> set[str]:
    """Whole tenses from listed first-person forms: ``devrai`` -> ``devra``, ``devrez``...;
    ``parus`` -> ``parut``. Over-generates; Ngram attestation decides."""
    out = set()
    for f in forms:
        for end, endings in _TENSES:
            if f.endswith(end) and len(f) > len(end):
                stem = f[: -len(end)]
                out.update(stem + x for x in endings.split())
                break
    return out


def irregular_forms(e: Entry, paradigms: dict[str, tuple[str, ...]]) -> set[str]:
    """Forms Littré lists for ``e``, for its ``se conjugue comme`` model, and for the
    longest listed verb it ends with (``revenir`` -> ``venir``), with their tenses."""
    out = set(e.forms)
    if e.model in paradigms:
        out |= transfer_forms(e.word, e.model, paradigms[e.model])
    bases = [b for b in paradigms if len(b) >= 4 and b != e.word and e.word.endswith(b)]
    if bases:
        base = max(bases, key=lambda b: (len(b), b))
        out |= transfer_forms(e.word, base, paradigms[base])
    return out | expand_tenses(out)


# Plurals the rules do not make: pronouns (Littré lists ``elle`` and ``leur``) and
# irregular nouns.
EXTRA_PLURALS = ("elles", "leurs", "cieux", "aïeux")


def lemma_forms(entry: Entry) -> set[str]:
    """Rule-made inflections of one Littré entry: verb forms, plurals and feminines."""
    out: set[str] = set()
    if is_verb(entry):
        out |= verb_forms(entry.word)
    if is_noun(entry) or is_adj(entry) or is_participle(entry):
        if not is_plural_only(entry):
            out |= plurals(entry.word)
        fems: set[str] = set()
        if entry.feminine:
            fems = {entry.feminine}
        elif is_adj(entry) or is_participle(entry) or "both" in entry.pos:
            fems = feminines(entry.word)
        for f in fems:
            out.add(f)
            out |= plurals(f)
    out.discard(entry.word)
    return out
