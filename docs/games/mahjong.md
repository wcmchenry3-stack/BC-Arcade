# Mahjong

**Category:** Puzzle
**Tier:** TBD
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

`final_score` = derived from number of moves, shuffles used, and completion time. A completed board is `COMPLETED`; a deadlocked/abandoned game is `ABANDONED`.

This game is **offline-capable** — the engine runs client-side and the board state persists to AsyncStorage. Scores are submitted to the server when online.

## Client-Side Engine

- Location: `frontend/src/game/mahjong/engine.ts`
- Key exports: tile matching, free-tile detection, deadlock detection, shuffle
- Rendering: `@shopify/react-native-skia` on native; Canvas2D on web

## Backend

- Module: `backend/mahjong/module.py`
- Endpoints: `backend/mahjong/router.py`
- Metadata model: `MahjongMetadata` — `player_name: str = ""` (max 64 chars)
- Scoring: `final_score` = score at game end

## Accessibility

Mahjong uses a Skia canvas on native. The canvas must be complemented by native accessible elements for score and game state. See [`docs/ACCESSIBILITY.md §4`](../ACCESSIBILITY.md#4-screen-readers).

## Entitlement

Tier TBD. If free: no entitlement check.

## Known Issues / Limitations

- Responsive board layout extraction pending (Epic #1331 — `calculateMahjongLayout()` to be extracted)
- Engine shipping tracked in issue #870
