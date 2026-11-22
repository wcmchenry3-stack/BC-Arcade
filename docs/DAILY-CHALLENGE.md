# Daily Challenge

Daily Challenge is BC Arcade's cross-game daily activity: **three goals per local day**, with Daily Word always present and two goals drawn from other eligible games. An install with history gets **its own** two goals, from the games it plays, with targets set from its own results (#3993, #3994); a new install gets the shared template.

This document is the current product/system source of truth. The implementation lives in `backend/daily_challenge/` and `frontend/src/game/daily_challenge/`. The reasoning behind the design, and the shipped-story record, are in [DAILY-CHALLENGE-STRATEGY.md](DAILY-CHALLENGE-STRATEGY.md) (epic #3990); where the two differ, this document is right.

## 1. Daily structure

Each challenge has exactly three **core** goals (and, on a personal day, one optional bonus goal, below):

1. Daily Word. Its goal is always "complete today's word" (win or lose); it never asks for a win or a guess limit.
2. A goal from an eligible game.
3. A second goal, from a different eligible game where possible.

There are two ways a day's three core goals are chosen (`service.pick_for_install`):

- **Personal pick** (#3993, #3994), for an install with at least 3 finished games of the games with personal goal specs (2048, Solitaire, FreeCell, Bottle Sort, Sudoku, Yacht, and the premium games Blackjack, Cascade, Hearts, Mahjong and Star Swarm; Daily Word does not count), at least one of them in the last `DAILY_CHALLENGE_AFFINITY_DAYS` (14), and continuous recent play (below): goals 2 and 3 come from the games the install plays, each with a personal target (§2a, §3a). This is what an active player sees.
- **Shared template**, for every other install (a new install, or one back after a gap) and for everyone while the kill switch is off: the same three goals for every install, drawn from the per-game easy / medium / hard goals below (§2, §3). When such an install's day is pinned it is pinned as **exactly** the shared template (`shared_for_install`).

A personal day may also carry one optional **bonus goal** beside the three core goals (#3995, §3b). It never counts toward the streak, `completed_goals` or "day complete", and a shared-template day never has one.

**Goals already shown never change.** An install can be shown a day's goals before that day is pinned: `assignments.may_pin` refuses to pin while the install has no `games` row created in the last `DAILY_CHALLENGE_PIN_RECENT_PLAY_HOURS` (48), so a brand-new or lapsed install is served the shared template unpinned, and the device caches it (`/upcoming` covers today..today+2). So a day is picked personally only if that could not have happened (`InstallHistory.always_pinnable`, `personal.serves_shared`): from the earliest instant any client could have asked for the day (the start of local day − 2 in the easternmost time zone, UTC+14) until now, the install must have had a game created within the 48 h window before every instant. That needs a game created in the 48 h before that instant, no gap of more than 48 h between consecutive games since, and one in the last 48 h. Otherwise the day is the shared template, the same goals an unpinned request would have shown. A brand-new install therefore gets the shared template for its first few days, including the days its first `/upcoming` cached, and a lapsed install for the day it comes back and the two after. Exceptions (accepted, no extra state is kept for them):

- **Storage-guard pauses.** `may_pin` also refuses while storage is over budget. That pause is automatic, not only an operator's: storage crossing the replay recorder's 90 % turn-down point, or a size reading that failed (remembered as over budget for 10 minutes, `SIZE_FAILURE_TTL`). During such a pause a day is served unpinned; once pinning resumes, that day can be pinned with personal goals, so the card can change mid-day.
- **The `/today` fallback.** When `/status` fails with a non-network error, the app may show the shared `/today` goals for the day (not cached). The next successful `/status` may pin personal goals for that day.
- **The kill switch.** Days served while `DAILY_CHALLENGE_PERSONALIZED` was off can be pinned with personal goals once it is back on.

**Shared template rules.** Each game other than Daily Word owns three goal definitions (Daily Word has the one "complete" goal in every slot):

- easy;
- medium;
- hard.

The two rotating non-Daily-Word games do not repeat either of the previous day's two rotating games. The selected tiers rotate by day for the other two games, so a challenge mixes difficulty instead of always choosing the same tier for the same slot. Because Daily Word is never win-dependent, it does not use up the day's one win-dependent slot, so either of the other two games can hold it.

Days already frozen before this rule (#3991) keep their stored goals. An old Daily Word "win" or "win within 4 guesses" goal still rebuilds from its stored spec and is evaluated as before, so past streak days do not change.

At most one selected goal per day is allowed to be luck/win-dependent (both picks). If a second selected goal would require a win, it falls back to that game's easy goal, which is required to be non-win-dependent. Since #3993 no free goal is luck-dependent: Solitaire and FreeCell deal only provably solvable deals, so their wins are skill (`SOLVABLE_DEAL_GAMES`), like a Sudoku solve.

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

2048's goals are `final_score` at least 500, reach tile 512 (`highest_tile`), and `final_score` at least 2,500 (easy / medium / hard).

Sudoku's goals are difficulty-agnostic: solve a puzzle (`solved`, not luck-dependent, since an unsolved puzzle reports `won: false` and is filtered out as abandoned), `final_score >= 180` and `final_score >= 280` (score = difficulty base 100/200/300 minus 10 per error, so the thresholds imply medium and hard puzzles). Targets are to be tuned post-launch.

Bottle Sort's goals are `final_score` (highest level solved) at least 3 / 8 / 15 (easy / medium / hard, set for the old 23 levels) while `SORT_CATALOG_EDITION_ENFORCED` is off, and at least 10 / 30 / 60 (the middle of chapters 1 to 3 of the 120-level catalog) once it is on (#3728). The switch is the same one that resets the Sort leaderboard, because store builds from before the catalog top out at level 23 and could not reach 30 or 60. It is read at pick time (`template_for` passes it to the memoised `pick_template`), so it only affects days not yet frozen: a frozen day keeps the targets in its stored specs (`goal_from_spec` rebuilds from the spec, never the pool). A stopgap until the owner's pass over every game's goals. These absolute targets are the shared template's only (what a new install sees); a personal pick gives Sort the relative "solve _N_ new levels" goal instead (§2a, #4028).

Solitaire's goals are win / win in at most 150 moves / win in at most 120 moves, and FreeCell's win / 130 / 100 (#3993). The old "make 10 moves" / "make 5 moves" easy goals are gone: these games have no loss, so a finished row only exists for a win and those goals needed one anyway. Days frozen with them still rebuild from their stored specs.

Yacht's goals are `final_score` at least 100 / 175 / 250; abandoned games never count (the service filters them).

Mahjong has shared-template goal definitions prepared in `PENDING_PREMIUM_GOALS`, but they are not in either live pool today. Blackjack's old hand-count goals (play 3 hands, win 3 hands, finish a session up on chips) were removed from it in #3996; days frozen or pinned with them still rebuild through `goal_from_spec`.

**Disabled games.** `rotation()` in `backend/daily_challenge/definitions.py` skips every game in `DISABLED_GAMES` (`backend/entitlements/service.py`, mirroring the frontend list in `gameVisibility.ts`), so a disabled game never reaches a slate even if a pool lists it (`test_a_disabled_game_added_to_a_pool_never_reaches_a_slate`). `test_disabled_games_are_in_no_goal_pool_and_stay_premium` is the backstop that no pool lists one, and `test_disabled_games_match_the_frontend_list` keeps the two lists equal. The Home card also drops any goal for a game `isGameVisible` hides. The list is empty today: Cascade was on it from #3001 until its rework shipped (#3703).

**The premium games** (Blackjack, Cascade, Hearts, Mahjong, Star Swarm) have goals in the personal pick only (#3996, §2a), not in any pool. `_WON_WITHIN_FLOORS` gives a Cascade "won within" goal on `duration_ms` a 20 s floor (`CASCADE_MIN_WIN_MS`), and a Mahjong "clear within" goal a 36 s floor (`MIN_CLEAR_MS`, #4033), so a forged quick win cannot pass; `test_cascade_is_no_longer_skipped_once_a_pool_lists_it` pins that the rotation would draw Cascade if a pool listed it.

`PREMIUM_GOAL_POOL` still contains the same goal specs as `FREE_GOAL_POOL`, so the free and premium templates are identical, on purpose (#3996). Putting premium games in it would make `resolve_slate` name them for entitled installs on shared days (it picks the slate from the _computed_ templates while the frozen one is served, #2760, so a day already served could change), change every streak replay of an unfrozen day, and add frozen premium rows, all for a shared template that only an install without history sees. An entitled install with history gets premium goals from the personal pick, which does not use the pools. `test_the_shared_template_stays_the_free_pool` pins this.

### 2a. Personal goals per game (#3993)

`backend/daily_challenge/personal.py` (`GAME_SPECS`) gives each free game, and since #3996 each premium game, its goal types. Every one but Bottle Sort's is an existing goal kind with an absolute target, so installed app builds word it and the evaluator scores it with no per-player logic. Bottle Sort's is the relative `new_levels_at_least` kind (#4028, below).

| Game         | Goal types (kind)                                                                                                                           | Personal measure                                                        | Cold start (fewer than 3 finished games) |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------- |
| Daily Word   | complete today's word (`completed`), always goal 1                                                                                          | none                                                                    | same                                     |
| 2048         | score at least _T_ (`final_score_at_least`, stretch) · reach tile _T_ (`highest_tile_at_least`, skill)                                      | `final_score`; `highest_tile`                                           | score 500+                               |
| Solitaire    | win (`won`, finish) · win in at most _T_ moves (`won_moves_at_most`, stretch)                                                               | `moves` on wins                                                         | win                                      |
| FreeCell     | win (`won`) · win in at most _T_ moves (`won_moves_at_most`)                                                                                | `moves` on wins                                                         | win                                      |
| Bottle Sort  | solve _N_ new levels (`new_levels_at_least`, target _N_ = 1–3, progress, relative to the day's start, #4028)                                | new levels per day of play (per-day best `final_score`)                 | 1 new level                              |
| Sudoku       | solve a puzzle (`solved`, finish) · score at least _T_ (`final_score_at_least`, stretch)                                                    | `final_score` (difficulty base 100/200/300 minus 10 per error)          | solve                                    |
| Yacht        | score at least _T_ (`final_score_at_least`, stretch)                                                                                        | `final_score`                                                           | score 100+                               |
| Blackjack\*  | finish a run (`completed`) · win a run (`won`, luck-dependent) · finish at table _T_ or higher (`starting_chips_at_least`, 100 / 250 / 500) | `starting_chips` (the usual table, one up after a win there)            | finish a run                             |
| Cascade\*    | finish a game (`completed`) · win a game (`won`) · win in at most _T_ minutes (`won_duration_ms_at_most`)                                   | `duration_ms` on wins (whole minutes, floor 2, 20 s win floor)          | finish a game                            |
| Hearts\*     | finish a game (`completed`) · win a game (`won`, luck-dependent)                                                                            | none                                                                    | finish a game                            |
| Mahjong\*    | clear a board (`won`) · clear in at most _T_ minutes (`won_duration_ms_at_most`)                                                            | `duration_ms` on clears (whole minutes, floor 4; 36 s win floor, #4033) | clear a board                            |
| Star Swarm\* | finish a run (`completed`) · reach wave _T_ (`wave_reached_at_least`) · score at least _T_ (`final_score_at_least`)                         | `wave_reached`, `final_score` on the usual `difficulty_tier`            | finish a run                             |

\* premium: offered only to an install entitled to the game (`service.eligible_games`; the dev entitlement override counts as entitled), so a free install never gets one (`test_a_free_install_never_gets_a_premium_goal_whatever_its_history`). Hidden in store builds (`HIDDEN_GAMES`), where the card drops their goals.

**Target rule** (`personal_target`), from the install's last `DAILY_CHALLENGE_HISTORY_GAMES` (10) finished, non-abandoned games of that game before the day starts:

- the **median** of the measure, **stretched** by `DAILY_CHALLENGE_STRETCH_PCT` (12 %): up for "at least" goals, down for "at most" goals;
- **rounded**: 2048 score to 50, Sudoku score to 10, Yacht score and moves to 5, a 2048 tile to the nearest power of two;
- **capped at the personal best**, so beating it is never required (an "at least" target is at most the best, using the best `final_score` ever for score goals; an "at most" limit is at least the fewest moves in the recent wins);
- **floored** at the game's minimum: 2048 score 500 and Yacht 100 (the pool's easy tier), Sudoku 100, a 2048 tile 128, and 60 moves for a win; the floor wins over the cap for a player whose best is below it;
- **stepped down** after two consecutive misses: when, on the last two pinned days that held this (game, goal type) as a personal target, the install played the game and no finished game that day met it, the stretch goes the other way (at the default 12 %: median × 0.88 for "at least", × 1.12 for "at most"), a tile target halves and Sort asks one level fewer. A day the game was not played is not a miss, and a pinned goal equal to a shared-pool goal (a pinned shared-template day) is not counted; a personal target that happens to equal one is skipped too, which only delays a step-down.

**Premium goal notes (#3996).**

- **Finish and win read server-written facts.** The evaluator reads the result block and the two columns, never `games.outcome`, and the apps send no `won` (Blackjack, Hearts) or `is_complete` (Blackjack, Hearts, Star Swarm, Cascade) of their own. Each result model writes them from the completion's outcome (`backend/games/result_flags.py`): `is_complete` for every outcome but `abandoned`, `won` for `win` only (a Hearts tie is a finish, not a win), none when the completion reports no outcome. Mahjong's app sends `won` itself. Rows from before #3996 lack the flags and meet neither goal (they still feed the Blackjack table target through `starting_chips`).
- **Blackjack's "one table up".** No existing kind says "win a run at a table", so the goal is `starting_chips_at_least` on the table ladder: finish a run at table _T_ or higher, which is not luck-dependent. _T_ is the table above the usual one (the median `starting_chips` of the recent runs), stepping up only once a recent run at the usual table or higher reached its goal (the next table unlocks on a won run); otherwise the usual table; after two misses the usual table; the top table stays. Fewer than 3 runs: finish a run (at Beginner a table condition adds nothing).
- **Luck.** Blackjack and Hearts wins are luck-dependent (at most one such goal a day, as before); Cascade and Mahjong wins are skill (`SKILL_WIN_GAMES`: a deadlocked Mahjong board can be undone); finish goals, Star Swarm and the table goal never are.
- **Times** (Cascade, Mahjong) are whole minutes so the card shows `4 min`, not `4.25`. They use the wins only, are never below the fastest recent win, and are floored (Cascade 2 min, Mahjong 4 min). Both timed goals have a win floor against a forged clock: Cascade 20 s, Mahjong 36 s (`_WON_WITHIN_FLOORS`, #4033).
- **Star Swarm tiers.** Wave and score come from the recent runs on the install's usual `difficulty_tier` (the most common, the newest on a tie; none counts as `LieutenantJG`), need 3 runs there (else only the finish goal is offered), and the cap is the best of those runs. The goal itself is not tier-bound (no kind asks for one), so a run on an easier tier can meet it. Wave floor 3; score floor 1,000, rounded to 250.
- **`dev_affected` runs never count**: not in the history (as before), and since #3996 not in `/status` or the streak either.
- **Offline preview.** The Home card's offline progress (`localProgress.ts`) builds facts from the app's own result block, which has no `won` or `is_complete` for Blackjack, Hearts or Star Swarm. It applies the server's outcome rule itself (`SERVER_FLAGGED`, mirroring `games/result_flags.py` and each game's result model, including Blackjack's legacy chips win and Cascade's always-written `won`), so those finish and win goals show as done offline. Free games keep their own flags (#4032).
- **Streak.** The streak query reads every game with a spec, not only the pools' games, so a pinned premium goal day scores.
- Cost: an entitled-game check (one indexed query, once per request) runs on a personal pick, so a pick is at most five statements (the history's four, then `game_entitlements`); nothing is stored beyond the existing assignment row.

**Bottle Sort: "solve _N_ new levels" (#4028).** An absolute "reach level _L_" (the highest level solved before the day + _N_) cannot be pinned safely for today+1 and today+2: those days are pinned at the first open of today, so today's own solves could already meet them (#4024 left Sort out for that reason). The goal is therefore a relative kind, `new_levels_at_least` with target _N_: it is met when the highest level solved that day minus the highest solved **before that day started** is at least _N_ (`definitions.facts_for`, §5). `final_score` on a Sort row is the player's highest level solved after that solve, sent on every solve, replays included (#2625), so a replay of an old level never counts as new.

- **_N_** (`personal.sort_new_levels`): the median of the new levels solved per day of play in the affinity window (each day's best `final_score` minus the best before it, so 10 levels a day reads as 10), stretched by `DAILY_CHALLENGE_STRETCH_PCT` and rounded half up, clamped to 1–3 (a day not over yet, today when today+1 or today+2 is picked, is left out of the pace); then one fewer after two misses (never under 1). Fewer than 3 finished Sort games: 1.
- **Catalog cap** (`personal.sort_levels_left`): _N_ is at most the levels left above the best before the day, in the edition the install plays (pace and best both read that edition only, §5 "Sort editions"): 120 (`sort.catalog.LEVEL_COUNT`) for the catalog edition, 23 for the pre-catalog random levels (builds from before the catalog stop there). The cap follows the edition, not the switch: with `SORT_CATALOG_EDITION_ENFORCED` on the edition is always the catalog, and with it off it is the edition of the install's latest Sort row, so a catalog player past level 23 still gets a goal. With no level left Sort offers no goal, core or bonus. Accepted edge: a day pinned two days ahead from a best of 118 asks for at most 2, so a player who reaches 120 before that day starts cannot meet it.
- Sort is an eligible game again and counts toward the 3 finished games; the cold-start, step-down, variety and no-repeat rules apply to it as to the other games. The stars goal is still not built.
- **Older builds** have no copy for the kind and word it "Play Bottle Sort" (`goal.fallback`, §6); their offline check reads it as an "at least" goal on a `new_levels` fact no game sends, so it is never marked done locally. `/status` scores it for them as for any build.

A goal is only ever evaluated against that day's games (§5); a relative goal also reads the best before the day started.

## 3. How a day is selected

### Shared template

For a day that has never been frozen before:

- `definitions.py` uses the calendar day's ordinal plus `DAILY_CHALLENGE_SALT`;
- the salt deterministically shuffles the non-Daily-Word game rotation;
- the day advances two positions through that rotation (with an even-length rotation, the start also shifts by one place after every lap of half the rotation, so every neighbouring pair still occurs);
- goal tiers are selected deterministically from the same day/salt inputs.

The salt is environment-specific. Its purpose is to make the future schedule stable for the environment without making the complete future rotation trivially derivable from public source alone.

### 3a. Personal pick (#3994)

`personal.choose_core` picks goals 2 and 3 for an install that has history:

- **Eligible games** (`service.eligible_games`): the free games with goal specs, plus the premium games with specs the install is entitled to (the dev override counts as entitled). Never a game in `DISABLED_GAMES`. Blackjack, Cascade, Hearts, Mahjong and Star Swarm have specs (#3996), so it reads the install's `game_entitlements` for them (one query, once per request; none under the dev override). A premium game never appears for an install that does not own it, whatever it has played.
- **Affinity**: finished games on each of the last `DAILY_CHALLENGE_AFFINITY_DAYS` (14) local days, weighted 14 for yesterday, 13 for the day before, down to 1 for 14 days ago. Each slot is drawn with probability proportional to its game's affinity (a game's goal types share its weight).
- **Variety guard**, as a ranking of the options (each rule only breaks ties left by the ones above it):
  1. at most one luck-dependent goal a day;
  2. not one of yesterday's core games, while the install has 3 or more games with affinity;
  3. a game with affinity before one without (a game the install has not played is used only when nothing else fits, with its cold-start goal);
  4. two different games before the same game twice (a player of one game gets two goal types of that game);
  5. a (game, goal type) not used in the last two days, so it never repeats within 3 days;
  6. two different goal archetypes (finish, stretch, progress, skill).
- **Determinism**: the draw is seeded from (session id, day, `DAILY_CHALLENGE_SALT`), never the clock.
- With exactly 3 or 4 games with affinity, rule 2 sets the rhythm more than affinity does: two games one day, the other(s) the next.
- `/upcoming` picks today, today+1 and today+2 in date order from one history read, so each day sees the day before it.

**History** (`history.load_install_history`) is read with at most four queries, whatever the number of games: the install's pinned assignments for the last 60 days (the variety guard, the step-down and the rest rule below); its latest `DAILY_CHALLENGE_HISTORY_GAMES` finished games per game type before the first served day, and as many again within each later served day (so a day's own games never push the history before it out), plus every finished game on the days the step-down and rest rules look at; one grouped row per game type with its finished games and best `final_score` per local day of the affinity window, its best before that window (Sort's per-day pace), and its best `final_score` before each served day and each step-down day (the day-start best a Sort goal of that day is scored against); and one aggregate row over the install's game creations since the first served day could be asked for (`LAG()` gives each served day's first creation, gaps over the pin window and the latest creation; the "goals already shown" rule, §1; skipped when every served day is a new-install day). Abandoned and `dev_affected` games never count. The pick runs at most once per install per day (pin on serve), writes nothing beyond the assignment row, and that row stays about 250 B (a personal day's goal text is 115–140 B, against 129 B measured for the shared template).

**Discovery candidates** (for the bonus goal, §3b): `personal.discovery_candidates` returns the eligible games the install has not finished in the affinity window, minus resting games. A game offered as a **discovery** bonus (`bonus` on the pinned row, tier `easy`) and not played that day 3 times within 30 days rests for 30 days after the last of them (`personal.resting`, read from the pinned rows; only finished days count). A stretch bonus (tier `medium`) never rests a game.

### 3b. The bonus goal (#3995)

`personal.choose_bonus` runs right after `choose_core`, in `service.pick_for_install`, for a personal pick only:

- **When.** `DAILY_CHALLENGE_BONUS_ENABLED` (default true) is on. Off, no new bonus is pinned (a day already pinned keeps the one it has).
- **Which kind.** With probability `DAILY_CHALLENGE_DISCOVERY_SHARE` (default 0.5, 0-1) the bonus is a **discovery** goal: the cold-start goal (`GameSpec.cold_type`: a finish, or the low fixed score) of a `discovery_candidates` game, so a game the player has not touched in the affinity window (`DAILY_CHALLENGE_AFFINITY_DAYS`, default 14 days) and is not resting. Otherwise it is a **bigger stretch**: a personal target (§2a) in a game with affinity, with the stretch percentage **doubled** (24 % at the default), still capped at the personal best and floored at the game's minimum, through the same `personal_target`. A game with fewer than 3 finished games has no stretch, so it is only ever a discovery candidate.
- **Constraints.** Never the game of a core goal that day; never luck-dependent (`Goal.is_win`; no free goal is today); when the drawn kind has no candidate the other kind is used; with neither, `bonus` is `null`.
- **Determinism.** The draw uses its own stream seeded from (session id, day, `DAILY_CHALLENGE_SALT`, `"bonus"`), never the clock, so adding a bonus never changes the core picks.
- **Marker.** The pinned row's goal tier tells the two kinds apart: `easy` is a discovery goal, `medium` a stretch (`personal.bonus_kind`). No encoding change: the stored bonus is still `[game_type, kind, target, tier]`.
- **Shared days.** A shared-template pick (a new install, `serves_shared`, the kill switch, an install that may not pin) has `bonus = null`. The goals a device shows never change, so a shared day never gains a bonus later either.
- **Streak.** `GOALS_TO_QUALIFY` is over the core goals only; the streak scores `assignment.template`, never the bonus.

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

- **What the pick returns:** for an install with history, the personal pick (§3a) on the slate `resolve_slate` chooses, plus its optional bonus goal (§3b); for a new install, exactly the shared frozen template above for that slate, with no bonus. A day already pinned is never picked again.
- **The slate is pinned with the day.** A purchase part-way through a day no longer swaps that day's goals; it applies from the next day not yet pinned. Invisible while the free and premium pools are identical.
- **Write ceiling: only recently active installs pin, and only under the storage budget.** Before picking, `assignments.may_pin` checks two things, and only when a requested day is not pinned yet (a pinned day's read stays one SELECT):
  - **Recent play:** the session has a `games` row created (server time) within `DAILY_CHALLENGE_PIN_RECENT_PLAY_HOURS` (default 48). One `EXISTS` on the `games_session_created_idx (session_id, created_at)` index.
  - **Storage budget:** storage is under budget: the fuller of replay events vs `REPLAY_STORAGE_BUDGET_MB` and the whole database vs `DATABASE_PLAN_MB`, at the replay recorder's 90 % turn-down point (`replay_storage.read_budget`). The size reading is cached in-process for an hour, so there is no size query per request. If the size cannot be read (a DB error or timeout), the install does not pin: that failure is remembered for 10 minutes (one warning per window), and the size query runs in a SAVEPOINT so `/status` still answers.

  An install that fails either is served the shared template (the `/upcoming` public path's one batched read, or `/status`'s slate-resolved frozen template) and nothing is written; `pick_for_install` never runs for it. A brand-new install's first day, and the days it caches for offline play, are therefore unpinned until its first game syncs; the next request then pins. A lapsed install stops pinning after 48 h without a game.

- **Concurrent first requests** cannot store two different rows: the primary key is `(session_id, local_date)` and the insert is `ON CONFLICT DO NOTHING`, after which the stored row is read back and served.
- **At most 3 days ahead:** only today..today+2 in the requesting client's local calendar are ever pinned (`MAX_DAYS_AHEAD`); `get_or_pin` refuses any other day.
- **Encoding:** each goal is `[game_type, kind, target, tier]` (the spec `goal_from_spec` rebuilds) in compact JSON text; the session id is a native `uuid`; `template_id` and `slate` are stored only when they differ from the defaults (an id derived from the goals, the free slate), so they are NULL and free for every real day. About 250 B a row on disk including the primary-key index (measured on Postgres 16: 193 B heap + 54 B index, 129 B of it goal text; about 15 MB held at 60 days per 1,000 daily players, 150 MB per 10,000; see [DATA-INVENTORY.md §2d](DATA-INVENTORY.md#2d-daily-challenge-assignments-3992)).
- **Retention:** `DAILY_CHALLENGE_ASSIGNMENT_RETENTION_DAYS` may not be below `STREAK_LOOKBACK_DAYS` + 1 (the settings refuse it), since a pinned day pruned inside the streak window would be re-scored on the shared template and could flip a past streak day; the extra day covers clients west of UTC, because the prune cuts on the UTC date. A daily batched prune (`daily_challenge/retention.py`, started by `jobs.lifespan`) deletes rows whose `local_date` is more than `DAILY_CHALLENGE_ASSIGNMENT_RETENTION_DAYS` (default `STREAK_LOOKBACK_DAYS` + 1, 61) before today in UTC. A pruned day is replayed from the shared template.
- **Delete My Data** (`DELETE /me`, `backend/me/router.py`, which deletes `DailyChallengeAssignment` rows by install id in the same transaction as the install's other server data) deletes the install's rows (`test_delete_me_removes_the_installs_assignments`).
- **Kill switch:** `DAILY_CHALLENGE_PERSONALIZED=false` (default true) serves every install the shared frozen template, exactly as before this table existed: no row is read or written, by the routes or the streak. Rows already stored stay until retention or `DELETE /me` removes them.

## 5. Goal evaluation

A goal is evaluated against **one finished game row** of the matching game type.

The evaluator sees a facts envelope made from:

- the game's validated result fields merged into `games.metadata`;
- `final_score`, when present;
- `duration_ms`, when present.

A goal is complete when any eligible game of that type during the local day satisfies its predicate.

Personal goals (§2a) use the same kinds with absolute targets, so they are evaluated exactly like the shared ones, with one exception.

**Relative goals (#4028).** Bottle Sort's `new_levels_at_least` is scored against the install's **day-start best**: the highest `final_score` among its finished, non-abandoned, non-`dev_affected` Sort games completed before the local day's start (0 for none). For each of the day's Sort rows the evaluator derives `new_levels` = `final_score` − day-start best (`definitions.facts_for`; a `new_levels` sent by a client is overwritten) and checks it against _N_ like any "at least" goal. A game finished at 23:59:59 local raises the next day's baseline; one at 00:00:00 counts for the new day. Without day-start bests (not read) the goal is never met.

**Sort editions.** Sort's catalog levels (rows sent with the current `catalog_version`) and the random levels before them (rows without it, #2761) are numbered apart, and a migrated device empties its bests (`catalogMigration.ts`), so a baseline is **per edition** (`definitions.edition_of`, the same integer check as the leaderboard's `edition_matches`): a row is only ever compared with the best of its own edition. Which editions count follows `SORT_CATALOG_EDITION_ENFORCED` (`definitions.counted_editions`):

- **On**: the catalog only, as on the leaderboard. A pre-catalog row neither meets the goal nor raises a baseline; the pick's pace and levels left read catalog rows only.
- **Off**: both, each against its own edition's best, which is what the device playing that edition counts from (a catalog build from its catalog bests, a pre-catalog build from its random levels). The two never add up (1 new level in each is not 2). The pick reads the edition of the install's latest Sort row (the build it plays now).

So a migrated install with a random-level best of 18 that solves catalog levels 5 → 7 has solved 2 new levels, with the switch on or off. The readers group their existing aggregate by edition (one more `GROUP BY` key, `daily_challenge/editions.py`), never an extra statement.

Where it is read:

- **`/status`**: `service.day_start_bests`, one aggregate (`MAX(final_score)` grouped by game type) for the install, run only when the day's core or bonus goals hold a relative goal; any other day reads nothing more.
- **Streak** (§10): one aggregate for the best before the lookback window, then a running max over the window's own rows, which the streak already reads; no query per day. It runs only when some pinned day in the window holds a relative goal (shared templates never do).
- **History** (§3a): the step-down reads each probe day's baseline from the existing query 3.
- **Metrics script** (§15): one grouped SELECT per chunk that holds such a goal, then a running max.
- **Offline** (§9): the baseline Sort recorded on the device at the day's first solve.

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

**`new_levels_at_least` (#4028)** is the one kind the personal pick adds: Bottle Sort only, `target` = _N_ (1–3), id `sort:new_levels_at_least:N`, never luck-dependent. Its copy is `goal.sort.new_levels_at_least` with i18next plurals ("Solve {{count}} new {{game}} level" / "levels") in every shipped locale; `count` is the target. Builds from before #4028 have no such key and show "Play Bottle Sort". It is relative to the day it is scored on (§5), so the wire shape is unchanged and nothing on the wire carries the baseline.

Apart from it, the personal pick (#3993/#3994, #3996) adds no kind: it uses `completed`, `won`, `solved`, `final_score_at_least`, `highest_tile_at_least`, `won_moves_at_most`, and for the premium games `won_duration_ms_at_most`, `wave_reached_at_least` and `starting_chips_at_least`, each of which has wording for the games that use it in every locale (`test_every_spec_goal_kind_is_an_existing_kind_with_frontend_wording`, `test_every_premium_goal_has_wording_in_every_locale`), so installed builds that have the wording render every personal goal; an older build without a (game, kind) pair shows "Play {game}".

**Dials** (server env vars, read lazily, no app release; all in [RENDER.md](RENDER.md)): `DAILY_CHALLENGE_STRETCH_PCT` (12, 0–50), `DAILY_CHALLENGE_AFFINITY_DAYS` (14, 1–60), `DAILY_CHALLENGE_HISTORY_GAMES` (10, 3–50), `DAILY_CHALLENGE_BONUS_ENABLED` (true) and `DAILY_CHALLENGE_DISCOVERY_SHARE` (0.5, 0–1) tune the pick (§2a, §3b); `DAILY_CHALLENGE_PIN_RECENT_PLAY_HOURS` (48, 1–720) and `DAILY_CHALLENGE_ASSIGNMENT_RETENTION_DAYS` (default `STREAK_LOOKBACK_DAYS` + 1 = 61, 1–365) bound the stored rows, and the kill switch `DAILY_CHALLENGE_PERSONALIZED` (true, §4) serves the shared template to everyone. `DAILY_CHALLENGE_SALT` seeds the shared schedule and the draws (§3). `SORT_CATALOG_EDITION_ENFORCED` is not a Daily Challenge dial but it is read here: it picks the shared template's Sort targets (§2) and the Sort editions a relative goal counts (§5).

## 7. Free and premium slates

The system has two slate names: `free` and `premium`.

The public `/today` route has no player/session context, so it always returns the free slate.

The session-scoped `/status` route can resolve a premium slate. The slate is resolved when an install's day is first served and is then pinned with the day (§4); it is resolved per request only for a day that is not pinned. The rule is:

- inspect the premium games named by that day's premium template;
- the session receives the premium slate only if it owns **every** named premium game;
- otherwise it receives the free slate;
- the development entitlement override counts named premium games as owned.

A partly entitled player is never intentionally handed a challenge containing a game they cannot open.

Today the two live pools are identical, so the slate distinction does not change the goals returned (the premium games' personal goals do not use the pools; §2). The architecture remains in place for future premium-specific goal pools.

A personal pick keeps the slate too: it is stored on the assignment, as for a shared day. Which games a personal pick may use is decided separately, by entitlement to each game with goal specs (§3a); the slate does not limit it.

## 8. API routes

| Route                           | Scope                   | Purpose                                                                                                                                                                                        |  Limit |
| ------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -----: |
| `GET /daily-challenge/today`    | public / IP-keyed       | Free slate for the local day, without player progress                                                                                                                                          | 60/min |
| `GET /daily-challenge/upcoming` | IP-keyed; session-aware | Today, today+1 and today+2 (`{"days": [...]}`, each shaped like `/today`). With a valid `X-Session-ID`: that install's pinned assignment for each day (§4). Without one: the shared free slate | 60/min |
| `GET /daily-challenge/status`   | `X-Session-ID`          | This install's pinned goals for today (§4) plus completion/progress                                                                                                                            | 60/min |

`/upcoming` takes the same `tz_offset_minutes` (-840..840) as the other routes and resolves each day from the client's local calendar. Without a session (or a header that is not a UUID, or with the kill switch off) it is the public route it always was: reading a day freezes it through `get_or_create_templates`, so a second read, another device, and a later `/today` all return the same goals. With a session it pins each day for that install, so `/status` later serves today exactly as `/upcoming` cached it. The app's shared HTTP client sends `X-Session-ID` on every request, `/upcoming` included. Scoring is unchanged: a completion is still checked against its own local day when it syncs.

Every day payload (`/status`, each `/upcoming` day, `/today`) carries a nullable `bonus` goal (`{id, game_type, kind, target}` or `null`), the optional bonus goal (§3b, #3995). `/status` adds `completed` and `best_score` to it, the same shape as a core goal; `/today` (shared, free slate) is always `null`. It is never one of `goals`, which stays exactly three entries, and it never counts toward `completed_goals`, `total_goals`, `completed` or the streak, so older app builds ignore it and keep a correct done count.

The Home card treats `/status` as authoritative because an install's pinned goals (§4) can differ from the shared `/today` goals, not merely in their completion flags.

If `/status` reaches the server but fails in a way the client can recover from, the client can fall back to `/today` and show the day's free goals without progress.

A network failure is not followed by a second doomed `/today` request; the UI moves to its offline/retry state.

## 9. Home-screen behavior

Daily Challenge appears near the top of Home.

The card:

- shows three localized goal chips and completion marks;
- shows done/total progress, over the core goals only;
- shows a completion note when all visible core goals are done;
- shows the optional bonus goal (#3995) below a dashed divider as a row with a small uppercase "Bonus" label and one chip: dashed outline and a hollow star when open, a solid green outline and a filled star when done (never the core accent fill). Its screen-reader label is "Bonus, optional: {goal}, completed / not completed yet"; the glyph and label are hidden from readers. The bonus is hidden when its game is hidden in the build, is cached with its day for offline play and marked done from queued games like a core goal (`localProgress.ts`); it never changes the count or the completion note;
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
- **Progress:** goals already met in the cached `/status`, plus any goal met by a game still in the device's queue (`pendingGamesStore`) that finished on that local date by the device's current UTC offset (the same offset `/status` is asked with). `localProgress.ts` builds each game's facts like the server does (result block, non-null creation metadata, `final_score`, `duration_ms`), skips abandoned games, and mirrors the per-kind checks in `definitions.py`. A kind it does not know is never met locally. Sort's relative "new levels" goal (#4028) counts from the device's day-start best: Sort's saves keep only the current standing (best moves per level), so the day's first solve stores the standing before it (`game/sort/dayStart.ts`, key `@sort/day_start`, `{"day":"YYYY-MM-DD","best":N}`, about 30 B, one write per day Sort is played, on the solve event). When that record is for another day (or could not be written), the goal is not marked done offline; `/status` scores it on reconnect.
- **Sync:** the queued games upload through `SyncWorker` as usual and are scored by the server against the local day of their device `completed_at`, so a day played offline on that day counts toward the streak once it syncs.
- **Back online:** the local progress stays on the card until the first `/status` answer, which then replaces it. Online, the cache is never shown.
- **Run out:** when the 3-day window is exhausted (`offlineWindowExhausted`, `lastConnected.ts`), or goals were cached but none cover today, the card shows the shared message (`common:offline.windowExhausted`), plus `common:offline.windowExhaustedStreak` when the last known streak is above 0. A device that never cached anything keeps the plain offline message.
- **No catch-up:** only today's entry is ever used; a past day's goals are never shown or completed.

Known gap: a game that synced after the last `/status` read and before the device went offline is in neither the cached `/status` nor the queue, so it shows as not done until the device reconnects. The hook reads `/status` on every Home focus (after flushing the queue), so in practice this is the game finished just before losing the connection without returning to Home.

Delete My Data clears both keys. The Sort day-start record (`@sort/day_start`) holds only a date and a level number, no identifier, and stays with Sort's other local saves until uninstall (see [DATA-INVENTORY.md §3](DATA-INVENTORY.md#3-on-device-data-never-leaves-the-phone-unless-stated)).

## 10. Streak

The app-wide streak is derived from Daily Challenge history; there is no mutable streak counter table.

A calendar day qualifies when the player met **at least 2 of that day's 3 goals**.

The streak scores each day on the goals that install was served: its pinned assignment (§4) when one exists, else the shared frozen template (days before #3992, days pruned by retention, or every day while `DAILY_CHALLENGE_PERSONALIZED` is off). Only the core goals count; the bonus goal never does. The pinned rows for the whole window come from one query, so the query count stays fixed however long the lookback is. A pinned day with a Sort "new levels" goal (#4028) is scored against the best before that day started: one more aggregate for the best before the window, only when some pinned day holds such a goal, then a running max over the window's rows (§5). It walks backward over those days:

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

- **Current entitlements are used only for unpinned past days.** The slate is pinned with the day (§4), so a pinned day replays with the slate it was served with. For unpinned days (before #3992, pruned by retention, or days the install could not pin), once free/premium goal pools actually diverge, gaining or losing entitlement can change which slate is used for the replay.
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
- `service.py` owns current-day evaluation, slate resolution, eligibility and `pick_for_install`.
- `personal.py` owns the per-game goal specs, the target rule and the selection (pure); `history.py` reads an install's history for it.
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

## 15. Tuning metrics (#3998)

`backend/scripts/daily_challenge_metrics.py` answers "are the goals too easy or too hard?" from data already stored (the pinned `daily_challenge_assignments` rows and `games`). It collects and writes nothing, prints aggregates only (never an install id), and issues SELECTs only (plus `SET TRANSACTION READ ONLY` on PostgreSQL).

```bash
cd backend
python scripts/daily_challenge_metrics.py                                   # last 14 complete days
python scripts/daily_challenge_metrics.py --since 2026-11-01 --until 2026-11-14
python scripts/daily_challenge_metrics.py --json                            # machine use
```

It reads `DATABASE_URL` like the app (`backend/.env` or the environment). Point it at a read replica or run it off-peak; it makes `3 x ceil(installs / 500) + 1` queries (the last is the empty id page that ends the loop), plus one per chunk that holds a Sort "new levels" goal (the chunk's best Sort level before the window, grouped per install, #4028), so at most `4 x ceil(installs / 500) + 1`. It holds one 500-install chunk in memory, so a window with about 30,000 distinct pinned installs (a 60-day window on a database with 10,000 daily players) is roughly 181 to 241 queries and tens of MB.

What it reports, over the pinned install-days in the window:

| Metric                                  | Definition                                                                                                                                                                                                                                |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Core goal completion, per game and kind | `played` = met / offered, where an install-day is offered a game's goal only if that install finished a non-abandoned game of that type that day. `overall` = met / every pinned goal. Plus an `ALL` row.                                 |
| Days with 2 of 3 core goals met         | Over install-days with any finished game (the streak rule).                                                                                                                                                                               |
| Bonus discovery                         | Of pinned days with a bonus goal, the share where the bonus game was played that day, then the same split by kind (`bonus_by_kind`: `discovery` = tier `easy`, `stretch` = tier `medium`, §3b). "no bonus data yet" while no row has one. |
| Next-day return after a qualifying day  | Of qualifying install-days whose next day is over, the share where the install finished a game the next day.                                                                                                                              |

Goals are rebuilt with `goal_from_spec` and scored with `evaluate_goal`, so the semantics (abandoned and `dev_affected` games never count, #4039) are the live ones.

**Approximation.** A pinned row keeps the install's local _date_ but not its UTC offset, so every install is bucketed with one offset (`--tz-offset-minutes`, default 0, i.e. UTC days) through the same `local_day_of` window the service uses. A game near local midnight for an install far from that offset can land on the neighbouring day. Fine for a tuning read; do not use it for per-player questions. Today is excluded by default (the window ends yesterday) because it is unfinished, and a day counts for next-day return only once the day after it has ended (so the newest two days are left out). Installs are matched by canonical lowercase session id while `games.session_id` is stored as sent; real clients send lowercase, so the query does not handle other casings.

**Reading it** ([DAILY-CHALLENGE-STRATEGY.md §8](DAILY-CHALLENGE-STRATEGY.md#8-measuring-whether-it-works)):

- **Core goal completion, `played` column: target 65-75%.** Above about 75% the goals are too easy; below about 65% they are too hard. The overall column is lower by design (it counts days the game was not played) and is for context, not the band. Judge a game or kind only with enough `offered` days (a few hundred); small rows are noise.
- **2 of 3 share near 100%** means 2 of 3 may be too easy; a low share means too hard.
- **Bonus discovery**, read on the `discovery` line: low means lower the discovery share (the `stretch` line is a game the player already plays, so it is mostly a sanity check); **next-day return** is the retention signal to watch, with no target yet.

**Dials** (server env vars, no app release): `DAILY_CHALLENGE_STRETCH_PCT` (live since #3993, default 12, 0–50; see §2a) moves the stretch step up (completion too high) or down (too low); `DAILY_CHALLENGE_DISCOVERY_SHARE` (live since #3995, default 0.5, 0-1) controls how often the bonus suggests a game the player does not usually play, and `DAILY_CHALLENGE_BONUS_ENABLED` (default true) turns the bonus off without an app release. Re-run after a few days on the new value; one dial change at a time.
