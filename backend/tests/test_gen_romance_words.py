"""Unit tests for the French/Spanish Daily Word generator (#3239).

Covers ``fold`` (the #3240 contract) and the generator's filter functions as pure
functions: no network, no source downloads.
"""

from __future__ import annotations

import gzip
import hashlib
import io
import struct
import sys
import tarfile
from pathlib import Path

import pytest

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND / "scripts"))

import _ngram as ng
import _romance_es as es
import _romance_fr as fr
import gen_romance_words as gen
from _wordfold import accent_count, fold, is_key, words

# --- fold ----------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("word", "key"),
    [
        ("était", "etait"),
        ("garçon", "garcon"),
        ("cœur", "coeur"),
        ("Cœur", "coeur"),
        ("æther", "aether"),
        ("pêche", "peche"),
        ("péché", "peche"),
        ("naïf", "naif"),
        ("árbol", "arbol"),
        ("pingüino", "pinguino"),
        ("niño", "niño"),
        ("NIÑO", "niño"),
        ("niño", "niño"),  # NFD input
        ("était", "etait"),  # NFD input
        ("ã", "a"),  # a tilde on any letter but n is dropped
    ],
)
def test_fold(word, key):
    assert fold(word, "es") == key
    assert fold(word, "fr") == key.replace("ñ", "n")


def test_fold_is_the_runtime_fold():
    from daily_word import normalize

    assert fold is normalize.fold


def test_fold_is_idempotent_and_keeps_n_tilde_as_one_code_point():
    assert fold(fold("Niño", "es"), "es") == "niño"
    assert len(fold("niño", "es")) == 4
    assert fold("niño", "fr") == "nino"


def test_is_key_applies_each_language_alphabet():
    assert is_key("niños", "es")
    assert not is_key("niños", "fr")
    assert is_key("etait", "fr")
    assert not is_key("etai", "fr")
    assert not is_key("eta-t", "fr")
    assert not is_key("coeurs", "fr")


def test_accent_count_and_words():
    assert accent_count("péché") == 2
    assert accent_count("niño") == 1
    assert words(" a  b\nc ") == ("a", "b", "c")


# --- Ngram extraction ----------------------------------------------------------------


def _line(token: str, *years: tuple[int, int]) -> str:
    return token + "".join(f"\t{y},{n},1" for y, n in years) + "\n"


def test_year_total_counts_only_the_window():
    fields = ["1949,5,1", "1950,2,1", "2019,3,1", "2020,7,1"]
    assert ng.year_total(fields) == 5


def test_add_line_splits_case_and_part_of_speech():
    c = ng.Counts()
    ng.add_line(c, _line("table", (1990, 10), (2001, 2)))
    ng.add_line(c, _line("Table", (1990, 4)))
    ng.add_line(c, _line("table_NOUN", (1990, 9)))
    ng.add_line(c, _line("Table_VERB", (1990, 1)))
    ng.add_line(c, _line("table_START", (1990, 1)))  # not a POS tag
    ng.add_line(c, _line("Paris", (1990, 50)))
    ng.add_line(c, _line("cœur", (1990, 3)))  # 4 characters, folds to 5 letters
    ng.add_line(c, _line("vieux", (1900, 3)))  # outside the year window
    assert c.total == {"table": 16, "paris": 50, "cœur": 3}
    assert c.lower == {"table": 12, "cœur": 3}
    assert c.pos == {"table": {"NOUN": 9, "VERB": 1}}


def test_add_line_keeps_only_5_letter_keys():
    c = ng.Counts()
    ng.add_line(c, _line("table", (2000, 4)))
    ng.add_line(c, _line("tables", (2000, 4)))
    ng.add_line(c, _line("niño", (2000, 4)))
    ng.add_line(c, _line("ta1le", (2000, 4)))
    assert set(c.total) == {"table"}
    assert ng.wanted("niños") and not ng.wanted("ab-cd")


