# Cascade

**Category:** Arcade
**Tier:** TBD
**Status:** Shipped (v2 engine — see epic #1746)

## How to Play

Cascade is a physics-based piece-drop game. Pieces fall from the top of the screen into a bin. When two pieces of the same tier collide they merge into a higher-tier piece, scoring points. The goal is to score as high as possible before the bin overflows.

### Piece Progression

Pieces evolve through 10 fixed tiers. The lowest-tier pieces are droppable (tiers 0–4); higher tiers are only reachable via merging. The highest tier is the **Watermelon**; two Watermelons do not merge (`MAX_TIER`). Definitions are in `frontend/src/game/cascade/pieceDefs.ts`.

A merge scores the new piece's `scoreValue` (`pieceDefs.ts`). The values follow the triangular numbers 1, 3, 6, 10, 15, 21, 28, 36, 45, 55 for tiers 0–9, so a merge into the Watermelon scores 55. There is no jackpot bonus.

### Gameplay

- The current piece and the next queued piece are shown at the top of the screen
- The player taps or swipes to aim, then releases to drop
- Pieces roll and stack after landing — physics are fully simulated at 60 Hz
- Merges can chain: a merge may cause the new piece to immediately contact another of the same tier, triggering another merge
- Game over when any piece rests above the bin's overflow line for more than 3 seconds of accumulated ticks

## Client-Side Engine

All game logic is client-side and offline-capable. Each game reaches the backend as a session row with its events; see [Scoring](#scoring-persistence).

### Module Map

| File                | Purpose                                                                      |
| ------------------- | ---------------------------------------------------------------------------- |
| `engine2.ts`        | Core physics simulation (`CascadeEngine` class, Matter.js wrapper)           |
| `pieceDefs.ts`      | 10-tier piece definitions: label, color, score, shape (`circle` or `convex`) |
| `constants.ts`      | All tunable physics & gameplay parameters                                    |
| `pieceQueue2.ts`    | Current + next piece queue (preview UI data)                                 |
| `spawnSelector2.ts` | Weighted random tier selection with drought correction & danger suppression  |
| `scoring.ts`        | Unused merge score calculator; the engine scores with `pieceDefs.ts`         |
| `storage2.ts`       | AsyncStorage save/load — versioned `SavedState` (v3)                         |
| `types.ts`          | `CascadeSession` and the `GameEvent` union type                              |

### Physics

- **Engine:** Matter.js (rigid-body simulation), rendered via `@shopify/react-native-skia`
- **Timestep:** Fixed 16.67 ms (60 Hz) with up to 3 substeps per frame to handle variable frame rates
- **Sleep system:** Pieces sleep after 10 frames below velocity threshold — eliminates micro-vibration
- **Guard rails:** Out-of-bounds bodies are clamped back inside and a `guardRailFired` event is emitted. `Matter.World.remove()` is only called during confirmed merges — no silent deletion
- **Angular damping:** Applied post-physics with a hard clamp on `MAX_ANGULAR_VELOCITY`

### Piece Queue & Spawn Selection (`pieceQueue2.ts`, `spawnSelector2.ts`)

- Queue holds `{ current, next }` tiers; `advanceQueue()` shifts forward and generates a new `next`
- Tier selection uses a weighted random algorithm:
  1. Base weights favour lower tiers (`{0:5, 1:4, 2:3, 3:2, 4:1}`)
  2. Drought boost: tiers absent from the last 10 drops gain +3 weight
  3. Danger penalty: when the stack is near the overflow line, tiers ≥3 are reduced to 20% weight
  4. Streak hard-ban: if the last 4 picks are identical, that tier is banned for one turn
- RNG is injectable for deterministic testing and seeded replay

### Combo Detection (`engine2.ts`)

A `cascadeCombo` event is emitted when ≥3 merges occur within `COMBO_WINDOW_TICKS` (120 ticks, ~2 s). The combo counter resets on each drop.

### Persistence (`storage2.ts`)

- Saved state is versioned (`SavedState` v3) — includes pieces, score, and queue state
- `looksValid()` type guard runs strict validation on load; corrupt saves are wiped cleanly
- Sentry is notified on any storage error

## Backend

- Module: `backend/cascade/module.py`
- Endpoints: none of its own — the generic `/games` routes. The legacy `PATCH /cascade/score/{game_id}` and `GET /cascade/scores` were removed in #2644.
- Metadata model: `CascadeMetadata` — `player_name: str = ""` (max 64 chars). Current builds send no metadata.
- Result model: none (`result_model = None`): the result block is stored as sent.
- Scoring: see [Scoring](#scoring-persistence)

## Scoring (Persistence)

- **Metric and direction:** `final_score`, higher is better, labelled `score` (`board` in `backend/cascade/module.py`; `BOARDS.cascade` in `frontend/src/api/vocab.ts`). It is the points at game over: for each merge the engine (`engine2.ts`) adds the new piece's `scoreValue` from `pieceDefs.ts`.
- **Tie-break:** none declared. Equal scores go to the earlier `completed_at`, the last tie-break on every board.
- **Partitions:** none: one board.
- **Recorded, not partitioned:** the result block from `progressResult` in `frontend/src/screens/CascadeScreen.tsx`: `final_score`, `duration_ms`, `theme`, `total_drops`, `total_merges`, and `outcome` on a finish. The fruit set is in the `game_started` event (`fruit_set`, `theme`), not in metadata.
- **Max value:** none (#2519 decision 14). Any integer up to 2³¹−1 is accepted.
- **Outcomes:** `has_winner = False`. Game over records `completed`. Restart during play records `abandoned` (`handleRestart`), and so does switching the fruit set mid-game (the fruit-set effect in `CascadeScreen.tsx` calls `endInstrumentedSession("abandoned")` and starts a new game). Leaving the screen records `abandoned` too (`useGameSync`'s unmount abandon), once a piece has been dropped. The Restart and fruit-set abandons carry the score so far in `final_score`, but abandoned rows never rank or count toward "best".
- **Duration:** Cascade's own `duration_ms` (`playedMs` in `CascadeScreen.tsx`): time since the session opened, less the time the player was away. Being away is another screen covering the board (navigation `blur`, #2743) or the app in the background (`AppState`, #2750): `usePauseWhileAway` stops the physics loop, and on return `gameStartTimeRef` moves forward by the pause. Because the value is > 0 it wins over `useGameSync`'s active-play window. The saved board carries `playedMs` (`SavedState` in `frontend/src/game/cascade/storage2.ts`), and the pause saves the board, so a game continued after an app kill keeps the play before it and doesn't count the time the app was closed. A save from a build before #2750 has no `playedMs`: its earlier play is unknown, so the game counts from the relaunch.
- **How it reaches the server:** the `useGameSync("cascade")` session row. `SyncWorker` sends `POST /games` after the first drop (`markStarted`) and `PATCH /games/{id}/complete` at game over. If the player has a display name (`PUT /players/me`), the row ranks with no further step. The board shows each named player's best game once. Shared rules: [Leaderboard routes](../GAME-CONTRACT.md#leaderboard-routes-2618).
- **Where the player sees it:** the result card shows the rank through `sessionBoardAdapter` (`GET /games/{id}/rank`), or asks once for a display name. The card's "View leaderboard" link and the ⋯ menu open the Leaderboard screen (#2633). Stats (#2635) are in the ⋯ menu. Store builds hide Cascade (`HIDDEN_GAMES`, `frontend/src/entitlements/gameVisibility.ts`), so there it has no leaderboard or stats entry point.

## Accessibility

Cascade uses a Skia canvas for rendering. The native accessibility tree does not include canvas content. Requirements:

- Current score must be displayed in a native `Text` element outside the canvas
- Game-over state must be announced via an accessible modal or live region
- Canvas element marked `accessible={false}`

See [`docs/ACCESSIBILITY.md §4`](../ACCESSIBILITY.md#4-screen-readers) for the full canvas accessibility contract.

## Entitlement

Tier TBD. If premium: requires a valid entitlement JWT; see [`docs/ARCHITECTURE.md §10`](../ARCHITECTURE.md#10-premium-entitlements).

## Known Issues / Limitations

- None tracked at this time
