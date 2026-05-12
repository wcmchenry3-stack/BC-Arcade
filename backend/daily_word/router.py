"""Daily Word REST endpoints — GET /today, POST /guess (#1190).

Rate limits:
  GET /today   — 60/minute (IP-keyed, no auth)
  POST /guess  — 20/hour keyed by f"{session_id}:{puzzle_id}" (compound key
                 isolates by puzzle so the limit resets naturally each new day;
                 20/hour gives 6 real guesses + room for invalid-word attempts
                 and network retries without blocking a legitimate game)
"""

from __future__ import annotations

import json
import unicodedata
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field

from daily_word.puzzle import get_answer, get_today_meta, is_valid_guess
from limiter import _real_ip, limiter
from session import get_session_id

_SUPPORTED_LANGS = frozenset(("en", "hi"))

router = APIRouter()


def _guess_key(request: Request) -> str:
    """Compound rate-limit key: "{session_id}:{puzzle_id}".

    slowapi 0.1.9 calls key_func synchronously, so we cannot await body().
    FastAPI resolves `body: GuessRequest` before the route handler runs, which
    causes Starlette to cache the raw bytes in request._body. Reading that
    cached attribute synchronously is safe here, but depends on FastAPI's
    request lifecycle — revisit if slowapi adds async key_func support.
    """
    body_bytes = getattr(request, "_body", b"") or b""
    try:
        data = json.loads(body_bytes)
        puzzle_id = str(data.get("puzzle_id", ""))
    except Exception:
        puzzle_id = ""
    sid = request.headers.get("X-Session-ID", "").strip() or _real_ip(request)
    return f"{sid}:{puzzle_id}"


def _score_guess(answer: str, guess: str) -> list[dict]:
    """Tile-color algorithm: correct positions first, then present/absent by frequency."""
    tiles = [{"letter": c, "status": "absent"} for c in guess]
    answer_chars: list[str | None] = list(answer)

    for i, (g, a) in enumerate(zip(guess, answer)):
        if g == a:
            tiles[i]["status"] = "correct"
            answer_chars[i] = None

    for i, tile in enumerate(tiles):
        if tile["status"] == "correct":
            continue
        c = tile["letter"]
        if c in answer_chars:
            tile["status"] = "present"
            answer_chars[answer_chars.index(c)] = None

    return tiles


def _grapheme_clusters(word: str) -> list[list[int]]:
    """Group code-point indices into visual grapheme clusters.

    Devanagari combining marks (Unicode category Mc/Mn) attach to the
    preceding base character. A character following a virama (U+094D) is
    also part of the same conjunct cluster. The frontend uses this to
    render multi-codepoint syllables as a single tile.
    """
    clusters: list[list[int]] = []
    for i, ch in enumerate(word):
        cat = unicodedata.category(ch)
        if clusters and (cat.startswith("M") or (i > 0 and word[i - 1] == "\u094d")):
            clusters[-1].append(i)
        else:
            clusters.append([i])
    return clusters


def _cluster_len(word: str, lang: str) -> int:
    """Visual length: grapheme-cluster count for Hindi, code-point count for English.

    Comparing cluster counts ties the length check to visible syllables rather
    than Unicode storage size. The caller must NFC-normalise word before calling;
    the router does this at line 133 for guesses, and answers are normalised on
    load in puzzle.py.
    """
    return len(_grapheme_clusters(word)) if lang == "hi" else len(word)


class GuessRequest(BaseModel):
    puzzle_id: str
    guess: str
    tz_offset_minutes: int = Field(0, ge=-840, le=840)


@router.get("/today")
@limiter.limit("60/minute")
async def get_today(
    request: Request,
    tz_offset_minutes: int = Query(0, ge=-840, le=840),
    lang: str = Query("en"),
) -> dict:
    if lang not in _SUPPORTED_LANGS:
        raise HTTPException(status_code=422, detail="unsupported_language")
    return get_today_meta(tz_offset_minutes, lang)


@router.post("/guess")
@limiter.limit("20/hour", key_func=_guess_key)
async def post_guess(request: Request, body: GuessRequest) -> dict:
    get_session_id(request)

    try:
        date_str, lang = body.puzzle_id.rsplit(":", 1)
    except ValueError:
        raise HTTPException(status_code=422, detail="invalid_puzzle_id")

    if lang not in _SUPPORTED_LANGS:
        raise HTTPException(status_code=422, detail="invalid_puzzle_id")

    # 1-minute grace so guesses submitted just before midnight aren't rejected by
    # server/client clock drift when the server evaluates them just after midnight.
    now_utc = datetime.now(timezone.utc)
    local_ts = now_utc + timedelta(minutes=body.tz_offset_minutes)
    grace_ts = local_ts - timedelta(minutes=1)
    if date_str not in {local_ts.strftime("%Y-%m-%d"), grace_ts.strftime("%Y-%m-%d")}:
        raise HTTPException(status_code=422, detail="stale_puzzle_id")

    try:
        answer = get_answer(body.puzzle_id)
    except Exception:
        raise HTTPException(status_code=422, detail="invalid_puzzle_id")

    guess = body.guess.lower()  # no-op for Devanagari; NFC handles Hindi normalisation
    if lang == "hi":
        guess = unicodedata.normalize("NFC", guess)

    if _cluster_len(guess, lang) != _cluster_len(answer, lang):
        raise HTTPException(status_code=422, detail="wrong_guess_length")

    if not is_valid_guess(guess, lang):
        raise HTTPException(status_code=422, detail="not_a_word")

    result: dict = {"tiles": _score_guess(answer, guess)}
    if lang == "hi":
        # clusters describe how to split the guess's code points into displayable tile units (not the answer)
        result["grapheme_clusters"] = _grapheme_clusters(guess)
    return result


@router.get("/answer")
@limiter.limit("20/minute")
async def get_answer_route(
    request: Request,
    puzzle_id: str = Query(...),
) -> dict:
    """Return the answer for a puzzle — only called client-side after all guesses are exhausted."""
    try:
        answer = get_answer(puzzle_id)
    except Exception:
        raise HTTPException(status_code=422, detail="invalid_puzzle_id")
    return {"answer": answer}
