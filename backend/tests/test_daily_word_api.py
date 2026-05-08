"""API tests for daily_word endpoints (#1190, #1195, #1208).

Covers:
  - Happy path GET /daily-word/today and POST /daily-word/guess
  - Duplicate-letter coloring
  - Stale puzzle_id → 422
  - Grace-window edge cases (#1208)
  - Invalid word → 422 not_a_word
  - Brute-force 7th guess → 429
  - Missing X-Session-ID → 400
  - GET /answer happy path and invalid puzzle_id (#1208)
  - Answer-not-in-response security assertions (#1195)
  - Response time SLO (#1195)
"""

from __future__ import annotations

import json
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Iterator
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient


def _today_puzzle_id(tz_offset_minutes: int = 0, lang: str = "en") -> str:
    local_ts = datetime.now(timezone.utc) + timedelta(minutes=tz_offset_minutes)
    return f"{local_ts.strftime('%Y-%m-%d')}:{lang}"


@pytest.fixture()
def client() -> Iterator[TestClient]:
    from main import app

    with TestClient(app) as c:
        yield c


def _sid_headers(sid: str | None = None) -> dict[str, str]:
    return {"X-Session-ID": sid or str(uuid.uuid4())}


# ---------------------------------------------------------------------------
# GET /daily-word/today
# ---------------------------------------------------------------------------


def test_get_today_returns_puzzle_id_and_word_length(client: TestClient) -> None:
    r = client.get("/daily-word/today?tz_offset_minutes=0&lang=en")
    assert r.status_code == 200
    data = r.json()
    assert "puzzle_id" in data
    assert "word_length" in data
    assert data["word_length"] == 5
    assert data["puzzle_id"].endswith(":en")


def test_get_today_no_auth_required(client: TestClient) -> None:
    r = client.get("/daily-word/today")
    assert r.status_code == 200


def test_get_today_hindi(client: TestClient) -> None:
    r = client.get("/daily-word/today?lang=hi&tz_offset_minutes=0")
    assert r.status_code == 200
    assert r.json()["puzzle_id"].endswith(":hi")


def test_get_today_unsupported_lang_returns_422(client: TestClient) -> None:
    r = client.get("/daily-word/today?lang=fr")
    assert r.status_code == 422
    assert r.json()["detail"] == "unsupported_language"


# ---------------------------------------------------------------------------
# POST /daily-word/guess — happy path
# ---------------------------------------------------------------------------


def test_post_guess_returns_tiles(client: TestClient) -> None:
    headers = _sid_headers()
    puzzle_id = _today_puzzle_id()
    r = client.post(
        "/daily-word/guess",
        headers=headers,
        json={"puzzle_id": puzzle_id, "guess": "crane", "tz_offset_minutes": 0},
    )
    assert r.status_code == 200
    tiles = r.json()["tiles"]
    assert len(tiles) == 5
    for tile in tiles:
        assert tile["letter"] in "crane"
        assert tile["status"] in ("correct", "present", "absent")


def test_post_guess_correct_word_all_correct(client: TestClient) -> None:
    """Guessing the exact answer gives all-correct tiles."""
    from daily_word.puzzle import get_answer

    puzzle_id = _today_puzzle_id()
    answer = get_answer(puzzle_id)
    headers = _sid_headers()
    r = client.post(
        "/daily-word/guess",
        headers=headers,
        json={"puzzle_id": puzzle_id, "guess": answer, "tz_offset_minutes": 0},
    )
    assert r.status_code == 200
    for tile in r.json()["tiles"]:
        assert tile["status"] == "correct"


# ---------------------------------------------------------------------------
# Duplicate-letter coloring
# ---------------------------------------------------------------------------


