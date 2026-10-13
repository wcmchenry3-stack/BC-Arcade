"""Unit tests for the daily_word puzzle selector (#1188)."""

from __future__ import annotations

import importlib.util
import re
import unicodedata
from datetime import UTC, datetime
from pathlib import Path

from daily_word.puzzle import get_answer, get_today_meta, is_valid_guess

_GEN_PATH = Path(__file__).parents[1] / "scripts" / "gen_english_words.py"
_spec = importlib.util.spec_from_file_location("gen_english_words", _GEN_PATH)
assert _spec is not None and _spec.loader is not None
gen = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(gen)

# ---------------------------------------------------------------------------
# Timezone isolation
# ---------------------------------------------------------------------------


def test_tz_isolation_calgary_vs_london():
    """Calgary (UTC-7) and London (UTC+0) get different puzzle_ids between 00:00–07:00 UTC."""
    # At 2026-05-02 03:00 UTC:
    #   Calgary offset = -420 min → local time = 2026-05-01 20:00
    #   London  offset =    0 min → local time = 2026-05-02 03:00
    fixed_utc = datetime(2026, 5, 2, 3, 0, 0, tzinfo=UTC)

    calgary = get_today_meta(-420, "en", _utc_now=fixed_utc)
    london = get_today_meta(0, "en", _utc_now=fixed_utc)

    assert calgary["puzzle_id"] != london["puzzle_id"]
    assert calgary["puzzle_id"].startswith("2026-05-01")
    assert london["puzzle_id"].startswith("2026-05-02")


def test_same_tz_same_puzzle_id():
    """Same timezone always yields the same puzzle_id for the same UTC time."""
    fixed_utc = datetime(2026, 5, 2, 12, 0, 0, tzinfo=UTC)
    a = get_today_meta(0, "en", _utc_now=fixed_utc)
    b = get_today_meta(0, "en", _utc_now=fixed_utc)
    assert a["puzzle_id"] == b["puzzle_id"]


# ---------------------------------------------------------------------------
# Answer not in response
# ---------------------------------------------------------------------------


def test_get_today_meta_does_not_return_answer():
    """get_today_meta return value must have no 'word' or 'answer' key."""
    fixed_utc = datetime(2026, 5, 2, 12, 0, 0, tzinfo=UTC)
    meta = get_today_meta(0, "en", _utc_now=fixed_utc)
    assert "word" not in meta
    assert "answer" not in meta
    assert "puzzle_id" in meta
    assert "word_length" in meta


def test_get_today_meta_word_length_positive():
    fixed_utc = datetime(2026, 5, 2, 12, 0, 0, tzinfo=UTC)
    meta = get_today_meta(0, "en", _utc_now=fixed_utc)
    assert meta["word_length"] > 0


def test_all_hindi_answers_same_word_length():
    """Every Hindi answer must have the same word_length so the UI grid is consistent."""
    from daily_word.puzzle import _ANSWERS_HI

    lengths = {len(w) for w in _ANSWERS_HI}
    assert len(lengths) == 1, f"Hindi answers have mixed lengths: {lengths}"


def test_hindi_corpus_has_year_coverage():
    """Hindi answer corpus must cover at least a year of daily puzzles (no proper nouns)."""
    from daily_word.puzzle import _ANSWERS_HI

    assert len(_ANSWERS_HI) >= 365, f"Hindi corpus too small: {len(_ANSWERS_HI)} words"


def test_hindi_answers_subset_of_valid():
    """Every Hindi answer must also be a valid guess."""
    from daily_word.puzzle import _ANSWERS_HI, _VALID_HI

    missing = set(_ANSWERS_HI) - set(_VALID_HI)
    assert not missing, f"Answers not in valid_hi: {missing}"


# ---------------------------------------------------------------------------
# get_answer determinism
# ---------------------------------------------------------------------------


def test_get_answer_is_deterministic():
    """Same puzzle_id always returns the same answer."""
    a = get_answer("2026-05-02:en:2")
    b = get_answer("2026-05-02:en:2")
    assert a == b


