"""Sentry integration tests.

Validates that Sentry SDK is correctly configured and captures errors.
Addresses lessons from PRs #91-#96 where Sentry silently failed due to
native module incompatibility — these tests catch that class of issue.
"""

import os
import sys
from pathlib import Path

import pytest
import sentry_sdk

# Path to main.py source — avoids importing the full app for source checks
_MAIN_PY = Path(__file__).resolve().parent.parent / "main.py"


# ---------------------------------------------------------------------------
# Unit tests — no network, always run
# ---------------------------------------------------------------------------


class TestSentryUnit:
    """Unit tests for Sentry configuration."""

    def test_sentry_dsn_env_var_format(self):
        """SENTRY_DSN should be a valid Sentry DSN URL when set."""
        dsn = os.environ.get("SENTRY_DSN", "")
        if not dsn:
            pytest.skip("SENTRY_DSN not set (expected in CI)")
        assert dsn.startswith("https://"), f"DSN should start with https://, got: {dsn[:20]}..."
        assert ".sentry.io" in dsn or ".ingest." in dsn, "DSN should contain a Sentry ingest domain"

    def test_sentry_sdk_importable(self):
        """sentry-sdk should be installed and importable."""
        assert hasattr(sentry_sdk, "init")
        assert hasattr(sentry_sdk, "capture_exception")
        assert hasattr(sentry_sdk, "capture_message")

    def test_sentry_init_code_present_in_main(self):
        """main.py should contain Sentry initialization logic."""
        source = _MAIN_PY.read_text()
        assert "sentry_sdk.init(" in source, "main.py should call sentry_sdk.init()"
        assert "SENTRY_DSN" in source, "main.py should read SENTRY_DSN env var"

    def test_sentry_integrations_in_source(self):
        """main.py should register FastAPI and Starlette integrations."""
        source = _MAIN_PY.read_text()
        assert "FastApiIntegration" in source
        assert "StarletteIntegration" in source

    def test_sentry_traces_sample_rate_in_source(self):
        """Traces sample rate should be configured (not 0 or 1.0 in prod)."""
        source = _MAIN_PY.read_text()
        assert "traces_sample_rate" in source, "traces_sample_rate should be set"
        assert (
            "traces_sample_rate=1.0" not in source
        ), "traces_sample_rate should not be 1.0 in production"

    def test_sentry_conditional_on_dsn(self):
        """Sentry init should be gated on SENTRY_DSN being set."""
        source = _MAIN_PY.read_text()
        assert (
            "if _sentry_dsn:" in source or "if _sentry_dsn" in source
        ), "Sentry init should be conditional on DSN being set"

    def test_sentry_captures_callable(self):
        """Verify that Sentry's core capture functions are available."""
        assert callable(sentry_sdk.capture_exception)
        assert callable(sentry_sdk.capture_message)

    def test_debug_error_route_in_source(self):
        """main.py should have a test-only /debug/error route."""
        source = _MAIN_PY.read_text()
        assert "/debug/error" in source, "main.py should define a /debug/error route"
        assert "ENVIRONMENT" in source, "/debug/error should be gated on ENVIRONMENT env var"

    @pytest.mark.skipif(
        sys.version_info < (3, 10),
        reason="App import requires Python 3.10+ (str | None syntax)",
    )
    @pytest.mark.asyncio
    async def test_debug_error_route_returns_500(self):
        """The /debug/error route should return 500 when ENVIRONMENT=test."""
        if os.environ.get("ENVIRONMENT") != "test":
            pytest.skip("ENVIRONMENT != test, debug route not registered")

        from httpx import ASGITransport, AsyncClient

        from main import app

        transport = ASGITransport(app=app, raise_app_exceptions=False)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get(
                "/debug/error",
                headers={"X-Session-ID": "00000000-0000-4000-8000-000000000000"},
            )
            assert resp.status_code == 500

    @pytest.mark.skipif(
        sys.version_info < (3, 10),
        reason="App import requires Python 3.10+ (str | None syntax)",
    )
    def test_health_endpoint_accessible(self):
        """Health endpoint should work regardless of Sentry state."""
        from starlette.testclient import TestClient

        from main import app

        client = TestClient(app)
        resp = client.get(
            "/health",
            headers={"X-Session-ID": "00000000-0000-4000-8000-000000000000"},
        )
        assert resp.status_code == 200
        assert resp.json() == {"status": "ok"}