def test_counts_queries_and_merge():
    a = ng.Counts({"paris": 10, "table": 10}, {"paris": 1, "table": 9}, {"table": {"NOUN": 3}})
    b = ng.Counts({"table": 10}, {"table": 10}, {"table": {"NOUN": 1, "VERB": 4}})
    a.merge(b)
    assert a.freq("table") == 20 and a.lower["table"] == 19
    assert a.lower_share("paris") == pytest.approx(0.1)
    assert a.lower_share("absent") == 0.0
    assert a.top_pos("table") == "NOUN"  # 4 vs 4: ties go to the first tag name
    assert a.top_pos("absent") is None
    assert a.pos_share("table", "NOUN") == pytest.approx(0.5)
    assert a.pos_share("absent", "NOUN") == 0.0
    assert ng.Counts.from_json(a.to_json()) == a


class _FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def _gz(text: str) -> bytes:
    return gzip.compress(text.encode("utf-8"), mtime=0)


def test_extract_shard_hashes_the_whole_download(monkeypatch):
    blob = _gz(_line("table", (2000, 5)) + _line("x" * 30, (2000, 1)))
    monkeypatch.setattr(ng.urllib.request, "urlopen", lambda *a, **k: _FakeResponse(blob))
    sha, counts = ng.extract_shard("https://example.invalid/shard.gz")
    assert sha == hashlib.sha256(blob).hexdigest()
    assert counts.total == {"table": 5}


def test_load_shard_verifies_then_caches(monkeypatch, tmp_path):
    blob = _gz(_line("table", (2000, 5)))
    sha = hashlib.sha256(blob).hexdigest()
    calls = []

    def fake_urlopen(*_a, **_k):
        calls.append(1)
        return _FakeResponse(blob)

    monkeypatch.setattr(ng.urllib.request, "urlopen", fake_urlopen)
    shard = ("https://example.invalid/shard.gz", sha)
    assert ng.load_shard(shard, tmp_path).total == {"table": 5}
    assert ng.load_shard(shard, tmp_path).total == {"table": 5}  # from the cache
    assert len(calls) == 1
    merged = ng.load_counts((shard, shard), tmp_path, workers=1)
    assert merged.total == {"table": 10}


def test_load_shard_exits_on_checksum_mismatch(monkeypatch):
    monkeypatch.setattr(
        ng.urllib.request, "urlopen", lambda *a, **k: _FakeResponse(_gz("table\t2000,1,1\n"))
    )
    with pytest.raises(ng.ChecksumMismatch, match="checksum mismatch"):
        ng.load_shard(("https://example.invalid/s.gz", "0" * 64), None)
    with pytest.raises(SystemExit, match="checksum mismatch"):
        ng.load_counts((("https://example.invalid/s.gz", "0" * 64),), None, workers=1)


_POOL_MISMATCH = """
import gzip, io, sys
sys.path.insert(0, sys.argv[1])
import _ngram as ng

class R(io.BytesIO):
    def __enter__(self):
        return self
    def __exit__(self, *exc):
        return False

blob = gzip.compress(b"table\\t2000,5,1\\n", mtime=0)
ng.urllib.request.urlopen = lambda *a, **k: R(blob)
bad = ("https://example.invalid/s.gz", "0" * 64)
ng.load_counts((bad, bad, bad), None, workers=2)
"""


def test_load_counts_exits_cleanly_when_a_pool_worker_hits_a_bad_checksum():
    """A mismatch inside a Pool worker must end the run, not hang pool.map (#3253)."""
    import subprocess

    proc = subprocess.run(
        [sys.executable, "-c", _POOL_MISMATCH, str(_BACKEND / "scripts")],
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )
    assert proc.returncode != 0
    assert "checksum mismatch" in proc.stderr


