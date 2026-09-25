# Mahjong

**Category:** Puzzle
**Tier:** Premium (hidden in the v1.0 store build; swapped with Sort, owner decision 2026-09-24)
**Status:** In Development

## How to Play

Mahjong Solitaire (Shanghai-style). Remove all tiles from the board by matching identical pairs. A tile is selectable only if it has no tile on top of it and is free on at least one side (left or right).

### Layout

The default layout is the Turtle / Tortoise stack: a multi-layer pyramid of 144 tiles arranged in a traditional pattern. Additional layouts may be added over time.

### Rules

- Select two matching free tiles to remove them
- Tiles are "free" if they have no tiles above them and at least one horizontal side is open
- Joker / flower tiles match any tile of the same category (if present)
- The game is won when all tiles are removed
- The game is lost if no matching free pairs remain (deadlock)

### Shuffle

If a deadlock is detected, a shuffle option is offered. Shuffles may be limited — see implementation for count.

## Scoring (Persistence)

`final_score` = 10 per pair removed + 500 for clearing the board (max 1220). What each game records (#2627):

- A cleared board completes with outcome `win`, its `final_score` and `result: { won: true, pairs }`.
- A deadlocked board the player leaves completes with outcome `loss` and no score (#2592). "Undo last move" on the deadlock card rescues the board and records nothing.
- Any other exit is `abandoned`, with the progress snapshot `result: { won: false, pairs }` and no score.
- The layout played is creation metadata (`layout`). All layouts share one board.

The finished session row is the leaderboard entry: a named player's best win ranks once, under their display name. The result card asks `GET /games/{id}/rank` (`sessionBoardAdapter`); the app no longer calls `POST /mahjong/score`, which stays for installed builds until #2644.

This game is **offline-capable** — the engine runs client-side and the board state persists to AsyncStorage. Finished games upload through `SyncWorker` when online.

## Client-Side Engine

- Location: `frontend/src/game/mahjong/engine.ts`
- Key exports: tile matching, free-tile detection, deadlock detection, shuffle
- Rendering: `@shopify/react-native-skia` on native; Canvas2D on web

## Backend

- Module: `backend/mahjong/module.py`
- Endpoints: `backend/mahjong/router.py`
- Metadata model: `MahjongMetadata` — `player_name: str = ""` (max 64 chars), `layout: str | None` (layout id)
- Scoring: `final_score` = score at game end

## Accessibility

Mahjong uses a Skia canvas on native. The canvas must be complemented by native accessible elements for score and game state. See [`docs/ACCESSIBILITY.md §4`](../ACCESSIBILITY.md#4-screen-readers).

## Entitlement

Premium: requires a valid entitlement JWT. Offline play continues within the
7-day grace period; see [`docs/ARCHITECTURE.md §10`](../ARCHITECTURE.md#10-premium-entitlements).

## Known Issues / Limitations

- Responsive board layout extraction pending (Epic #1331 — `calculateMahjongLayout()` to be extracted)
- Engine shipping tracked in issue #870
