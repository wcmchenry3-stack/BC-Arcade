# Bottle Sort

**Category:** Puzzle
**Tier:** TBD
**Status:** In Development

## How to Play

Bottle Sort (also called Color Sort) is a logic puzzle. A set of bottles contains colored liquid layers. Pour liquid from one bottle into another to sort each bottle so it contains only one color.

### Rules

- Each bottle holds up to 4 layers of liquid
- You can only pour the top layer of one bottle into another if:
  - The destination bottle's top color matches the source's top color (or the destination is empty)
  - The destination bottle has enough empty space to receive the pour
- A pour transfers all contiguous matching-color layers from the source at once
- The puzzle is solved when every bottle is either empty or contains a single uniform color

### Level Progression

Levels increase in difficulty (more bottles, more colors). Level data is defined in `backend/sort/levels.json`. Completing a level unlocks the next.

## Scoring (Persistence)

`final_score` = level number reached. Progress is tracked per-session. A completed level advances the counter; an abandoned session retains progress from the last completed level.

## Client-Side Engine

- Location: `frontend/src/game/sort/engine.ts`
- Key exports: `validatePour(state, from, to) → boolean`, `applyPour(state, from, to) → GameState`, win detection
- Level data: loaded from backend or bundled locally — check implementation

## Backend

- Module: `backend/sort/module.py`
- Endpoints: `backend/sort/router.py`
- Level data: `backend/sort/levels.json`
- Metadata model: `SortMetadata` — `player_name: str = ""` (max 32 chars)
- Scoring: `final_score` = highest level completed

## Entitlement

Tier TBD. If premium: requires a valid entitlement JWT; see [`docs/ARCHITECTURE.md §10`](../ARCHITECTURE.md#10-premium-entitlements).

## Known Issues / Limitations

- None tracked at this time
