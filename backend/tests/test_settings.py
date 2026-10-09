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
        "import daily_word.puzzle as p, daily_challenge.definitions as d; print(p.SALT, d.SALT)",
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


# ---------------------------------------------------------------------------
# APPLE_* / GOOGLE_* store config (#2997 PR 4)
# ---------------------------------------------------------------------------

STORE_STRIPPED = {
    "APPLE_BUNDLE_ID": "apple_bundle_id",
    "APPLE_APP_ID": "apple_app_id",
    "APPLE_IAP_ISSUER_ID": "apple_iap_issuer_id",
    "APPLE_IAP_KEY_ID": "apple_iap_key_id",
    "APPLE_IAP_ONLINE_CHECKS": "apple_iap_online_checks",
    "GOOGLE_PLAY_PACKAGE_NAME": "google_play_package_name",
    "GOOGLE_RTDN_AUDIENCE": "google_rtdn_audience",
    "GOOGLE_RTDN_PUSH_SA": "google_rtdn_push_sa",
}
STORE_SECRETS = {
    "APPLE_IAP_PRIVATE_KEY": "apple_iap_private_key",
    "GOOGLE_PLAY_SERVICE_ACCOUNT_JSON": "google_play_service_account_json",
}
STORE_ENVIRONMENTS = {
    "APPLE_IAP_ENVIRONMENTS": "apple_iap_environments_raw",
    "GOOGLE_PLAY_ENVIRONMENTS": "google_play_environments_raw",
}
STORE_VARS = (*STORE_STRIPPED, *STORE_SECRETS, *STORE_ENVIRONMENTS)


