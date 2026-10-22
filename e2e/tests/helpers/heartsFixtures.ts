/**
 * Seeded Hearts saves shared by the Hearts specs (#2224).
 *
 * `loadGame` runs the integrity suite on a stored save and discards one that
 * cannot be a real game, so every seeded state must hold exactly 52 unique
 * cards across hands, the current trick and the won piles (the engine keeps
 * all 52 in `wonCards` once a hand ends), with scores that reconcile. This
 * module is pure (no Playwright import) so a jest test in `frontend/` can run
 * each fixture through `checkHeartsIntegrity`.
 */

export interface FixtureCard {
  suit: string;
  rank: number;
}

const c = (suit: string, rank: number): FixtureCard => ({ suit, rank });

const SUITS = ["clubs", "diamonds", "hearts", "spades"];

export function fullDeck(): FixtureCard[] {
  return SUITS.flatMap((suit) =>
    Array.from({ length: 13 }, (_, i) => c(suit, i + 1)),
  );
}

/** The deck cards not in `placed`, in deck order. */
export function remainingCards(placed: FixtureCard[]): FixtureCard[] {
  const key = (x: FixtureCard) => `${x.suit}-${x.rank}`;
  const used = new Set(placed.map(key));
  return fullDeck().filter((x) => !used.has(key(x)));
}

/**
 * Deal the cards not in `placed` round-robin onto the `targets` piles
 * (appended to copies of `piles`). Round-robin spreads the hearts and Q♠, so
 * no pile becomes an accidental moon shot.
 */
export function distributeRemaining(
  placed: FixtureCard[],
  piles: FixtureCard[][],
  targets: number[] = [0, 1, 2, 3],
): FixtureCard[][] {
  const out = piles.map((p) => [...p]);
  remainingCards(placed).forEach((card, i) => {
    out[targets[i % targets.length]!]!.push(card);
  });
  return out;
}

// ── hearts-difficulty-select: a finished game ──────────────────────────────
// Each scoreHistory row sums to 26 (or is a moon row) and the column sums
// equal cumulativeScores (#1540). All 52 cards sit in the won piles.
export const DIFFICULTY_GAME_OVER_STATE = {
  _v: 3,
  aiDifficulty: "schemer",
  phase: "game_over",
  handNumber: 5,
  passDirection: "none",
  playerHands: [[], [], [], []],
  cumulativeScores: [104, 0, 0, 0],
  handScores: [0, 0, 0, 0],
  scoreHistory: [
    [26, 0, 0, 0],
    [26, 0, 0, 0],
    [26, 0, 0, 0],
    [26, 0, 0, 0],
  ],
  passSelections: [[], [], [], []],
  passingComplete: true,
  currentTrick: [],
  currentLeaderIndex: 0,
  currentPlayerIndex: 0,
  wonCards: distributeRemaining([], [[], [], [], []]),
  heartsBroken: true,
  tricksPlayedInHand: 13,
  isComplete: true,
  winnerIndex: 1,
};

// ── hearts-leaderboard ─────────────────────────────────────────────────────
// Player 0 leads with 45 points (lowest). Player 1 is already at 100.
// P0 shoots the moon twice (rows 0–1) so their delta stays 0 while others
// accumulate; normal hands fill the rest.
export const LEADERBOARD_GAME_OVER_STATE = {
  _v: 2,
  phase: "game_over",
  handNumber: 7,
  passDirection: "none",
  playerHands: [[], [], [], []],
  cumulativeScores: [45, 100, 63, 52],
  handScores: [0, 0, 0, 0],
  scoreHistory: [
    [0, 26, 26, 26], // P0 shoots moon — sum 78
    [0, 26, 26, 26], // P0 shoots moon — sum 78
    [12, 12, 2, 0], // normal — sum 26
    [12, 12, 2, 0], // normal — sum 26
    [12, 12, 2, 0], // normal — sum 26
    [9, 12, 5, 0], // normal — sum 26
  ],
  passSelections: [[], [], [], []],
  passingComplete: true,
  currentTrick: [],
  currentLeaderIndex: 0,
  currentPlayerIndex: 0,
  wonCards: distributeRemaining([], [[], [], [], []]),
  heartsBroken: false,
  tricksPlayedInHand: 0,
  isComplete: true,
  winnerIndex: 0, // Player 0 wins (lowest score)
};

