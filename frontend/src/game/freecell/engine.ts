/**
 * FreeCell engine (#808).
 *
 * Pure TypeScript. No React, AsyncStorage, HTTP, timers, or other
 * side-effect imports. The UI replaces the entire FreeCellState object
 * on each transition — state is immutable.
 */

import type {
  Card,
  Foundations,
  FreeCellState,
  FreeCells,
  GameEvent,
  Move,
  Rank,
  Suit,
} from "./types";
import { cardColor, RANKS, SUITS } from "./types";

const UNDO_CAP = 50;
const TABLEAU_COLUMNS = 8;
const DECK_SIZE = 52;
const FREE_CELL_COUNT = 4;

// ---------------------------------------------------------------------------
// Seedable RNG — same LCG used by Solitaire/Cascade/Blackjack/Twenty48.
// Tests can pin shuffles via `setRng(createSeededRng(seed))`.
// ---------------------------------------------------------------------------

export type RandomSource = () => number;

let _rng: RandomSource = Math.random;

export function setRng(fn: RandomSource): void {
  _rng = fn;
}

export function createSeededRng(seed: number): RandomSource {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Deck construction
// ---------------------------------------------------------------------------

function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ suit, rank });
    }
  }
  return deck;
}

function fisherYates(deck: Card[], rng: RandomSource): Card[] {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = deck[i];
    const b = deck[j];
    if (a !== undefined && b !== undefined) {
      deck[i] = b;
      deck[j] = a;
    }
  }
  return deck;
}

// ---------------------------------------------------------------------------
// Deal
// ---------------------------------------------------------------------------

function emptyFoundations(): Foundations {
  return { spades: [], hearts: [], diamonds: [], clubs: [] };
}

function emptyFreeCells(): FreeCells {
  return [null, null, null, null];
}

/**
 * Deal a new FreeCell game. 52 cards dealt face-up across 8 columns:
 * columns 0–3 receive 7 cards each; columns 4–7 receive 6 cards each.
 */
export function dealGame(explicitSeed?: number): FreeCellState {
  const seed = explicitSeed ?? Math.floor(_rng() * 0xffffffff) >>> 0;
  const deck = fisherYates(createDeck(), createSeededRng(seed));

  const tableau: Card[][] = [];
  let k = 0;
  for (let col = 0; col < TABLEAU_COLUMNS; col++) {
    const count = col < 4 ? 7 : 6;
    const pile: Card[] = [];
    for (let i = 0; i < count; i++) {
      const card = deck[k++];
      if (card === undefined) throw new Error("deck underflow during deal");
      pile.push(card);
    }
    tableau.push(pile);
  }

  if (k !== DECK_SIZE) throw new Error("deal did not consume exactly 52 cards");

  return {
    _v: 1,
    tableau,
    freeCells: emptyFreeCells(),
    foundations: emptyFoundations(),
    undoStack: [],
    isComplete: false,
    moveCount: 0,
  };
}

// ---------------------------------------------------------------------------
// Move validation helpers
// ---------------------------------------------------------------------------

function canStackOnTableau(moving: Card, dest: Card | undefined): boolean {
  if (dest === undefined) return moving.rank === 13;
  return cardColor(moving) !== cardColor(dest) && moving.rank === dest.rank - 1;
}

function canStackOnFoundation(moving: Card, pile: readonly Card[]): boolean {
  if (pile.length === 0) return moving.rank === 1;
  const top = pile[pile.length - 1];
  if (top === undefined) return false;
  return moving.suit === top.suit && moving.rank === ((top.rank + 1) as Rank);
}

/** A tableau run to be moved must form a valid alternating-color descending sequence.
 * All FreeCell tableau cards are face-up, so no faceUp check is needed. */
function isValidTableauRun(run: readonly Card[]): boolean {
  if (run.length === 0) return false;
  for (let i = 1; i < run.length; i++) {
    const prev = run[i - 1];
    const curr = run[i];
    if (prev === undefined || curr === undefined) return false;
    if (cardColor(prev) === cardColor(curr)) return false;
    if (curr.rank !== prev.rank - 1) return false;
  }
  return true;
}

/**
 * Maximum cards movable as a stack to `toCol`.
 * Formula: (1 + emptyCells) × 2^emptyColumns
 * The destination column is excluded from the empty-column count even when empty.
 */
function supermoveMax(state: FreeCellState, toCol: number): number {
  const emptyCells = state.freeCells.filter((c) => c === null).length;
  const emptyColumns = state.tableau.filter((col, idx) => idx !== toCol && col.length === 0).length;
  return (1 + emptyCells) * Math.pow(2, emptyColumns);
}