def test_get_answer_different_dates_may_differ():
    """Different dates yield potentially different answers (collision is possible but unlikely)."""
    a = get_answer("2026-05-01:en:2")
    b = get_answer("2026-05-02:en:2")
    # Not guaranteed to differ, but checks no crash
    assert isinstance(a, str)
    assert isinstance(b, str)


def test_get_answer_consistent_with_meta():
    """Word length from get_today_meta matches actual answer length."""
    fixed_utc = datetime(2026, 5, 2, 12, 0, 0, tzinfo=UTC)
    meta = get_today_meta(0, "en", _utc_now=fixed_utc)
    answer = get_answer(meta["puzzle_id"])
    assert len(answer) == meta["word_length"]


# ---------------------------------------------------------------------------
# is_valid_guess (O(1) check)
# ---------------------------------------------------------------------------


def test_is_valid_guess_known_word():
    assert is_valid_guess("crane", "en") is True


def test_is_valid_guess_unknown_word():
    assert is_valid_guess("zzzzz", "en") is False


def test_is_valid_guess_case_insensitive():
    assert is_valid_guess("CRANE", "en") is False  # guesses should be lower-cased by caller


def test_is_valid_guess_hindi_nfc_roundtrip():
    """NFC and NFD input forms both validate correctly after normalization."""
    word = "सुंदर"
    nfc = unicodedata.normalize("NFC", word)
    nfd = unicodedata.normalize("NFD", word)
    assert is_valid_guess(nfc, "hi") is True
    assert is_valid_guess(nfd, "hi") is True


def test_is_valid_guess_hindi_invalid():
    assert is_valid_guess("zzzzz", "hi") is False


# ---------------------------------------------------------------------------
# English valid-guess corpus size (#1261)
# ---------------------------------------------------------------------------


def test_valid_en_corpus_size():
    """valid_en.txt must be large enough to accept common 5-letter words (>8 000 entries)."""
    from daily_word.puzzle import _VALID_EN

    assert len(_VALID_EN) > 8_000, f"English valid-guess corpus too small: {len(_VALID_EN)}"


def test_valid_en_common_words_accepted():
    """Words routinely rejected before #1261 fix must now validate."""
    for word in ("stoic", "piety", "tryst", "grove", "flint"):
        assert is_valid_guess(word, "en") is True, f"{word!r} should be a valid guess"


# ---------------------------------------------------------------------------
# Hindi valid-guess corpus size (#1262)
# ---------------------------------------------------------------------------


def test_valid_hi_corpus_size():
    """valid_hi.txt must be large enough for the game to be usable (>=3 000 entries)."""
    from daily_word.puzzle import _VALID_HI

    assert len(_VALID_HI) >= 3_000, f"Hindi valid-guess corpus too small: {len(_VALID_HI)}"


def test_valid_hi_all_five_codepoints():
    """Every entry in valid_hi.txt must be exactly 5 NFC code points."""
    import unicodedata

    from daily_word.puzzle import _VALID_HI

    bad = [w for w in _VALID_HI if len(unicodedata.normalize("NFC", w)) != 5]
    assert not bad, f"Hindi valid words with wrong length: {bad[:5]}"


def test_valid_hi_all_devanagari():
    """Every character in valid_hi.txt must be in the Devanagari Unicode block."""
    from daily_word.puzzle import _VALID_HI

    DEVA_START, DEVA_END = 0x0900, 0x097F
    bad = [w for w in _VALID_HI if not all(DEVA_START <= ord(c) <= DEVA_END for c in w)]
    assert not bad, f"Non-Devanagari words in valid_hi: {bad[:5]}"


def test_valid_hi_no_duplicates():
    """valid_hi.txt must have no duplicate lines (frozenset would silently hide them)."""
    from daily_word.puzzle import _WORDS_DIR

    lines = (_WORDS_DIR / "valid_hi.txt").read_text("utf-8").splitlines()
    lines = [ln for ln in lines if ln.strip()]
    assert len(lines) == len(
        set(lines)
    ), f"valid_hi.txt contains {len(lines) - len(set(lines))} duplicate entries"


# ---------------------------------------------------------------------------
# English word lists: provenance invariants and filtering (#3155)
# ---------------------------------------------------------------------------