// The last trick of hand 7: West led ♦7, North and East followed; the human
// holds only ♥5 and plays it. The other 48 cards are in the won piles.
const LAST_TRICK_CARDS = [c("diamonds", 7), c("diamonds", 8), c("diamonds", 9)];
export const LEADERBOARD_LAST_TRICK_STATE = {
  ...LEADERBOARD_GAME_OVER_STATE,
  _v: 3,
  aiDifficulty: "schemer",
  phase: "playing",
  isComplete: false,
  winnerIndex: null,
  heartsBroken: true,
  tricksPlayedInHand: 12,
  currentLeaderIndex: 1,
  currentPlayerIndex: 0,
  currentTrick: LAST_TRICK_CARDS.map((card, i) => ({
    card,
    playerIndex: i + 1,
  })),
  playerHands: [[c("hearts", 5)], [], [], []],
  wonCards: distributeRemaining(
    [...LAST_TRICK_CARDS, c("hearts", 5)],
    [[], [], [], []],
  ),
};

// ── hearts-difficulty-select: a v2 save (no aiDifficulty) ──────────────────
const V2_P0_HAND = [
  c("spades", 1),
  c("spades", 13),
  c("clubs", 7),
  c("clubs", 8),
  c("clubs", 9),
  c("diamonds", 5),
  c("diamonds", 9),
  c("clubs", 10),
  c("diamonds", 3),
  c("hearts", 5),
  c("hearts", 6),
  c("hearts", 7),
  c("hearts", 8),
];
// The other 39 cards, 13 per remaining seat.
const V2_OTHER_HANDS = distributeRemaining(
  V2_P0_HAND,
  [[], [], []],
  [0, 1, 2],
);
export const DIFFICULTY_V2_STATE = {
  _v: 2,
  phase: "playing",
  handNumber: 1,
  passDirection: "left",
  playerHands: [V2_P0_HAND, ...V2_OTHER_HANDS],
  cumulativeScores: [0, 0, 0, 0],
  handScores: [0, 0, 0, 0],
  scoreHistory: [],
  passSelections: [[], [], [], []],
  passingComplete: true,
  currentTrick: [],
  currentLeaderIndex: 0,
  currentPlayerIndex: 0,
  wonCards: [[], [], [], []],
  heartsBroken: false,
  tricksPlayedInHand: 0,
  isComplete: false,
  winnerIndex: null,
};

// ── hearts-shoot-the-moon ──────────────────────────────────────────────────
// wonCards[0]: 12 hearts (2–K) + Q♠ — player is one card away from moon. The
// other 35 cards (no point cards among them) sit in the other players' piles.
const HEARTS_2_TO_K = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map((r) =>
  c("hearts", r),
);
const QUEEN_OF_SPADES = c("spades", 12);
const MOON_HANDS = [
  [c("hearts", 1)], // You: only the Ace of Hearts remains
  [c("clubs", 5)], // West: one club
  [c("clubs", 6)], // North: one club
  [c("clubs", 7)], // East: one club
];
const MOON_P0_PILE = [...HEARTS_2_TO_K, QUEEN_OF_SPADES];
export const NEAR_MOON_STATE = {
  _v: 2,
  phase: "playing",
  handNumber: 1,
  passDirection: "left",
  playerHands: MOON_HANDS,
  cumulativeScores: [0, 0, 0, 0],
  handScores: [25, 0, 0, 0], // 12 hearts (12 pts) + Q♠ (13 pts) accumulated
  scoreHistory: [],
  passSelections: [[], [], [], []],
  passingComplete: true,
  currentTrick: [],
  currentLeaderIndex: 0,
  currentPlayerIndex: 0, // Player's turn to lead
  wonCards: distributeRemaining(
    [...MOON_HANDS.flat(), ...MOON_P0_PILE],
    [MOON_P0_PILE, [], [], []],
    [1, 2, 3],
  ),
  heartsBroken: true,
  tricksPlayedInHand: 12,
  isComplete: false,
  winnerIndex: null,
};
