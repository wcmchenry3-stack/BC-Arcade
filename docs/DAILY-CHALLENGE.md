# Daily Challenge

Daily Challenge is BC Arcade's cross-game daily activity: **three goals per local day**, with Daily Word always present and two goals drawn from other eligible games.

This document is the current product/system source of truth. The implementation lives in `backend/daily_challenge/` and `frontend/src/game/daily_challenge/`.

## 1. Daily structure

Each challenge has exactly three goals:

1. Daily Word.
2. A goal from one other eligible game.
3. A goal from a different eligible game.

The two rotating non-Daily-Word games do not repeat either of the previous day's two rotating games.

Each game owns three goal definitions:
- easy;
- medium;
- hard.

The selected tiers rotate by day, so a challenge mixes difficulty instead of always choosing the same tier for the same slot.

At most one selected goal per day is allowed to be luck/win-dependent. If a second selected goal would require a win, it falls back to that game's easy goal, which is required to be non-win-dependent.

## 2. Current eligible goal pool

The current free goal pool contains:

- Daily Word
- 2048
- Solitaire
- Bottle Sort
- FreeCell
- Yacht

Blackjack and Mahjong have goal definitions prepared in `PENDING_PREMIUM_GOALS`, but they are not in either live pool today.

`PREMIUM_GOAL_POOL` currently contains the same goal specs as `FREE_GOAL_POOL`, so the free and premium templates are presently identical. Broader premium/game-specific goal-pool work remains separate product backlog; this document describes the code that is live now.

## 3. How a day is selected

For a day that has never been frozen before:

- `definitions.py` uses the calendar day's ordinal plus `DAILY_CHALLENGE_SALT`;
- the salt deterministically shuffles the non-Daily-Word game rotation;
- the day advances two positions through that rotation;
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
| `GET /daily-challenge/status` | `X-Session-ID` | This session's resolved slate plus completion/progress | 60/min |

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
- shows a retryable offline message when the device/network is the actionable problem;
- holds a loading footprint while fetching so the game grid does not jump.

Offline game completions can count later after the shared game-session queue uploads them.

## 10. Streak

The app-wide streak is derived from Daily Challenge history; there is no mutable streak counter table.

A calendar day qualifies when the player met **at least 2 of that day's 3 goals**.

The streak walks backward over frozen daily templates:

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
- `service.py` owns current-day evaluation and slate resolution.
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
