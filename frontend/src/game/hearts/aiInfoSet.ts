/**
 * Hearts information set for the utility AI (#2029).
 *
 * `buildHeartsInfoSet` converts a live HeartsState snapshot into a pure,
 * read-only InformationSet that decision-making components can consume without
 * direct access to the mutable engine state.
 *
 * Pure TypeScript. No React, AsyncStorage, HTTP, timers, or side effects.
 */

import type { InformationSet } from "../_shared/utilityAi/types";
import type { Card, HeartsState, PassDirection, Suit, TrickCard } from "./types";

// ---------------------------------------------------------------------------
// Hearts-specific information set type
// ---------------------------------------------------------------------------

/**
 * A per-player, per-suit boolean ledger of known voids.
 * voidLedger[playerIndex][suit] === true means that player is known void in that suit.
 * Derived from engine-tracked knownVoids + current-trick observations.
 */
export type VoidLedger = Readonly<Record<number, Readonly<Partial<Record<Suit, boolean>>>>>;

/**
 * Read-only decision snapshot for one player's turn in a Hearts game.
 * Implements InformationSet with kind === "hearts".
 */
export interface HeartsInfoSet extends InformationSet {
  readonly kind: "hearts";

  /** The requesting player's current hand. */
  readonly hand: readonly Card[];

  /** Cards played so far in the current trick, in play order. */
  readonly currentTrick: readonly TrickCard[];

  /**
   * The suit led in the current trick, or null when this player is leading
   * (i.e. currentTrick is empty at the time of the snapshot).
   */
  readonly ledSuit: Suit | null;

  /**
   * All card keys ("suit:rank") that have been seen this hand — aggregated from
   * every player's wonCards pile and every card in the current trick.
   * Generalises the ad-hoc card-counting in the Hard AI play logic.
   */
  readonly seenKeys: ReadonlySet<string>;

  /**
   * Per-player, per-suit known-void ledger.
   * A player is recorded as void in suit S when they played off-suit while S
   * was led in a completed trick (recorded by the engine in knownVoids) or
   * while S is led in the current trick (inferred live from currentTrick).
   */
  readonly voidLedger: VoidLedger;

  /** Points (hearts + Q♠) each player has accumulated this hand. */
  readonly pointsPerPlayer: readonly number[];

  /** Running cumulative scores across all hands. */
  readonly cumulativeScores: readonly number[];

  /** Number of tricks remaining in this hand (13 − tricksPlayedInHand). */
  readonly tricksRemaining: number;

  /** Pass direction for this hand. */
  readonly passDirection: PassDirection;

  /** Whether hearts have been broken yet this hand. */
  readonly heartsBroken: boolean;

  /** True when this is the first trick of the hand (tricksPlayedInHand === 0). */
  readonly isFirstTrick: boolean;
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Build a read-only HeartsInfoSet snapshot for `playerIndex` at the current
 * point in `state`.
 *
 * @param hand        The player's current hand (state.playerHands[playerIndex]).
 * @param trick       The current trick (state.currentTrick).
 * @param state       The full game state snapshot.
 * @param playerIndex The seat index (0–3) for whom the snapshot is built.
 */
export function buildHeartsInfoSet(
  hand: readonly Card[],
  trick: readonly TrickCard[],
  state: HeartsState,
  _playerIndex: number
): HeartsInfoSet {
  // ------------------------------------------------------------------
  // ledSuit: null when leading (trick is empty), otherwise the first card's suit.
  // ------------------------------------------------------------------
  const ledSuit: Suit | null = trick.length > 0 ? (trick[0]?.card.suit ?? null) : null;

  // ------------------------------------------------------------------
  // seenKeys: aggregate wonCards from all players + current trick cards.
  // ------------------------------------------------------------------
  const seenKeys = new Set<string>();
  for (const pile of state.wonCards) {
    for (const c of pile) {
      seenKeys.add(`${c.suit}:${c.rank}`);
    }
  }
  for (const tc of trick) {
    seenKeys.add(`${tc.card.suit}:${tc.card.rank}`);
  }

  // ------------------------------------------------------------------
  // voidLedger: merge engine-tracked knownVoids with live current-trick observations.
  //
  // Engine-tracked: state.knownVoids[p] lists suits player p is known void in
  // from completed tricks (updated by resolveTrick when a follower plays off-suit).
  //
  // Live observation: within the current (incomplete) trick, any player who has
  // already played off the led suit is also void in that suit — we can observe
  // this now without waiting for trick resolution.
  //
  // No false positives: we only mark a void when a *follower* plays off-suit.
  // The leader (trick[0]) sets the led suit and never "fails to follow".
  // ------------------------------------------------------------------
  const rawKnownVoids: readonly (readonly Suit[])[] = state.knownVoids ?? [[], [], [], []];

  // Start from the engine-tracked voids (completed tricks).
  const ledgerMutable: Record<number, Partial<Record<Suit, boolean>>> = {};
  for (let p = 0; p < 4; p++) {
    const voids = rawKnownVoids[p] ?? [];
    if (voids.length > 0) {
      const entry: Partial<Record<Suit, boolean>> = {};
      for (const suit of voids) {
        entry[suit] = true;
      }
      ledgerMutable[p] = entry;
    }
  }

  // Layer in live observations from the current trick (followers only, index > 0).
  if (ledSuit !== null) {
    for (let i = 1; i < trick.length; i++) {
      const tc = trick[i]!;
      if (tc.card.suit !== ledSuit) {
        // This follower is void in ledSuit right now.
        if (!ledgerMutable[tc.playerIndex]) {
          ledgerMutable[tc.playerIndex] = {};
        }
        (ledgerMutable[tc.playerIndex] as Partial<Record<Suit, boolean>>)[ledSuit] = true;
      }
    }
  }

  const voidLedger: VoidLedger = ledgerMutable as VoidLedger;

  // ------------------------------------------------------------------
  // pointsPerPlayer: hand-level point totals (hearts + Q♠ taken this hand).
  // ------------------------------------------------------------------
  const pointsPerPlayer: readonly number[] = state.handScores.map((s) => s ?? 0);

  // ------------------------------------------------------------------
  // tricksRemaining: 13 minus tricks already completed.
  // ------------------------------------------------------------------
  const tricksRemaining = 13 - state.tricksPlayedInHand;

  return Object.freeze({
    kind: "hearts" as const,
    hand,
    currentTrick: trick,
    ledSuit,
    seenKeys: Object.freeze(seenKeys) as ReadonlySet<string>,
    voidLedger: Object.freeze(voidLedger) as VoidLedger,
    pointsPerPlayer,
    cumulativeScores: state.cumulativeScores,
    tricksRemaining,
    passDirection: state.passDirection,
    heartsBroken: state.heartsBroken,
    isFirstTrick: state.tricksPlayedInHand === 0,
  });
}
