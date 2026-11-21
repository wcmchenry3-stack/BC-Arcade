# Daily Challenge

Daily Challenge is BC Arcade's cross-game daily activity: **three goals per local day**, with Daily Word always present and two goals drawn from other eligible games.

This document is the current product/system source of truth. The implementation lives in `backend/daily_challenge/` and `frontend/src/game/daily_challenge/`.

## 1. Daily structure

Each challenge has exactly three goals:

1. Daily Word. Its goal is always "complete today's word" (win or lose); it never asks for a win or a guess limit.
2. A goal from one other eligible game.
3. A goal from a different eligible game.

The two rotating non-Daily-Word games do not repeat either of the previous day's two rotating games.

Each game other than Daily Word owns three goal definitions (Daily Word has the one "complete" goal in every slot):
- easy;
- medium;
- hard.

The selected tiers rotate by day for the other two games, so a challenge mixes difficulty instead of always choosing the same tier for the same slot. Because Daily Word is never win-dependent, it does not use up the day's one win-dependent slot, so either of the other two games can hold it.

Days already frozen before this rule (#3991) keep their stored goals. An old Daily Word "win" or "win within 4 guesses" goal still rebuilds from its stored spec and is evaluated as before, so past streak days do not change.

At most one selected goal per day is allowed to be luck/win-dependent. If a second selected goal would require a win, it falls back to that game's easy goal, which is required to be non-win-dependent.

## 2. Current eligible goal pool

The current free goal pool contains:

- Daily Word
- 2048
- Solitaire
- Bottle Sort
- FreeCell
- Yacht
- Sudoku (added by #2949 after it went free in migration 0023)

A guard test (`test_free_pool_matches_the_non_premium_game_types`) fails if `FREE_GOAL_POOL` and the non-premium `game_types` rows ever differ.

Sudoku's goals are difficulty-agnostic: solve a puzzle (`solved`, not luck-dependent, since an unsolved puzzle reports `won: false` and is filtered out as abandoned), `final_score >= 180` and `final_score >= 280` (score = difficulty base 100/200/300 minus 10 per error, so the thresholds imply medium and hard puzzles). Targets are to be tuned post-launch.

Bottle Sort's goals are `final_score` (highest level solved) at least 3 / 8 / 15 (easy / medium / hard, set for the old 23 levels) while `SORT_CATALOG_EDITION_ENFORCED` is off, and at least 10 / 30 / 60 (the middle of chapters 1 to 3 of the 120-level catalog) once it is on (#3728). The switch is the same one that resets the Sort leaderboard, because store builds from before the catalog top out at level 23 and could not reach 30 or 60. It is read at pick time (`template_for` passes it to the memoised `pick_template`), so it only affects days not yet frozen: a frozen day keeps the targets in its stored specs (`goal_from_spec` rebuilds from the spec, never the pool). A stopgap until the owner's pass over every game's goals.

Blackjack and Mahjong have goal definitions prepared in `PENDING_PREMIUM_GOALS`, but they are not in either live pool today.

**Disabled games.** `rotation()` in `backend/daily_challenge/definitions.py` skips every game in `DISABLED_GAMES` (`backend/entitlements/service.py`, mirroring the frontend list in `gameVisibility.ts`), so a disabled game never reaches a slate even if a pool lists it (`test_a_disabled_game_added_to_a_pool_never_reaches_a_slate`). `test_disabled_games_are_in_no_goal_pool_and_stay_premium` is the backstop that no pool lists one, and `test_disabled_games_match_the_frontend_list` keeps the two lists equal. The Home card also drops any goal for a game `isGameVisible` hides. The list is empty today: Cascade was on it from #3001 until its rework shipped (#3703).

**Cascade** is a premium game with no goals yet: like Hearts and Star Swarm, it has no goals in any pool or in `PENDING_PREMIUM_GOALS`. Its result block already carries what its goals will read: `won`, `max_tier` (0-10; 10 on a win) and the `duration_ms` column, and `_WON_WITHIN_FLOORS` gives any Cascade "won within" goal on `duration_ms` a 20 s floor (`CASCADE_MIN_WIN_MS`) so a forged quick win cannot pass. Its goals and their copy are tracked in #3945 and arrive with the premium goal pool (#2458); `test_cascade_is_no_longer_skipped_once_a_pool_lists_it` pins that the rotation will draw them.

`PREMIUM_GOAL_POOL` currently contains the same goal specs as `FREE_GOAL_POOL`, so the free and premium templates are presently identical. Broader premium/game-specific goal-pool work remains separate product backlog; this document describes the code that is live now.

## 3. How a day is selected

For a day that has never been frozen before:

- `definitions.py` uses the calendar day's ordinal plus `DAILY_CHALLENGE_SALT`;
- the salt deterministically shuffles the non-Daily-Word game rotation;
- the day advances two positions through that rotation (with an even-length rotation, the start also shifts by one place after every lap of half the rotation, so every neighbouring pair still occurs);
- goal tiers are selected deterministically from the same day/salt inputs.

The salt is environment-specific. Its purpose is to make the future schedule stable for the environment without making the complete future rotation trivially derivable from public source alone.

## 4. Frozen days

The scheduling formula is only a proposal for a day no one has seen yet.

The first request for a `(date, slate)` pair stores that day's selected goal specs in `daily_challenge_days`. Every later request for that date/slate reads the frozen row instead of recomputing it.

This means later changes to:
- goal targets;
- goal pools;
- the salt;
- scheduling logic

affect only days that have not yet been frozen.

Each frozen goal is stored as a self-contained spec rather than a pointer back into the current goal pool, so a historical day can still be replayed after a live goal is retuned or removed.

### Per-install pinned assignments (#3992)

The same idea also applies per install. The first `/status` or `/upcoming` request that needs a `(session, local date)` asks `service.pick_for_install` for that install's goals and stores them in `daily_challenge_assignments` (`assignments.get_or_pin`). Every later request for that install and day, on any device, and the streak's replay of that day return the stored row unchanged.

- **What the pick returns today:** the shared frozen template above, for the slate `resolve_slate` chooses, and no bonus goal. So in this release every install still sees the same goals as everyone else; the table is the plumbing that personal targets (#3993), game selection (#3994) and the bonus goal (#3995) build on.
- **The slate is pinned with the day.** A purchase part-way through a day no longer swaps that day's goals; it applies from the next day not yet pinned. Invisible while the free and premium pools are identical.
- **Only installs that have played pin.** Before inserting, `get_or_pin` checks (one `EXISTS` on `games.session_id`, run only when a requested day is not pinned yet) that the session has at least one game row. A session with none is served the pick (the shared template, as a cold start would get) and nothing is written; pinning starts on the first request after its first game has synced. This is the write ceiling: a made-up session id cannot create assignment rows without first creating game rows. A pinned day's read stays one SELECT.
- **Concurrent first requests** cannot store two different rows: the primary key is `(session_id, local_date)` and the insert is `ON CONFLICT DO NOTHING`, after which the stored row is read back and served.
- **At most 3 days ahead:** only today..today+2 in the requesting client's local calendar are ever pinned (`MAX_DAYS_AHEAD`); `get_or_pin` refuses any other day.
- **Encoding:** each goal is `[game_type, kind, target, tier]` (the spec `goal_from_spec` rebuilds) in compact JSON text; the session id is a native `uuid`; `template_id` and `slate` are stored only when they differ from the defaults (an id derived from the goals, the free slate), so they are NULL and free for every real day. About 250 B a row on disk including the primary-key index (measured on Postgres 16: 193 B heap + 54 B index, 129 B of it goal text; about 15 MB held at 60 days per 1,000 daily players, 150 MB per 10,000; see [DATA-INVENTORY.md §2d](DATA-INVENTORY.md#2d-daily-challenge-assignments-3992)).
- **Retention:** a daily batched prune (`daily_challenge/retention.py`, started by `jobs.lifespan`) deletes rows whose `local_date` is more than `DAILY_CHALLENGE_ASSIGNMENT_RETENTION_DAYS` (default `STREAK_LOOKBACK_DAYS`, 60) before today in UTC. A pruned day is replayed from the shared template.
- **Delete My Data** (`DELETE /me`) deletes the install's rows.
- **Kill switch:** `DAILY_CHALLENGE_PERSONALIZED=false` (default true) serves every install the shared frozen template, exactly as before this table existed: no row is read or written, by the routes or the streak. Rows already stored stay until retention or `DELETE /me` removes them.

## 5. Goal evaluation

A goal is evaluated against **one finished game row** of the matching game type.

The evaluator sees a facts envelope made from:
- the game's validated result fields merged into `games.metadata`;
- `final_score`, when present;
- `duration_ms`, when present.

A goal is complete when any eligible game of that type during the local day satisfies its predicate.

Examples of goal shapes include:
- complete a puzzle/run;
- win;
- reach at least a score/level/move count;
- win within a move/guess/time limit.

### Abandoned games

**Abandoned games do not satisfy Daily Challenge goals.**

The service filters abandoned session rows before goal evaluation. This applies even to threshold/progress goals that could otherwise be satisfied by progress made before the player quit.

This rule is intentionally stricter than simply trusting a result block's `won` flag.

## 6. Current goal vocabulary

The wire contract sends:
- `game_type`;
- `kind`;
- optional numeric `target`;
- goal id;
- completion status on the session-scoped route.

It does **not** send player-facing English copy.

The frontend localizes each goal from `game_type + kind + target`. If a newer backend sends a goal kind the installed client does not know, the card falls back to generic "Play {game}" wording rather than exposing a raw translation key.

## 7. Free and premium slates

The system has two slate names: `free` and `premium`.

The public `/today` route has no player/session context, so it always returns the free slate.

The session-scoped `/status` route can resolve a premium slate. The rule is:

- inspect the premium games named by that day's premium template;
- the session receives the premium slate only if it owns **every** named premium game;
- otherwise it receives the free slate;
- the development entitlement override counts named premium games as owned.

A partly entitled player is never intentionally handed a challenge containing a game they cannot open.

Today the two live pools are identical, so the slate distinction does not change the goals returned. The architecture remains in place for future premium-specific goal pools.

## 8. API routes

| Route | Scope | Purpose | Limit |
| --- | --- | --- | ---: |
| `GET /daily-challenge/today` | public / IP-keyed | Free slate for the local day, without player progress | 60/min |
| `GET /daily-challenge/upcoming` | IP-keyed; session-aware | Today, today+1 and today+2 (`{"days": [...]}`, each shaped like `/today`). With a valid `X-Session-ID`: that install's pinned assignment for each day (§4). Without one: the shared free slate | 60/min |
| `GET /daily-challenge/status` | `X-Session-ID` | This install's pinned goals for today (§4) plus completion/progress | 60/min |

`/upcoming` takes the same `tz_offset_minutes` (-840..840) as the other routes and resolves each day from the client's local calendar. Without a session (or a header that is not a UUID, or with the kill switch off) it is the public route it always was: reading a day freezes it through `get_or_create_templates`, so a second read, another device, and a later `/today` all return the same goals. With a session it pins each day for that install, so `/status` later serves today exactly as `/upcoming` cached it. The app's shared HTTP client sends `X-Session-ID` on every request, `/upcoming` included. Scoring is unchanged: a completion is still checked against its own local day when it syncs.

Every day payload (`/today`, each `/upcoming` day, `/status`) carries a nullable `bonus` goal (`{id, game_type, kind, target}` or `null`), reserved for the optional bonus goal (#3995). It is always `null` until then, it is never one of `goals`, it never counts toward `completed_goals` or the streak, and older app builds ignore it (the client's wire normalizer reads only the fields it knows).

The Home card treats `/status` as authoritative because a future premium session's goal list can differ from `/today`, not merely its completion flags.

If `/status` reaches the server but fails in a way the client can recover from, the client can fall back to `/today` and show the day's free goals without progress.

A network failure is not followed by a second doomed `/today` request; the UI moves to its offline/retry state.

## 9. Home-screen behavior

Daily Challenge appears near the top of Home.

The card:
- shows three localized goal chips and completion marks;
- shows done/total progress;
- shows a completion note when all visible goals are done;
- filters out goals for games hidden in the current build;
- renders nothing for a non-network server-side unavailable state the player cannot act on;
- shows a retryable offline message when the device/network is the actionable problem and no goals are cached for today (the shared 3-day message once the cached goals have run out);
- holds a loading footprint while fetching so the game grid does not jump.

The card holds a challenge only for the local day it was fetched for. The hook re-checks the local day on foreground, screen focus and just after local midnight; once the day has changed, yesterday's challenge is never shown as today's. Online it refetches; offline it shows that day's cached goals (below), or the retryable offline message when it has none (#2924).

Offline game completions can count later after the shared game-session queue uploads them.

### Offline play (#3228, #3043)

While online, the hook (`useDailyChallenge.ts`) saves goals on the device (`offlineCache.ts`), so an offline player still gets each day's goals for up to 3 days:

- **`daily_challenge_upcoming_v1`**: the `/upcoming` answer (this install's pinned goals for today, today+1 and today+2, §4), read at most once per local day, after the server answers a refresh.
- **`daily_challenge_status_v1`**: the last `/status` answer of the day: this install's goals with the ones already met. Since #3992 `/upcoming` and `/status` serve the same pinned goals for a day, so days 2 and 3 from `/upcoming` are the goals `/status` will show on those days. The server re-checks every completion when it syncs.

Offline (or after a network failure), for the device's current local date:

- **Goals:** today's cached `/status` (or the in-memory one fetched earlier today), else that date's `/upcoming` entry. Days are keyed by their date; the server freezes each date's goals, so changing time zone only changes which date is "today".
- **Progress:** goals already met in the cached `/status`, plus any goal met by a game still in the device's queue (`pendingGamesStore`) that finished on that local date by the device's current UTC offset (the same offset `/status` is asked with). `localProgress.ts` builds each game's facts like the server does (result block, non-null creation metadata, `final_score`, `duration_ms`), skips abandoned games, and mirrors the per-kind checks in `definitions.py`. A kind it does not know is never met locally.
- **Sync:** the queued games upload through `SyncWorker` as usual and are scored by the server against the local day of their device `completed_at`, so a day played offline on that day counts toward the streak once it syncs.
- **Back online:** the local progress stays on the card until the first `/status` answer, which then replaces it. Online, the cache is never shown.
- **Run out:** when the 3-day window is exhausted (`offlineWindowExhausted`, `lastConnected.ts`), or goals were cached but none cover today, the card shows the shared message (`common:offline.windowExhausted`), plus `common:offline.windowExhaustedStreak` when the last known streak is above 0. A device that never cached anything keeps the plain offline message.
- **No catch-up:** only today's entry is ever used; a past day's goals are never shown or completed.

Known gap: a game that synced after the last `/status` read and before the device went offline is in neither the cached `/status` nor the queue, so it shows as not done until the device reconnects. The hook reads `/status` on every Home focus (after flushing the queue), so in practice this is the game finished just before losing the connection without returning to Home.

Delete My Data clears both keys.

## 10. Streak

The app-wide streak is derived from Daily Challenge history; there is no mutable streak counter table.

A calendar day qualifies when the player met **at least 2 of that day's 3 goals**.

The streak scores each day on the goals that install was served: its pinned assignment (§4) when one exists, else the shared frozen template (days before #3992, days pruned by retention, or every day while `DAILY_CHALLENGE_PERSONALIZED` is off). Only the core goals count; the bonus goal never does. The pinned rows for the whole window come from one query, so the query count stays fixed however long the lookback is. It walks backward over those days:

- If today already qualifies, the run ends today.
- If today does not yet qualify, today is treated as unfinished rather than failed, and the run may end yesterday.
- Once an earlier day fails to qualify, the streak stops.
- Lookback is capped at 60 days; a returned value of 60 means "at least 60" and is displayed as 60+.

The streak is returned on `GET /stats/me` alongside Arcade XP/level, but streak and XP are separate systems. Daily Challenge currently grants no direct XP bonus.

## 11. Local day and timezone — current behavior

**Current implementation uses a UTC offset supplied by the client (`tz_offset_minutes`), not an IANA timezone id.**

For the live day:
- the client's current offset is applied to UTC to determine the local date;
- that same offset defines the day's UTC start/end window.

For streak replay:
- the same current offset is used across the entire lookback window.

### Known DST limitation

Because the server does not currently receive an IANA timezone, a daylight-saving transition inside the streak lookback can move a game completed near local midnight onto the neighboring reconstructed day.

That is a known limitation tracked by **#2478**. Do not document IANA/DST-correct behavior as current until that implementation lands.

When #2478 is implemented, this section must be updated as part of that change.

## 12. Historical replay limitations

Two current approximations matter when interpreting old streak days:

- **Current entitlements are used when replaying past days.** Once free/premium goal pools actually diverge, gaining or losing entitlement can change which historical slate is used for the replay window.
- **Game history is client-reported within the shared trust model.** Daily Challenge/streak is a lightweight accomplishment count, not a prize or financial system. Revisit anti-tamper assumptions before attaching valuable rewards.

## 13. Daily Challenge vs Daily Word

These are related but different features:

- **Daily Word** is one game's daily puzzle.
- **Daily Challenge** is the cross-game three-goal feature.

Daily Word is always one of the three Daily Challenge goals, but completing/playing Daily Word still follows Daily Word's own game/session rules.

## 14. Ownership and change rules

- `definitions.py` owns scheduling policy and live goal specs.
- `schedule.py` owns day/slate freezing.
- `assignments.py` owns per-install pinning and its kill switch; `retention.py` its prune.
- `service.py` owns current-day evaluation, slate resolution and `pick_for_install`.
- `streak.py` owns the streak calculation.
- `router.py` owns the HTTP surface.
- the frontend Daily Challenge client owns wire normalization/fallback;
- the card owns presentation/localization, not goal semantics.

When changing behavior:
1. update the owning code/tests;
2. update this document;
3. do not duplicate the live rules into the release plan or Architecture;
4. keep historical release notes as historical evidence.

For shared game-session/offline behavior see [GAME-CONTRACT.md](GAME-CONTRACT.md) and [ARCHITECTURE.md](ARCHITECTURE.md).
