"""``settings.Settings`` and how ``create_app()`` uses it (#2997).

Pins env-var parity with the ``os.environ.get`` calls it replaced: the same
names (case-sensitive, no prefix), the same defaults, and the same startup
errors for a bad value.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi.middleware.cors import CORSMiddleware
from pydantic import ValidationError

import limiter as limiter_module
import main
from daily_challenge.definitions import parse_salt
from observability import sentry as sentry_setup
from settings import DEFAULT_ALLOWED_ORIGINS, Settings

BACKEND_DIR = Path(__file__).resolve().parent.parent

ENV_VARS = (
    "ENVIRONMENT",
    "ALLOWED_ORIGINS",
    "SENTRY_DSN",
    "RENDER_GIT_COMMIT",
    "TRUSTED_PROXY_MODE",
    "TRUSTED_PROXY_HOPS",
    "LOG_PROXY_HEADERS",
)
DSN = "https://key@o0.ingest.sentry.io/0"


@pytest.fixture
def clean_env(monkeypatch: pytest.MonkeyPatch) -> pytest.MonkeyPatch:
    for name in ENV_VARS:
        monkeypatch.delenv(name, raising=False)
    return monkeypatch


@pytest.fixture
def keep_proxy_trust(monkeypatch: pytest.MonkeyPatch) -> None:
    """``create_app()`` sets process-wide trust; restore it after the test."""
    monkeypatch.setattr(limiter_module, "_TRUST", limiter_module._TRUST)
    monkeypatch.setattr(limiter_module, "_LOG_PROXY_HEADERS", limiter_module._LOG_PROXY_HEADERS)


def _cors_origins(app) -> list[str]:
    (cors,) = [m for m in app.user_middleware if m.cls is CORSMiddleware]
    return cors.kwargs["allow_origins"]


# ---------------------------------------------------------------------------
# Defaults and env overrides
# ---------------------------------------------------------------------------


def test_defaults_match_the_old_os_environ_reads(clean_env: pytest.MonkeyPatch) -> None:
    s = Settings()
    assert s.environment is None
    assert s.allowed_origins_raw == ""
    assert s.allowed_origins == ["http://localhost:8081", "http://localhost:19006"]
    assert s.sentry_dsn is None
    assert s.sentry_environment == "development"
    assert s.render_git_commit is None
    assert s.trusted_proxy_mode is None and s.trusted_proxy_hops is None
    assert s.log_proxy_headers == "" and s.log_proxy_headers_requested is False
    assert not s.is_production and not s.is_test
    assert s.proxy_environ() == {"LOG_PROXY_HEADERS": ""}


def test_env_overrides_every_field(clean_env: pytest.MonkeyPatch) -> None:
    values = {
        "ENVIRONMENT": "production",
        "ALLOWED_ORIGINS": " https://a.example.com ,, https://b.example.com ",
        "SENTRY_DSN": DSN,
        "RENDER_GIT_COMMIT": "abc1234",
        "TRUSTED_PROXY_MODE": "render",
        "TRUSTED_PROXY_HOPS": "2",
        "LOG_PROXY_HEADERS": " 1 ",
    }
    for name, value in values.items():
        clean_env.setenv(name, value)
    s = Settings()
    assert s.is_production and s.sentry_environment == "production"
    assert s.allowed_origins == ["https://a.example.com", "https://b.example.com"]
    assert (s.sentry_dsn, s.render_git_commit) == (DSN, "abc1234")
    assert s.log_proxy_headers_requested is True
    assert s.proxy_environ() == {
        "ENVIRONMENT": "production",
        "TRUSTED_PROXY_MODE": "render",
        "TRUSTED_PROXY_HOPS": "2",
        "LOG_PROXY_HEADERS": " 1 ",
    }


def test_env_names_are_case_sensitive_and_unprefixed(clean_env: pytest.MonkeyPatch) -> None:
    clean_env.setenv("environment", "production")
    clean_env.setenv("ENVIRONMENT_X", "production")
    assert Settings().environment is None


def test_lower_and_mixed_case_env_names_are_ignored_for_every_field(
    clean_env: pytest.MonkeyPatch,
) -> None:
    for name in ("allowed_origins", "Allowed_Origins", "sentry_dsn", "Sentry_Dsn"):
        clean_env.setenv(name, "https://x.example.com")
    clean_env.setenv("trusted_proxy_mode", "none")
    clean_env.setenv("Trusted_Proxy_Hops", "3")
    clean_env.setenv("log_proxy_headers", "1")
    clean_env.setenv("render_git_commit", "abc")
    s = Settings()
    assert s.allowed_origins == list(DEFAULT_ALLOWED_ORIGINS)
    assert s.sentry_dsn is None
    assert s.trusted_proxy_mode is None and s.trusted_proxy_hops is None
    assert s.log_proxy_headers == "" and s.render_git_commit is None


def test_allowed_origins_stays_a_raw_comma_split_not_json(clean_env: pytest.MonkeyPatch) -> None:
    clean_env.setenv("ALLOWED_ORIGINS", '["a"]')
    assert Settings().allowed_origins == ['["a"]']


def test_settings_does_not_read_a_dotenv_file(
    clean_env: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    (tmp_path / ".env").write_text(
        "ENVIRONMENT=production\nSENTRY_DSN=https://k@o0.ingest.sentry.io/0\n"
    )
    clean_env.chdir(tmp_path)
    s = Settings()
    assert s.environment is None and s.sentry_dsn is None


def test_isolated_ignores_the_environment(clean_env: pytest.MonkeyPatch) -> None:
    clean_env.setenv("SENTRY_DSN", DSN)
    clean_env.setenv("ALLOWED_ORIGINS", "https://x.example.com")
    s = Settings.isolated(ENVIRONMENT="production")
    assert s.environment == "production"
    assert s.sentry_dsn is None
    assert s.allowed_origins == list(DEFAULT_ALLOWED_ORIGINS)
    assert isinstance(s, Settings)


def test_empty_values_are_kept_as_the_old_reads_kept_them(clean_env: pytest.MonkeyPatch) -> None:
    # os.environ.get("ENVIRONMENT", "development") returned "" for ENVIRONMENT="".
    clean_env.setenv("ENVIRONMENT", "")
    clean_env.setenv("ALLOWED_ORIGINS", "")
    s = Settings()
    assert s.sentry_environment == ""
    assert s.allowed_origins == list(DEFAULT_ALLOWED_ORIGINS)


def test_test_environment_flag(clean_env: pytest.MonkeyPatch) -> None:
    assert Settings.isolated(ENVIRONMENT="test").is_test
    assert not Settings.isolated(ENVIRONMENT="production").is_test


def test_field_names_are_not_accepted_as_keywords() -> None:
    """Only env var names are; a typo cannot silently fall back to a default."""
    with pytest.raises(ValidationError):
        Settings(environment="test")


def test_settings_are_frozen() -> None:
    with pytest.raises(ValidationError):
        Settings().environment = "production"  # type: ignore[misc]


# ---------------------------------------------------------------------------
# DATABASE_URL and the daily salts (#2997 PR 2)
# ---------------------------------------------------------------------------

DB_AND_SALT_VARS = ("DATABASE_URL", "DAILY_WORD_SALT", "DAILY_CHALLENGE_SALT")


def test_db_and_salt_defaults_match_the_old_reads(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in DB_AND_SALT_VARS:
        monkeypatch.delenv(name, raising=False)
    s = Settings()
    # os.environ.get("DATABASE_URL", "").strip() → falsy → no database.
    assert s.database_url_raw == "" and s.database_url is None
    # int(os.environ.get("DAILY_WORD_SALT", "0"))
    assert s.daily_word_salt == "0" and int(s.daily_word_salt) == 0
    # parse_salt(os.environ.get("DAILY_CHALLENGE_SALT"))
    assert s.daily_challenge_salt is None and parse_salt(s.daily_challenge_salt) == 0


@pytest.mark.parametrize(
    ("raw", "expected"),
    [("", None), ("   ", None), (" postgres://u@h/db \n", "postgres://u@h/db")],
)
def test_database_url_is_stripped_and_blank_means_unset(
    monkeypatch: pytest.MonkeyPatch, raw: str, expected: str | None
) -> None:
    monkeypatch.setenv("DATABASE_URL", raw)
    assert Settings().database_url == expected


def test_salts_stay_raw_strings_so_their_parse_is_unchanged(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("DAILY_WORD_SALT", "")
    monkeypatch.setenv("DAILY_CHALLENGE_SALT", "")
    s = Settings()
    assert (s.daily_word_salt, s.daily_challenge_salt) == ("", "")
    with pytest.raises(ValueError, match="invalid literal for int"):
        int(s.daily_word_salt)
    assert parse_salt(s.daily_challenge_salt) == 0

    monkeypatch.setenv("DAILY_WORD_SALT", " 7 ")
    monkeypatch.setenv("DAILY_CHALLENGE_SALT", "not-a-number")
    s = Settings()
    assert int(s.daily_word_salt) == 7
    assert parse_salt(s.daily_challenge_salt) == parse_salt("not-a-number")


def _import_in_fresh_process(code: str, **env: str) -> subprocess.CompletedProcess[str]:
    full_env = {k: v for k, v in os.environ.items() if k not in DB_AND_SALT_VARS}
    full_env.update(env)
    return subprocess.run(
        [sys.executable, "-c", code],
        cwd=BACKEND_DIR,
        env=full_env,
        capture_output=True,
        text=True,
        check=False,
    )


@pytest.mark.parametrize(
    ("env", "word_salt", "challenge_salt"),
    [
        ({}, "0", "0"),
        ({"DAILY_WORD_SALT": "41", "DAILY_CHALLENGE_SALT": " 9 "}, "41", "9"),
    ],
)
def test_salts_are_read_when_their_modules_are_imported(
    env: dict[str, str], word_salt: str, challenge_salt: str
) -> None:
    result = _import_in_fresh_process(
        "import daily_word.puzzle as p, daily_challenge.definitions as d; " "print(p.SALT, d.SALT)",
        **env,
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout.split() == [word_salt, challenge_salt]


def test_an_empty_daily_word_salt_still_fails_the_import() -> None:
    result = _import_in_fresh_process("import daily_word.puzzle", DAILY_WORD_SALT="")
    assert result.returncode != 0
    assert "ValueError: invalid literal for int() with base 10: ''" in result.stderr


# ---------------------------------------------------------------------------
# create_app(settings)
# ---------------------------------------------------------------------------


def test_create_app_takes_settings_without_touching_env(
    clean_env: pytest.MonkeyPatch, keep_proxy_trust: None
) -> None:
    settings = Settings.isolated(ENVIRONMENT="production", ALLOWED_ORIGINS="https://x.example.com")
    app = main.create_app(settings)
    assert app.state.settings is settings
    assert _cors_origins(app) == ["https://x.example.com"]
    assert app.docs_url is None and app.openapi_url is None


def test_create_app_reads_env_when_no_settings_given(
    clean_env: pytest.MonkeyPatch, keep_proxy_trust: None
) -> None:
    clean_env.setenv("ALLOWED_ORIGINS", "https://y.example.com")
    app = main.create_app()
    assert app.state.settings.allowed_origins == ["https://y.example.com"]
    assert _cors_origins(app) == ["https://y.example.com"]
    assert app.docs_url == "/docs"


def test_create_app_passes_proxy_trust_from_settings(
    clean_env: pytest.MonkeyPatch, keep_proxy_trust: None
) -> None:
    main.create_app(Settings.isolated(TRUSTED_PROXY_MODE="none", TRUSTED_PROXY_HOPS="3"))
    assert (limiter_module._TRUST.mode, limiter_module._TRUST.hops) == ("none", 3)


@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        ({"TRUSTED_PROXY_MODE": "leftmost"}, "TRUSTED_PROXY_MODE must be one of"),
        ({"TRUSTED_PROXY_HOPS": "two"}, "TRUSTED_PROXY_HOPS must be an integer"),
        ({"TRUSTED_PROXY_HOPS": "11"}, "TRUSTED_PROXY_HOPS must be between 1 and 10"),
    ],
)
def test_bad_proxy_settings_still_raise_value_error_at_startup(
    overrides: dict[str, str], message: str, keep_proxy_trust: None
) -> None:
    with pytest.raises(ValueError, match=message):
        main.create_app(Settings.isolated(**overrides))


def test_init_sentry_uses_the_settings_it_is_given(
    clean_env: pytest.MonkeyPatch, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[dict] = []
    monkeypatch.setattr(sentry_setup.sentry_sdk, "init", lambda **kw: calls.append(kw))
    monkeypatch.setattr(sentry_setup, "_initialised", False)
    settings = Settings.isolated(
        SENTRY_DSN=DSN, ENVIRONMENT="production", RENDER_GIT_COMMIT="c0ffee"
    )
    assert sentry_setup.init_sentry(settings) is True
    (opts,) = calls
    assert (opts["dsn"], opts["environment"], opts["release"]) == (DSN, "production", "c0ffee")


def test_log_proxy_trust_reports_refusal_from_the_flag(
    clean_env: pytest.MonkeyPatch, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    monkeypatch.setattr(limiter_module, "_LOG_PROXY_HEADERS", False)
    with caplog.at_level("INFO", logger="audit"):
        limiter_module.log_proxy_trust(log_proxy_headers_requested=True)
    assert "log_proxy_headers_ignored" in caplog.text
