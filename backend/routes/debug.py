"""Test-only ``GET /debug/error`` — confirms Sentry captures unhandled exceptions.

``main.create_app()`` imports and mounts this router only when
``ENVIRONMENT=test`` (the sentry-check CI job), so outside that environment the
route does not exist and its rate limit is never registered.
"""

from __future__ import annotations

from fastapi import APIRouter, Request

from limiter import limiter

router = APIRouter()


@router.get("/debug/error")
@limiter.limit("5/minute")
def trigger_error(request: Request) -> None:
    raise RuntimeError("Intentional test error for Sentry verification")
