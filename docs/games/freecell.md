# FreeCell

**Category:** Card  
**Tier:** Free in the v1.0 store build

BC Arcade FreeCell deals only from a bank of solver-verified solvable layouts and ranks completed deals by **fewest moves**. It includes hints, supermoves, undo, and automatic foundation completion.

Shared session/offline/reporting behavior is defined by [GAME-CONTRACT.md](../GAME-CONTRACT.md). This page owns FreeCell-specific gameplay and scoring.

## Objective and layout

Move all 52 cards to four suit foundations, Ace through King.

A new deal places the entire deck face-up across eight tableau columns:

- columns 1–4: 7 cards each;
- columns 5–8: 6 cards each.

There are:
- **4 free cells**, each holding at most one card;
- **4 foundations**, one per suit;
- **8 tableau columns**.

There is no stock/waste and no hidden information.

## Deals

Live deals come from `frontend/src/game/freecell/seeds.json`, a bank of **provably solvable** seeds produced offline by `backend/scripts/gen_freecell_seeds.py`.

The engine selects a bank seed and deterministically shuffles the deck. Explicit seeds remain available for tests/E2E.

## Tableau and foundations

Tableau sequences build:
- descending by rank;
- alternating red/black.

An empty tableau column accepts a King or King-led movable run.

Foundations build upward by suit from Ace.

A top foundation card can be moved back to tableau when legal.

## Free cells

Any exposed single tableau card can move to an empty free cell.

A card in a free cell can move:
- to a legal tableau destination; or
- to its foundation.

Free cells also increase the size of a run that can be moved as one player action.

## Supermoves

A legal alternating-color descending tableau run can move as one action when enough temporary workspace exists.

Maximum movable run length:

`(1 + empty free cells) × 2^(empty tableau columns)`

The destination column is excluded from the empty-column multiplier when it is itself empty.

A supermove counts as **one move**, regardless of the number of cards transferred.

## Move count and ranking

FreeCell's ranked metric is move count: **lower is better**.

Normal legal moves count **1**, including:
- tableau → tableau (single card or supermove);
- tableau → free cell;
- tableau → foundation;
- free cell → tableau;
- free cell → foundation.

Moving a card **from foundation back to tableau costs 2 moves** as a progress penalty.

Undo restores the earlier move count.

There is one global FreeCell board with no partition and no declared maximum. Equal move totals use the shared final tie rule: earlier completion ranks first.

## Hint

Hint highlights a recommended productive move; it does not execute it and has no score/move penalty.

The engine orders hints roughly as:
1. tableau/free-cell → foundation;
2. productive tableau → tableau runs;
3. free-cell → tableau;
4. tableau → free cell as a parking move.

Obvious reversible tableau oscillations are filtered from the hint list.

If only non-productive/reversible moves remain, Hint reports the existing **No moves left** state rather than recommending one of those swaps.

Players may still manually make legal moves that the hint engine considers non-productive.

## Auto-complete

When every remaining card can reach a foundation through direct foundation plays alone, FreeCell automatically begins completion.

The engine proves this with a greedy simulation before starting.

The automatic sequence:
- prefers free-cell → foundation;
- then tableau-top → foundation;
- runs one move at a time.

It does **not** perform rearrangement during auto-complete. If direct foundation draining cannot finish the board, auto-complete is not enabled yet.

Each automated foundation move is a real move and increments the move count.

## Undo

Undo restores the most recent engine snapshot, including the earlier move count.

It is disabled:
- with no undo history;
- after completion;
- while auto-complete is running.

## Win / no-loss model

The deal is complete when all 52 cards reach the foundations.

FreeCell has no formal loss outcome in the shared reporting model. A position with no productive hint can still be escaped through Undo or other legal play if available.

A won deal records:
- `completed`;
- `final_score = moveCount`;
- result `{ won: true, moves }`.

Starting a new deal or leaving after a move records `abandoned` with no ranked score.

## Save / resume and duration

Board state is persisted locally after changes and restores after relaunch.

A killed app can therefore continue the same deal/session.

FreeCell does not maintain its own persisted play clock. Duration comes from the shared `useGameSync` active-play window; starting a new deal resets that window.

The local device also caches lightweight best-moves/game counters for immediate UI presentation; server Stats/history are authoritative for shared reporting.

## Controls

Cards support the shared card-game selection/drag interaction.

Foundation auto-move behavior is available through the current board interaction; hints and auto-complete are separate from direct player moves.

## Implementation

- Engine: `frontend/src/game/freecell/engine.ts`
- Screen: `frontend/src/screens/FreeCellScreen.tsx`
- Seed bank: `frontend/src/game/freecell/seeds.json`
- Seed generator/solver: `backend/scripts/gen_freecell_seeds.py`
- Storage: `frontend/src/game/freecell/storage.ts`
- Backend descriptor: `backend/freecell/module.py`