function topOf<T>(arr: readonly T[]): T | undefined {
  return arr.length === 0 ? undefined : arr[arr.length - 1];
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function validateMove(state: FreeCellState, move: Move): boolean {
  switch (move.type) {
    case "tableau-to-tableau": {
      if (move.fromCol < 0 || move.fromCol >= TABLEAU_COLUMNS) return false;
      if (move.toCol < 0 || move.toCol >= TABLEAU_COLUMNS) return false;
      if (move.fromCol === move.toCol) return false;
      const src = state.tableau[move.fromCol];
      const dst = state.tableau[move.toCol];
      if (src === undefined || dst === undefined) return false;
      if (move.fromIndex < 0 || move.fromIndex >= src.length) return false;
      const run = src.slice(move.fromIndex);
      if (!isValidTableauRun(run)) return false;
      const head = run[0];
      if (head === undefined) return false;
      if (!canStackOnTableau(head, topOf(dst))) return false;
      return run.length <= supermoveMax(state, move.toCol);
    }
    case "tableau-to-freecell": {
      if (move.fromCol < 0 || move.fromCol >= TABLEAU_COLUMNS) return false;
      if (move.toCell < 0 || move.toCell >= FREE_CELL_COUNT) return false;
      if (state.freeCells[move.toCell] !== null) return false;
      const src = state.tableau[move.fromCol];
      if (src === undefined || src.length === 0) return false;
      return true;
    }
    case "tableau-to-foundation": {
      if (move.fromCol < 0 || move.fromCol >= TABLEAU_COLUMNS) return false;
      const src = state.tableau[move.fromCol];
      if (src === undefined) return false;
      const card = topOf(src);
      if (card === undefined) return false;
      return canStackOnFoundation(card, state.foundations[card.suit]);
    }
    case "freecell-to-tableau": {
      if (move.fromCell < 0 || move.fromCell >= FREE_CELL_COUNT) return false;
      if (move.toCol < 0 || move.toCol >= TABLEAU_COLUMNS) return false;
      const card = state.freeCells[move.fromCell];
      if (card === null || card === undefined) return false;
      const dst = state.tableau[move.toCol];
      if (dst === undefined) return false;
      return canStackOnTableau(card, topOf(dst));
    }
    case "freecell-to-foundation": {
      if (move.fromCell < 0 || move.fromCell >= FREE_CELL_COUNT) return false;
      const card = state.freeCells[move.fromCell];
      if (card === null || card === undefined) return false;
      return canStackOnFoundation(card, state.foundations[card.suit]);
    }
    case "foundation-to-tableau": {
      if (move.toCol < 0 || move.toCol >= TABLEAU_COLUMNS) return false;
      const pile = state.foundations[move.fromSuit];
      const card = topOf(pile);
      if (card === undefined) return false;
      const dst = state.tableau[move.toCol];
      if (dst === undefined) return false;
      return canStackOnTableau(card, topOf(dst));
    }
  }
}

// ---------------------------------------------------------------------------
// State transitions
// ---------------------------------------------------------------------------

function replaceAt<T>(arr: readonly T[], idx: number, value: T): readonly T[] {
  const out = arr.slice();
  out[idx] = value;
  return out;
}

function withFoundation(foundations: Foundations, suit: Suit, pile: readonly Card[]): Foundations {
  return { ...foundations, [suit]: pile };
}

function isWin(foundations: Foundations): boolean {
  let total = 0;
  for (const suit of SUITS) {
    total += foundations[suit].length;
  }
  return total === DECK_SIZE;
}

/** Take a snapshot of `prev` (undoStack cleared to []), append to the stack,
 * cap at UNDO_CAP, then attach to `next`. */
function withUndo(prev: FreeCellState, next: Omit<FreeCellState, "undoStack">): FreeCellState {
  const snapshot: FreeCellState = { ...prev, undoStack: [] };
  const stack = [...prev.undoStack, snapshot];
  const capped = stack.length > UNDO_CAP ? stack.slice(stack.length - UNDO_CAP) : stack;
  return { ...next, undoStack: capped };
}

function finalizeAfterMove(
  prev: FreeCellState,
  next: Omit<FreeCellState, "undoStack" | "isComplete" | "events" | "hint">,
  events: readonly GameEvent[]
): FreeCellState {
  const win = isWin(next.foundations);
  const baseEvents: readonly GameEvent[] = win ? [...events, { type: "gameWin" } as const] : events;
  // Hint is always cleared after a real move.
  const result = withUndo(prev, { ...next, hint: undefined, isComplete: win, events: baseEvents });
  if (!win && !hasLegalMoves(result)) {
    return { ...result, events: [...(result.events ?? []), { type: "noMovesAvailable" } as const] };
  }
  return result;
}

// ---------------------------------------------------------------------------
// applyMove
// ---------------------------------------------------------------------------

/**
 * Apply a card-moving `Move`. Returns the (immutable) next state; if the
 * move is invalid, returns `state` unchanged.
 */
export function applyMove(state: FreeCellState, move: Move): FreeCellState {
  if (!validateMove(state, move)) return state;

  switch (move.type) {
    case "tableau-to-tableau": {
      const src = state.tableau[move.fromCol];
      const dst = state.tableau[move.toCol];
      if (src === undefined || dst === undefined) return state;
      const run = src.slice(move.fromIndex);
      const newSrc = src.slice(0, move.fromIndex);
      const newDst: readonly Card[] = [...dst, ...run];
      let tableau = replaceAt(state.tableau, move.fromCol, newSrc);
      tableau = replaceAt(tableau, move.toCol, newDst);
      const ttEvents: readonly GameEvent[] =
        run.length >= 2 ? [{ type: "supermove", cardCount: run.length }] : [{ type: "cardPlace" }];
      return finalizeAfterMove(
        state,
        {
          _v: 1,
          tableau,
          freeCells: state.freeCells,
          foundations: state.foundations,
          moveCount: state.moveCount + 1,
        },
        ttEvents
      );
    }
    case "tableau-to-freecell": {
      const src = state.tableau[move.fromCol];
      if (src === undefined) return state;
      const card = topOf(src);
      if (card === undefined) return state;
      const newSrc = src.slice(0, -1);
      const tableau = replaceAt(state.tableau, move.fromCol, newSrc);
      const freeCells = replaceAt(state.freeCells, move.toCell, card) as FreeCells;
      return finalizeAfterMove(
        state,
        {
          _v: 1,
          tableau,
          freeCells,
          foundations: state.foundations,
          moveCount: state.moveCount + 1,
        },
        [{ type: "cardPlace" }]
      );
    }
    case "tableau-to-foundation": {
      const src = state.tableau[move.fromCol];
      if (src === undefined) return state;
      const card = topOf(src);
      if (card === undefined) return state;
      const newSrc = src.slice(0, -1);
      const tableau = replaceAt(state.tableau, move.fromCol, newSrc);
      const newPile: readonly Card[] = [...state.foundations[card.suit], card];
      const foundations = withFoundation(state.foundations, card.suit, newPile);
      const tfEvents: GameEvent[] = [{ type: "cardPlace" }];
      if (newPile.length === 13) tfEvents.push({ type: "foundationComplete", suit: card.suit });
      return finalizeAfterMove(
        state,
        { _v: 1, tableau, freeCells: state.freeCells, foundations, moveCount: state.moveCount + 1 },
        tfEvents
      );
    }
    case "freecell-to-tableau": {
      const card = state.freeCells[move.fromCell];
      if (card === null || card === undefined) return state;
      const dst = state.tableau[move.toCol];
      if (dst === undefined) return state;
      const freeCells = replaceAt(state.freeCells, move.fromCell, null) as FreeCells;
      const tableau = replaceAt(state.tableau, move.toCol, [...dst, card]);
      return finalizeAfterMove(
        state,
        {
          _v: 1,
          tableau,
          freeCells,
          foundations: state.foundations,
          moveCount: state.moveCount + 1,
        },
        [{ type: "cardPlace" }]
      );
    }
    case "freecell-to-foundation": {
      const card = state.freeCells[move.fromCell];
      if (card === null || card === undefined) return state;
      const freeCells = replaceAt(state.freeCells, move.fromCell, null) as FreeCells;
      const newPile: readonly Card[] = [...state.foundations[card.suit], card];
      const foundations = withFoundation(state.foundations, card.suit, newPile);
      const ffEvents: GameEvent[] = [{ type: "cardPlace" }];
      if (newPile.length === 13) ffEvents.push({ type: "foundationComplete", suit: card.suit });
      return finalizeAfterMove(
        state,
        { _v: 1, tableau: state.tableau, freeCells, foundations, moveCount: state.moveCount + 1 },
        ffEvents
      );
    }
    case "foundation-to-tableau": {
      const srcPile = state.foundations[move.fromSuit];
      const card = topOf(srcPile);
      if (card === undefined) return state;
      const dst = state.tableau[move.toCol];
      if (dst === undefined) return state;
      const foundations = withFoundation(state.foundations, move.fromSuit, srcPile.slice(0, -1));
      const tableau = replaceAt(state.tableau, move.toCol, [...dst, card]);
      // Retreating from the foundation costs 2 moves (progress penalty).
      return finalizeAfterMove(
        state,
        { _v: 1, tableau, freeCells: state.freeCells, foundations, moveCount: state.moveCount + 2 },
        [{ type: "cardPlace" }]
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Hint / legal-move enumeration
// ---------------------------------------------------------------------------

/**
 * Returns false when a tableau-to-tableau move is a pure oscillation: the
 * moving run's parent card is color-rank-equivalent to the destination card
 * (same rank, same color), and the move uncovers no new foundation play and
 * creates no empty column. All other move types are always productive.
 *
 * Used by getHintMoves to avoid suggesting reversible swaps (#1295).
 * applyMove / validateMove are unaffected — players may still execute
 * non-productive moves via tap/drag.
 */
export function isProductiveMove(state: FreeCellState, move: Move): boolean {
  if (move.type !== "tableau-to-tableau") return true;

  const src = state.tableau[move.fromCol];
  const dst = state.tableau[move.toCol];
  if (src === undefined || dst === undefined) return true;

  // No parent card: moving from the column base — could create empty column
  if (move.fromIndex === 0) return true;

  const parent = src[move.fromIndex - 1];
  const destTop = topOf(dst);
  if (parent === undefined || destTop === undefined) return true;

  // Different color or rank → not a reversible swap
  if (parent.rank !== destTop.rank || cardColor(parent) !== cardColor(destTop)) return true;

  // Exposing the parent enables a foundation play → productive
  if (canStackOnFoundation(parent, state.foundations[parent.suit])) return true;

  return false;
}

/**
 * Returns all legal moves from the current state, ordered by desirability:
 * foundation moves first (always progress), then tableau runs, then freecell
 * moves, then parking a card to an empty freecell as a last resort.
 *
 * Non-productive tableau-to-tableau moves (reversible swaps with no benefit)
 * are filtered out (#1295). Returns [] when only non-productive moves exist,
 * triggering the existing "No moves left" banner in the hint handler.
 *
 * Used by the hint system (#988) and the no-moves detector (#989).
 */
export function getHintMoves(state: FreeCellState): Move[] {
  const moves: Move[] = [];

  // Foundation moves — always good progress
  for (let col = 0; col < TABLEAU_COLUMNS; col++) {
    const m: Move = { type: "tableau-to-foundation", fromCol: col };
    if (validateMove(state, m)) moves.push(m);
  }
  for (let cell = 0; cell < FREE_CELL_COUNT; cell++) {
    const m: Move = { type: "freecell-to-foundation", fromCell: cell };
    if (validateMove(state, m)) moves.push(m);
  }

  // Tableau-to-tableau runs (deepest valid fromIndex per column pair)
  for (let fromCol = 0; fromCol < TABLEAU_COLUMNS; fromCol++) {
    const src = state.tableau[fromCol];
    if (!src || src.length === 0) continue;
    for (let fromIndex = src.length - 1; fromIndex >= 0; fromIndex--) {
      for (let toCol = 0; toCol < TABLEAU_COLUMNS; toCol++) {
        if (toCol === fromCol) continue;
        const m: Move = { type: "tableau-to-tableau", fromCol, fromIndex, toCol };
        if (validateMove(state, m) && isProductiveMove(state, m)) {
          moves.push(m);
          break;
        }
      }
    }
  }

  // Freecell-to-tableau
  for (let cell = 0; cell < FREE_CELL_COUNT; cell++) {
    if (state.freeCells[cell] === null) continue;
    for (let toCol = 0; toCol < TABLEAU_COLUMNS; toCol++) {
      const m: Move = { type: "freecell-to-tableau", fromCell: cell, toCol };
      if (validateMove(state, m)) {
        moves.push(m);
        break;
      }
    }
  }

  // Tableau-to-freecell (parking — last resort)
  for (let col = 0; col < TABLEAU_COLUMNS; col++) {
    const src = state.tableau[col];
    if (!src || src.length === 0) continue;
    for (let cell = 0; cell < FREE_CELL_COUNT; cell++) {
      const m: Move = { type: "tableau-to-freecell", fromCol: col, toCell: cell };
      if (validateMove(state, m)) {
        moves.push(m);
        break;
      }
    }
  }

  return moves;
}

/** True when at least one legal move exists. Early-exits at the first hit. */
export function hasLegalMoves(state: FreeCellState): boolean {
  for (let col = 0; col < TABLEAU_COLUMNS; col++) {
    if (validateMove(state, { type: "tableau-to-foundation", fromCol: col })) return true;
  }
  for (let cell = 0; cell < FREE_CELL_COUNT; cell++) {
    if (validateMove(state, { type: "freecell-to-foundation", fromCell: cell })) return true;
  }
  for (let fromCol = 0; fromCol < TABLEAU_COLUMNS; fromCol++) {
    const src = state.tableau[fromCol];
    if (!src || src.length === 0) continue;
    for (let fromIndex = src.length - 1; fromIndex >= 0; fromIndex--) {
      for (let toCol = 0; toCol < TABLEAU_COLUMNS; toCol++) {
        if (toCol === fromCol) continue;
        if (validateMove(state, { type: "tableau-to-tableau", fromCol, fromIndex, toCol }))
          return true;
      }
    }
  }
  for (let cell = 0; cell < FREE_CELL_COUNT; cell++) {
    if (state.freeCells[cell] === null) continue;
    for (let toCol = 0; toCol < TABLEAU_COLUMNS; toCol++) {
      if (validateMove(state, { type: "freecell-to-tableau", fromCell: cell, toCol })) return true;
    }
  }
  for (let col = 0; col < TABLEAU_COLUMNS; col++) {
    const src = state.tableau[col];
    if (!src || src.length === 0) continue;
    for (let cell = 0; cell < FREE_CELL_COUNT; cell++) {
      if (validateMove(state, { type: "tableau-to-freecell", fromCol: col, toCell: cell }))
        return true;
    }
  }
  return false;
}

/**
 * Sets state.hint to the first legal move (for the hint UI to highlight).
 * Returns state unchanged if there are no legal moves — caller should check
 * state.hint to decide whether to surface a "no moves" message instead.
 */
export function applyHint(state: FreeCellState): FreeCellState {
  const moves = getHintMoves(state);
  return { ...state, hint: moves[0] };
}

// ---------------------------------------------------------------------------
// Auto-complete
// ---------------------------------------------------------------------------

/**
 * Returns true when every remaining card can reach the foundation using only
 * direct foundation plays (no rearrangement). Uses a greedy simulation:
 * repeatedly move any available top card / free-cell card to the foundation
 * until no more progress is possible, then check if all 52 cards arrived.
 */
export function canAutoComplete(state: FreeCellState): boolean {
  if (state.isComplete) return false;

  const counts: Record<Suit, number> = {
    spades: state.foundations.spades.length,
    hearts: state.foundations.hearts.length,
    diamonds: state.foundations.diamonds.length,
    clubs: state.foundations.clubs.length,
  };
  const columns: Card[][] = state.tableau.map((col) => [...col]);
  const cells: (Card | null)[] = [...state.freeCells];

  let moved = true;
  while (moved) {
    moved = false;
    for (let i = 0; i < cells.length; i++) {
      const card = cells[i];
      if (card != null && card.rank === counts[card.suit] + 1) {
        counts[card.suit]++;
        cells[i] = null;
        moved = true;
      }
    }
    for (const col of columns) {
      const card = col[col.length - 1];
      if (card !== undefined && card.rank === counts[card.suit] + 1) {
        counts[card.suit]++;
        col.pop();
        moved = true;
      }
    }
  }

  return counts.spades + counts.hearts + counts.diamonds + counts.clubs === DECK_SIZE;
}

/**
 * Executes one step of the auto-complete sequence: moves the next available
 * card to the foundation. Free-cell cards are preferred over tableau cards.
 * Returns `state` unchanged if no foundation move is currently available.
 */
export function autoComplete(state: FreeCellState): FreeCellState {
  for (let cell = 0; cell < FREE_CELL_COUNT; cell++) {
    const card = state.freeCells[cell];
    if (card != null && canStackOnFoundation(card, state.foundations[card.suit])) {
      return applyMove(state, { type: "freecell-to-foundation", fromCell: cell });
    }
  }
  for (let col = 0; col < TABLEAU_COLUMNS; col++) {
    const pile = state.tableau[col] ?? [];
    const card = topOf(pile);
    if (card !== undefined && canStackOnFoundation(card, state.foundations[card.suit])) {
      return applyMove(state, { type: "tableau-to-foundation", fromCol: col });
    }
  }
  return state;
}

// ---------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------

/**
 * Pop the most recent snapshot off the undo stack. Returns `state` unchanged
 * when the stack is empty.
 */
export function undoMove(state: FreeCellState): FreeCellState {
  if (state.undoStack.length === 0) return state;
  const last = state.undoStack[state.undoStack.length - 1];
  if (last === undefined) return state;
  const remaining = state.undoStack.slice(0, -1);
  return { ...last, undoStack: remaining };
}
