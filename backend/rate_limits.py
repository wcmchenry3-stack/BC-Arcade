"""Every rate-limit string in the API, in one table (#2997).

Routes pass these constants to ``@limiter.limit(...)``; no route spells a limit
literal. ``ROUTE_LIMITS`` at the bottom maps each handler to the limits it must
carry, and ``tests/test_rate_limit_coverage.py`` checks the registered
decorators against it, so a new route without an entry, or a decorator that
drifts from this file, fails the suite.

Named ``rate_limits`` rather than ``limits`` because the third-party ``limits``
package (slowapi's backend, imported by ``purchases/router.py``) would be
shadowed by a top-level ``backend/limits.py``.

Two kinds of key (see ``limiter.py``):
  * session - ``key_func=session_key``: the ``X-Session-ID`` of an authenticated route.
  * ip      - the default ``_real_ip`` key (unauthenticated routes, and IP backstops
              stacked on a session limit because the session id is self-asserted, #2217).

Two routes that share a value but belong to different families keep separate
constants, so tuning one never silently moves the other. Values are strings in
the ``limits`` syntax; ``a;b`` means both windows apply.
"""

from typing import NamedTuple

# --- Games: catalog, boards, rank -------------------------------------------------
# GET /games/catalog. Public, IP-keyed. A constant so the rate-limit test derives its
# request count from the configured limit instead of duplicating it.
CATALOG_RATE_LIMIT = "60/minute"
# PATCH /games/catalog/{id} (admin token), session-keyed.
CATALOG_ADMIN_SESSION_RATE_LIMIT = "30/minute"
# Generic leaderboard (#2618). Keyed by session, with a looser per-IP backstop so
# rotating the X-Session-ID header doesn't lift the limit (#2217).
LEADERBOARD_SESSION_RATE_LIMIT = "60/minute"
LEADERBOARD_IP_RATE_LIMIT = "300/minute"
# GET /games/{id}/rank (#2677): a read, limited like the leaderboard.
RANK_SESSION_RATE_LIMIT = "60/minute"
RANK_IP_RATE_LIMIT = "300/minute"

# --- Games: a player's own game sessions (session-keyed) --------------------------
# GET /games (my games list).
GAMES_LIST_SESSION_RATE_LIMIT = "60/minute"
# GET /games/{id} (one game's detail).
GAMES_DETAIL_SESSION_RATE_LIMIT = "60/minute"
# POST /games (start a game).
GAMES_CREATE_SESSION_RATE_LIMIT = "10/minute"
# POST /games/{id}/events (batched event append).
GAMES_EVENTS_SESSION_RATE_LIMIT = "60/minute"
# POST /games/{id}/complete (server-side scoring).
GAMES_COMPLETE_SESSION_RATE_LIMIT = "10/minute"

# --- Players (session-keyed, like the games write routes) -------------------------
PLAYER_READ_RATE_LIMIT = "60/minute"
PLAYER_WRITE_RATE_LIMIT = "10/minute"
# On top of the write limit: rerolling is a name picker, not a stream of fresh public
# identities (a reroll every few seconds would let one player cycle through names on
# the boards).
PLAYER_REROLL_RATE_LIMIT = "5/hour"

# --- Account, stats, entitlements, logs (session-keyed) ---------------------------
# DELETE /me (account deletion).
ME_DELETE_SESSION_RATE_LIMIT = "5/minute"
# GET /stats/me.
STATS_SESSION_RATE_LIMIT = "60/minute"
# GET /entitlements (premium JWT issue).
ENTITLEMENTS_SESSION_RATE_LIMIT = "30/minute"
# POST /logs (bug-log batches).
LOGS_SESSION_RATE_LIMIT = "30/minute"

# --- Purchases (owner-tunable, IAP.md section 8.2) --------------------------------
# POST /purchases/{apple,google}: per session, per IP, and per store account.
PURCHASE_SESSION_RATE_LIMIT = "20/minute"
PURCHASE_IP_RATE_LIMIT = "30/minute;200/day"
# Applied in code (purchases/router.py), not by a decorator.
PURCHASE_STORE_KEY_RATE_LIMIT = "10/hour;30/day"
# Apple sends from its own address ranges; a 429 loses nothing (Apple retries, and the
# notification-history replay backfills).
APPLE_NOTIFICATION_IP_RATE_LIMIT = "300/minute"
# Pub/Sub pushes from Google's ranges; a 429 loses nothing (Pub/Sub retries, and the
# daily voided-purchases poll backfills revocations).
GOOGLE_NOTIFICATION_IP_RATE_LIMIT = "300/minute"

# --- Daily Word (free game, IP-keyed unless noted) --------------------------------
# GET /daily-word/today.
DAILY_WORD_TODAY_IP_RATE_LIMIT = "60/minute"
# POST /daily-word/guess per session (_guess_key).
DAILY_WORD_GUESS_SESSION_RATE_LIMIT = "20/hour"
# POST /daily-word/guess per IP: a deliberately generous volume backstop, because
# _real_ip resolves to a carrier NAT address many subscribers share. Not a security
# boundary (a determined caller needs server-issued sessions, #1047).
DAILY_WORD_GUESS_IP_RATE_LIMIT = "1200/hour"
# GET /daily-word/answer.
DAILY_WORD_ANSWER_IP_RATE_LIMIT = "20/minute"

# --- Daily Challenge --------------------------------------------------------------
# GET /daily-challenge/today (public, IP-keyed).
DAILY_CHALLENGE_TODAY_IP_RATE_LIMIT = "60/minute"
# GET /daily-challenge/status (session-keyed).
DAILY_CHALLENGE_STATUS_SESSION_RATE_LIMIT = "60/minute"

