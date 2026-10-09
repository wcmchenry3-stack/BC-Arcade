# Solitaire

**Category:** Card  
**Tier:** Free in the v1.0 store build

BC Arcade Solitaire is Klondike with Draw-1 / Draw-3, a proven-solvable deal bank, hints, undo, auto-complete, local save/resume, and score-based ranking.

Shared session/offline/reporting behavior is defined by [GAME-CONTRACT.md](../GAME-CONTRACT.md). This page owns Solitaire-specific gameplay and scoring.

## Objective and layout

Move all 52 cards to the four suit foundations, Ace through King.

- **Tableau:** seven columns; descending rank, alternating colors.
- **Stock:** undealt face-down cards.
- **Waste:** cards drawn from the stock; only the top waste card is playable.
- **Foundations:** one per suit, built Ace → King.

The tableau starts with 1–7 cards by column, with only each column's top card face-up. The remaining 24 cards start in the stock.

An empty tableau column accepts only a King or a King-led valid run.

## Deals and draw modes

Before a new deal the player chooses:

- **Draw-1:** draw one stock card at a time.
- **Draw-3:** draw up to three; only the top waste card is playable.

Draw-1 and Draw-3 share one public leaderboard.

Live deals come from `frontend/src/game/solitaire/seeds.json`, a bank of **provably solvable** seeds generated offline by `backend/scripts/gen_solitaire_seeds.py`. A seed reproduces the same deal deterministically.

### Recycling the stock

When stock is empty, the waste can be recycled back into stock.

- first recycle: free;
- every later recycle: −50 points.

Score is floored at 0.

## Legal card movement

### Tableau
A face-up card/run can move onto a card exactly one rank higher and the opposite color.

A moved tableau run itself must already be a valid alternating-color descending sequence.

When a move uncovers a face-down tableau card, that newly exposed card flips face-up automatically.

### Foundation
Foundations build by suit from Ace upward.

The top card of:
- waste; or
- a tableau column

can move to its matching foundation when legal.

A top foundation card can also be moved back to tableau when it fits; that retreat costs points.

## Input

Cards can be moved through the shared card-selection/drag interaction.

The current UI uses tap-to-select. The older smart-single-tap auto-move experiment (`resolveAutoMove`, #2039) was removed in #2970.

A quick second activation on eligible cards can use the screen's explicit double-tap path where implemented, but ordinary legal selection/drag remains the core interaction.

## Hint

Hint highlights a productive legal move. It does **not** execute the move.

Hint priority is:

1. waste/tableau → foundation;
2. tableau → tableau that reveals a face-down card;
3. waste → tableau;
4. other productive tableau → tableau moves.

The hint engine filters obvious reversible tableau oscillations and excludes:
- stock draws;
- foundation → tableau retreats.

If there is no productive hint, the Hint control is disabled.

Each hint use costs **20 points**, floored at 0.

## Undo

Undo restores the board and score snapshot from before the previous state-changing move.

- history cap: **50** snapshots;
- timer continues according to the current presence state rather than rewinding to an old clock;
- the screen's displayed move count is also decremented when Undo is used;
- unavailable while auto-complete is running.

## Auto-complete

An Auto Complete action appears only when the engine can prove its own stepper can finish the deal.

The proof requires all tableau cards to be face-up and simulates the exact auto-complete sequence to completion before offering the action.

The stepper can:
1. move waste → foundation;
2. draw stock batches to waste;
3. move tableau tops → foundation;
4. make a narrow single-card tableau relocation only when it immediately exposes a foundation-ready card.

It deliberately refuses deeper speculative rearrangements. If the stepper cannot prove the finish, Auto Complete is not offered.

Auto-complete performs real game moves one step at a time, so:
- normal scoring applies;
- normal move counting applies;
- the game timer/session behaves as if those moves were made normally.

## Scoring

The leaderboard ranks final score, higher is better.

| Event | Score |
| --- | ---: |
| Waste → tableau | +5 |
| Waste → foundation | +10 |
| Tableau → foundation | +10 |
| Reveal a face-down tableau card | +5 |
| Foundation → tableau | −15 |
| Recycle after the first | −50 |
| Use Hint | −20 |
| Complete all foundations | +500 |

Score never falls below 0.

There is **no time bonus**.

The backend's declared maximum rankable score is **1245**.

Equal scores use the shared final tie rule: earlier completion ranks first.

## Timer and save/resume

The active-play timer starts on the first real move and stops at the win.

It pauses while:
- the app backgrounds; or
- another screen covers the game.

The full deal state and banked active-play time are saved locally. Relaunching:
- restores the board;
- keeps previously accumulated active time;
- does not count time while the app was closed.

A save from an older pre-#2750 build cannot reconstruct an unbanked running segment, so that unknown segment is discarded on load.

## Session outcome

Solitaire has no loss outcome in the reporting contract.

- Win → `completed`, with engine score as `final_score` and `{ won: true, moves }`.
- Leaving or starting a new deal after play → `abandoned`, with no ranked score.
- An untouched deal can be discarded without a meaningful played result.

Creation metadata records `draw_mode` (1 or 3).

For generic syncing, rank lookup, display names, Stats, and result-card behavior, see [GAME-CONTRACT.md](../GAME-CONTRACT.md).

## Implementation

- Engine: `frontend/src/game/solitaire/engine.ts`
- Screen: [`frontend/src/screens/SolitaireScreen.tsx`](../../frontend/src/screens/SolitaireScreen.tsx) (its header lists the screen's concerns; see [GAMEPLAY_STANDARDS §8](../GAMEPLAY_STANDARDS.md#8-screen-layer))
- Seed bank: `frontend/src/game/solitaire/seeds.json`
- Seed generator/solver: `backend/scripts/gen_solitaire_seeds.py`
- Storage: `frontend/src/game/solitaire/storage.ts`
- Backend descriptor: `backend/solitaire/module.py`
