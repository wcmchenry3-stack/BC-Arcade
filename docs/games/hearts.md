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

`final_score` = the player's total penalty points at game end. Lower is better. Leaderboard ranks by lowest `final_score`.

## Client-Side Engine

- Location: `frontend/src/game/hearts/engine.ts`
- Key exports: card passing logic, trick resolution, moon-shot detection, AI decision-making

## Backend

- Module: `backend/hearts/module.py`
- Endpoints: `backend/hearts/router.py`
- Metadata model: `HeartsMetadata` — `player_name: str = ""` (max 64 chars)
- Scoring: `final_score` = total penalty points (lower = better)

## Entitlement

Tier TBD. If premium: requires a valid entitlement JWT. Offline play continues within the 7-day grace period; see [`docs/ARCHITECTURE.md §10`](../ARCHITECTURE.md#10-premium-entitlements).

## Known Issues / Limitations

- None tracked at this time