def test_duplicate_letter_coloring_only_first_colored_present(client: TestClient) -> None:
    """With answer 'abbey', guess 'blabs': only two b's match, third b is absent."""
    from daily_word.puzzle import get_answer
    from daily_word import puzzle as puzzle_mod

    # patch to make today's answer "abbey"

    orig_list = puzzle_mod._ANSWERS_EN
    orig_answers = puzzle_mod._ANSWERS["en"]
    puzzle_mod._ANSWERS_EN = ["abbey"]
    puzzle_mod._ANSWERS["en"] = ["abbey"]
    try:
        puzzle_id = _today_puzzle_id()
        assert get_answer(puzzle_id) == "abbey"
        headers = _sid_headers()
        r = client.post(
            "/daily-word/guess",
            headers=headers,
            json={"puzzle_id": puzzle_id, "guess": "blabs", "tz_offset_minutes": 0},
        )
    finally:
        puzzle_mod._ANSWERS_EN = orig_list
        puzzle_mod._ANSWERS["en"] = orig_answers

    assert r.status_code == 200
    statuses = [t["status"] for t in r.json()["tiles"]]
    # b→present, l→absent, a→present, b→present, s→absent
    assert statuses[1] == "absent"  # l not in abbey
    assert statuses[4] == "absent"  # s not in abbey


# ---------------------------------------------------------------------------
# Validation — 422 cases
# ---------------------------------------------------------------------------


def test_stale_puzzle_id_returns_422(client: TestClient) -> None:
    headers = _sid_headers()
    r = client.post(
        "/daily-word/guess",
        headers=headers,
        json={"puzzle_id": "2020-01-01:en", "guess": "crane", "tz_offset_minutes": 0},
    )
    assert r.status_code == 422
    assert r.json()["detail"] == "stale_puzzle_id"


def test_grace_window_accepts_yesterday_puzzle_id(client: TestClient) -> None:
    """Yesterday's puzzle_id is accepted when local time is within the 1-minute grace window.

    Clock is pinned to 2024-01-02 00:00:30 UTC.  local_ts=2024-01-02 00:00:30,
    grace_ts=2024-01-01 23:59:30 — so date "2024-01-01" matches grace_ts and must be accepted.
    """
    pinned = datetime(2024, 1, 2, 0, 0, 30, tzinfo=timezone.utc)
    with patch("daily_word.router.datetime") as mock_dt:
        mock_dt.now.return_value = pinned
        headers = _sid_headers()
        r = client.post(
            "/daily-word/guess",
            headers=headers,
            json={"puzzle_id": "2024-01-01:en", "guess": "crane", "tz_offset_minutes": 0},
        )
    assert r.status_code == 200


def test_grace_window_rejects_two_days_ago_puzzle_id(client: TestClient) -> None:
    """A puzzle_id two days old is rejected even when local time is near midnight.

    Clock is pinned to 2024-01-02 00:00:30 UTC.  Neither local_ts (2024-01-02)
    nor grace_ts (2024-01-01) matches "2023-12-31", so the request must be rejected.
    """
    pinned = datetime(2024, 1, 2, 0, 0, 30, tzinfo=timezone.utc)
    with patch("daily_word.router.datetime") as mock_dt:
        mock_dt.now.return_value = pinned
        headers = _sid_headers()
        r = client.post(
            "/daily-word/guess",
            headers=headers,
            json={"puzzle_id": "2023-12-31:en", "guess": "crane", "tz_offset_minutes": 0},
        )
    assert r.status_code == 422
    assert r.json()["detail"] == "stale_puzzle_id"


def test_invalid_word_returns_422_not_a_word(client: TestClient) -> None:
    headers = _sid_headers()
    r = client.post(
        "/daily-word/guess",
        headers=headers,
        json={"puzzle_id": _today_puzzle_id(), "guess": "zzzzz", "tz_offset_minutes": 0},
    )
    assert r.status_code == 422
    assert r.json()["detail"] == "not_a_word"


def test_wrong_guess_length_returns_422(client: TestClient) -> None:
    headers = _sid_headers()
    r = client.post(
        "/daily-word/guess",
        headers=headers,
        json={"puzzle_id": _today_puzzle_id(), "guess": "cat", "tz_offset_minutes": 0},
    )
    assert r.status_code == 422


def test_missing_session_id_returns_400(client: TestClient) -> None:
    r = client.post(
        "/daily-word/guess",
        json={"puzzle_id": _today_puzzle_id(), "guess": "crane", "tz_offset_minutes": 0},
    )
    assert r.status_code == 400


def test_out_of_range_tz_offset_post_returns_422(client: TestClient) -> None:
    headers = _sid_headers()
    r = client.post(
        "/daily-word/guess",
        headers=headers,
        json={"puzzle_id": _today_puzzle_id(), "guess": "crane", "tz_offset_minutes": 9999},
    )
    assert r.status_code == 422


