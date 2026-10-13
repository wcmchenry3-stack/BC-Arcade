"""French / Spanish Daily Word backend (#3240): fold, loading, offsets, API.

The real fr/es lists come from #3239, so these tests install small fixture lists
(display-form files, as that issue specifies) rather than relying on them.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from daily_word import puzzle as puzzle_mod
from daily_word.normalize import fold
from daily_word.puzzle import get_answer, make_puzzle_id

_FR_ANSWERS = ["étage", "pêche", "forêt"]
_FR_VALID = ["étage", "pêche", "forêt", "péché", "cœur", "naïve", "garçon", "était"]
_ES_ANSWERS = ["cañón", "árbol", "pañal"]
_ES_VALID = ["cañón", "árbol", "pañal", "mañas", "pinta", "tapón"]


# ---------------------------------------------------------------------------
# fold()
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("word", "lang", "expected"),
    [
        ("ÉTAIT", "fr", "etait"),
        ("était", "fr", "etait"),
        ("garçon", "fr", "garcon"),
        ("cœurs", "fr", "coeurs"),
        ("CŒURS", "fr", "coeurs"),
        ("æther", "fr", "aether"),
        ("naïve", "fr", "naive"),
        ("niño", "es", "niño"),
        ("NIÑO", "es", "niño"),
        ("árbol", "es", "arbol"),
        ("pingüino", "es", "pinguino"),
        ("cañón", "es", "cañon"),
        ("crane", "en", "crane"),
        ("CRANE", "en", "crane"),
    ],
)
def test_fold_cases(word: str, lang: str, expected: str) -> None:
    assert fold(word, lang) == expected


def test_fold_strips_tilde_on_n_only_outside_spanish() -> None:
    assert fold("niño", "fr") == "nino"
    assert fold("niño", "en") == "nino"


def test_fold_keeps_tilde_on_other_letters_out_in_spanish() -> None:
    # Only ñ is a letter; a tilde on any other base is just a combining mark.
    assert fold("ã", "es") == "a"


def test_fold_handles_decomposed_input() -> None:
    assert fold("était", "fr") == "etait"
    assert fold("niño", "es") == "niño"
    # decomposed n + U+0303 and precomposed U+00F1 fold to the same key
    assert fold("nin\u0303o", "es") == fold("ni\u00f1o", "es") == "ni\u00f1o"


def test_fold_is_idempotent() -> None:
    for lang, word in (("fr", "ÉTÂGE"), ("es", "NIÑOS"), ("en", "great")):
        once = fold(word, lang)
        assert fold(once, lang) == once


def test_fold_leaves_devanagari_untouched() -> None:
    for word in ("सुंदर", "चाहिए", "कटोरी"):
        assert fold(word, "hi") == word


def test_fold_is_noop_on_english_words() -> None:
    from daily_word.puzzle import _ANSWERS_EN

    assert all(fold(w, "en") == w for w in _ANSWERS_EN)


# ---------------------------------------------------------------------------
# Loader
# ---------------------------------------------------------------------------


def _write_lists(directory: Path, lang: str, answers: list[str], valid: list[str]) -> None:
    (directory / f"answers_{lang}.txt").write_text("\n".join(answers) + "\n", encoding="utf-8")
    (directory / f"valid_{lang}.txt").write_text("\n".join(valid) + "\n", encoding="utf-8")


def test_loader_builds_folded_keys_and_display_map(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _write_lists(tmp_path, "es", _ES_ANSWERS, _ES_VALID)
    monkeypatch.setattr(puzzle_mod, "_WORDS_DIR", tmp_path)
    answers, valid, display = puzzle_mod._load_romance("es")  # type: ignore[misc]
    assert answers == ["cañon", "arbol", "pañal"]
    assert {"cañon", "arbol", "pañal", "manas"} - valid == {"manas"}  # mañas keeps ñ
    assert "mañas" in valid
    assert display["arbol"] == "árbol"
    assert display["cañon"] == "cañón"
    assert set(answers) <= valid


def test_loader_returns_none_when_files_are_missing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(puzzle_mod, "_WORDS_DIR", tmp_path)
    assert puzzle_mod._load_romance("fr") is None
    (tmp_path / "answers_fr.txt").write_text("étage\n", encoding="utf-8")
    assert puzzle_mod._load_romance("fr") is None  # valid file still missing


def test_register_missing_language_leaves_it_unsupported(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(puzzle_mod, "_WORDS_DIR", tmp_path)
    monkeypatch.setattr(puzzle_mod, "_ANSWERS", {"en": puzzle_mod._ANSWERS_EN})
    puzzle_mod._register_romance("fr")
    assert not puzzle_mod.is_supported("fr")
    assert puzzle_mod.is_supported("en")


# ---------------------------------------------------------------------------
# Installed fixture languages
# ---------------------------------------------------------------------------


def _install(monkeypatch: pytest.MonkeyPatch, lang: str, answers: list[str], valid: list[str]):
    folded_answers = [fold(w, lang) for w in answers]
    display = {fold(w, lang): w for w in [*valid, *answers]}
    monkeypatch.setitem(puzzle_mod._ANSWERS, lang, folded_answers)
    monkeypatch.setitem(puzzle_mod._VALID, lang, frozenset(display))
    monkeypatch.setitem(puzzle_mod._DISPLAY, lang, display)
    monkeypatch.setitem(puzzle_mod._LIST_VERSION, lang, 1)


@pytest.fixture
def fr_es(monkeypatch: pytest.MonkeyPatch) -> None:
    _install(monkeypatch, "fr", _FR_ANSWERS, _FR_VALID)
    _install(monkeypatch, "es", _ES_ANSWERS, _ES_VALID)


def _today(lang: str) -> str:
    return make_puzzle_id(datetime.now(UTC).strftime("%Y-%m-%d"), lang)


def _pin_answer(monkeypatch: pytest.MonkeyPatch, lang: str, display_word: str) -> None:
    monkeypatch.setitem(puzzle_mod._ANSWERS, lang, [fold(display_word, lang)])


def _guess(client: TestClient, puzzle_id: str, guess: str, sid: str | None = None):
    return client.post(
        "/daily-word/guess",
        headers={"X-Session-ID": sid or str(uuid.uuid4())},
        json={"puzzle_id": puzzle_id, "guess": guess, "tz_offset_minutes": 0},
    )


def test_romance_puzzle_ids_carry_version_one(fr_es: None) -> None:
    assert make_puzzle_id("2026-10-13", "fr") == "2026-10-13:fr:1"
    assert make_puzzle_id("2026-10-13", "es") == "2026-10-13:es:1"
    assert puzzle_mod.parse_puzzle_id("2026-10-13:fr:1") == ("2026-10-13", "fr")
    with pytest.raises(puzzle_mod.StalePuzzleId):
        puzzle_mod.parse_puzzle_id("2026-10-13:es")


def test_today_serves_fr_and_es(client: TestClient, fr_es: None) -> None:
    for lang in ("fr", "es"):
        r = client.get(f"/daily-word/today?lang={lang}")
        assert r.status_code == 200
        assert r.json()["puzzle_id"].endswith(f":{lang}:1")
        assert r.json()["word_length"] == 5


def test_upcoming_serves_fr_and_es(client: TestClient, fr_es: None) -> None:
    for lang in ("fr", "es"):
        r = client.get(f"/daily-word/upcoming?lang={lang}")
        assert r.status_code == 200
        assert len(r.json()) == 3


def test_unknown_language_is_422(client: TestClient, fr_es: None) -> None:
    assert client.get("/daily-word/today?lang=de").status_code == 422
    assert client.get("/daily-word/upcoming?lang=de").status_code == 422
    r = _guess(client, "2026-10-13:de:1", "etage")
    assert r.status_code == 422
    assert r.json()["detail"] == "invalid_puzzle_id"
    r = client.get("/daily-word/answer?puzzle_id=2026-10-13:de:1", headers={"X-Session-ID": "x"})
    assert r.status_code == 422
    assert r.json()["detail"] == "invalid_puzzle_id"


def test_language_without_lists_is_unsupported(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delitem(puzzle_mod._ANSWERS, "fr", raising=False)
    assert client.get("/daily-word/today?lang=fr").status_code == 422
    r = _guess(client, "2026-10-13:fr:1", "etage")
    assert r.status_code == 422
    assert r.json()["detail"] == "invalid_puzzle_id"


@pytest.mark.parametrize("guess", ["pêche", "peche", "PÊCHE", "Peche", "pêche"])
def test_accented_and_unaccented_guesses_score_identically(
    client: TestClient, fr_es: None, monkeypatch: pytest.MonkeyPatch, guess: str
) -> None:
    _pin_answer(monkeypatch, "fr", "étage")
    baseline = _guess(client, _today("fr"), "peche").json()["tiles"]
    r = _guess(client, _today("fr"), guess)
    assert r.status_code == 200
    assert r.json()["tiles"] == baseline
    assert len(r.json()["tiles"]) == 5
    assert [t["letter"] for t in r.json()["tiles"]] == list("peche")


def test_display_is_list_spelling_not_user_input(
    client: TestClient, fr_es: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    _pin_answer(monkeypatch, "fr", "étage")
    for typed in ("foret", "FORÊT", "forêt"):
        r = _guess(client, _today("fr"), typed)
        assert r.status_code == 200
        assert r.json()["display"] == "forêt"


def test_ligature_guess_is_folded_to_five_tiles(
    client: TestClient, fr_es: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    _pin_answer(monkeypatch, "fr", "étage")
    r = _guess(client, _today("fr"), "cœur")  # folds to "coeur"
    assert r.status_code == 200
    assert len(r.json()["tiles"]) == 5
    assert r.json()["display"] == "cœur"


def test_win_with_unaccented_guess(
    client: TestClient, fr_es: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    _pin_answer(monkeypatch, "fr", "étage")
    r = _guess(client, _today("fr"), "etage")
    assert all(t["status"] == "correct" for t in r.json()["tiles"])
    assert r.json()["display"] == "étage"


def test_wrong_length_and_non_word_still_rejected(
    client: TestClient, fr_es: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    _pin_answer(monkeypatch, "fr", "étage")
    assert _guess(client, _today("fr"), "chat").json()["detail"] == "wrong_guess_length"
    assert _guess(client, _today("fr"), "zzzzz").json()["detail"] == "not_a_word"


def test_spanish_enye_is_a_distinct_letter(
    client: TestClient, fr_es: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    _pin_answer(monkeypatch, "es", "cañón")
    # "mañas" is in the list; "manas" (no tilde) is a different, unlisted word.
    ok = _guess(client, _today("es"), "mañas")
    assert ok.status_code == 200
    assert ok.json()["display"] == "mañas"
    assert [t["letter"] for t in ok.json()["tiles"]] == list("mañas")
    bad = _guess(client, _today("es"), "manas")
    assert bad.status_code == 422
    assert bad.json()["detail"] == "not_a_word"


def test_spanish_enye_scores_against_enye_only(
    client: TestClient, fr_es: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    _pin_answer(monkeypatch, "es", "cañón")  # folds to cañon
    tiles = _guess(client, _today("es"), "pañal").json()["tiles"]
    # p absent, a absent, ñ correct (idx 2 == ñ), a/l absent
    assert tiles[2] == {"letter": "ñ", "status": "correct"}


def test_spanish_accent_folding_on_guess(
    client: TestClient, fr_es: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    _pin_answer(monkeypatch, "es", "cañón")
    r = _guess(client, _today("es"), "ARBOL")
    assert r.status_code == 200
    assert r.json()["display"] == "árbol"


def _solve(client: TestClient, puzzle_id: str, guess: str) -> dict:
    sid = str(uuid.uuid4())
    assert _guess(client, puzzle_id, guess, sid).status_code == 200
    return client.get(f"/daily-word/answer?puzzle_id={puzzle_id}", headers={"X-Session-ID": sid})


def test_answer_returns_folded_and_display_for_romance(
    client: TestClient, fr_es: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    _pin_answer(monkeypatch, "fr", "étage")
    r = _solve(client, _today("fr"), "etage")
    assert r.status_code == 200
    assert r.json() == {"answer": "etage", "display": "étage"}

    _pin_answer(monkeypatch, "es", "cañón")
    r = _solve(client, _today("es"), "cañon")
    assert r.json() == {"answer": "cañon", "display": "cañón"}


def test_answer_display_equals_answer_for_en_and_hi(client: TestClient) -> None:
    for lang in ("en", "hi"):
        puzzle_id = _today(lang)
        r = _solve(client, puzzle_id, get_answer(puzzle_id))
        assert r.status_code == 200
        body = r.json()
        assert set(body) == {"answer", "display"}
        assert body["display"] == body["answer"] == get_answer(puzzle_id)


def test_en_and_hi_guess_responses_have_no_display(client: TestClient) -> None:
    r = _guess(client, _today("en"), "crane")
    assert r.status_code == 200
    assert "display" not in r.json()
    assert "grapheme_clusters" not in r.json()


# ---------------------------------------------------------------------------
# Day offsets
# ---------------------------------------------------------------------------

# Pinned with the pre-#3240 code (SALT == 0): existing en/hi answers must not move.
_EN_PINS = {
    "2026-01-01": "great",
    "2026-03-15": "shady",
    "2026-07-04": "clear",
    "2026-10-13": "gauze",
    "2027-02-28": "usage",
}
_HI_PINS = {"2026-01-01": "चाहिए", "2026-10-13": "कटोरी"}


def test_english_and_hindi_answers_are_unchanged_by_offsets() -> None:
    for d, expected in _EN_PINS.items():
        date_int = int(d.replace("-", ""))
        legacy = puzzle_mod._ANSWERS["en"][
            (date_int + puzzle_mod.SALT) % len(puzzle_mod._ANSWERS["en"])
        ]
        assert get_answer(make_puzzle_id(d, "en")) == legacy
        if puzzle_mod.SALT == 0:
            assert legacy == expected
    for d, expected in _HI_PINS.items():
        date_int = int(d.replace("-", ""))
        legacy = puzzle_mod._ANSWERS["hi"][
            (date_int + puzzle_mod.SALT) % len(puzzle_mod._ANSWERS["hi"])
        ]
        assert get_answer(make_puzzle_id(d, "hi")) == legacy
        if puzzle_mod.SALT == 0:
            assert legacy == expected


def test_english_and_hindi_offsets_are_zero() -> None:
    assert puzzle_mod._DAY_OFFSET["en"] == 0
    assert puzzle_mod._DAY_OFFSET["hi"] == 0


def test_languages_have_distinct_offsets() -> None:
    offsets = {puzzle_mod._DAY_OFFSET[lang] for lang in ("en", "fr", "es")}
    assert len(offsets) == 3


def test_romance_lists_do_not_share_the_english_index(monkeypatch: pytest.MonkeyPatch) -> None:
    n = 1000
    for lang in ("fr", "es"):
        words = [f"w{i:04d}" for i in range(n)]
        monkeypatch.setitem(puzzle_mod._ANSWERS, lang, words)
        monkeypatch.setitem(puzzle_mod._ANSWERS, "en", words)
        same = sum(
            get_answer(make_puzzle_id(f"2026-06-{d:02d}", lang))
            == get_answer(make_puzzle_id(f"2026-06-{d:02d}", "en"))
            for d in range(1, 29)
        )
        assert same == 0


# ---------------------------------------------------------------------------
# /upcoming display_blob
# ---------------------------------------------------------------------------


def _decode(puzzle_id: str, blob: str) -> str:
    import base64
    import hashlib

    key = hashlib.sha256(puzzle_id.encode("utf-8")).digest()
    data = base64.b64decode(blob)
    return bytes(b ^ key[i % 32] for i, b in enumerate(data)).decode("utf-8")


@pytest.mark.parametrize("lang", ["fr", "es"])
def test_upcoming_romance_entries_carry_scrambled_display(
    client: TestClient, fr_es: None, lang: str
) -> None:
    entries = client.get(f"/daily-word/upcoming?lang={lang}").json()
    assert len(entries) == 3
    for e in entries:
        folded = get_answer(e["puzzle_id"])
        display = puzzle_mod.get_display(folded, lang)
        assert _decode(e["puzzle_id"], e["answer_blob"]) == folded
        assert _decode(e["puzzle_id"], e["display_blob"]) == display
        assert display not in e["display_blob"]
        assert e["word_length"] == 5


@pytest.mark.parametrize("lang", ["en", "hi"])
def test_upcoming_en_hi_entries_have_no_display_blob(client: TestClient, lang: str) -> None:
    for e in client.get(f"/daily-word/upcoming?lang={lang}").json():
        assert set(e) == {"puzzle_id", "word_length", "answer_blob"}


def test_oversized_guess_is_rejected_before_folding(client: TestClient) -> None:
    """A huge guess is refused by request validation, never folded (#3242 review)."""
    from daily_word.router import GUESS_MAX_CHARS

    # Under the 1 KB body cap, so this exercises the field limit, not the middleware.
    flood = "a" * (GUESS_MAX_CHARS + 1)
    r = _guess(client, _today("en"), flood)
    assert r.status_code == 422
    assert r.json()["detail"] != "wrong_guess_length"  # rejected by validation, not after folding
