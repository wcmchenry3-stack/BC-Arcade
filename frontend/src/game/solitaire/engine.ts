/**
 * Klondike Solitaire engine (#593).
 *
 * Pure TypeScript. No React, AsyncStorage, HTTP, timers, or other
 * side-effect imports. The UI replaces the entire SolitaireState object
 * on each transition — state is immutable.
 *
 * Deal reproducibility comes from `seeds.json`, a bank of provably
 * solvable seeds generated offline by `backend/scripts/gen_solitaire_seeds.py`.
 * `dealGame` picks a seed from the bank for the requested draw mode and
 * shuffles the deck with a seeded LCG matching the parameters used by
 * Cascade and Blackjack (so any seed reproduces its deal deterministically).
 */

import seedsJson from "./seeds.json";
import type {
  Card,
  DrawMode,
  Foundations,
  GameEvent,
  Move,
  Rank,
  SolitaireState,
  Suit,
} from "./types";
import { cardColor, RANKS, SUITS } from "./types";

// ---------------------------------------------------------------------------
// Scoring constants (PRODUCT.md — no timers)
// ---------------------------------------------------------------------------

const SCORE_WASTE_TO_TABLEAU = 5;
const SCORE_WASTE_TO_FOUNDATION = 10;
const SCORE_TABLEAU_TO_FOUNDATION = 10;
const SCORE_FOUNDATION_TO_TABLEAU = -15;
const SCORE_REVEAL = 5;
const SCORE_RECYCLE_PENALTY = -50;
const SCORE_WIN_BONUS = 500;
const HINT_PENALTY = 20;

const UNDO_CAP = 50;
const TABLEAU_COLUMNS = 7;
const DECK_SIZE = 52;

// ---------------------------------------------------------------------------
// Seedable RNG — matches the LCG used by Cascade/Blackjack/Twenty48.
// Tests can pin shuffles via `setRng(createSeededRng(seed))`.
// ---------------------------------------------------------------------------

export type RandomSource = () => number;

let _rng: RandomSource = Math.random;

export function setRng(fn: RandomSource): void {
  _rng = fn;
}

/**
 * Linear congruential generator. Deterministic for a given seed. Not
 * cryptographic — only suitable for deal reproducibility and tests.
 */
export function createSeededRng(seed: number): RandomSource {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Seed bank
// ---------------------------------------------------------------------------

interface SeedBank {
  readonly draw1: readonly number[];
  readonly draw3: readonly number[];
}

const SEED_BANK: SeedBank = seedsJson as SeedBank;

function pickSeed(drawMode: DrawMode): number {
  const bank = drawMode === 1 ? SEED_BANK.draw1 : SEED_BANK.draw3;
  if (bank.length === 0) {
    throw new Error(
      `Solitaire seed bank is empty for draw-${drawMode}. ` +
        `Run: python backend/scripts/gen_solitaire_seeds.py`
    );
  }
  const idx = Math.floor(_rng() * bank.length);
  const seed = bank[idx];
  if (seed === undefined) {
    throw new Error("Seed bank indexing failed");
  }
  return seed;
}

// ---------------------------------------------------------------------------
// Deck construction
// ---------------------------------------------------------------------------

/**
 * Ordered 52-card deck, all face-down. Callers shuffle before dealing.
 */
export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ suit, rank, faceUp: false });
    }
  }
  return deck;
}

/** Fisher-Yates in-place against a supplied PRNG. Returns the same array. */
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

/**
 * Deal a new Klondike game. If `explicitSeed` is not provided, a seed is
 * picked from the appropriate bank (throws if empty). Layout: column
 * i holds i+1 cards with only the top face-up; remaining 24 go to the
 * stock face-down.
 */