def test_bounded_lines_skips_over_long_lines_without_buffering_them():
    stream = io.BytesIO(b"ok\n" + b"x" * 300 + b"\nend\n" + b"y" * 300)
    assert list(ng.bounded_lines(stream, max_len=100)) == [b"ok\n", b"end\n"]
    stream = io.BytesIO(b"a" * 50 + b"\n" + b"b" * 20)
    assert list(ng.bounded_lines(stream, max_len=100)) == [b"a" * 50 + b"\n", b"b" * 20]


def test_extract_shard_survives_a_stream_with_no_newline(monkeypatch):
    blob = _gz(_line("table", (2000, 5)) + "z" * (ng.MAX_LINE + 10))
    monkeypatch.setattr(ng.urllib.request, "urlopen", lambda *a, **k: _FakeResponse(blob))
    sha, counts = ng.extract_shard("https://example.invalid/shard.gz")
    assert sha == hashlib.sha256(blob).hexdigest()
    assert counts.total == {"table": 5}


def test_fetch_verified_exits_on_checksum_mismatch(monkeypatch):
    monkeypatch.setattr(gen.urllib.request, "urlopen", lambda *a, **k: _FakeResponse(b"x"))
    with pytest.raises(SystemExit, match="checksum mismatch"):
        gen.fetch_verified("https://example.invalid/x", "0" * 64)
    good = hashlib.sha256(b"x").hexdigest()
    assert gen.fetch_verified("https://example.invalid/x", good) == b"x"


def test_sources_are_pinned():
    pins = [gen.LITTRE_SHA256, gen.WSPANISH_SHA256]
    pins += [sha for shards in gen.NGRAM_SHARDS.values() for _, sha in shards]
    assert len(pins) == 11 and all(len(p) == 64 for p in pins)
    assert len(gen.NGRAM_SHARDS["fr"]) == 6 and len(gen.NGRAM_SHARDS["es"]) == 3


# --- shared list building ------------------------------------------------------------


def _counts(lower: dict[str, int], **pos: str) -> ng.Counts:
    return ng.Counts(dict(lower), dict(lower), {w: {t: 1} for w, t in pos.items()})


def test_pick_display_prefers_frequency_then_accents_then_code_point():
    c = _counts({"pêche": 10, "péché": 3})
    assert gen.pick_display({"péché", "pêche"}, c) == "pêche"
    assert gen.pick_display({"peche", "pêche"}, ng.Counts()) == "pêche"
    assert gen.pick_display({"pèche", "pêche"}, ng.Counts()) == "pèche"


def test_attested_needs_count_lowercase_and_not_foreign(monkeypatch):
    monkeypatch.setattr(gen, "MIN_ATTEST", 5)
    c = ng.Counts(
        {"aimes": 9, "rares": 4, "julia": 9, "skies": 9},
        {"aimes": 9, "rares": 4, "julia": 1, "skies": 9},
        {"skies": {"X": 3}},
    )
    assert gen.attested("aimes", c)
    assert not gen.attested("rares", c)
    assert not gen.attested("julia", c)
    assert not gen.attested("skies", c)


def test_build_valid_keeps_lemmas_and_attested_inflections_only(monkeypatch):
    monkeypatch.setattr(gen, "MIN_ATTEST", 5)
    c = _counts({"pêche": 10, "péché": 3, "aimés": 2, "aimes": 7, "chats": 9, "zzzzz": 9})
    valid = gen.build_valid(
        ["pêche", "péché", "abait", "ab"], ["aimés", "aimes", "chats", "chat"], c, "fr"
    )
    assert valid == {"abait": "abait", "aimes": "aimes", "chats": "chats", "peche": "pêche"}


def test_build_valid_lets_a_respelling_win_the_display(monkeypatch):
    monkeypatch.setattr(gen, "MIN_ATTEST", 5)
    c = _counts({"poème": 50, "poëme": 1})
    valid = gen.build_valid(["poëme"], [], c, "fr", fr.spelling_variants)
    assert valid == {"poeme": "poème"}


