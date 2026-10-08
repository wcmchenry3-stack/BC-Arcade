"""FastAPI router for /logs/bug (#364)."""

from __future__ import annotations

from fastapi import APIRouter, Request

from db.base import DbSession
from limiter import limiter, session_key
from session import get_session_id

from . import service
from .schemas import BugLogBatchRequest, BugLogBatchResponse

router = APIRouter()


@router.post("/bug", response_model=BugLogBatchResponse)
@limiter.limit("30/minute", key_func=session_key)
async def append_bug_logs(
    request: Request, body: BugLogBatchRequest, db: DbSession
) -> BugLogBatchResponse:
    sid = get_session_id(request)
    result = await service.append_bug_logs(
        db,
        session_id=sid,
        logs=[log.model_dump() for log in body.logs],
    )
    return BugLogBatchResponse(accepted=result.accepted, duplicates=result.duplicates)