export function dealGame(drawMode: DrawMode, explicitSeed?: number): SolitaireState {
  const seed = explicitSeed ?? pickSeed(drawMode);
  const deck = fisherYates(createDeck(), createSeededRng(seed));

  const tableau: Card[][] = [];
  let k = 0;
  for (let col = 0; col < TABLEAU_COLUMNS; col++) {
    const pile: Card[] = [];
    for (let i = 0; i <= col; i++) {
      const card = deck[k++];
      if (card === undefined) {
        throw new Error("deck underflow during deal");
      }
      pile.push({ ...card, faceUp: i === col });
    }
    tableau.push(pile);
  }

  const stock: Card[] = [];
  while (k < DECK_SIZE) {
    const card = deck[k++];
    if (card === undefined) {
      throw new Error("deck underflow during stock fill");
    }
    stock.push({ ...card, faceUp: false });
  }

  return {
    _v: 1,
    drawMode,
    tableau,
    foundations: emptyFoundations(),
    stock,
    waste: [],
    score: 0,
    recycleCount: 0,
    undoStack: [],
    isComplete: false,
    startedAt: null,
    accumulatedMs: 0,
  };
}

// ---------------------------------------------------------------------------
// Move validation helpers
// ---------------------------------------------------------------------------

function canStackOnTableau(moving: Card, dest: Card | undefined): boolean {
  if (dest === undefined) {
    return moving.rank === 13;
  }
  return cardColor(moving) !== cardColor(dest) && moving.rank === dest.rank - 1;
}

function canStackOnFoundation(moving: Card, pile: readonly Card[]): boolean {
  if (pile.length === 0) {
    return moving.rank === 1;
  }
  const top = pile[pile.length - 1];
  if (top === undefined) {
    return false;
  }
  return moving.suit === top.suit && moving.rank === ((top.rank + 1) as Rank);
}

/** A tableau slice to be moved must be face-up and a valid
 * alternating-color descending run. */
function isValidTableauRun(run: readonly Card[]): boolean {
  if (run.length === 0) return false;
  const first = run[0];
  if (first === undefined || !first.faceUp) return false;
  for (let i = 1; i < run.length; i++) {
    const prev = run[i - 1];
    const curr = run[i];
    if (prev === undefined || curr === undefined) return false;
    if (!curr.faceUp) return false;
    if (cardColor(prev) === cardColor(curr)) return false;
    if (curr.rank !== prev.rank - 1) return false;
  }
  return true;
}

function topOf<T>(arr: readonly T[]): T | undefined {
  return arr.length === 0 ? undefined : arr[arr.length - 1];
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function validateMove(state: SolitaireState, move: Move): boolean {
  switch (move.type) {
    case "waste-to-tableau": {
      const card = topOf(state.waste);
      if (card === undefined) return false;
      if (move.toCol < 0 || move.toCol >= TABLEAU_COLUMNS) return false;
      const col = state.tableau[move.toCol];
      if (col === undefined) return false;
      return canStackOnTableau(card, topOf(col));
    }
    case "waste-to-foundation": {
      const card = topOf(state.waste);
      if (card === undefined) return false;
      return canStackOnFoundation(card, state.foundations[card.suit]);
    }
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
      return canStackOnTableau(head, topOf(dst));
    }
    case "tableau-to-foundation": {
      if (move.fromCol < 0 || move.fromCol >= TABLEAU_COLUMNS) return false;
      const src = state.tableau[move.fromCol];
      if (src === undefined) return false;
      const card = topOf(src);
      if (card === undefined || !card.faceUp) return false;
      return canStackOnFoundation(card, state.foundations[card.suit]);
    }
    case "foundation-to-tableau": {
      if (move.toCol < 0 || move.toCol >= TABLEAU_COLUMNS) return false;
      const pile = state.foundations[move.fromSuit];
      const card = topOf(pile);
      if (card === undefined) return false;
      const col = state.tableau[move.toCol];
      if (col === undefined) return false;
      return canStackOnTableau(card, topOf(col));
    }
  }
}

// ---------------------------------------------------------------------------
// State transitions
// ---------------------------------------------------------------------------

function clampScore(score: number): number {
  return score < 0 ? 0 : score;
}

/** Take a snapshot of `prev` (with its own undoStack cleared to []), append
 * it to `prev.undoStack`, cap at UNDO_CAP, and attach to `next`. */
function withUndo(
  prev: SolitaireState,
  next: Omit<SolitaireState, "undoStack" | "startedAt" | "accumulatedMs">
): SolitaireState {
  const snapshot: SolitaireState = { ...prev, undoStack: [], events: undefined };
  const stack = [...prev.undoStack, snapshot];
  const capped = stack.length > UNDO_CAP ? stack.slice(stack.length - UNDO_CAP) : stack;
  return {
    ...next,
    undoStack: capped,
    startedAt: prev.startedAt,
    accumulatedMs: prev.accumulatedMs,
  };
}