def test_top_keys_sums_display_forms_and_breaks_ties_by_key():
    c = _counts({"pêche": 3, "péché": 3, "table": 5, "chose": 5, "niños": 9})
    assert gen.top_keys(c, "fr", 3) == {"ninos", "peche", "chose"}  # ñ folds to n in fr
    assert gen.top_keys(c, "es", 1) == {"niños"}


def test_finish_answers_uses_the_valid_display_and_drops_blocked():
    valid = {"peche": "pêche", "poeme": "poème", "aimes": "aimés", "merde": "merde"}
    out = gen.finish_answers(
        ["pêche", "péché", "poëme", "aimes", "merde", "table"],
        valid,
        blocklist=frozenset({"merde"}),
        exclude=frozenset(),
        lang="fr",
        variants=fr.spelling_variants,
    )
    assert out == ["pêche", "poème"]
    assert gen.finish_answers(["pêche"], valid, frozenset(), frozenset({"peche"}), "fr") == []


def test_display_override_beats_ngram_and_keeps_the_answer():
    c = _counts({"guión": 50, "guion": 1})
    valid = gen.build_valid(["guión"], [], c, "es")
    assert valid == {"guion": "guion"}
    assert gen.finish_answers(["guión"], valid, frozenset(), frozenset(), "es") == ["guion"]


def test_collisions_lists_the_dropped_forms():
    lines = gen.collisions({"peche": "pêche"}, ["pêche", "péché", "pèche", "autre"], "fr")
    assert lines == ["peche: pêche (pèche, péché)"]


def test_parse_blocklist_folds_and_ignores_comments():
    text = "# header\n\nPéter  # note\n  niño \n"
    assert gen.parse_blocklist(text, "es") == {"peter", "niño"}
    assert gen.parse_blocklist(text, "fr") == {"peter", "nino"}


def test_tar_member_reads_and_exits_on_missing():
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        info = tarfile.TarInfo("d/words")
        info.size = 3
        tar.addfile(info, io.BytesIO(b"abc"))
    assert gen.tar_member(buf.getvalue(), "d/words") == b"abc"
    with pytest.raises(KeyError):
        gen.tar_member(buf.getvalue(), "d/missing")


# --- French ---------------------------------------------------------------------------


def test_split_headword_and_feminine_suffix():
    assert fr.split_headword("FRÉQUENT, ENTE.1") == ("fréquent", "ente")
    assert fr.split_headword("ABCÈS") == ("abcès", None)
    assert fr.feminine_from_suffix("actif", "ive") == "active"
    assert fr.feminine_from_suffix("fréquent", "ente") == "fréquente"
    assert fr.feminine_from_suffix("aboyé", "ée") == "aboyée"
    assert fr.feminine_from_suffix("frénateur", "trice") == "frénatrice"
    assert fr.feminine_from_suffix("veuf", "veuve") == "veuve"
    assert fr.feminine_from_suffix("sec", "sèche") == "sèche"
    assert fr.feminine_from_suffix("amant", "ante") == "amante"
    assert fr.feminine_from_suffix("bon", "ne!") is None
    assert fr.feminine_from_suffix("bon", "z") is None


def test_grammar_pos():
    assert fr.grammar_pos("s. m.") == {"noun"}
    assert fr.grammar_pos("s. m. et f.") == {"noun", "both"}
    assert fr.grammar_pos("s. f. plur.") == {"noun", "plural"}
    assert fr.grammar_pos("ajd.") == {"adj"}
    assert fr.grammar_pos(", je dors, tu dors, v. n.") == {"verb"}
    assert fr.grammar_pos("part. passé et adj.") == {"part", "adj"}
    assert fr.grammar_pos(", part. passé du verbe battre.") == {"part"}
    assert fr.grammar_pos("adv.") == {"adv"}


def test_listed_forms_reads_a_verb_head():
    label = (
        ", je dors, tu dors, il dort, nous dormons ; que je dorme ; j'irai (rare), "
        "il prend l'auxiliaire être ; dormant, v. n."
    )
    assert fr.listed_forms(label) == ("dors", "dort", "dormons", "dorme", "irai", "dormant")


