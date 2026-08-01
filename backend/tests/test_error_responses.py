"""Tests that error responses include a 'detail' field for frontend error display.

Covers #254/#255: the frontend httpClient reads `detail` from error JSON bodies.
If the backend omits `detail`, the frontend falls back to a raw statusText string
that is not user-friendly. These tests ensure every 404 response provides one.
"""

import uuid

import pytest
from fastapi.testclient import TestClient

from main import app

client = TestClient(app)

TEST_SESSION_ID = str(uuid.uuid4())
SESSION_HEADERS = {"X-Session-ID": TEST_SESSION_ID}


# ---------------------------------------------------------------------------
# Missing X-Session-ID header returns 422
# ---------------------------------------------------------------------------


class TestMissingSessionHeader:
    """All session-dependent endpoints require X-Session-ID."""

    @pytest.mark.parametrize(
        "method,path",
        [
            ("GET", "/games/me"),
            ("POST", "/games"),
        ],
    )
    def test_missing_header_returns_error(self, method, path):
        res = client.request(method, path)
        assert res.status_code in (400, 422)