_BLOCKLIST_EN = Path(__file__).parents[1] / "daily_word" / "words" / "answers_blocklist_en.txt"


def test_english_answers_are_valid_five_letter_unique_words():
    from daily_word.puzzle import _ANSWERS_EN, _VALID_EN

    assert all(re.fullmatch(r"[a-z]{5}", w) for w in _ANSWERS_EN)
    assert len(set(_ANSWERS_EN)) == len(_ANSWERS_EN)
    assert set(_ANSWERS_EN) <= _VALID_EN
    assert 1_500 <= len(_ANSWERS_EN) <= 3_000


def test_english_valid_list_is_enable_sized_and_clean():
    from daily_word.puzzle import _VALID_EN

    assert all(re.fullmatch(r"[a-z]{5}", w) for w in _VALID_EN)
    # ENABLE has 8,636 five-letter words; the old (unlicensed) guess list had 14,855.
    assert 8_000 < len(_VALID_EN) < 9_000


def test_english_answers_exclude_blocklist():
    from daily_word.puzzle import _ANSWERS_EN

    blocked = gen.parse_blocklist(_BLOCKLIST_EN.read_text(encoding="utf-8"))
    assert blocked
    assert not blocked & set(_ANSWERS_EN)


def test_gen_build_answers_filters():
    enable5 = frozenset({"tests", "catty", "crane", "bitch", "alias", "boxes"})
    enable4 = frozenset({"test", "cats"})
    candidates = {"tests", "catty", "crane", "bitch", "alias", "boxes", "zzzzz", "caf\xe9s"}
    out = gen.build_answers(candidates, enable5, enable4, frozenset({"bitch"}))
    # tests: plural of an ENABLE 4-letter word; bitch: blocklisted; zzzzz: not in ENABLE;
    # cafés: not a-z. boxes stays ("boxe" is not a word); alias stays (stem "alia" is not one).
    assert out == ["alias", "boxes", "catty", "crane"]


def test_gen_build_answers_drops_past_tense_but_keeps_listed_words():
    enable5 = frozenset({"acted", "freed", "greed", "tired", "tweed", "seeds", "naked"})
    stems = frozenset({"act", "free", "gree", "tire", "twee"})
    out = gen.build_answers(set(enable5), enable5, stems, frozenset())
    # acted (act+ed) and freed (free+d) are dropped; greed and tired are in ED_KEEP;
    # naked has no word stem; tweed is kept by ED_KEEP.
    assert out == ["greed", "naked", "seeds", "tired", "tweed"]
    assert {"greed", "tired", "tweed", "bored", "breed"} <= gen.INFLECTION_KEEP


def test_english_answers_have_no_dropped_past_tense():
    from daily_word.puzzle import _ANSWERS_EN

    assert not {"acted", "freed", "baked", "moved"} & set(_ANSWERS_EN)
    assert {"greed", "tired", "bored"} <= set(_ANSWERS_EN)


def test_gen_parse_blocklist_ignores_comments_and_blanks():
    assert gen.parse_blocklist("# header\n\nBitch  # note\n  rude \n") == {"bitch", "rude"}


def test_gen_parse_enable_splits_by_length():
    five, four = gen.parse_enable("cat\ncats\ncrane\nplanet\nCrane\n")
    assert five == {"crane"}
    assert four == {"cat", "cats"}


def test_gen_output_is_sorted_and_scowl_pinned():
    assert len(gen.SCOWL_SHA256) == 64 and len(gen.ENABLE_SHA256) == 64
    from daily_word.puzzle import _load_list

    for name in ("answers_en.txt", "valid_en.txt"):
        words = _load_list(name)
        assert words == sorted(words)


# ---------------------------------------------------------------------------
# puzzle_id carries the English list version (#3155)
# ---------------------------------------------------------------------------


def test_english_puzzle_id_is_versioned_hindi_is_not():
    fixed_utc = datetime(2026, 5, 2, 12, 0, 0, tzinfo=UTC)
    assert get_today_meta(0, "en", _utc_now=fixed_utc)["puzzle_id"] == "2026-05-02:en:2"
    assert get_today_meta(0, "hi", _utc_now=fixed_utc)["puzzle_id"] == "2026-05-02:hi"


