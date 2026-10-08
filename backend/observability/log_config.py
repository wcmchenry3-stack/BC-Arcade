"""Audit logging setup — JSON lines; Render's log aggregator adds timestamps."""

from __future__ import annotations

import logging

# httpx logs every request URL at INFO ("HTTP Request: GET .../tokens/<token>").
# Store API URLs carry credentials in the path (Google purchaseToken, Apple
# transaction IDs), so the HTTP client loggers only speak up for warnings (#2787).
QUIET_HTTP_LOGGERS = ("httpx", "httpcore")


def configure_logging() -> None:
    """Root logging at INFO with bare messages; HTTP client loggers at WARNING.

    ``basicConfig`` is a no-op once the root logger has handlers, so calling
    this from every ``create_app()`` is safe.
    """
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    for name in QUIET_HTTP_LOGGERS:
        logging.getLogger(name).setLevel(logging.WARNING)