def _article(head: str, body: str) -> str:
    return f"<i><small>{head}</small></i>\n{body}\n"


def test_parse_head_reads_grammar_forms_model_xref_and_archaism():
    e = fr.parse_head(_article("(dor-mir), je dors, il dort, v. n.", "Être dans le sommeil."))
    assert e.pos == {"verb"} and e.forms == ("dors", "dort") and not e.xref
    e = fr.parse_head(
        _article("(a-dmè-tr'. Se conjugue comme mettre)", "<b>1°</b> V. a. Recevoir.")
    )
    assert e.pos == {"verb"} and e.model == "mettre"
    assert fr.parse_head(_article(" s. f.", "    Voy. ALISE.")).xref
    assert fr.parse_head(_article("(a-bè) s. m.", "Vieux mot. Appât.")).archaic
    assert fr.parse_head("no head").pos == frozenset()


def _stardict(articles: list[tuple[list[str], str]]) -> tuple[bytes, bytes]:
    data = b""
    idx = []
    for heads, text in articles:
        raw = text.encode("utf-8")
        for h in heads:
            idx.append((h, len(data), len(raw)))
        data += raw
    idx_bytes = b"".join(h.encode() + b"\0" + struct.pack(">II", o, s) for h, o, s in idx)
    return idx_bytes, gzip.compress(data, mtime=0)


def test_parse_littre_keeps_the_accented_headword_and_its_feminine():
    idx, dz = _stardict(
        [
            (["ABCES", "ABCÈS"], _article("(ab-sê) s. m.", "Amas de pus.")),
            (["VEUF", "VEUF, VEUVE"], _article("(veuf) adj.", "Dont la femme est morte.")),
            (["A VAU", "-ACE"], _article("loc. adv.", "x")),
        ]
    )
    assert [o for _h, o, _s in fr.parse_idx(idx)][:2] == [0, 0]
    entries = fr.parse_littre(idx, dz)
    assert [(e.word, e.feminine) for e in entries] == [("abcès", None), ("veuf", "veuve")]


def test_spelling_variants():
    assert "poème" in fr.spelling_variants("poëme")
    assert "grège" in fr.spelling_variants("grége")
    assert "gaine" in fr.spelling_variants("gaîne")
    assert "arôme" in fr.spelling_variants("arome")
    assert "cœur" in fr.spelling_variants("coeur")
    assert "àjour" not in fr.spelling_variants("ajour")
    assert "table" not in fr.spelling_variants("table")


def test_plurals_and_feminines():
    assert fr.plurals("chat") == {"chats"}
    assert fr.plurals("cheval") == {"chevals", "chevaux"}
    assert fr.plurals("travail") == {"travails", "travaux"}
    assert "feux" in fr.plurals("feu")
    assert fr.plurals("prix") == set()
    assert fr.feminines("actif") == {"active", "actife"}
    assert "heureuse" in fr.feminines("heureux")
    assert fr.feminines("jeune") == set()
    assert fr.feminines("petit") == {"petite"}


def test_verb_forms():
    assert {"aime", "aimes", "aimez", "aima", "aimai", "aimés", "aimât"} <= fr.verb_forms("aimer")
    assert {"lève", "levez"} <= fr.verb_forms("lever")
    assert "commençons" in fr.verb_forms("commencer")
    assert "mangeons" in fr.verb_forms("manger")
    assert {"paie", "paye"} <= fr.verb_forms("payer")
    assert {"jette", "appelle"} <= fr.verb_forms("jeter") | fr.verb_forms("appeler")
    assert {"finis", "finit", "fini", "finie"} <= fr.verb_forms("finir")
    assert {"dors", "dort"} <= fr.verb_forms("dormir")
    assert {"vends", "vend", "vendu", "vendue"} <= fr.verb_forms("vendre")
    assert fr.verb_forms("table") == set()
    assert "aimer" not in fr.verb_forms("aimer")