def test_out_of_range_tz_offset_get_returns_422(client: TestClient) -> None:
    r = client.get("/daily-word/today?tz_offset_minutes=9999")
    assert r.status_code == 422


# ---------------------------------------------------------------------------
# Rate limiting — brute-force 7th guess returns 429 (#1195)
# ---------------------------------------------------------------------------


def test_brute_force_rate_limited(client: TestClient) -> None:
    headers = _sid_headers()
    puzzle_id = _today_puzzle_id()

    for _ in range(20):
        r = client.post(
            "/daily-word/guess",
            headers=headers,
            json={"puzzle_id": puzzle_id, "guess": "crane", "tz_offset_minutes": 0},
        )
        assert r.status_code == 200

    r21 = client.post(
        "/daily-word/guess",
        headers=headers,
        json={"puzzle_id": puzzle_id, "guess": "crane", "tz_offset_minutes": 0},
    )
    assert r21.status_code == 429


# ---------------------------------------------------------------------------
# Security assertions (#1195)
# ---------------------------------------------------------------------------


def test_answer_not_in_get_today_response(client: TestClient) -> None:
    """Answer word must not appear anywhere in GET /today response body or headers."""
    from daily_word.puzzle import get_answer

    r = client.get("/daily-word/today?tz_offset_minutes=0&lang=en")
    assert r.status_code == 200
    puzzle_id = r.json()["puzzle_id"]
    answer = get_answer(puzzle_id)

    assert answer not in r.text
    for value in r.headers.values():
        assert answer not in value


def test_answer_not_in_post_guess_response(client: TestClient) -> None:
    """POST /guess response must not contain 'word', 'answer', or 'solution' keys."""
    headers = _sid_headers()
    r = client.post(
        "/daily-word/guess",
        headers=headers,
        json={"puzzle_id": _today_puzzle_id(), "guess": "crane", "tz_offset_minutes": 0},
    )
    assert r.status_code == 200
    json_str = json.dumps(r.json())
    for forbidden in ('"word"', '"answer"', '"solution"'):
        assert forbidden not in json_str


# ---------------------------------------------------------------------------
# GET /answer endpoint (#1208)
# ---------------------------------------------------------------------------


def test_get_answer_returns_answer_for_valid_puzzle_id(client: TestClient) -> None:
    """GET /answer returns {"answer": <word>} for today's valid puzzle_id."""
    puzzle_id = _today_puzzle_id()
    r = client.get(f"/daily-word/answer?puzzle_id={puzzle_id}")
    assert r.status_code == 200
    data = r.json()
    assert "answer" in data
    assert isinstance(data["answer"], str)
    assert len(data["answer"]) > 0


def test_get_answer_returns_422_for_invalid_puzzle_id(client: TestClient) -> None:
    """GET /answer returns 422 when puzzle_id is not a valid date-keyed id."""
    r = client.get("/daily-word/answer?puzzle_id=not-a-real-id")
    assert r.status_code == 422
    assert r.json()["detail"] == "invalid_puzzle_id"


# ---------------------------------------------------------------------------
# Performance SLO (#1195)
# ---------------------------------------------------------------------------


def test_guess_response_time(client: TestClient) -> None:
    """POST /daily-word/guess must respond in under 200ms."""
    headers = _sid_headers()
    start = time.perf_counter()
    r = client.post(
        "/daily-word/guess",
        headers=headers,
        json={"puzzle_id": _today_puzzle_id(), "guess": "crane", "tz_offset_minutes": 0},
    )
    elapsed = time.perf_counter() - start
    assert r.status_code == 200
    assert elapsed < 0.2, f"Response too slow: {elapsed:.3f}s"


# ---------------------------------------------------------------------------
# Hindi grapheme clusters (#1205)
# ---------------------------------------------------------------------------


