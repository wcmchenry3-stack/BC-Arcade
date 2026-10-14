"""The ``X-Session-ID`` request header: the pseudonymous player id.

The app generates a UUID once per install and sends it on every request; it is
the only player identity until accounts (#1047). Routes read it through these
two helpers so every route answers a missing or malformed header the same way.
"""

import uuid

from fastapi import HTTPException, Request


def parse_session_id(raw: str | None) -> str | None:
    """``raw`` stripped if it parses as a UUID, else ``None``.

    The single definition of a valid session id: :func:`get_session_id` (which
    answers 400) and the rate limiters' key functions (``limiter.session_key``,
    ``daily_word.router._guess_key``) all use it, so they cannot disagree.
    """
    sid = (raw or "").strip()
    if not sid:
        return None
    try:
        uuid.UUID(sid)
    except ValueError:
        return None
    return sid


def canonical_session_id(raw: str | None) -> str | None:
    """The canonical spelling (lowercase, hyphenated) of a valid UUID, else ``None``.

    For rate-limit keys only: uppercase, braced, ``urn:uuid:`` and unhyphenated
    spellings of one UUID all map to one bucket. :func:`get_session_id` still
    returns the id as sent, because stored data is keyed on that.
    """
    sid = parse_session_id(raw)
    return None if sid is None else str(uuid.UUID(sid))


def get_session_id(request: Request) -> str:
    """Extract and validate the X-Session-ID header.

    Returns the session UUID string if valid.
    Raises HTTPException 400 if missing or not a valid UUID (any version).
    """
    raw = request.headers.get("X-Session-ID", "").strip()
    if not raw:
        raise HTTPException(status_code=400, detail="X-Session-ID header required.")
    sid = parse_session_id(raw)
    if sid is None:
        raise HTTPException(status_code=400, detail="X-Session-ID must be a valid UUID.")
    return sid


def optional_session_id(request: Request) -> str | None:
    """The X-Session-ID header if present and a valid UUID, else ``None``.

    For routes that accept requests without one (e.g. a free leaderboard).
    """
    try:
        return get_session_id(request)
    except HTTPException:
        return None
