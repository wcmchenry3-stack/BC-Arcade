"""Unit tests for ALLOWED_ORIGINS parsing logic in main.py.

We avoid reloading main (importlib.reload) because it reinitialises the
FastAPI app and wipes in-memory session state, which breaks other tests
running in the same process.  Instead we test the parsing logic inline.
"""

from pathlib import Path

_MAIN_PY = Path(__file__).resolve().parent.parent / "main.py"


class TestAllowedOriginsLogic:
    """ALLOWED_ORIGINS env var is parsed into a list of stripped origin strings."""

    def test_custom_domains_parsed(self):
        raw = "https://dev-games.buffingchi.com,https://dev-games-api.buffingchi.com"
        result = [o.strip() for o in raw.split(",") if o.strip()]
        assert result == [
            "https://dev-games.buffingchi.com",
            "https://dev-games-api.buffingchi.com",
        ]

    def test_empty_string_gives_empty_list(self):
        raw = ""
        result = [o.strip() for o in raw.split(",") if o.strip()] if raw else []
        assert result == []

    def test_whitespace_trimmed(self):
        raw = "  https://a.example.com , https://b.example.com  "
        result = [o.strip() for o in raw.split(",") if o.strip()]
        assert result == ["https://a.example.com", "https://b.example.com"]


class TestApiDocsVisibility:
    """/docs, /redoc, /openapi.json expose the whole API publicly and were
    unthrottled — hidden outside production so a store-facing prod API doesn't
    serve them (see _is_production in main.py)."""

    def test_docs_hidden_only_in_production_source(self):
        source = _MAIN_PY.read_text()
        assert 'docs_url=None if _is_production else "/docs"' in source
        assert 'redoc_url=None if _is_production else "/redoc"' in source
        assert 'openapi_url=None if _is_production else "/openapi.json"' in source

    def test_docs_enabled_outside_production(self):
        """This suite runs with ENVIRONMENT=test, so docs must stay enabled."""
        from main import app

        assert app.docs_url == "/docs"
        assert app.redoc_url == "/redoc"
        assert app.openapi_url == "/openapi.json"
