# Solitaire

**Category:** Card
**Tier:** TBD
**Status:** In Development

## How to Play

Klondike Solitaire. The objective is to move all 52 cards onto the 4 foundation piles, sorted by suit from Ace to King.

### Layout

- **Stock** (draw pile): undealt cards; tap to draw
- **Waste**: face-up cards drawn from stock
- **Tableau** (7 columns): alternating-color sequences in descending rank; only face-up cards can be moved; can place any card or sequence on an empty column (Kings only to open column)
- **Foundations** (4 piles, one per suit): built up from Ace to King

### Draw Mode

BC Arcade uses **draw-3** by default: tapping the stock deals 3 cards to the waste. Only the top waste card is playable. Cycling through the stock after it's exhausted applies a **recycle penalty** to the score.

### Undo

Unlimited undos are available. Each undo step is tracked and does not affect the win/loss outcome, but the score formula may factor move count.

## Scoring (Persistence)

`final_score` = points accumulated during the game (formula: time bonus, moves, cards moved to foundation). A completed game (all cards on foundations) is an `COMPLETED` outcome; abandoning mid-game is `ABANDONED`.

## Client-Side Engine

- Location: `frontend/src/game/solitaire/engine.ts`
- Key exports: `validateMove(state, move) → boolean`, `applyMove(state, move) → GameState`, auto-complete detection, recycle penalty logic

## Backend

- Module: `backend/solitaire/module.py`
- Endpoints: `backend/solitaire/router.py`
- Metadata model: `SolitaireMetadata` — `player_name: str = ""` (max 64 chars)
- Scoring: `final_score` = points at game end

## Entitlement

Tier TBD. If free: no entitlement check.

## Known Issues / Limitations

- None tracked at this time
