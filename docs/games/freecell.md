# FreeCell

**Category:** Card
**Tier:** TBD
**Status:** In Development

## How to Play

FreeCell is a solitaire variant where nearly every deal is winnable with correct play. The full 52-card deck is dealt face-up into 8 tableau columns at the start — there is no hidden information.

### Layout

- **Tableau** (8 columns): all cards dealt face-up at start; move cards to build in descending rank, alternating colors
- **Free cells** (4): temporary holding spots for individual cards; each can hold one card at a time
- **Foundations** (4, one per suit): built up from Ace to King

### Rules

- Move a single card (or a sequence, if enough free cells + empty columns exist) from one tableau column to another
- A card may be placed on the tableau if it is one rank lower and opposite color from the top card
- Free cells can hold any single card temporarily
- Empty tableau columns act as extended free cells (can hold any card or sequence)
- Win by moving all 52 cards to the foundations

### Supermove

The maximum number of cards moveable as a sequence is `(free cells + 1) × 2^(empty columns)`.

### Double-Tap

Double-tapping a card (within a 300 ms window) triggers auto-move to foundation if a valid foundation move exists.

## Scoring (Persistence)

`final_score` = number of moves to complete. **Lower is better.** Leaderboard ranks by fewest moves (ascending).

## Client-Side Engine

- Location: `frontend/src/game/freecell/engine.ts`
- Key exports: `validateMove`, `applyMove`, `autoMoveCandidates`, supermove calculation

## Backend

- No `module.py` — FreeCell uses a standalone leaderboard router
- Endpoints: `backend/freecell/router.py`
- No metadata model
- Scoring: move count submitted at game completion

## Entitlement

Tier TBD. If free: no entitlement check.

## Known Issues / Limitations

- Tracked in issue #893 (in-memory leaderboard migration)
