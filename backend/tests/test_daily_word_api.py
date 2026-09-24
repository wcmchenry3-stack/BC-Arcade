"""API tests for daily_word endpoints (#1190, #1195, #1208).

Covers:
  - Happy path GET /daily-word/today and POST /daily-word/guess
  - Duplicate-letter coloring
  - Stale puzzle_id → 422
  - Grace-window edge cases (#1208)
  - Invalid word → 422 not_a_word
  - 7th guess → 403 no_guesses_remaining (#2197)
  - Missing X-Session-ID → 400
  - GET /answer happy path and invalid puzzle_id (#1208)
  - Answer-not-in-response security assertions (#1195)
  - Response time SLO (#1195)
"""

from __future__ import annotations

import json
import time
import uuid
from collections.abc import Iterator
from datetime import datetime, timedelta, timezone
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
    from daily_word import puzzle as puzzle_mod
    from daily_word.puzzle import get_answer

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


def _guess(client: TestClient, headers: dict, puzzle_id: str, word: str):
    return client.post(
        "/daily-word/guess",
        headers=headers,
        json={"puzzle_id": puzzle_id, "guess": word, "tz_offset_minutes": 0},
    )


# Six valid five-letter guesses that are NOT in the answer pool, so they can
# never accidentally solve the puzzle. The earlier picks included "crane",
# "pilot" and "zesty", all of which *are* answers — on the days the scheduler
# chose one of them, the first guess would win, every later guess would 403
# already_solved, and four of the tests below would fail. A calendar-dependent
# failure is the worst kind to debug, so the invariant is asserted rather than
# assumed (test_guess_words_are_never_answers).
_SIX_WRONG = ["nymph", "crwth", "phlox", "xylem", "squib", "kudzu"]
# A seventh, for testing the guess past the cap.
_SEVENTH = "vozhd"