def test_transfer_and_expand_tenses():
    assert fr.transfer_forms("admettre", "mettre", ["mets", "met", "mis"]) == {
        "admets",
        "admet",
        "admis",
    }
    assert "craignons" in fr.transfer_forms("craindre", "peindre", ["peins", "peignons"])
    assert fr.transfer_forms("aimer", "boire", ["bois"]) == set()
    tenses = fr.expand_tenses(["devrai", "parus", "mis", "venais", "vins"])
    assert {"devra", "devrez", "parut", "mit", "venait", "vint"} <= tenses


def test_irregular_forms_use_littre_paradigms():
    venir = fr.Entry("venir", frozenset({"verb"}), forms=("viens", "vient", "venu", "vins"))
    revenir = fr.Entry("revenir", frozenset({"verb"}))
    admettre = fr.Entry("admettre", frozenset({"verb"}), model="mettre")
    mettre = fr.Entry("mettre", frozenset({"verb"}), forms=("mets", "mis"))
    paradigms = fr.listed_paradigms([venir, revenir, admettre, mettre])
    assert set(paradigms) == {"venir", "mettre"}
    assert {"reviens", "revient", "revint"} <= fr.irregular_forms(revenir, paradigms)
    assert {"admets", "admis", "admit"} <= fr.irregular_forms(admettre, paradigms)


def test_lemma_forms_by_part_of_speech():
    adj = fr.Entry("petit", frozenset({"adj"}))
    assert fr.lemma_forms(adj) == {"petits", "petite", "petites"}
    noun = fr.Entry("ami", frozenset({"noun", "both"}))
    assert {"amis", "amie", "amies"} <= fr.lemma_forms(noun)
    plural_only = fr.Entry("abois", frozenset({"noun", "plural"}))
    assert fr.lemma_forms(plural_only) == set()
    given = fr.Entry("veuf", frozenset({"adj"}), feminine="veuve")
    assert fr.lemma_forms(given) == {"veufs", "veuve", "veuves"}


def _fr(word: str, *pos: str, **kw) -> fr.Entry:
    return fr.Entry(word, frozenset(pos), **kw)


def test_fr_is_inflection():
    c = ng.Counts(
        pos={
            "allée": {"NOUN": 24, "VERB": 76},
            "dorée": {"NOUN": 15, "ADJ": 85},
            "porte": {"NOUN": 70, "VERB": 30},
            "vide": {"ADJ": 80, "VERB": 20},
            "aimes": {"VERB": 1},
            "chats": {"NOUN": 1},
        }
    )
    assert not gen.fr_is_inflection("allée", [_fr("allée", "noun")], True, False, c)
    assert gen.fr_is_inflection("dorée", [_fr("dorée", "noun")], True, False, c)
    assert not gen.fr_is_inflection("porte", [_fr("porte", "noun")], True, False, c)
    assert not gen.fr_is_inflection("vide", [_fr("vide", "adj")], True, False, c)
    assert gen.fr_is_inflection("aimes", [_fr("aimes", "noun")], True, False, c)
    assert gen.fr_is_inflection("battu", [_fr("battu", "part")], False, False, c)
    assert gen.fr_is_inflection("chats", [_fr("chats", "noun")], False, True, c)
    assert not gen.fr_is_inflection("abois", [_fr("abois", "noun", "plural")], False, True, c)
    assert gen.fr_is_inflection("belle", [_fr("belle", "adj")], False, True, c)
    assert not gen.fr_is_inflection("table", [_fr("table", "noun")], False, False, c)


