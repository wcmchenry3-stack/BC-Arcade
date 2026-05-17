# Starswarm

**Category:** Arcade
**Tier:** TBD
**Status:** In Development (early)

## How to Play

Starswarm is an arcade shooter. Details of the core loop, controls, and level structure are still being defined. This document will be updated as the game design solidifies.

What is known:

- The game is rendered via `@shopify/react-native-skia` (canvas-based)
- It is a score-attack game — the goal is to survive as long as possible and score as many points as possible
- No local save state is persisted to AsyncStorage (intentional — the game has no resume state)

## Scoring (Persistence)

`final_score` = points at game over. Leaderboard tracks top scores.

## Client-Side Engine

- Location: `frontend/src/game/starswarm/` — check this directory for current engine structure
- Rendering: `@shopify/react-native-skia`

## Backend

- No `module.py` — Starswarm has a router-only backend
- Endpoints: `backend/starswarm/router.py`
- No metadata model
- Scoring: score submitted via the router at game over

## Accessibility

Starswarm uses a Skia canvas for all rendering. Accessible text overlays for score and game state are required. See [`docs/ACCESSIBILITY.md §4`](../ACCESSIBILITY.md#4-screen-readers).

## Entitlement

Tier TBD. If premium: requires a valid entitlement JWT; see [`docs/ARCHITECTURE.md §10`](../ARCHITECTURE.md#10-premium-entitlements).

## Known Issues / Limitations

- In early development — game design is not finalized
- No `module.py`; tracked in issue #893 (in-memory leaderboard migration)