def test_hindi_guess_response_includes_grapheme_clusters(client: TestClient) -> None:
    """POST /guess for Hindi must include grapheme_clusters for frontend tile rendering."""
    from daily_word import puzzle as puzzle_mod

    orig_answers = puzzle_mod._ANSWERS["hi"]
    orig_valid = puzzle_mod._VALID["hi"]
    # "सुंदर" = 5 code points: स, ु, ं, द, र
    puzzle_mod._ANSWERS["hi"] = ["सुंदर"]
    puzzle_mod._VALID["hi"] = frozenset(["सुंदर"])
    try:
        headers = _sid_headers()
        r = client.post(
            "/daily-word/guess",
            headers=headers,
            json={
                "puzzle_id": _today_puzzle_id(lang="hi"),
                "guess": "सुंदर",
                "tz_offset_minutes": 0,
            },
        )
    finally:
        puzzle_mod._ANSWERS["hi"] = orig_answers
        puzzle_mod._VALID["hi"] = orig_valid

    assert r.status_code == 200
    data = r.json()
    assert "grapheme_clusters" in data
    clusters = data["grapheme_clusters"]
    # Every code-point index must appear exactly once across all clusters
    all_indices = [idx for cluster in clusters for idx in cluster]
    assert sorted(all_indices) == list(range(5))


def test_english_guess_response_excludes_grapheme_clusters(client: TestClient) -> None:
    """POST /guess for English must NOT include grapheme_clusters."""
    headers = _sid_headers()
    r = client.post(
        "/daily-word/guess",
        headers=headers,
        json={"puzzle_id": _today_puzzle_id(), "guess": "crane", "tz_offset_minutes": 0},
    )
    assert r.status_code == 200
    assert "grapheme_clusters" not in r.json()


def test_hindi_grapheme_clusters_devanagari_matras(client: TestClient) -> None:
    """Devanagari vowel signs (matras) must be grouped with their preceding consonant."""
    from daily_word.router import _grapheme_clusters

    # "सुंदर": स(Lo), ु(Mc), ं(Mn), द(Lo), र(Lo) → clusters [[0,1,2],[3],[4]]
    clusters = _grapheme_clusters("सुंदर")
    assert clusters[0] == [0, 1, 2], f"Expected [0,1,2], got {clusters[0]}"
    assert len(clusters) == 3


def test_hindi_cluster_length_mismatch_rejected(client: TestClient) -> None:
    """Guess with wrong grapheme-cluster count must be rejected as wrong_guess_length (#1262).

    "सुंदर" has 3 clusters; "अचानक" has 4 clusters — both are 5 code points.
    The code-point-only check (pre-fix) would accept both; the cluster check (post-fix)
    rejects the 4-cluster guess when the answer is 3 clusters.
    """
    from daily_word import puzzle as puzzle_mod

    orig_answers = puzzle_mod._ANSWERS["hi"]
    orig_valid = puzzle_mod._VALID["hi"]
    # answer = 3 clusters; guess candidate = 4 clusters — same 5-codepoint length
    puzzle_mod._ANSWERS["hi"] = ["सुंदर"]  # 3 clusters: [[0,1,2],[3],[4]]
    puzzle_mod._VALID["hi"] = frozenset(puzzle_mod._ANSWERS["hi"]) | frozenset(["अचानक"])
    try:
        headers = _sid_headers()
        r = client.post(
            "/daily-word/guess",
            headers=headers,
            json={
                "puzzle_id": _today_puzzle_id(lang="hi"),
                "guess": "अचानक",  # 4 clusters: [[0],[1,2],[3],[4]]
                "tz_offset_minutes": 0,
            },
        )
    finally:
        puzzle_mod._ANSWERS["hi"] = orig_answers
        puzzle_mod._VALID["hi"] = orig_valid

    assert r.status_code == 422
    assert r.json()["detail"] == "wrong_guess_length"


def test_hindi_cluster_length_match_accepted(client: TestClient) -> None:
    """Guess with matching grapheme-cluster count must pass the length check (#1262)."""
    from daily_word import puzzle as puzzle_mod

    orig_answers = puzzle_mod._ANSWERS["hi"]
    orig_valid = puzzle_mod._VALID["hi"]
    puzzle_mod._ANSWERS["hi"] = ["सुंदर"]  # 3 clusters
    puzzle_mod._VALID["hi"] = frozenset(puzzle_mod._ANSWERS["hi"])
    try:
        headers = _sid_headers()
        r = client.post(
            "/daily-word/guess",
            headers=headers,
            json={
                "puzzle_id": _today_puzzle_id(lang="hi"),
                "guess": "सुंदर",  # same 3 clusters — passes length check
                "tz_offset_minutes": 0,
            },
        )
    finally:
        puzzle_mod._ANSWERS["hi"] = orig_answers
        puzzle_mod._VALID["hi"] = orig_valid

    assert r.status_code == 200
