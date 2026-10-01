# Arcade XP and Player Progression

Arcade XP is BC Arcade's lightweight cross-game progression system. It acknowledges completed play and breadth across the arcade without creating a grind economy or a separate spendable currency.

The implementation source of truth is `backend/games/progression.py`. This document explains the product and data contract.

## 1. Core rule

Arcade XP is derived from completed game-session history:

- **10 XP** for every completed, non-abandoned game.
- **+50 XP** for each distinct game type with at least one completed, non-abandoned game.

The breadth bonus is effectively earned once per game type. Playing that same game again continues to earn the normal 10 XP per completion but does not add another 50 XP breadth bonus.

### Example

A player has completed:
- 3 games of Solitaire;
- 2 games of Sudoku;
- 1 game of Yacht.

That is 6 completed games across 3 distinct game types:

- base XP: 6 × 10 = 60;
- breadth bonus: 3 × 50 = 150;
- total Arcade XP: **210**.

## 2. What counts as a completed game

The XP input is each game's `completed_played` count from the shared Stats aggregation.

A row counts when:
- it has completed;
- its outcome is **not** `abandoned`.

That means a legitimate completed result can earn XP whether the outcome is:
- `win`;
- `loss`;
- `push`;
- `completed` for games without a winner concept.

Starting a game and backing out does **not** earn XP.

The broader `sessions` metric intentionally still counts abandoned sessions as lifecycle history. Do not use `sessions` as an XP input.

## 3. No XP ledger

There is no mutable XP balance table.

`GET /stats/me`:
1. derives the player's current game statistics from the shared `games` table;
2. passes that summary to `compute_progression()`;
3. returns the resulting XP/level fields.

This has useful consequences:

- XP cannot drift away from game history.
- Offline-completed games contribute once their session rows sync to the server.
- A corrected historical game row automatically affects progression on the next calculation.
- If the XP formula or level thresholds are deliberately changed in a future release, existing players' displayed XP/levels are recomputed from their session history under the new formula. There is no migration of stored XP balances because no balances are stored.

## 4. Level thresholds

Levels are based on cumulative Arcade XP.

| Level | Cumulative XP required |
| ---: | ---: |
| 1 | 0 |
| 2 | 100 |
| 3 | 250 |
| 4 | 450 |
| 5 | 700 |
| 6 | 1,000 |
| 7 | 1,400 |
| 8 | 1,900 |
| 9 | 2,500 |
| 10 | 3,200 |

The thresholds are intentionally kept in one ordered constant, `LEVEL_THRESHOLDS`, and are marked tunable post-launch.

Level 1 starts at 0 XP. The highest threshold reached determines the player's current level.

## 5. API fields

`GET /stats/me` returns:

| Field | Meaning |
| --- | --- |
| `arcade_xp` | Total derived XP |
| `arcade_level` | Current level |
| `xp_into_level` | XP earned since the current level's threshold |
| `xp_for_next_level` | XP still needed to reach the next level |

Below the maximum level:

`xp_into_level + xp_for_next_level`

equals the gap between the current level threshold and the next threshold.

At the current maximum level:
- `xp_for_next_level = 0`;
- `xp_into_level` keeps increasing beyond the final threshold.

There is therefore no hidden hard cap on earned XP merely because the displayed level table currently ends at 10.

## 6. Home screen

Home shows the player's current Arcade level as a lightweight header pill.

The level is decorative and never blocks the game grid.

Home:
- flushes queued completed games before fetching Stats so a just-finished game can affect the displayed level;
- refreshes on mount/focus, reconnect, and foreground;
- skips the request while the device is known offline;
- omits the pill (or retains the last in-memory value during an existing screen session) when the Stats request cannot provide a fresh value.

Home also displays the Daily Challenge streak, but **streak and XP are separate systems**. See the Daily Challenge documentation once #2803 lands.

## 7. Profile

Profile shows the fuller progression presentation through `LevelProgress`:

- current level;
- total XP;
- progress within the current level;
- XP remaining to the next level.

Profile uses the server-derived values as returned. It does not re-derive XP from only the games currently visible in the build.

That distinction matters because progression belongs to the player's complete BC Arcade history, while store-build visibility can hide games from navigation.

## 8. Daily Challenge relationship

Daily Challenge completion does **not** add a separate XP award in the current progression formula.

The individual completed game sessions used to satisfy Daily Challenge goals earn XP under the same normal rules as any other completed games.

If a future product decision adds a direct challenge XP bonus, that would require an explicit progression-model change; it should not be inferred from streak/challenge completion.

## 9. Premium/free relationship

XP is based on completed game types in the player's recorded history, not on a separate free/premium multiplier.

There is currently:
- no paid XP;
- no XP purchase;
- no XP spending;
- no XP-based gameplay gate;
- no reduced XP rate for free games.

Premium entitlement and game visibility are separate product systems.

## 10. Offline behavior

Gameplay can finish offline through the shared game-session sync system.

While offline:
- a newly completed game may not yet be represented in server-derived XP;
- Home does not make a doomed Stats request when connectivity is known unavailable;
- once queued game data syncs, the next Stats refresh recomputes XP and level from the updated history.

Arcade XP itself does not need a separate offline mutation queue because there is no XP transaction to upload.

## 11. Ownership and change rules

When changing progression:

1. `backend/games/progression.py` owns the formula and thresholds.
2. Its unit tests must cover the intended values and boundary cases.
3. `/stats/me` remains the server delivery surface.
4. Home/Profile should render returned progression values, not invent a second formula.
5. Update this document in the same change.
6. Do not duplicate the formula in release plans, store copy, or per-game specs; those locations should summarize and link here when implementation detail is needed.

For the broader Stats contract, see [GAME-CONTRACT.md](GAME-CONTRACT.md). For player-facing Stats/Profile roles, see the canonical leaderboard/reporting documentation once #2802 lands.