def test_fr_answer_ok(monkeypatch):
    c = ng.Counts(
        {"table": 10, "paris": 10, "about": 10, "abait": 10},
        {"table": 9, "paris": 1, "about": 9, "abait": 9},
        {"about": {"X": 5}},
    )
    top = frozenset({"table", "paris", "about", "abait"})

    def never(_w):
        return False

    assert gen.fr_answer_ok("table", [_fr("table", "noun")], top, c, never)
    assert not gen.fr_answer_ok("table", [_fr("table", "noun")], frozenset(), c, never)
    assert not gen.fr_answer_ok("paris", [_fr("paris", "noun")], top, c, never)
    assert not gen.fr_answer_ok("about", [_fr("about", "noun")], top, c, never)
    assert not gen.fr_answer_ok("abait", [_fr("abait", "noun", archaic=True)], top, c, never)
    assert not gen.fr_answer_ok("table", [_fr("table")], top, c, never)
    assert not gen.fr_answer_ok("table", [_fr("table", "noun")], top, c, lambda _w: True)


# --- Spanish --------------------------------------------------------------------------


def test_parse_wspanish_reads_latin1():
    data = "árbol\nniño\nmesa\nAbril\nde-ar\nbuenos\n".encode("latin-1")
    assert es.parse_wspanish(data) == ["abril", "árbol"]
    assert "niño" in es.parse_wspanish_all(data)


def test_es_plurals():
    assert es.plurals("casa") == {"casas"}
    assert es.plurals("árbol") == {"árboles"}
    assert es.plurals("luz") == {"luces"}
    assert es.plurals("canción") == {"canciones"}
    assert es.plurals("gas") == {"gases"}
    assert es.plurals("inglés") == {"ingleses"}
    assert es.plurals("lunes") == set()
    assert es.plurals("rubí") == {"rubís", "rubíes"}
    assert es.plurals("tórax") == set()


def test_es_verb_forms():
    assert {"hablo", "habla", "habló", "hablé", "hablan"} <= es.verb_forms("hablar")
    assert {"busqué", "busque"} <= es.verb_forms("buscar")
    assert "pagué" in es.verb_forms("pagar")
    assert "cojo" in es.verb_forms("coger")
    assert "conozca" in es.verb_forms("conocer")
    assert {"puede", "vuela", "juega"} <= (
        es.verb_forms("poder") | es.verb_forms("volar") | es.verb_forms("jugar")
    )
    assert {"pidió", "durmió"} <= es.verb_forms("pedir") | es.verb_forms("dormir")
    assert {"huyen", "huyó"} <= es.verb_forms("huir")
    assert {"leyó", "leído", "cayó"} <= es.verb_forms("leer") | es.verb_forms("caer")
    assert es.verb_forms("mesa") == set()
    assert "hablar" not in es.verb_forms("hablar")


def test_es_irregulars_and_enclitics():
    assert {"tengo", "tiene", "tuvo"} <= es.irregular_forms("tener")
    assert {"opuso", "opongo"} <= es.irregular_forms("oponer")
    assert "obtuvo" in es.irregular_forms("obtener")
    assert es.irregular_forms("ver") >= {"visto", "veían"}
    assert "vio" not in es.irregular_forms("prever")  # 3-letter bases are not compounded
    clitics = es.enclitics("dar") | es.enclitics("ver") | es.enclitics("ir")
    assert {"darle", "verlo", "irnos"} <= clitics
    assert es.enclitics("mesa") == set()
    forms = es.lemma_forms("casa") | es.lemma_forms("dar") | es.lemma_forms("tener")
    assert {"casas", "darle", "tuvo"} <= forms


def test_es_is_inflection():
    lemmas = frozenset({"casa", "bueno", "buena", "casas", "habla", "hablar", "luz", "luces"})
    c = ng.Counts(pos={"buena": {"ADJ": 9}, "habla": {"VERB": 9}, "fruta": {"NOUN": 9}})
    assert gen.es_is_inflection("casas", lemmas, c)
    assert gen.es_is_inflection("luces", lemmas, c)
    assert gen.es_is_inflection("buena", lemmas, c)
    assert gen.es_is_inflection("habla", lemmas, c)
    assert not gen.es_is_inflection("hablar", lemmas, c)
    assert not gen.es_is_inflection("fruta", lemmas | {"fruto"}, c)
    assert es.feminine_of("buena", lemmas) and not es.feminine_of("casa", lemmas)