def test_get_answer_rejects_unversioned_english_id():
    import pytest

    with pytest.raises(ValueError):
        get_answer("2026-05-02:en")
    with pytest.raises(ValueError):
        get_answer("2026-05-02:en:1")
    assert get_answer("2026-05-02:en:2")
    assert get_answer("2026-05-02:hi")


def test_parse_puzzle_id_accepts_current_ids():
    from daily_word.puzzle import parse_puzzle_id

    assert parse_puzzle_id("2026-05-02:en:2") == ("2026-05-02", "en")
    assert parse_puzzle_id("2026-05-02:hi") == ("2026-05-02", "hi")


def test_parse_puzzle_id_rejects_malformed():
    import pytest

    from daily_word.puzzle import StalePuzzleId, parse_puzzle_id

    for bad in (
        "2026-13-01:en:2",  # bad month
        "2026-02-30:en:2",  # bad day
        "2026-5-2:en:2",  # not zero-padded
        "2026-W05-1:en:2",  # ISO week date (fromisoformat accepts it on 3.11+)
        "20260502:en:2",  # basic format
        "\u0662\u0660\u0662\u0666-\u0660\u0665-\u0660\u0662:en:2",  # Arabic-Indic digits
        "2026-05-02:fr",  # unknown language
        "2026-05-02:xx:2",
        "2026-05-02",
        "2026-05-02:en:2:3",
        "",
    ):
        with pytest.raises(ValueError) as exc:
            parse_puzzle_id(bad)
        assert not isinstance(exc.value, StalePuzzleId), bad


def test_parse_puzzle_id_flags_old_versions_as_stale():
    import pytest

    from daily_word.puzzle import StalePuzzleId, parse_puzzle_id

    for old in ("2026-05-02:en", "2026-05-02:en:1", "2026-05-02:en:3", "2026-05-02:hi:2"):
        with pytest.raises(StalePuzzleId):
            parse_puzzle_id(old)


# ---------------------------------------------------------------------------
# Inflection filters (#3155)
# ---------------------------------------------------------------------------


def _rule(word, stems):
    return gen.inflection_rule(word, frozenset(stems))


def test_inflection_rule_each_suffix():
    stems = {"cat", "cry", "fry", "box", "cue", "wry", "icy", "wide", "act", "free", "ski"}
    assert _rule("wides", {"wide"}) == "s"
    assert _rule("cries", stems) == "ies"
    assert _rule("fried", stems) == "ied"
    assert _rule("boxes", stems) == "es"
    assert _rule("acted", stems) == "ed"
    assert _rule("freed", stems) == "ed"
    assert _rule("cuing", stems) == "ing"
    assert _rule("eking", {"eke"}) == "ing"
    assert _rule("wryer", stems) == "er"
    assert _rule("wider", stems) == "er"
    assert _rule("icier", stems) == "ier"
    assert _rule("wrest", {"wr"}) == "est"
    assert _rule("crane", stems) is None


def test_build_answers_applies_inflection_rules_and_keep_list():
    five = {
        "cries",
        "fried",
        "boxes",
        "cuing",
        "wryer",
        "icier",
        "pants",
        "thing",
        "water",
        "tired",
    }
    stems = frozenset(
        {"cry", "fry", "box", "cue", "wry", "icy", "pant", "thin", "wat", "tire", "tir"}
    )
    out = gen.build_answers(five, frozenset(five), stems, frozenset())
    # pants, thing, water, tired are in INFLECTION_KEEP; the rest are inflections.
    assert out == ["pants", "thing", "tired", "water"]
    assert {"pants", "thing", "water", "tired", "bored", "never"} <= gen.INFLECTION_KEEP


def test_committed_answers_have_no_common_inflections():
    from daily_word.puzzle import _ANSWERS_EN

    answers = set(_ANSWERS_EN)
    assert not {"cries", "fried", "boxes", "taxes", "cuing", "wryer", "icier", "acted"} & answers
    assert {"pants", "thing", "water", "never", "greed"} <= answers