/** Start, advance, or freeze the timer. Called after every state mutation. */
function applyTimer(prev: SolitaireState, next: SolitaireState): SolitaireState {
  const now = Date.now();
  if (next.isComplete && !prev.isComplete) {
    const activeStart = prev.startedAt ?? now;
    return { ...next, accumulatedMs: prev.accumulatedMs + (now - activeStart), startedAt: null };
  }
  return { ...next, startedAt: prev.startedAt ?? now, accumulatedMs: prev.accumulatedMs };
}

/** If the top card of `col` exists and is face-down, flip it and return
 * the (updated column, +reveal score) pair. Otherwise the column is
 * unchanged and the score delta is 0. */
function revealIfNeeded(col: readonly Card[]): { col: readonly Card[]; scoreDelta: number } {
  if (col.length === 0) return { col, scoreDelta: 0 };
  const top = col[col.length - 1];
  if (top === undefined || top.faceUp) return { col, scoreDelta: 0 };
  const flipped: Card = { ...top, faceUp: true };
  return { col: [...col.slice(0, -1), flipped], scoreDelta: SCORE_REVEAL };
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

function finalizeAfterMove(
  prev: SolitaireState,
  next: Omit<SolitaireState, "undoStack" | "isComplete" | "startedAt" | "accumulatedMs" | "hint">
): SolitaireState {
  const wasComplete = prev.isComplete;
  const nowComplete = isWin(next.foundations);
  const bonus = !wasComplete && nowComplete ? SCORE_WIN_BONUS : 0;
  const finalScore = clampScore(next.score + bonus);

  const events: GameEvent[] = [...(next.events ?? [])];
  if (!wasComplete) {
    for (const suit of SUITS) {
      if (prev.foundations[suit].length < 13 && next.foundations[suit].length === 13) {
        events.push("foundationComplete");
      }
    }
    if (nowComplete) events.push("gameWin");
  }

  return applyTimer(
    prev,
    withUndo(prev, {
      ...next,
      score: finalScore,
      isComplete: nowComplete,
      hint: undefined,
      events: events.length > 0 ? events : undefined,
    })
  );
}

// ---------------------------------------------------------------------------
// applyMove
// ---------------------------------------------------------------------------

/**
 * Apply a card-moving `Move`. Returns the (immutable) next state; if the
 * move is invalid, returns `state` unchanged. Auto-reveals a newly
 * uncovered face-down tableau card and adds +5 in the same step. Applies
 * the +500 win bonus exactly once when the game transitions to complete.
 */
export function applyMove(state: SolitaireState, move: Move): SolitaireState {
  if (!validateMove(state, move)) return { ...state, events: ["invalidMove"] };

  switch (move.type) {
    case "waste-to-tableau": {
      const card = topOf(state.waste);
      if (card === undefined) return state;
      const newWaste = state.waste.slice(0, -1);
      const col = state.tableau[move.toCol];
      if (col === undefined) return state;
      const newCol: readonly Card[] = [...col, { ...card, faceUp: true }];
      const tableau = replaceAt(state.tableau, move.toCol, newCol);
      return finalizeAfterMove(state, {
        _v: 1,
        drawMode: state.drawMode,
        tableau,
        foundations: state.foundations,
        stock: state.stock,
        waste: newWaste,
        score: state.score + SCORE_WASTE_TO_TABLEAU,
        recycleCount: state.recycleCount,
        events: ["cardPlace"],
      });
    }
    case "waste-to-foundation": {
      const card = topOf(state.waste);
      if (card === undefined) return state;
      const newWaste = state.waste.slice(0, -1);
      const newPile: readonly Card[] = [...state.foundations[card.suit], { ...card, faceUp: true }];
      const foundations = withFoundation(state.foundations, card.suit, newPile);
      return finalizeAfterMove(state, {
        _v: 1,
        drawMode: state.drawMode,
        tableau: state.tableau,
        foundations,
        stock: state.stock,
        waste: newWaste,
        score: state.score + SCORE_WASTE_TO_FOUNDATION,
        recycleCount: state.recycleCount,
        events: ["cardPlace"],
      });
    }
    case "tableau-to-tableau": {
      const src = state.tableau[move.fromCol];
      const dst = state.tableau[move.toCol];
      if (src === undefined || dst === undefined) return state;
      const run = src.slice(move.fromIndex);
      const newSrc = src.slice(0, move.fromIndex);
      const newDst: readonly Card[] = [...dst, ...run];
      const revealed = revealIfNeeded(newSrc);
      let tableau = replaceAt(state.tableau, move.fromCol, revealed.col);
      tableau = replaceAt(tableau, move.toCol, newDst);
      const ttEvents: GameEvent[] = ["cardPlace"];
      if (revealed.scoreDelta > 0) ttEvents.push("cardFlip");
      return finalizeAfterMove(state, {
        _v: 1,
        drawMode: state.drawMode,
        tableau,
        foundations: state.foundations,
        stock: state.stock,
        waste: state.waste,
        score: state.score + revealed.scoreDelta,
        recycleCount: state.recycleCount,
        events: ttEvents,
      });
    }
    case "tableau-to-foundation": {
      const src = state.tableau[move.fromCol];
      if (src === undefined) return state;
      const card = topOf(src);
      if (card === undefined) return state;
      const newSrc = src.slice(0, -1);
      const newPile: readonly Card[] = [...state.foundations[card.suit], card];
      const foundations = withFoundation(state.foundations, card.suit, newPile);
      const revealed = revealIfNeeded(newSrc);
      const tableau = replaceAt(state.tableau, move.fromCol, revealed.col);
      const tfEvents: GameEvent[] = ["cardPlace"];
      if (revealed.scoreDelta > 0) tfEvents.push("cardFlip");
      return finalizeAfterMove(state, {
        _v: 1,
        drawMode: state.drawMode,
        tableau,
        foundations,
        stock: state.stock,
        waste: state.waste,
        score: state.score + SCORE_TABLEAU_TO_FOUNDATION + revealed.scoreDelta,
        recycleCount: state.recycleCount,
        events: tfEvents,
      });
    }
    case "foundation-to-tableau": {
      const pile = state.foundations[move.fromSuit];
      const card = topOf(pile);
      if (card === undefined) return state;
      const col = state.tableau[move.toCol];
      if (col === undefined) return state;
      const newPile = pile.slice(0, -1);
      const newCol: readonly Card[] = [...col, card];
      const foundations = withFoundation(state.foundations, move.fromSuit, newPile);
      const tableau = replaceAt(state.tableau, move.toCol, newCol);
      return finalizeAfterMove(state, {
        _v: 1,
        drawMode: state.drawMode,
        tableau,
        foundations,
        stock: state.stock,
        waste: state.waste,
        score: state.score + SCORE_FOUNDATION_TO_TABLEAU,
        recycleCount: state.recycleCount,
        events: ["cardPlace"],
      });
    }
  }
}

function replaceAt<T>(arr: readonly T[], idx: number, value: T): readonly T[] {
  const out = arr.slice();
  out[idx] = value;
  return out;
}

// ---------------------------------------------------------------------------
// Stock operations
// ---------------------------------------------------------------------------

/**
 * Flip the top `drawMode` cards from stock to waste (face-up). No-op if
 * stock is empty (caller uses `recycleWaste` for that). Pushes undo.
 */
export function drawFromStock(state: SolitaireState): SolitaireState {
  if (state.stock.length === 0) return state;
  const n = Math.min(state.drawMode, state.stock.length);
  const drawn: Card[] = [];
  for (let i = 0; i < n; i++) {
    const idx = state.stock.length - 1 - i;
    const card = state.stock[idx];
    if (card === undefined) return state;
    drawn.push({ ...card, faceUp: true });
  }
  const newStock = state.stock.slice(0, state.stock.length - n);
  const newWaste = [...state.waste, ...drawn];
  return applyTimer(
    state,
    withUndo(state, {
      _v: 1,
      drawMode: state.drawMode,
      tableau: state.tableau,
      foundations: state.foundations,
      stock: newStock,
      waste: newWaste,
      score: state.score,
      recycleCount: state.recycleCount,
      isComplete: state.isComplete,
      events: ["cardFlip"],
    })
  );
}

/**
 * Recycle the waste back to the stock. First recycle is free; 2nd and
 * later cost -50 (floored at 0). No-op if stock has cards or waste is empty.
 */
export function recycleWaste(state: SolitaireState): SolitaireState {
  if (state.stock.length !== 0 || state.waste.length === 0) return state;
  const newStock: Card[] = [];
  for (let i = state.waste.length - 1; i >= 0; i--) {
    const card = state.waste[i];
    if (card === undefined) return state;
    newStock.push({ ...card, faceUp: false });
  }
  const penalty = state.recycleCount >= 1 ? SCORE_RECYCLE_PENALTY : 0;
  return applyTimer(
    state,
    withUndo(state, {
      _v: 1,
      drawMode: state.drawMode,
      tableau: state.tableau,
      foundations: state.foundations,
      stock: newStock,
      waste: [],
      score: clampScore(state.score + penalty),
      recycleCount: state.recycleCount + 1,
      isComplete: state.isComplete,
    })
  );
}

// ---------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------

/**
 * Pop the most recent snapshot off the undo stack and return it with the
 * remaining stack re-attached. Returns `state` unchanged when the stack is
 * empty.
 */
export function undo(state: SolitaireState): SolitaireState {
  if (state.undoStack.length === 0) return state;
  const last = state.undoStack[state.undoStack.length - 1];
  if (last === undefined) return state;
  const remaining = state.undoStack.slice(0, -1);
  // Preserve the live timer — don't restore the older timer snapshot from the undo entry.
  return {
    ...last,
    undoStack: remaining,
    startedAt: state.startedAt,
    accumulatedMs: state.accumulatedMs,
  };
}

// ---------------------------------------------------------------------------
// Auto-complete
// ---------------------------------------------------------------------------

/** True iff every tableau card is face-up. When this holds the remaining
 * deal is trivially winnable — the UI can offer a one-click finish. */
export function canAutoComplete(state: SolitaireState): boolean {
  if (state.isComplete) return false;
  for (const col of state.tableau) {
    for (const card of col) {
      if (!card.faceUp) return false;
    }
  }
  return true;
}

/**
 * Perform a single auto-complete step and return the resulting state.
 * Order: drain stock → waste, then waste → foundation, then tableau →
 * foundation (lowest-column-first). Returns `state` unchanged if no
 * step applies (i.e., the game is already complete or cannot finish).
 */
export function autoComplete(state: SolitaireState): SolitaireState {
  if (state.isComplete) return state;

  // 1) Waste → foundation.
  const wasteTop = topOf(state.waste);
  if (wasteTop !== undefined && canStackOnFoundation(wasteTop, state.foundations[wasteTop.suit])) {
    return applyMove(state, { type: "waste-to-foundation" });
  }

  // 2) Stock → waste (drains 1 at a time so the loop makes progress).
  if (state.stock.length > 0) {
    return drawFromStock(state);
  }

  // 3) Tableau → foundation, lowest-column-first.
  for (let col = 0; col < TABLEAU_COLUMNS; col++) {
    const pile = state.tableau[col];
    if (pile === undefined) continue;
    const card = topOf(pile);
    if (card === undefined || !card.faceUp) continue;
    if (canStackOnFoundation(card, state.foundations[card.suit])) {
      return applyMove(state, { type: "tableau-to-foundation", fromCol: col });
    }
  }

  return state;
}

// ---------------------------------------------------------------------------
// Hint engine (#2033)
// ---------------------------------------------------------------------------

/**
 * Returns false when a tableau-to-tableau move is a pure oscillation: the
 * moving run's base card's parent card (the card that would be exposed) is
 * color-rank-equivalent to the destination top card (same rank, same color),
 * and the move doesn't reveal a face-down card, doesn't empty a column for a
 * waiting king, and doesn't enable a foundation play. All other move types
 * are always productive.
 *
 * Used by getHintMoves to avoid suggesting reversible swaps (#1295 precedent
 * from FreeCell). applyMove / validateMove are unaffected.
 */
export function isProductiveMove(state: SolitaireState, move: Move): boolean {
  if (move.type !== "tableau-to-tableau") return true;

  const src = state.tableau[move.fromCol];
  const dst = state.tableau[move.toCol];
  if (src === undefined || dst === undefined) return true;

  // Moving from column base — could create an empty column for a king
  if (move.fromIndex === 0) return true;

  // Reveals a face-down card → productive
  const cardBelowRun = src[move.fromIndex - 1];
  if (cardBelowRun !== undefined && !cardBelowRun.faceUp) return true;

  // The parent card (exposed after the move) can go to foundation → productive
  if (
    cardBelowRun !== undefined &&
    canStackOnFoundation(cardBelowRun, state.foundations[cardBelowRun.suit])
  )
    return true;

  const destTop = topOf(dst);
  if (destTop === undefined) return true; // moving to empty column

  // Reversible swap: cardBelowRun is face-up, can't go to foundation, and the
  // move is valid (validateMove already confirmed rank/color) — no benefit gained.
  return false;
}

/**
 * Returns all legal moves from the current state, ordered by desirability:
 *   1. Foundation moves (waste→foundation, tableau→foundation) — always progress.
 *   2. Tableau→tableau moves that reveal a face-down card.
 *   3. Waste→tableau moves.
 *   4. Other productive tableau→tableau moves.
 *
 * Non-productive moves (reversible swaps with no benefit) are filtered out.
 * Stock draws and foundation→tableau retreats are excluded from hints.
 * Returns [] when no productive moves exist.
 */
export function getHintMoves(state: SolitaireState): Move[] {
  const moves: Move[] = [];

  // 1. Foundation moves — always progress
  const wasteFoundation: Move = { type: "waste-to-foundation" };
  if (validateMove(state, wasteFoundation)) moves.push(wasteFoundation);

  for (let col = 0; col < TABLEAU_COLUMNS; col++) {
    const m: Move = { type: "tableau-to-foundation", fromCol: col };
    if (validateMove(state, m)) moves.push(m);
  }

  // 2. Tableau→tableau moves that reveal a face-down card
  const revealingMoves: Move[] = [];
  const otherProductiveMoves: Move[] = [];

  for (let fromCol = 0; fromCol < TABLEAU_COLUMNS; fromCol++) {
    const src = state.tableau[fromCol];
    if (!src || src.length === 0) continue;
    let foundForCol = false;
    for (let fromIndex = 0; fromIndex < src.length && !foundForCol; fromIndex++) {
      const card = src[fromIndex];
      if (card === undefined || !card.faceUp) continue;
      for (let toCol = 0; toCol < TABLEAU_COLUMNS; toCol++) {
        if (toCol === fromCol) continue;
        const m: Move = { type: "tableau-to-tableau", fromCol, fromIndex, toCol };
        if (!validateMove(state, m)) continue;
        if (!isProductiveMove(state, m)) continue;

        const revealsFaceDown =
          fromIndex > 0 && src[fromIndex - 1] !== undefined && !src[fromIndex - 1]!.faceUp;

        if (revealsFaceDown) {
          revealingMoves.push(m);
        } else {
          otherProductiveMoves.push(m);
        }
        foundForCol = true;
        break;
      }
    }
  }

  moves.push(...revealingMoves);

  // 3. Waste→tableau moves
  for (let toCol = 0; toCol < TABLEAU_COLUMNS; toCol++) {
    const m: Move = { type: "waste-to-tableau", toCol };
    if (validateMove(state, m)) {
      moves.push(m);
      break; // first valid destination is sufficient
    }
  }

  // 4. Other productive tableau→tableau moves
  moves.push(...otherProductiveMoves);

  return moves;
}

/**
 * Sets state.hint to the first legal move (for the hint UI to highlight).
 * Returns state unchanged if there are no legal moves — caller should check
 * state.hint to decide whether to surface a "no moves" message instead.
 * Does NOT mutate the input state.
 */
export function applyHint(state: SolitaireState): SolitaireState {
  const moves = getHintMoves(state);
  const newScore = Math.max(0, state.score - HINT_PENALTY);
  return { ...state, hint: moves[0], score: newScore };
}
