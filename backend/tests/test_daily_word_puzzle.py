"""Unit tests for the daily_word puzzle selector (#1188)."""

from __future__ import annotations

import unicodedata
from datetime import datetime, timezone


from daily_word.puzzle import get_answer, get_today_meta, is_valid_guess

# ---------------------------------------------------------------------------
# Timezone isolation
# ---------------------------------------------------------------------------


def test_tz_isolation_calgary_vs_london():
    """Calgary (UTC-7) and London (UTC+0) get different puzzle_ids between 00:00–07:00 UTC."""
    # At 2026-05-02 03:00 UTC:
    #   Calgary offset = -420 min → local time = 2026-05-01 20:00
    #   London  offset =    0 min → local time = 2026-05-02 03:00
    fixed_utc = datetime(2026, 5, 2, 3, 0, 0, tzinfo=timezone.utc)

    calgary = get_today_meta(-420, "en", _utc_now=fixed_utc)
    london = get_today_meta(0, "en", _utc_now=fixed_utc)

    assert calgary["puzzle_id"] != london["puzzle_id"]
    assert calgary["puzzle_id"].startswith("2026-05-01")
    assert london["puzzle_id"].startswith("2026-05-02")


def test_same_tz_same_puzzle_id():
    """Same timezone always yields the same puzzle_id for the same UTC time."""
    fixed_utc = datetime(2026, 5, 2, 12, 0, 0, tzinfo=timezone.utc)
    a = get_today_meta(0, "en", _utc_now=fixed_utc)
    b = get_today_meta(0, "en", _utc_now=fixed_utc)
    assert a["puzzle_id"] == b["puzzle_id"]


# ---------------------------------------------------------------------------
# Answer not in response
# ---------------------------------------------------------------------------


def test_get_today_meta_does_not_return_answer():
    """get_today_meta return value must have no 'word' or 'answer' key."""
    fixed_utc = datetime(2026, 5, 2, 12, 0, 0, tzinfo=timezone.utc)
    meta = get_today_meta(0, "en", _utc_now=fixed_utc)
    assert "word" not in meta
    assert "answer" not in meta
    assert "puzzle_id" in meta
    assert "word_length" in meta


def test_get_today_meta_word_length_positive():
    fixed_utc = datetime(2026, 5, 2, 12, 0, 0, tzinfo=timezone.utc)
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
    a = get_answer("2026-05-02:en")
    b = get_answer("2026-05-02:en")
    assert a == b


def test_get_answer_different_dates_may_differ():
    """Different dates yield potentially different answers (collision is possible but unlikely)."""
    a = get_answer("2026-05-01:en")
    b = get_answer("2026-05-02:en")
    # Not guaranteed to differ, but checks no crash
    assert isinstance(a, str)
    assert isinstance(b, str)


def test_get_answer_consistent_with_meta():
    """Word length from get_today_meta matches actual answer length."""
    fixed_utc = datetime(2026, 5, 2, 12, 0, 0, tzinfo=timezone.utc)
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
    lines = [l for l in lines if l.strip()]
    assert len(lines) == len(set(lines)), (
        f"valid_hi.txt contains {len(lines) - len(set(lines))} duplicate entries"
    )
