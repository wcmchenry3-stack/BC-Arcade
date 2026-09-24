"""Daily Word REST endpoints — GET /today, POST /guess, GET /answer (#1190).

Guess state is server-side (#2197, ``daily_word.progress``). It has to be: the
puzzle is deterministic and ``puzzle_id`` is just ``YYYY-MM-DD:{lang}``, so
nothing about the request itself can prove the caller has played. The rate
limits below throttle volume only — they were never an integrity control, and
before #2197 they were the *only* thing standing between a caller and both
today's answer and an unlimited supply of scored guesses.

Rate limits:
  GET /today   — 60/minute (IP-keyed, no auth)
  POST /guess  — 20/hour keyed by f"{session_id}:{puzzle_id}" (compound key
                 isolates by puzzle so the limit resets naturally each new day;
                 20/hour leaves room for invalid-word attempts and network
                 retries on top of the 6 scored guesses, which are now capped
                 by ``progress.MAX_GUESSES`` rather than by this limit)
  GET /answer  — 20/minute, and gated on the caller's own guess record

Availability posture (#2542): ``/guess`` degrades *open* if the guess record is
unreachable — it scores the guess and skips the cap rather than failing, because
``/today`` needs no DB and has already handed the player a board. ``/answer``
stays closed: with no record there is nothing to check entitlement against.
"""

from __future__ import annotations

import json
import logging
import unicodedata
from datetime import datetime, timedelta, timezone

import sentry_sdk
from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field

from daily_word.progress import MAX_GUESSES, GuessOutcome, may_see_answer, record_guess
from daily_word.puzzle import get_answer, get_today_meta, is_valid_guess
from db.base import get_session_factory
from limiter import _real_ip, limiter
from session import get_session_id

_SUPPORTED_LANGS = frozenset(("en", "hi"))

router = APIRouter()
logger = logging.getLogger(__name__)


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
    except Exception:  # noqa: BLE001 — best-effort; must never break the rate limiter
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
# An IP-keyed backstop *in addition to* the session key, because the session id
# is self-asserted: without one, minting a fresh UUID bought another six
# guesses and unbounded row insertion. Deliberately generous — `_real_ip`
# resolves to a carrier NAT address that many subscribers share, and locking
# real players out of a shipping free game is a worse outcome than the abuse it
# prevents. This is a volume backstop, not a security boundary; it does not
# stop a determined caller, which needs server-issued sessions (#1047).
@limiter.limit("1200/hour")
async def post_guess(request: Request, body: GuessRequest) -> dict:
    sid = get_session_id(request)

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
    except ValueError:
        raise HTTPException(status_code=422, detail="invalid_puzzle_id")

    guess = body.guess.lower()  # no-op for Devanagari; NFC handles Hindi normalisation
    if lang == "hi":
        guess = unicodedata.normalize("NFC", guess)

    if _cluster_len(guess, lang) != _cluster_len(answer, lang):
        raise HTTPException(status_code=422, detail="wrong_guess_length")

    if not is_valid_guess(guess, lang):
        raise HTTPException(status_code=422, detail="not_a_word")

    # #2197 — spend a guess server-side. Deliberately after the length and
    # dictionary checks, so a typo or a non-word costs nothing, exactly as the
    # client behaves. A guess already on record is re-scored without spending a
    # turn, so a retried request cannot rob the player.
    tiles = _score_guess(answer, guess)
    # Compared, not inferred from the tiles: `_score_guess` builds one tile per
    # code point of the *guess* and zips against the answer, while the length
    # check above compares grapheme clusters. For a Hindi guess with matching
    # clusters but fewer code points, every tile can read "correct" without the
    # words being equal — which would persist solved=True and release the
    # answer for a non-winning guess. No such pair exists in today's word
    # lists, so this is latent rather than live, but equality is exact and free.
    won = guess == answer

    # Degrade open if the record cannot be reached (#2542). Daily Word is a
    # free shipping game and the daily challenge's anchor, `/today` needs no DB
    # so the player has already been handed a board, and prod Postgres is on a
    # plan that pauses when idle — so a DB blip must not turn a playable game
    # into an error mid-puzzle. The cap is deterrence and volume bounding, not
    # a security boundary (sessions are self-asserted until #1047), so losing
    # enforcement during an outage is the cheaper failure. Reported to Sentry so
    # a permanent degrade is visible rather than a cap that quietly never
    # applies. `/answer` stays closed: without the record there is nothing to
    # check entitlement against.
    outcome: GuessOutcome | None = None
    try:
        factory = get_session_factory()
        async with factory() as db:
            outcome = await record_guess(
                db, session_id=sid, puzzle_id=body.puzzle_id, guess=guess, won=won
            )
    except Exception:
        logger.exception("daily_word: guess state unavailable, scoring without the cap")
        sentry_sdk.capture_message(
            "daily_word guess state unavailable — cap not enforced", level="warning"
        )

    if outcome is not None and not outcome.allowed:
        raise HTTPException(
            status_code=403,
            detail="already_solved" if outcome.solved else "no_guesses_remaining",
        )

    result: dict = {"tiles": tiles}
    if outcome is not None:
        result["guesses_used"] = outcome.guesses_used
        result["guesses_remaining"] = MAX_GUESSES - outcome.guesses_used
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
    """Return the answer, but only to a session that has earned it (#2197).

    ``puzzle_id`` is ``YYYY-MM-DD:{lang}`` and needs no discovery, so this used
    to hand today's word to anyone who asked before making a single guess. The
    gate is the caller's own guess record: solved, or all
    ``MAX_GUESSES`` spent. A session that never played gets 403, which also
    means past puzzles are not browsable.
    """
    # puzzle_id is validated before the session so a malformed id still answers
    # 422 rather than 400, keeping the pre-#2197 contract for that case.
    try:
        answer = get_answer(puzzle_id)
    except ValueError:
        raise HTTPException(status_code=422, detail="invalid_puzzle_id")

    sid = get_session_id(request)
    factory = get_session_factory()
    async with factory() as db:
        earned = await may_see_answer(db, session_id=sid, puzzle_id=puzzle_id)
    if not earned:
        raise HTTPException(status_code=403, detail="guesses_remaining")
    return {"answer": answer}
