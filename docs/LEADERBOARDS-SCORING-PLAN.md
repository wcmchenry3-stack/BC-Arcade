# Leaderboards & Scoring — Streamlining Plan

**Status:** owner decisions recorded 2026-09-25 (§8, sixteen decisions); filed as issues under epic #2519. Nothing in this plan is scheduled before the v1.0 store submission; see [§6 Sequencing](#6-sequencing).
**Scope:** how every game *reports* its result, how results are *stored and ranked*, and how results are *shown* (result card, per-game scoreboard, leaderboards, Profile stats). Game rules and scoring formulas stay game-specific and are out of scope.
**Companion docs:** [`ARCHITECTURE.md`](ARCHITECTURE.md) §4/§9, [`GAME-CONTRACT.md`](GAME-CONTRACT.md), [`PRODUCT.md`](PRODUCT.md), [`RELEASE-PLAN-2026-10.md`](RELEASE-PLAN-2026-10.md).

---

## Table of contents

1. [Summary](#1-summary)
2. [Current state — per game](#2-current-state--per-game)
3. [Current state — shared layer](#3-current-state--shared-layer)
4. [Target design](#4-target-design)
5. [Existing issues — disposition](#5-existing-issues--disposition)
6. [Sequencing](#6-sequencing)
7. [Proposed epic and stories](#7-proposed-epic-and-stories)
8. [Owner decisions](#8-owner-decisions-recorded-2026-09-25)
9. [Appendix A — docs that are wrong today](#appendix-a--docs-that-are-wrong-today)
10. [Appendix B — dead code and cleanup](#appendix-b--dead-code-and-cleanup)
11. [Appendix C — test safety net and gaps](#appendix-c--test-safety-net-and-gaps)

---

## 1. Summary

The app has 12 game types plus the Daily Challenge (a cross-game feature, not a game). Scores reach the server through **three different write paths**, all landing in the single `games` table, and are shown through **four disagreeing stat sources** (server, per-game AsyncStorage, in-memory counters, live in-session contexts). The concrete problems, in order of impact:

1. **Duplicate leaderboard rows.** Solitaire, Mahjong and Hearts write the finished game twice: once as the player's own session row (via `PATCH /games/{id}/complete`) and once as a named leaderboard row under a fake session such as `solitaire-anon` (`POST /<game>/score`). Every leaderboard query filters on game type only, so each win ranks twice — once under the player's name and once as "anon". FreeCell alone avoids this, by never sending a score on the session row, which in turn leaves its `/stats/me` "best" permanently null. (`backend/solitaire/router.py:47-95`, `backend/freecell/router.py:10-15`)
2. **`final_score` means something different per game, but every consumer treats it as "higher is better".** Yacht stores the raw score on session rows and `400 − raw` on leaderboard rows. Hearts stores `100 − penalty`. FreeCell stores moves and ranks ascending. Sort stores a level number capped at 23. Daily Word sends `null`. Blackjack never sends one, so its `best_chips`/`current_chips` stats are always null in production. Yet `/stats/me` `best`/`avg`, `compute_rank`, and Profile all take `max()`.
3. **Profile compares raw scores across games.** The "Top score" tile picks the largest `best` across every game (`frontend/src/screens/ProfileScreen.tsx:63-73`). This is exactly the comparison the owner has ruled out, and it sits next to a "Total games" tile that counts abandons.
4. **Players submit to leaderboards they can never see.** Six games (Solitaire, Sudoku, FreeCell, Cascade, Hearts, Mahjong) submit scores; none has a screen that reads its leaderboard. The only two leaderboard views are Sort's inline tab and Star Swarm's "Ranks" bottom tab, and both games are hidden in store builds. **A store build has no leaderboard view at all.** The shared `useLeaderboard` hook has zero production callers.
5. **Five submission flows, three outcome vocabularies, two offline queues.** Shared `useLeaderboardSubmit` (5 games); Mahjong's typed-name modal that enqueues unconditionally; Sort's direct POST with no queue; Star Swarm's fire-and-forget under the hard-coded name `"player"`; and four games with no submission at all. The backend `win/loss/push/blackjack` outcome values are written by no code path. Hearts, the one game with a true win/loss/draw, sends no win signal to the server.
6. **The "Scoreboard" overflow screen conflates two things** — a live in-match view (Hearts rounds, Yacht scorecard, Blackjack session) and "my stats for this game" (Hero cards fed by device-local counters). It covers 7 of 12 games; Mahjong's menu item routes there and lands on an untranslated "No scoreboard available" fallback.

What the owner asked for — comparable cross-game metrics (games played, completion/abandon rate, win/loss rate, time played) and per-game leaderboards that only compare like with like — is **mostly computable from data the server already has** (§4.5), but needs (a) every game on the one write path, (b) a normalised win signal, (c) `duration_ms` populated, and (d) a leaderboard identity model that does not create phantom rows.

---

## 2. Current state — per game

Direction: ↑ higher is better, ↓ lower is better. "A" = generic session pipeline (`useGameSync` → `POST /games` → `PATCH /games/{id}/complete`). "B" = per-game `POST /<game>/score` inserting a separate `games` row under a sentinel session. "C" = per-game `PATCH /<game>/score/{game_id}` attaching the display name to the session row.

| Game | Ranking metric (dir.) | Partition today | Write path(s) | Leaderboard identity | Offline path | Win signal sent | `duration_ms` | Result card | Scoreboard overflow | Leaderboard view |
|---|---|---|---|---|---|---|---|---|---|---|
| **Yacht** (free) | `total_score` ↑ | none (difficulty stored, not partitioned; docs say it is) | A only. `POST /yacht/score` exists but nothing calls it | — | SyncWorker | `vs_result` (vs-mode only) | never | Shared | ✅ live scorecard | none |
| **Twenty48** (free) | merge score ↑ | none | A only; **not in backend registry** | — | SyncWorker | `highest_tile`, `kept_playing` | ✅ | Shared, no submission slot | ✅ Hero cards (local) | none (no endpoint) |
| **Solitaire** (free) | points ↑ | none (Draw-1/3 shared by design) | A **+ B** → duplicates | display name | SyncWorker + scoreQueue | `won` | completed ✅, abandon 0 | Shared | ✅ Hero cards (local) | none |
| **FreeCell** (free) | moves ↓ | none | A (no score) **+ B** | display name sent as `player_id` | SyncWorker + scoreQueue | `won` | never | Shared | ❌ none | none |
| **Mahjong** (free) | 10/pair + 500 bonus ↑ | none (layout not recorded) | A **+ B** → duplicates | typed name every game | scoreQueue only, always | `won` | completed ✅, abandon 0 | **Custom WinModal** | ❌ button → broken fallback | none |
| **Daily Word** (free) | none (`final_score` null) | language | A only | — | SyncWorker | `won`, `guesses_used` | never | Shared, no submission slot | ❌ | none |
| **Hearts** (premium) | `100 − penalty` ↑ (engine is ↓) | none (AI difficulty not recorded) | A **+ B** → duplicates | display name | scoreQueue + bespoke `pendingSubmission.ts` | **none** | **always 0** | Shared (only game with real win/loss/draw) | ✅ live rounds table | none |
| **Sudoku** (premium) | `base − 10×errors` ↑ | (difficulty, variant) | A **+ C** | display name | SyncWorker + scoreQueue | `won`, `errors` | completed ✅, abandon 0 | Shared | ✅ Hero cards (local) | none |
| **Cascade** (premium) | merge score ↑ | none | A **+ C** | display name | SyncWorker + scoreQueue | none (no win concept) | ✅ | Shared | ✅ Hero cards (in-memory) | none |
| **Sort** (premium) | `level_reached` ↑, capped 23 | none | **B only** — no session rows at all | typed name every game; all rows `session_id="sort-anon"` | **none** | n/a | n/a | **Custom modal** | ❌ | ✅ inline tab |
| **Star Swarm** (premium) | kill score ↑ | none (tier stored, shown, not partitioned) | **B only** — no session rows; **no backend module** | hard-coded `"player"`; all rows `starswarm-anon` | **none**, `.catch(() => {})` | n/a | n/a | **Custom canvas overlay** | ❌ | ✅ "Ranks" tab (hidden in store builds) |
| **Blackjack** (premium) | chips ↑ (not a score) | table tier (metadata) | A only, **no `final_score`** | — | SyncWorker | `hands_won/hands_played`; bust = `completed` | ✅ | **Custom VictoryScreen**; no loss card | ✅ bespoke (in-memory) + separate local `BlackjackStatsScreen` | none |
| **Daily Challenge** | none — read-side over other games' rows | free/premium slate | none | — | depends on `flushQueuedGames()` | n/a | n/a | n/a (Home card + streak pill) | ❌ | none |

Source inventories with `path:line` citations for every cell were produced during this investigation and are summarised in §3; the per-game `docs/games/*.md` "Scoring" sections are wrong for 8 of 12 games (Appendix A).

---

## 3. Current state — shared layer

### 3.1 Write paths into `games`

| Pipeline | Client entry | Server | `session_id` | Read by |
|---|---|---|---|---|
| **A** session rows | `useGameSync` → `gameEventClient` → `pendingGamesStore`/`eventStore` → `SyncWorker` | `POST /games`, `POST /games/{id}/events`, `PATCH /games/{id}/complete` | real device session | `/stats/me`, `/games/me`, XP, daily challenge, streak, **and every leaderboard** |
| **B** insert-anon | per-game `api.submitScore` | `POST /<game>/score` (solitaire, mahjong, hearts, freecell, sort, starswarm, yacht) | `"<game>-anon"` sentinel | that game's leaderboard only |
| **C** attach name | `LeaderboardAdapter` | `PATCH /<game>/score/{game_id}` (cascade, sudoku) | real device session | that game's leaderboard |

No `_top_scores` query filters on `session_id`, so A and B rows mix on the same board. Nine hand-rolled leaderboard routers exist; `backend/games/ranking.py::compute_rank` is shared by only two of them. Rank semantics differ: "11 = not in top 10" (solitaire, mahjong, hearts, yacht, sort) vs exact rank (freecell, cascade, sudoku). Rate limits differ (5/min vs 10/min); entitlement dependencies are present on some routers and absent on others. Routes differ (`/scores`, `/leaderboard`, `/scores/{difficulty}`).

### 3.2 Outcome and win vocabulary

- `backend/vocab.py` `GameOutcome` declares `win/loss/push/blackjack` "for Blackjack"; **no code writes them**. Clients send only `completed/abandoned/kept_playing`. `ARCHITECTURE.md §4` already says `outcome` is lifecycle-only and `won` in `result` is the win signal; `GAME-CONTRACT.md §1.2` contradicts it.
- The win signal is scattered: `won` (solitaire, mahjong, freecell, sudoku, daily_word), `vs_result` (yacht vs-mode), `hands_won/hands_played` (blackjack), nothing (hearts), n/a (cascade, sort, starswarm, twenty48 uses `highest_tile`).
- The frontend has three `GameOutcome` types (`api/vocab.ts`, `GameResultModal.tsx:28`, `_shared/types.ts:55`).

### 3.3 Abandons and duration

- Two parallel abandon paths: the hook's unmount/restart path (no score, per its docstring) and screen-level `beforeRemove` handlers in Solitaire, Mahjong, Sudoku and Hearts that *do* send a score (Sudoku sends the full completion formula) and `durationMs: 0`. `not_abandoned()` (`backend/games/filters.py`, #2468) shields leaderboards and stats from those scores, so this is dead data rather than a ranking bug.
- `useGameSync.restart()` abandons sessions the player never touched (no `startedRef` check, unlike unmount).
- Killing the app leaves the row `completed_at IS NULL` forever; it is invisible to every aggregate. There is no stale-row policy.
- `duration_ms` is never sent by Yacht, FreeCell, Daily Word or any hook-level abandon, and is hard-coded to 0 by Hearts. `SyncWorker` holds `startedAt`/`completedAt` for every game and could derive a fallback but does not.

### 3.4 Stats

- `/stats/me` per game returns `played` (includes abandons), `best`/`avg` (max/mean of `final_score`, wrong for ↓ games, null for Blackjack/FreeCell/Daily Word), `last_played_at`, plus hard-coded Blackjack columns. `completed_played` is computed in `games/service.py:279` but **dropped** from the response, so no client can compute an abandon rate.
- Sort and Star Swarm have no session rows, so they never appear in `/stats/me` or `/games/me` (#2216 filed for Star Swarm; Sort has the same defect).
- "Games played" has at least four definitions on device: server rows; FreeCell increments on start; Twenty48 increments on load; Cascade uses an in-memory ref that resets each mount. The Scoreboard overflow shows the local number, Profile shows the server number.

### 3.5 UI surfaces

- **Result card:** `GameResultModal` (epic #2500) is used by 8 of 12 games; Mahjong, Sort, Star Swarm and Blackjack still have bespoke end screens. Yacht, Twenty48 and Daily Word use it without a `submission` slot.
- **Scoreboard overflow** (`ScoreboardScreen.tsx`): 3 bespoke live views (Hearts, Yacht, Blackjack, each with its own `*Model.ts`) and 4 thin `HeroStatScoreboard` wrappers (Cascade, Solitaire, Sudoku, Twenty48) that each choose their own four cards. Mahjong has a context that is written and never read, and a menu item that lands on the fallback.
- **Leaderboard views:** `LeaderboardScreen` (Ranks tab) is Star Swarm-only and gated by `PREMIUM_TABS`; Sort has an inline tab. No other game has any view. There are no leaderboard components under `frontend/src/components/`.
- **Profile:** four tiles (Total games incl. abandons, Favourite, **cross-game Top score**, Games tried) plus 20 recent rows showing raw `final_score`. `GameDetailScreen` shows the raw untranslated `outcome` string.
- **i18n:** seven namespaces hold leaderboard/scoreboard vocabulary; "gamesPlayed" is defined three times; `mahjong.json` has orphaned leaderboard-column keys; the Scoreboard fallback string is hard-coded English.

---

## 4. Target design

Principles, then the concrete contract. Everything below respects `PRODUCT.md`: no cross-game *social* leaderboard, no time pressure, no penalty for leaving mid-game, no complex profiles. Cross-game *personal* metrics (games played, completion rate, time played) are fine; a cross-game *ranking* is not.

### 4.1 One write path per game

- Every game — including Sort and Star Swarm — records sessions through pipeline A (`useGameSync`). Twenty48 and Star Swarm get backend modules and registry entries.
- Leaderboard entry is **pattern C everywhere**: the display name is attached to the player's own session row (`PATCH /games/{id}/name`, one generic route replacing nine per-game routers). No separate leaderboard rows; no sentinel sessions. This removes the duplicate-row bug structurally and lets FreeCell send its score again.
- Auto-submission under the saved display name through `useLeaderboardSubmit` (#2503) is the only submission flow. Mahjong, Sort and Star Swarm migrate; the typed-name `TextInput` disappears. `scoreQueue` stays as the offline queue for the name attach; the generic sync already handles the score.
- Migration: existing `*-anon` rows are **deleted** in one Alembic data migration (§8 decision 6).

### 4.2 A declared board definition per game

Each backend `GameModule` declares how its game is ranked, so the server, the frontend and the docs share one source of truth:

```python
class BoardDefinition(BaseModel):
    metric: Literal["final_score"] | str      # column or metadata key
    direction: Literal["asc", "desc"]
    tiebreak: tuple[str, Literal["asc", "desc"]] | None = None  # e.g. ("total_moves", "asc") for Sort; completed_at asc always breaks the final tie
    label_key: str                            # i18n key for the column header, e.g. "moves", "score", "level"
    partitions: list[str] = []                # metadata keys, e.g. ["difficulty", "variant"]
    max_value: int | None = None              # upper bound for submission validation (#2215)
    enabled: bool = True                      # games with no leaderboard set False

board: BoardDefinition | None
```

- One generic `GET /games/leaderboard/{game_type}?<partition>=…` and one generic rank helper (`compute_rank`, extended with direction) replace the nine routers. Exact rank is always returned; the "11" sentinel goes away.
- **One entry per player** (§8 decision 12): a board shows each device session's best row only (best by direction, then tie-break, then earliest `completed_at`). A replay that doesn't beat the player's best never appears, and the rank returned to a player is the rank of their best row. A row needs a display name to appear on a board.
- `stats_shape` uses `direction` to compute `best` correctly for FreeCell (fewest moves) and any future ↓ game. `best` is renamed in the API response to `best_value` with a `best_label_key`, so the client never has to know what the number means.
- The board definition is exported to the frontend through the existing `gen_vocab_ts.py` path (or the catalog endpoint), so the leaderboard screen and result card are data-driven.

Initial definitions, as decided by the owner (§8):

| Game | metric | dir | tie-break | partitions | recorded, not partitioned | max | enabled |
|---|---|---|---|---|---|---|---|
| Yacht | `final_score` | desc | — | — (solo and vs mixed) | `mode`, `difficulty` | 400 (joker rules permitting) | yes |
| Twenty48 | `final_score` | desc | — | — | — | none | **yes** |
| Solitaire | `final_score` | desc | — | — (Draw-1/3 shared, per #591) | `draw_mode` | 1245 (see §8 decision 13) | yes |
| FreeCell | `final_score` (moves) | **asc** | — | — | — | none | yes |
| Mahjong | `final_score` | desc | — | — | `layout` (all 25 layouts are 144 tiles, same max) | 1220 (72 pairs × 10 + 500) | yes |
| Hearts | `final_score` (`100 − penalty`) | desc | — | — | `ai_difficulty` | 100 | yes |
| Sudoku | `final_score` | desc | — | `difficulty`, `variant` | — | 300 | yes |
| Cascade | `final_score` | desc | — | — | — | none | yes |
| Sort | `level_reached` | desc | `total_moves` asc | — | — | 23 | yes |
| Star Swarm | `final_score` | desc | — | `difficulty_tier` | — | none | yes |
| Blackjack | — | — | — | — | — | — | **no** (chips are a balance, not a score) |
| Daily Word | — | — | — | — | — | — | **no** |

"Recorded, not partitioned" fields go into `games.metadata` so a board can be split later without a backfill. Sort's levels are generated with a fixed seed (`backend/sort/generate_levels.py`), so every player gets the same 23 levels and `total_moves` across cleared levels is a fair tie-break; Sort must start sending it.

### 4.3 One result envelope

**Revised 2026-09-25 (§8 decision 11): the contract is the one PR #2592 shipped for #2517.** `games.outcome` carries the result for games with a winner, so there is no separate `won` field:

| `outcome` | Meaning |
|---|---|
| `win` / `loss` / `push` | A finished game with a winner; `push` is a tie. Written through `frontend/src/game/_shared/recordedOutcome.ts` |
| `completed` / `kept_playing` | A finished game with no win concept (score-only games) — win rate shows "—" |
| `abandoned` | The player left; excluded from boards, stats and XP by `not_abandoned()` |

- Already on `dev` via #2592: Yacht vs computer, Hearts, Daily Word, Mahjong (deadlock is a `loss`). Still to adopt it: Blackjack (run goal reached = `win`, busted out = `loss`, leaving mid-run = `abandoned`) and Twenty48 (reaching 2048 = `win`).
- The never-written `blackjack` member of `GameOutcome` is removed. `ARCHITECTURE.md §4`'s "outcome is lifecycle-only" line and `GAME-CONTRACT.md §1.2` are rewritten to match. The frontend's three `GameOutcome` types collapse to `api/vocab.ts` plus `GameResultModal`'s presentational `win | loss | draw | ended`.
- `duration_ms` is always populated: `SyncWorker` falls back to `completed_at − started_at` when a game sends none or 0.
- Abandon rules move fully into `useGameSync`: screens stop sending their own `beforeRemove` abandons with scores and zero durations; `restart()` checks `startedRef`; a `ProgressSnapshot` is registered by every game. A server-side sweep marks rows with `completed_at IS NULL AND started_at < now() − 24h` as `abandoned` so killed apps stop leaking sessions.

### 4.4 UI: three surfaces with clear jobs

| Surface | Job | Design |
|---|---|---|
| **Result card** (`GameResultModal`) | End of *this* game | Already the standard (#2500). Finish Blackjack (#2507), Mahjong (#2510), Sort (#2512), Star Swarm (#2516). Add a **"View leaderboard"** secondary action whenever the game's board is enabled, so submissions are never write-only. |
| **Leaderboard** (new generic `LeaderboardScreen`) | Top N for *one* game, one partition | Parameterised by `gameType` and a partition picker (chips for difficulty/variant/tier). Columns from the board definition: rank, name, metric (labelled), date. Shows "Your best: #rank" from the session's own row. Reached from the result card and from the game's overflow menu. **The "Ranks" bottom tab is retired** (it was Star Swarm-only and is already hidden in store builds); the app keeps three tabs. |
| **Game stats** (rename of the "Scoreboard" overflow) | *My* history for *this* game | Split the two things it currently conflates. (a) **Live in-match views** (Hearts rounds table, Yacht scorecard, Blackjack session P/L) stay bespoke and move under a "Scorecard"/"Rounds" menu label — they are gameplay UI. (b) **Per-game stats** become one shared `GameStatsScreen` fed by `/stats/me` for that game (played, completed, won/lost or n/a, current and best win streak for games with a win concept, best with its label, time played, last played) plus the game's leaderboard link. Device-local stat stores (`*_stats_v1`) are retired as a source of truth; local best remains a cache for the "New best" badge. Mahjong, FreeCell, Daily Word, Sort and Star Swarm gain the screen for free. |

**Profile** becomes the cross-game *personal* dashboard and only shows comparable things:

- Sessions, completed, completion rate, time played, games tried, favourite (by *completed*), day streak.
- A per-game list (games visible in this build): each row shows that game's own best with its own label ("412 pts", "87 moves", "Level 19", "0 / 6 guesses") and its win rate or "—" when the game has no win concept. **The cross-game "Top score" tile is removed.**
- Recent games keep the outcome glyph but render a localised outcome and the metric with its label.

### 4.5 Comparable cross-game metrics — what the server needs to expose

| Metric | Source | Change needed |
|---|---|---|
| Sessions ended | `played` (rows with `completed_at`) | rename to `sessions` in the response; Sort/Star Swarm on pipeline A; stale-row sweep |
| Completed | `completed_played` (already computed) | **expose it** |
| Abandoned / abandon rate | `sessions − completed` | falls out of the two above; `restart()` fix removes over-count |
| Won / lost / tied / n/a | `outcome` = `win` / `loss` / `push` | count per game; return `null` for games that never write a result outcome |
| Time played | `duration_ms` sum, fallback `completed_at − started_at` | SyncWorker fallback; stop screens sending 0 |
| Per-game best (never compared) | `best` with direction | `best_value` + `best_label_key` (§4.2) |
| Streaks | `streak_days` exists (daily challenge) | **per-game win streaks are in scope** (§8 decision 10): current and best run of consecutive `win` outcomes, ordered by `completed_at`; `null` for no-win games. A `push` neither extends nor breaks a streak. Abandons do not break a streak (no penalty for leaving, per `PRODUCT.md`). Milestone badges stay out of scope. |

`GameTypeStatsResponse` drops the hard-coded Blackjack columns in favour of a small `extras: dict` that `stats_shape` may fill (Blackjack's chips live there).

---

## 5. Existing issues — disposition

All 204 open issues were scanned; the ones that touch this area are listed. "Absorb" means the new epic's story covers it and the old issue is closed with a link.

| # | Title (short) | Status today | Disposition |
|---|---|---|---|
| **2519** | [Placeholder] Unify scoring API and leaderboard behavior | The core placeholder; its five design questions are answered in §4/§8 | **Becomes the epic** (retitle, replace body with this plan's §4 and §7) |
| **2500** | Epic: Normalize end-of-game outcomes | 12 of 17 children done | Keep open; remaining children (#2507, #2510, #2512, #2516) are Phase 2 of this plan |
| 2507 / 2510 / 2512 / 2516 | Blackjack / Mahjong / Sort / Star Swarm → `GameResultModal` | Open; #2510 in PR #2569 | Keep; #2512 and #2516 gain "adopt `useGameSync`" acceptance criteria (they already mention it) |
| **2517** | Record real win/loss/draw in `useGameSync` | Closed Sep 24 by PR #2592 | Its contract is adopted (§8 decision 11); Blackjack and Twenty48 adopt it in Phase 2 |
| 2448 | Epic: result reporting / daily challenge / streak | Launch children shipped | Close as launch tracker, or keep for its post-launch tail (#2458–#2462, #2469, #2478) |
| 2469 | result-envelope follow-ups | Open, low | **Absorb** into §4.3 story (one abandon path, snapshot boilerplate, validated results) |
| 2446 | Daily Word / FreeCell record no session | Shipped in #2451/#2452 | **Close** |
| 2216 | Star Swarm scores never surface in `/stats/me` | Open | **Absorb** into "every game on pipeline A" story; note Sort has the same defect |
| 2215 | Score submission upper bounds | Open | **Absorb** into board definition (`max_value`) |
| 2217 | Leaderboard GETs rate-limited by IP | Open | **Absorb** into the single generic leaderboard route |
| 2270 | DECISION: finish or delete abandoned sync layer (`useLeaderboard`, unused `GameSession` types) | Open | **Decide here:** delete `useLeaderboard` and the unused `_shared/types.ts` aspirational types; the new leaderboard screen uses a fresh hook against the generic route |
| 2231 | Product decisions incl. Sort `level_reached` comparability | Open | Sort item answered by §8 decision 5 (levels are seeded, so comparable; tie-break on total moves); rest untouched |
| 2272 | `reset_leaderboard()` stubs in 6 routers | Open | **Absorb**: the routers are deleted with pattern C |
| 1130 | Star Swarm submission + top-10 (legacy) | Backend shipped | **Close** as superseded by #2516 |
| 1131 | Twenty48 submission + top-10 (legacy) | Open | **Close** as superseded: Twenty48 gets a board (§8 decision 1) via a board definition, not a new router |
| 1132 | Yacht submission + top-10 (legacy) | Orphaned backend router | **Close**; Yacht's board is a board definition on pipeline A; delete `backend/yacht/router.py` score routes |
| 1499 | Daily Word streak (current + best) | Partially superseded by `streak_days` | Keep, low; depends on §4.3 win/loss outcomes |
| 2459 / 2462 | Streak grace days / milestone badges | Open, low | Untouched and out of scope; per-game win streaks are in this epic, badges are not |
| 1914 | Guideline 4.2 cohesion tracker | Partially done | Update: "unified board" → per-game boards via §4.4; Game Center remains a separate decision |
| 2201 | Win modals cover win animations | Probably fixed by `GameResultModal` celebration phase | **Verify on device and close** |
| 2226 | Docs truth-sync incl. ARCHITECTURE §9 | Open | Feed Appendix A into it |
| 1047 | Epic: accounts / SSO | Long-term | The eventual answer to identity; §4.1 keeps display-name-on-session-row compatible with it |

**Not tracked anywhere today** (new stories in §7): Profile cross-game Top score; `completed_played` and win counts in `/stats/me`; the board definition; the generic leaderboard screen and "View leaderboard" action; the Scoreboard split; Mahjong's broken overflow route; `duration_ms` fallback; stale-row sweep; server-side idempotency (closed #155 never landed); `GAME-CONTRACT.md` frontend section.

---

## 6. Sequencing

Launch constraints from `RELEASE-PLAN-2026-10.md`: production API cutover Tue Sep 29, store submission Oct 9, **launch quality bar = crash/stability only**. Six of the twelve games are hidden in the store build. Therefore:

- **Phase 0 — before submission: decisions only, no code.** Nothing in this plan is a stability fix. The one product-rule violation visible to store users (Profile Top score) is cosmetic and waits. §8 was answered on Sep 25; the issues can be filed now and picked up after submission.
- **Phase 1 — backend contract (post-launch, first).** Board definitions, generic leaderboard/rank/name routes, `duration_ms` fallback in the envelope, `completed_played` and win counts exposed, stale-row sweep, migration for `*-anon` rows, delete the nine routers. All behind existing tests plus the new ones in Appendix C. Frontend keeps working throughout because the old routes are removed only after Phase 2 ships (keep them one release as thin shims onto the generic route).
- **Phase 2 — frontend reporting (per game, one PR each).** Sort and Star Swarm adopt `useGameSync`; Mahjong, Sort, Star Swarm, Blackjack adopt `GameResultModal` + `useLeaderboardSubmit` (finishing #2500); Blackjack and Twenty48 record `win`/`loss` like the #2592 games; screens drop their own abandon handlers; SyncWorker duration fallback. Free visible games first (Mahjong, FreeCell, Yacht, Twenty48, Solitaire), hidden premium games after.
- **Phase 3 — UI consolidation.** Generic `LeaderboardScreen` + "View leaderboard" action; Ranks tab retired; Scoreboard split into Scorecard (live) and `GameStatsScreen` (server-fed, with per-game win streaks); Profile rebuilt on comparable metrics; localisation of outcomes and the fallback string; i18n namespaces consolidated (`leaderboard.json`, `stats.json`).
- **Phase 4 — clean-up and docs.** Appendix A and B; `GAME-CONTRACT.md` frontend §2 written for real (scoring, result, leaderboard contract + checklist items); `GAMEPLAY_STANDARDS.md §8` gains a "Reporting" checklist; Maestro flow for one result-card submission on iOS and Android.

Rough size: Phase 1 ≈ 1 week backend; Phase 2 ≈ 1–2 days per game; Phase 3 ≈ 1–2 weeks; Phase 4 ≈ 3 days. Phases 1 and 2 can overlap once the generic route exists.

---

## 7. Proposed epic and stories

The filed issues under #2519 are authoritative where they differ from this list: they are written against `dev` after Sep 25 and include decisions 11–12 and three splits (stories 19, 22, 23). Originally drafted with the `plan-issues` process (it drafts, waits for confirmation, then creates). Labels: reuse `epic:leaderboards` as the umbrella label; add `backend`/`frontend`, per-game labels where they exist (note: no labels exist yet for cascade, twenty48, daily_word), and `priority:medium` unless stated. Each story links "Part of #2519".

**Epic — #2519 retitled: "Leaderboards & scoring: one reporting contract per game"**

Phase 1 — backend
1. **Board definition on `GameModule`** — `BoardDefinition` model (metric, direction, tie-break, partitions, max, enabled), `board` attribute, protocol test, initial definitions per §4.2, exported to `frontend/src/api/vocab.ts` via `gen_vocab_ts.py`. Absorbs #2215.
2. **Generic leaderboard, rank and name routes** — `GET /games/leaderboard/{game_type}`, `PATCH /games/{id}/name`, direction-aware `compute_rank`, session-keyed rate limit, entitlement check from the catalog. Absorbs #2217, #2272. Old routers become shims.
3. **Result envelope: `duration_ms` and one abandon path** — SyncWorker duration fallback; `restart()` guard; explicit result block; drop the unused `blackjack` outcome; outcome semantics per §4.3 (#2592's contract). Absorbs #2469 items 1–3.
4. **Expose comparable counts in `/stats/me`** — `sessions`, `completed`, `wins`, `losses`, `ties` (from `outcome`), `current_win_streak`/`best_win_streak` (null for no-win games; abandons don't break a streak), `time_played_ms`, `best_value`/`best_label_key`, `extras`; drop hard-coded Blackjack columns; update `GAME-CONTRACT.md §1.5`.
5. **Stale open session sweep** — mark `completed_at IS NULL AND started_at < now − 24h` as abandoned (scheduled task or on-read), test. Threshold decided: 24 h.
6. **Delete `*-anon` leaderboard rows** — Alembic data migration plus a test that no board contains a sentinel session.
7. **Register Twenty48 and Star Swarm modules** — metadata/result models, registry entries, `stats_shape`.
8. **Server-side idempotency for completion and name attach** — client id already exists on `POST /games`; make `PATCH …/complete` and `PATCH …/name` idempotent; test.

Phase 2 — frontend reporting (one story per game; #2507, #2510, #2512, #2516 already exist and are extended)
9. **Sort: adopt `useGameSync`, `GameResultModal`, `useLeaderboardSubmit`; send `total_moves` across cleared levels for the tie-break** (#2512 extended). Absorbs the Sort half of #2216's defect.
10. **Star Swarm: adopt `useGameSync`, `GameResultModal`, `useLeaderboardSubmit`; offline queue; drop `"player"`** (#2516 extended). Closes #2216, #1130.
11. **Mahjong: `GameResultModal` + `useLeaderboardSubmit`; deadlock already a `loss` (#2592); record `layout` in metadata; fix broken Scoreboard route** (#2510 extended, PR #2569 in flight).
12. **Blackjack: `GameResultModal` for victory and bust; run goal reached = `win`, bust = `loss`; server-side run summary in `extras`** (#2507 extended).
13. **Hearts: real `duration_ms` (win/loss already recorded by #2592); remove `pendingSubmission.ts` in favour of `scoreQueue`; record `ai_difficulty` in metadata.**
14. **Yacht: `duration_ms` (vs win/loss already recorded by #2592); record `mode`/`difficulty` in metadata; delete orphaned `/yacht/score` routes; one board for all modes.** Closes #1132.
15. **Twenty48: leaderboard submission via `useLeaderboardSubmit` and the result card's submission slot; reaching 2048 records `win`.** Closes #1131.
16. **Solitaire / Sudoku / Cascade / FreeCell / Daily Word: drop screen-level abandon handlers; FreeCell sends its score again on the session row; Solitaire records `draw_mode` in metadata.**

Phase 3 — UI
17. **Generic `LeaderboardScreen` + `useLeaderboardData` hook** — parameterised by game and partition; "Your best"; reached from result card ("View leaderboard" action) and overflow menu. Deletes `useLeaderboard.ts` (#2270 decided).
18. **Retire the Ranks tab** — update `premiumRoutes.ts`, `BottomTabBar`, `App.tsx`, tests; the release plan's "3 tabs" check holds in every build.
19. **Split Scoreboard into Scorecard (live) and `GameStatsScreen` (server-fed)** — shared screen for all 12 games, including current and best win streak for games with a win concept; retire `*_stats_v1` as a source of truth; fix Mahjong/FreeCell/Daily Word/Sort/Star Swarm gaps; translate the fallback.
20. **Profile on comparable metrics** — remove cross-game Top score; add completion rate, time played, per-game best-with-label and win rate; localise outcomes in recent games and `GameDetailScreen`.
21. **i18n consolidation** — `leaderboard.json`, `stats.json`; remove orphaned `mahjong.scoreboard.*`, duplicate `gamesPlayed` keys.

Phase 4 — docs, tests, cleanup
22. **`GAME-CONTRACT.md` frontend contract §2** — `useGameSync`, result envelope, `LeaderboardAdapter`, board definition, checklist items; fix §1.2/§1.3/§1.5. Also `ARCHITECTURE.md §4/§9/§12`, `GAMEPLAY_STANDARDS.md §8`, all 12 `docs/games/*.md` scoring sections (Appendix A). Feeds #2226.
23. **Tests** — no-duplicate-row test for every game; direction and tie-break test per board; win-streak tests (abandons don't break a streak); Mahjong Scoreboard route test; `ProfileScreen` test updated; one Maestro result-submission flow on iOS and Android (Appendix C).
24. **Dead code removal** — Appendix B.

---

## 8. Owner decisions (recorded 2026-09-25)

| # | Question | Decision | Why |
|---|---|---|---|
| 1 | Twenty48 leaderboard? | **Yes, one global board by score** | Free, visible, comparable score; sessions already reach the server |
| 2 | Yacht partition | **One board, solo and vs mixed**; record `mode` and `difficulty` | Difficulty only changes the opponent; the player's own score is ranked |
| 3 | Mahjong partition by layout | **One board; record `layout`** | All 25 layouts are 144 tiles, so the max score is identical. Split later if boards diverge |
| 4 | Hearts partition by AI difficulty | **Record `ai_difficulty`, don't partition** | Split only if scores clearly differ |
| 5 | Sort ranking metric | **Highest level cleared, tie-break fewest total moves** | Levels are generated with a fixed seed, so every player gets the same 23 levels; the cap only causes ties, which moves resolve |
| 6 | Existing `*-anon` rows | **Delete in a data migration** | Cannot be attributed to a player; the store build is unreleased, so they are test plays |
| 7 | Ranks tab | **Retire** | Boards open from the result card and game menu; app keeps three tabs |
| 8 | Blackjack win | **Reached the run goal = win; busted out = loss; leaving mid-run = abandoned** | Uses the game's own victory condition |
| 9 | Stale open session threshold | **24 hours after `started_at`** | Safe for long Hearts matches; matches entitlement TTL |
| 10 | Per-game win streaks and badges | **Win streaks in this epic (Phase 1 story 4, Phase 3 story 19); badges later** | Streaks fall out of the `win` outcomes; abandons don't break a streak |

| 11 | Where the win is recorded | **Keep PR #2592's contract: `outcome` = `win` / `loss` / `push` for games with a winner; no separate `won` field** | Shipped and tested on `dev` on Sep 24; the read side already counts these rows; reverting would need a data migration for no user-visible gain |
| 12 | How boards count players | **One entry per player: each session's best row only** | Stops Sort (one session per level) and frequent replayers from filling a top 10 |
| 13 | Solitaire `max_value` | **1245, with a test that recomputes it from the engine's constants** | 24 stock cards × 15 + 28 dealt cards × 10 + 21 reveals × 5 + 500 win bonus; moving a card off a foundation costs more than returning it earns, so replays can't farm points |
| 14 | Games with no natural maximum (Star Swarm, Cascade, Twenty48) | **No cap for now** | Rate limits plus one entry per player cap a fake score at one row per device; revisit when scores earn rewards |
| 15 | Stale-session sweep mechanism | **On read, per player**, at the start of `/stats/me` and `/games/me` | No scheduler exists; a cron job can be added later if global analytics need it |
| 16 | Blackjack's on-device run-history screen | **Keep it, linked as "Run history" from the shared stats screen** | Per-run details aren't on the server; counts and win rate come from `/stats/me` |

**`dev` moved while this plan was being decided (Sep 24–25).** PRs #2569 (Mahjong), #2576 (Sort), #2578 (Blackjack), #2580 (Star Swarm) and #2592 (win/loss/push) merged, closing #2507, #2510, #2512, #2516, #2517 and epic #2500. Sort and Star Swarm now record session rows (without a score) and auto-submit under the display name through the shared queue; Star Swarm's hard-coded `"player"` and Mahjong's typed-name modal are gone. The §2–§3 tables describe `dev` at `ca087331` and are kept as the baseline; the filed stories are written against current `dev`.

**Corrections found while deciding:** the original draft said Sort's levels were randomised and Mahjong layouts had different tile counts. Both were wrong (`backend/sort/generate_levels.py` seeds its RNG; every entry in `frontend/src/game/mahjong/layouts/registry.ts` is 144 tiles). The recommendations above reflect the corrected facts.

---

## Appendix A — docs that are wrong today

| Doc | Says | Reality |
|---|---|---|
| `ARCHITECTURE.md` §4 | Every game uses the shared pipeline; no game has its own queue | Sort and Star Swarm bypass it; Hearts has `pendingSubmission.ts` |
| `ARCHITECTURE.md` §9 | Star Swarm and FreeCell leaderboards are in-memory | Both DB-backed |
| `ARCHITECTURE.md` §12 | Daily challenge has no table | `DailyChallengeDay` + migration 0019 exist |
| `GAME-CONTRACT.md` §1.2 | `win/loss/push/blackjack` outcomes for Blackjack | Never written |
| `GAME-CONTRACT.md` §1.3 | Protocol = `game_type`, `metadata_model`, `stats_shape` | `result_model` also required |
| `GAME-CONTRACT.md` §1.4 | Twenty48 frontend-only | Writes session rows; just unregistered |
| `GAME-CONTRACT.md` §1.5 | `played` = completed count | Includes abandons; `completed_played` undocumented and unexposed |
| `GAME-CONTRACT.md` §2 | Frontend contract pending #522 | `useGameSync`/`GameShell` exist in 10 games; no scoring contract written |
| `games/blackjack.md` | `final_score` = chips | Never sent |
| `games/daily_word.md` | `final_score` = guesses ↓ | `null` |
| `games/hearts.md` | `final_score` = penalty ↓ | `100 − penalty` ↑ |
| `games/freecell.md` | `final_score` = moves; "no module.py" | Only on anon rows; module exists |
| `games/mahjong.md` | Deadlock = abandoned/lost | Not a completion; abandon only on navigation |
| `games/solitaire.md` | Score includes a time bonus | No time term in the engine |
| `games/sort.md` | Tracked per session | No session rows |
| `games/twenty48.md` | Frontend-only, no backend | Sessions recorded via `/games` |
| `games/yacht.md` | Board per difficulty | Not partitioned; stores `400 − raw`; no caller |
| `games/cascade.md` | Score submitted via `scoreSync` | Score travels on the session row; `scoreSync` attaches the name |

## Appendix B — dead code and cleanup

- `frontend/src/game/_shared/useLeaderboard.ts` (no callers) and the unused `Player`/`GameOutcome`/`GameSession` types in `_shared/types.ts` (#2270).
- `backend/yacht/router.py` score routes, `yacht/models.py` `ScoreEntry`/`LeaderboardResponse` (no frontend caller).
- `reset_leaderboard()` no-op stubs in six routers (#2272) — removed with the routers.
- `getLeaderboard()` in eight per-game API clients — replaced by the generic hook.
- `frontend/src/game/hearts/pendingSubmission.ts` — redundant with `scoreQueue`.
- `frontend/src/game/mahjong/MahjongScoreboardContext.tsx` — written, never read (either wire it into the live Scorecard or delete).
- Orphaned i18n: `mahjong.json` `scoreboard.rank/player/score/empty`, `sort.json` `win.enterName/submitScore`, the third copy of `gamesPlayed`.
- Per-game `*_stats_v1` AsyncStorage stores once `GameStatsScreen` reads the server.
- Hard-coded `player_id: "player"` in `frontend/src/game/starswarm/api.ts`.

## Appendix C — test safety net and gaps

**Exists (runs in CI on SQLite):** `/stats/me` aggregates, XP, streaks, daily challenge, abandon exclusion across all nine leaderboard routes (`test_abandoned_excluded_from_leaderboards.py`), per-game leaderboard API tests, FreeCell's no-duplicate test (`test_freecell_module.py:151-169`), `useGameSync`/`syncWorker`/`scoreQueue`/`useLeaderboardSubmit` unit tests, five adapter tests, `GameResultModal` tests, `ScoreboardScreen`/`ProfileScreen`/`LeaderboardScreen` screen tests. Web-only Playwright leaderboard specs for seven games.

**Gaps to close in this epic:**
- No no-duplicate test for Solitaire, Mahjong, Hearts, Yacht (Phase 1 story 2 adds one per board via the generic route).
- No test of leaderboard sort direction against the board definition.
- `ScoreboardScreen.test.tsx` asserts the fallback only for an *unknown* key, which is how Mahjong slipped through; add a "every visible game has a stats screen" test.
- `ProfileScreen.test.tsx` encodes the cross-game Top score; rewrite with the new tiles.
- No test that auto-submit never fires on an abandon (owner asked on #2519).
- No native (Maestro) flow covers result submission, leaderboards, stats or Profile; add one result-card submission flow per platform, gated to the on-demand workflow until #2400/#2347 restore Maestro as a PR gate.