# --- Sort (free game) -------------------------------------------------------------
# GET /sort/levels (public, IP-keyed).
SORT_LEVELS_IP_RATE_LIMIT = "60/minute"

# --- Health and diagnostics (public, IP-keyed) ------------------------------------
# GET /health: Render's health check, no DB.
HEALTH_IP_RATE_LIMIT = "120/minute"
# GET /health/db: the UptimeRobot poll, runs SELECT 1.
HEALTH_DB_IP_RATE_LIMIT = "30/minute"
# GET /debug/error: registered only when ENVIRONMENT=test (the sentry-check job).
DEBUG_ERROR_IP_RATE_LIMIT = "5/minute"

# Key kinds a limit can use. ``tests/test_rate_limit_coverage.py`` maps each to the
# real key function (``limiter.session_key``, ``limiter._real_ip``,
# ``daily_word.router._guess_key``) and checks the decorator uses it.
SESSION = "session"
IP = "ip"
GUESS = "guess"


class Rule(NamedTuple):
    limit: str
    key: str


# Handler key ("<module>.<function>", slowapi's registry key) -> the limits that
# handler must carry, one entry per stacked ``@limiter.limit``. Order is irrelevant.
ROUTE_LIMITS: dict[str, tuple[Rule, ...]] = {
    "games.router.get_catalog": (Rule(CATALOG_RATE_LIMIT, IP),),
    "games.router.patch_game_type": (Rule(CATALOG_ADMIN_SESSION_RATE_LIMIT, SESSION),),
    "games.router.get_leaderboard": (
        Rule(LEADERBOARD_IP_RATE_LIMIT, IP),
        Rule(LEADERBOARD_SESSION_RATE_LIMIT, SESSION),
    ),
    "games.router.get_game_rank": (
        Rule(RANK_IP_RATE_LIMIT, IP),
        Rule(RANK_SESSION_RATE_LIMIT, SESSION),
    ),
    "games.router.list_my_games": (Rule(GAMES_LIST_SESSION_RATE_LIMIT, SESSION),),
    "games.router.get_game_detail": (Rule(GAMES_DETAIL_SESSION_RATE_LIMIT, SESSION),),
    "games.router.create_game": (Rule(GAMES_CREATE_SESSION_RATE_LIMIT, SESSION),),
    "games.router.append_events": (Rule(GAMES_EVENTS_SESSION_RATE_LIMIT, SESSION),),
    "games.router.complete_game": (Rule(GAMES_COMPLETE_SESSION_RATE_LIMIT, SESSION),),
    "players.router.get_my_player": (Rule(PLAYER_READ_RATE_LIMIT, SESSION),),
    "players.router.put_my_player": (Rule(PLAYER_WRITE_RATE_LIMIT, SESSION),),
    "players.router.reroll_my_player": (
        Rule(PLAYER_WRITE_RATE_LIMIT, SESSION),
        Rule(PLAYER_REROLL_RATE_LIMIT, SESSION),
    ),
    "players.router.delete_my_player": (Rule(PLAYER_WRITE_RATE_LIMIT, SESSION),),
    "me.router.delete_me": (Rule(ME_DELETE_SESSION_RATE_LIMIT, SESSION),),
    "stats.router.get_my_stats": (Rule(STATS_SESSION_RATE_LIMIT, SESSION),),
    "entitlements.router.get_entitlements": (Rule(ENTITLEMENTS_SESSION_RATE_LIMIT, SESSION),),
    "logs.router.append_bug_logs": (Rule(LOGS_SESSION_RATE_LIMIT, SESSION),),
    "purchases.router.post_apple_purchase": (
        Rule(PURCHASE_IP_RATE_LIMIT, IP),
        Rule(PURCHASE_SESSION_RATE_LIMIT, SESSION),
    ),
    "purchases.router.post_google_purchase": (
        Rule(PURCHASE_IP_RATE_LIMIT, IP),
        Rule(PURCHASE_SESSION_RATE_LIMIT, SESSION),
    ),
    "purchases.router.post_apple_notification": (Rule(APPLE_NOTIFICATION_IP_RATE_LIMIT, IP),),
    "purchases.router.post_google_notification": (Rule(GOOGLE_NOTIFICATION_IP_RATE_LIMIT, IP),),
    "daily_word.router.get_today": (Rule(DAILY_WORD_TODAY_IP_RATE_LIMIT, IP),),
    "daily_word.router.post_guess": (
        Rule(DAILY_WORD_GUESS_SESSION_RATE_LIMIT, GUESS),
        Rule(DAILY_WORD_GUESS_IP_RATE_LIMIT, IP),
    ),
    "daily_word.router.get_answer_route": (Rule(DAILY_WORD_ANSWER_IP_RATE_LIMIT, IP),),
    "daily_challenge.router.get_today": (Rule(DAILY_CHALLENGE_TODAY_IP_RATE_LIMIT, IP),),
    "daily_challenge.router.get_status": (
        Rule(DAILY_CHALLENGE_STATUS_SESSION_RATE_LIMIT, SESSION),
    ),
    "sort.router.get_levels": (Rule(SORT_LEVELS_IP_RATE_LIMIT, IP),),
    "routes.health.health": (Rule(HEALTH_IP_RATE_LIMIT, IP),),
    "routes.health.health_db": (Rule(HEALTH_DB_IP_RATE_LIMIT, IP),),
    "routes.debug.trigger_error": (Rule(DEBUG_ERROR_IP_RATE_LIMIT, IP),),
}

# Registered only under ENVIRONMENT=test, so absent from the app in other runs.
CONDITIONAL_ROUTES = frozenset({"routes.debug.trigger_error"})
