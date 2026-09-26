import uuid

from fastapi import HTTPException, Request


def get_session_id(request: Request) -> str:
    """Extract and validate the X-Session-ID header.

    Returns the session UUID string if valid.
    Raises HTTPException 400 if missing or not a valid UUID4.
    """
    sid = request.headers.get("X-Session-ID", "").strip()
    if not sid:
        raise HTTPException(status_code=400, detail="X-Session-ID header required.")
    try:
        uuid.UUID(sid)
    except ValueError:
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