def test_store_defaults_match_the_old_reads(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in STORE_VARS:
        monkeypatch.delenv(name, raising=False)
    s = Settings()
    for field in STORE_STRIPPED.values():
        assert getattr(s, field) == ""
    for field in STORE_SECRETS.values():
        assert getattr(s, field).get_secret_value() == ""
    # Empty means "use the default": allowed_environments applies it, not Settings.
    assert s.apple_iap_environments_raw == "" and s.google_play_environments_raw == ""


def test_store_values_are_stripped_and_blank_reads_as_empty(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # (os.environ.get(name) or "").strip()
    for name in (*STORE_STRIPPED, *STORE_SECRETS):
        monkeypatch.setenv(name, "  value \n")
    s = Settings()
    for field in STORE_STRIPPED.values():
        assert getattr(s, field) == "value"
    for field in STORE_SECRETS.values():
        assert getattr(s, field).get_secret_value() == "value"
    for name in (*STORE_STRIPPED, *STORE_SECRETS):
        monkeypatch.setenv(name, "   ")
    s = Settings()
    assert all(getattr(s, f) == "" for f in STORE_STRIPPED.values())
    assert all(getattr(s, f).get_secret_value() == "" for f in STORE_SECRETS.values())


def test_store_environment_lists_stay_raw(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in STORE_ENVIRONMENTS:
        monkeypatch.setenv(name, " Production , ")
    s = Settings()
    assert s.apple_iap_environments_raw == " Production , "
    assert s.google_play_environments_raw == " Production , "


def test_store_secrets_are_hidden_in_repr(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in STORE_SECRETS:
        monkeypatch.setenv(name, "super-secret-material")
    s = Settings()
    assert "super-secret-material" not in repr(s) and "super-secret-material" not in str(s)
    assert "**********" in repr(s)


def test_store_env_names_are_case_sensitive(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in STORE_VARS:
        monkeypatch.delenv(name, raising=False)
        monkeypatch.setenv(name.lower(), "x")
    s = Settings()
    assert all(getattr(s, f) == "" for f in STORE_STRIPPED.values())
    assert s.apple_iap_environments_raw == ""


# ---------------------------------------------------------------------------
# Operational tunables (#3110)
# ---------------------------------------------------------------------------

TUNABLES = (
    # (field, env var, default, override env string, override value)
    ("entitlement_token_ttl_hours", "ENTITLEMENT_TOKEN_TTL_HOURS", 24, "48", 48),
    ("stale_game_after_hours", "STALE_GAME_AFTER_HOURS", 24, "36", 36),
    ("max_result_bytes", "MAX_RESULT_BYTES", 8192, "16384", 16384),
    ("streak_lookback_days", "STREAK_LOOKBACK_DAYS", 60, "30", 30),
    ("apple_replay_window_hours", "APPLE_REPLAY_WINDOW_HOURS", 48, "72", 72),
    ("db_ping_timeout_seconds", "DB_PING_TIMEOUT_SECONDS", 5.0, "2.5", 2.5),
)
# (env var, value just below the minimum, value just above the maximum)
TUNABLE_BOUNDS = (
    ("ENTITLEMENT_TOKEN_TTL_HOURS", "0", "169"),
    ("STALE_GAME_AFTER_HOURS", "0", "721"),
    ("MAX_RESULT_BYTES", "1023", "131073"),
    ("STREAK_LOOKBACK_DAYS", "0", "366"),
    ("APPLE_REPLAY_WINDOW_HOURS", "0", "721"),
    ("DB_PING_TIMEOUT_SECONDS", "0", "60.5"),
)


@pytest.mark.parametrize(("field", "env", "default", "_raw", "_value"), TUNABLES)
def test_tunable_defaults_keep_the_old_constants(
    monkeypatch: pytest.MonkeyPatch,
    field: str,
    env: str,
    default: object,
    _raw: str,
    _value: object,
) -> None:
    monkeypatch.delenv(env, raising=False)
    assert getattr(Settings(), field) == default
    assert getattr(Settings.isolated(), field) == default


@pytest.mark.parametrize(("field", "env", "_default", "raw", "value"), TUNABLES)
def test_tunable_env_override(
    monkeypatch: pytest.MonkeyPatch, field: str, env: str, _default: object, raw: str, value: object
) -> None:
    monkeypatch.setenv(env, raw)
    assert getattr(Settings(), field) == value


@pytest.mark.parametrize(("env", "low", "high"), TUNABLE_BOUNDS)
def test_tunable_bounds_are_enforced(
    monkeypatch: pytest.MonkeyPatch, env: str, low: str, high: str
) -> None:
    for bad in (low, high, "-1", "abc"):
        monkeypatch.setenv(env, bad)
        with pytest.raises(ValidationError):
            Settings()


def test_tunable_bounds_accept_the_edges() -> None:
    assert Settings.isolated(ENTITLEMENT_TOKEN_TTL_HOURS=1).entitlement_token_ttl_hours == 1
    assert Settings.isolated(ENTITLEMENT_TOKEN_TTL_HOURS=168).entitlement_token_ttl_hours == 168
    assert Settings.isolated(MAX_RESULT_BYTES=1024).max_result_bytes == 1024
    assert Settings.isolated(MAX_RESULT_BYTES=131_072).max_result_bytes == 131_072
    assert Settings.isolated(APPLE_REPLAY_WINDOW_HOURS=720).apple_replay_window_hours == 720
    assert Settings.isolated(DB_PING_TIMEOUT_SECONDS=60).db_ping_timeout_seconds == 60


def test_modules_read_tunables_lazily(monkeypatch: pytest.MonkeyPatch) -> None:
    """Each module takes its value from its own ``_settings`` on use, not at import."""
    from datetime import timedelta

    import entitlements.service as ent
    from daily_challenge import streak
    from games import sessions, sweep
    from routes import health

    monkeypatch.setattr(ent, "_settings", Settings.isolated(ENTITLEMENT_TOKEN_TTL_HOURS=2))
    monkeypatch.setattr(sweep, "_settings", Settings.isolated(STALE_GAME_AFTER_HOURS=3))
    monkeypatch.setattr(sessions, "_settings", Settings.isolated(MAX_RESULT_BYTES=2048))
    monkeypatch.setattr(streak, "_settings", Settings.isolated(STREAK_LOOKBACK_DAYS=7))
    monkeypatch.setattr(health, "_settings", Settings.isolated(DB_PING_TIMEOUT_SECONDS=1.5))
    assert ent._get_settings().entitlement_token_ttl_hours == 2
    assert sweep.stale_game_hours() == 3
    assert sweep.stale_game_after() == timedelta(hours=3)
    assert sessions._max_result_bytes() == 2048
    assert streak.lookback_days() == 7
    assert health._db_ping_timeout() == 1.5


def test_apple_replay_window_default_comes_from_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    import asyncio
    from datetime import UTC, datetime, timedelta
    from types import SimpleNamespace

    from purchases import _common, apple_notifications

    monkeypatch.setattr(_common, "_settings", Settings.isolated(APPLE_REPLAY_WINDOW_HOURS=72))
    starts: list[datetime] = []

    class _Client:
        async def get_notification_history(self, token, request, **_kw):
            starts.append(request.startDate)
            return SimpleNamespace(notificationHistory=[], hasMore=False, paginationToken=None)

    verifier = SimpleNamespace(
        has_api=True, api_environments=lambda: ["Sandbox"], api_client=lambda _env: _Client()
    )
    now = datetime(2026, 1, 10, tzinfo=UTC)
    asyncio.run(apple_notifications.replay_notification_history(verifier, lambda: None, now=now))
    assert starts == [int((now - timedelta(hours=72)).timestamp() * 1000)]


def test_token_ttl_setting_sets_the_token_expiry(monkeypatch: pytest.MonkeyPatch) -> None:
    from datetime import UTC, datetime, timedelta

    import entitlements.service as ent

    monkeypatch.setattr(ent, "_settings", Settings.isolated(ENTITLEMENT_TOKEN_TTL_HOURS=2))
    before = datetime.now(UTC)
    _token, exp = ent.issue_token("sid", [])
    assert (
        timedelta(hours=2) - timedelta(seconds=5) <= exp - before <= timedelta(hours=2, seconds=5)
    )


def test_max_guesses_stays_a_game_rule() -> None:
    from daily_word.progress import MAX_GUESSES

    assert MAX_GUESSES == 6
    assert not any("guess" in name for name in Settings.model_fields)


def test_max_result_bytes_cap_fits_inside_the_games_body_cap() -> None:
    """A result at the cap must still pass the /games request-body limit (no 413)."""
    from middleware.body_size import LARGE_BODY_BYTES

    cap = Settings.model_fields["max_result_bytes"].metadata
    le = next(m.le for m in cap if getattr(m, "le", None) is not None)
    assert le * 2 <= LARGE_BODY_BYTES