def test_guess_degrades_open_when_the_record_is_unreachable(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """#2542 — a DB outage must not turn a playable game into an error.

    `/today` needs no DB, so the player already has a board in front of them.
    Scoring keeps working and the cap is skipped for that request; the
    alternative is a shipping free game breaking mid-puzzle on a blip.
    """
    import daily_word.router as router_mod

    def boom():
        raise RuntimeError("database unavailable")

    monkeypatch.setattr(router_mod, "get_session_factory", boom)

    headers = _sid_headers()
    r = _guess(client, headers, _today_puzzle_id(), _SIX_WRONG[0])
    assert r.status_code == 200, "the guess must still be scored"
    body = r.json()
    assert len(body["tiles"]) == 5
    # No counts are claimed when they could not be read.
    assert "guesses_used" not in body
    assert "guesses_remaining" not in body


def test_answer_stays_closed_when_the_record_is_unreachable(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The other half of #2542: no record, no entitlement, no answer."""
    import daily_word.router as router_mod

    headers = _sid_headers()
    puzzle_id = _today_puzzle_id()
    for word in _SIX_WRONG:
        assert _guess(client, headers, puzzle_id, word).status_code == 200
    assert (
        client.get(f"/daily-word/answer?puzzle_id={puzzle_id}", headers=headers).status_code == 200
    )

    def boom():
        raise RuntimeError("database unavailable")

    monkeypatch.setattr(router_mod, "get_session_factory", boom)
    # TestClient re-raises server exceptions rather than converting them; in
    # production this surfaces as a 500. Either way the answer is not released,
    # which is the property under test.
    with pytest.raises(RuntimeError):
        client.get(f"/daily-word/answer?puzzle_id={puzzle_id}", headers=headers)


def test_guess_and_answer_keep_both_rate_limits() -> None:
    """The session-keyed limit and the IP backstop must both stay registered.

    `limiter` has no default_limits, so a route limit with a custom key_func
    *replaces* the IP key rather than adding to it — which is how minting
    session ids bought unbounded guesses in the first place. A silently dropped
    decorator would restore that hole with every test still green, so the pair
    is asserted directly (#2197 review).
    """
    import main  # noqa: F401  — importing the app registers the routes
    from limiter import limiter

    by_route = {
        name: {(str(lim.limit), getattr(lim.key_func, "__name__", "")) for lim in lims}
        for name, lims in limiter._route_limits.items()
    }

    guess = by_route["daily_word.router.post_guess"]
    assert any(k == "_guess_key" for _, k in guess), "session-keyed guess limit is missing"
    assert any(k == "_real_ip" for _, k in guess), "IP backstop on /guess is missing"

    answer = by_route["daily_word.router.get_answer_route"]
    assert any(k == "_real_ip" for _, k in answer), "IP limit on /answer is missing"


def test_guess_words_are_never_answers() -> None:
    """Guards the fixture above against a word-list change (#2197 review)."""
    from daily_word.puzzle import _ANSWERS_EN, is_valid_guess

    for word in [*_SIX_WRONG, _SEVENTH]:
        assert is_valid_guess(word, "en"), f"{word} must be an accepted guess"
        assert word not in _ANSWERS_EN, f"{word} can be an answer — pick another fixture word"
    assert len(set(_SIX_WRONG)) == 6, "the six must be distinct or they replay instead of spending"


def test_get_answer_refuses_a_session_that_has_not_played(client: TestClient) -> None:
    """#2197 — this used to hand out today's word to anyone who asked.

    `puzzle_id` is just "YYYY-MM-DD:{lang}", so there was nothing to discover
    and nothing to authenticate against.
    """
    r = client.get(f"/daily-word/answer?puzzle_id={_today_puzzle_id()}", headers=_sid_headers())
    assert r.status_code == 403
    assert r.json()["detail"] == "guesses_remaining"


def test_get_answer_refuses_a_session_partway_through(client: TestClient) -> None:
    headers = _sid_headers()
    puzzle_id = _today_puzzle_id()
    for word in _SIX_WRONG[:3]:
        assert _guess(client, headers, puzzle_id, word).status_code == 200

    r = client.get(f"/daily-word/answer?puzzle_id={puzzle_id}", headers=headers)
    assert r.status_code == 403


def test_get_answer_released_once_every_guess_is_spent(client: TestClient) -> None:
    headers = _sid_headers()
    puzzle_id = _today_puzzle_id()
    for word in _SIX_WRONG:
        assert _guess(client, headers, puzzle_id, word).status_code == 200

    r = client.get(f"/daily-word/answer?puzzle_id={puzzle_id}", headers=headers)
    assert r.status_code == 200
    assert isinstance(r.json()["answer"], str)
    assert len(r.json()["answer"]) > 0


def test_get_answer_released_once_the_puzzle_is_solved(client: TestClient) -> None:
    """A winner gets the answer without burning all six guesses."""
    from daily_word.puzzle import get_answer

    puzzle_id = _today_puzzle_id()
    headers = _sid_headers()
    assert _guess(client, headers, puzzle_id, get_answer(puzzle_id)).status_code == 200

    r = client.get(f"/daily-word/answer?puzzle_id={puzzle_id}", headers=headers)
    assert r.status_code == 200


def test_get_answer_is_scoped_to_the_asking_session(client: TestClient) -> None:
    """One player finishing must not unlock the answer for everyone else."""
    puzzle_id = _today_puzzle_id()
    played = _sid_headers()
    for word in _SIX_WRONG:
        _guess(client, played, puzzle_id, word)
    assert (
        client.get(f"/daily-word/answer?puzzle_id={puzzle_id}", headers=played).status_code == 200
    )

    bystander = _sid_headers()
    r = client.get(f"/daily-word/answer?puzzle_id={puzzle_id}", headers=bystander)
    assert r.status_code == 403


def test_get_answer_requires_a_session(client: TestClient) -> None:
    r = client.get(f"/daily-word/answer?puzzle_id={_today_puzzle_id()}")
    assert r.status_code == 400


# ---------------------------------------------------------------------------
# Server-side guess cap (#2197)
# ---------------------------------------------------------------------------


def test_a_seventh_guess_is_refused(client: TestClient) -> None:
    """The cap lived only in the client; the real ceiling was the 20/hour rate
    limit, i.e. enough scored guesses to brute-force a five-letter word."""
    headers = _sid_headers()
    puzzle_id = _today_puzzle_id()
    for word in _SIX_WRONG:
        assert _guess(client, headers, puzzle_id, word).status_code == 200

    r = _guess(client, headers, puzzle_id, _SEVENTH)
    assert r.status_code == 403
    assert r.json()["detail"] == "no_guesses_remaining"


def test_guesses_remaining_counts_down(client: TestClient) -> None:
    headers = _sid_headers()
    puzzle_id = _today_puzzle_id()
    for i, word in enumerate(_SIX_WRONG, start=1):
        body = _guess(client, headers, puzzle_id, word).json()
        assert body["guesses_used"] == i
        assert body["guesses_remaining"] == 6 - i


def test_no_further_guesses_once_solved(client: TestClient) -> None:
    from daily_word.puzzle import get_answer

    puzzle_id = _today_puzzle_id()
    headers = _sid_headers()
    assert _guess(client, headers, puzzle_id, get_answer(puzzle_id)).status_code == 200

    r = _guess(client, headers, puzzle_id, _SIX_WRONG[0])
    assert r.status_code == 403
    assert r.json()["detail"] == "already_solved"


def test_a_replayed_guess_does_not_cost_a_turn(client: TestClient) -> None:
    """withRetry can replay a guess that already reached the server."""
    headers = _sid_headers()
    puzzle_id = _today_puzzle_id()
    first = _guess(client, headers, puzzle_id, _SIX_WRONG[0]).json()
    again = _guess(client, headers, puzzle_id, _SIX_WRONG[0]).json()

    assert first["tiles"] == again["tiles"]
    assert again["guesses_used"] == 1, "a replay must not spend a second guess"


def test_an_invalid_word_costs_nothing(client: TestClient) -> None:
    """Rejected before the guess is recorded, matching the client's behaviour."""
    headers = _sid_headers()
    puzzle_id = _today_puzzle_id()
    assert _guess(client, headers, puzzle_id, "zzzzz").status_code == 422

    body = _guess(client, headers, puzzle_id, _SIX_WRONG[0]).json()
    assert body["guesses_used"] == 1


def test_guess_state_is_per_puzzle(client: TestClient) -> None:
    """Spending today's guesses must not affect another puzzle."""
    headers = _sid_headers()
    today = _today_puzzle_id()
    for word in _SIX_WRONG:
        _guess(client, headers, today, word)
    assert _guess(client, headers, today, _SEVENTH).status_code == 403

    # A different language is a different puzzle_id, and a separate budget.
    other = _today_puzzle_id(lang="hi")
    r = client.get(f"/daily-word/answer?puzzle_id={other}", headers=headers)
    assert r.status_code == 403, "the hi puzzle was never played"


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
