# Hearts

**Category:** Card
**Tier:** TBD
**Status:** In Development

## How to Play

Hearts is a 4-player trick-taking card game where the goal is to end with the **lowest** score. Each round, players pass 3 cards to an opponent (direction rotates each round), then take turns playing one card per trick. The player who played the highest card of the led suit wins the trick and leads the next one.

Hearts (♥) may not be led until the suit has been "broken" (played as a discard on another suit). The Queen of Spades (♠Q) may be led at any time.

BC Arcade's Hearts is 1v3 against AI opponents.

### Penalty Points

- Each heart taken: **1 point**
- Queen of Spades: **13 points**
- Total per round: up to **26 points**

### Shooting the Moon

If one player takes **all 13 hearts and the Queen of Spades** in a single round, that player scores 0 and every other player scores 26.

### Winning

Play continues until at least one player reaches 100 points. The player with the **lowest score** at that point wins.

## Scoring (Persistence)

- **Metric and direction:** `final_score`, **higher is better**, labelled `score` (`board` in `backend/hearts/module.py`; `BOARDS.hearts` in `frontend/src/api/vocab.ts`). It is `100 −` the player's penalty points at game end, floored at 0 (`heartsLeaderboardScore` in `frontend/src/game/hearts/result.ts`). Fewer points in play gives a higher score.
- **Tie-break:** none declared. Equal scores go to the earlier `completed_at`, the last tie-break on every board.
- **Partitions:** none: one board for every opponent style (#2519 decision 4).
- **Recorded, not partitioned:** creation metadata `ai_difficulty` (`HeartsMetadata`): the opponent style, one of `AI_PRESETS` in `frontend/src/game/hearts/types.ts` (`cautious`, `schemer`, `daring`, `mixed`). Result (stored as sent: `result_model = None`): `final_score` and `vs_result` on a finish, `hands_played` on an abandon.
- **Max value:** 100.
- **Outcomes:** `has_winner = True`. Game over records who won (`heartsResult`): `win` when the player alone has the lowest total, `push` when they share it, `loss` otherwise. All three rank. New Game, Change Difficulty and leaving the screen record `abandoned` (`hands_played`, no score) once a card has been played.
- **Duration:** Hearts' own play clock (#2629): active time while an unfinished game is on screen with the app in front. It wins over `useGameSync`'s window.
- **How it reaches the server:** the `useGameSync("hearts")` session row, opened at the player's first card. `SyncWorker` sends `POST /games` and `PATCH /games/{id}/complete`. If the player has a display name (`PUT /players/me`), the row ranks with no further step. The board shows each named player's best game once. The app no longer calls the legacy `POST /hearts/score`. Shared rules: [Leaderboard routes](../GAME-CONTRACT.md#leaderboard-routes-2618).
- **Where the player sees it:** the result card shows the rank through `sessionBoardAdapter` (`GET /games/{id}/rank`), or asks once for a display name. The card's "View leaderboard" link and the ⋯ menu open the Leaderboard screen (#2633). Stats (#2635) are in the ⋯ menu. Store builds hide Hearts (`HIDDEN_GAMES`, `frontend/src/entitlements/gameVisibility.ts`), so there it has no leaderboard or stats entry point.

## Client-Side Engine

- Location: `frontend/src/game/hearts/engine.ts`
- Key exports: card passing logic, trick resolution, moon-shot detection, AI decision-making

## Backend

- Module: `backend/hearts/module.py`
- Endpoints: `backend/hearts/router.py`, legacy. `POST /hearts/score` and `GET /hearts/scores` stay for installed builds until #2644; the app no longer calls them.
- Metadata model: `HeartsMetadata` — `player_name: str = ""` (max 64 chars), `ai_difficulty: str | None` (max 32 chars)
- Scoring: `final_score` = 100 − penalty points, higher is better; see [Scoring](#scoring-persistence)

## Entitlement

Tier TBD. If premium: requires a valid entitlement JWT. Offline play continues within the 7-day grace period; see [`docs/ARCHITECTURE.md §10`](../ARCHITECTURE.md#10-premium-entitlements).

## Known Issues / Limitations

- None tracked at this time
