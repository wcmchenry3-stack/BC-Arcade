/**
 * Saved score breakdowns on a finished game's detail (#2840).
 *
 * `GET /games/{id}` returns the completion's result block merged into
 * `metadata` (owner only). These parsers read the game-specific parts of it
 * defensively: anything missing or malformed parses to null, so the detail
 * screen shows the total and its facts instead of a breakdown that claims a
 * zero it never saw. Contracts: docs/games/hearts.md (#2838),
 * docs/games/yacht.md (#2839), docs/games/starswarm.md (#2837).
 */

type Metadata = Readonly<Record<string, unknown>>;

function isInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function sum(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

// ─── Hearts ──────────────────────────────────────────────────────────────────

const HEARTS_SEATS = 4;
const MOON_POINTS = 26;

export interface HeartsHand {
  /** Applied penalty deltas in seat order (post moon adjustment). */
  readonly scores: readonly number[];
  /** The seat that shot the moon this hand (0 for it, 26 for everyone else), or null. */
  readonly moonSeat: number | null;
}

export interface HeartsBreakdown {
  readonly hands: readonly HeartsHand[];
  readonly totals: readonly number[];
  readonly humanSeat: number;
  /** Every seat's deltas add up to its total. */
  readonly reconciled: boolean;
}

function moonSeatOf(row: readonly number[]): number | null {
  const zeros = row.filter((v) => v === 0).length;
  const moons = row.filter((v) => v === MOON_POINTS).length;
  return zeros === 1 && moons === HEARTS_SEATS - 1 ? row.indexOf(0) : null;
}

/** `hand_scores` / `final_scores` / `human_seat`, or null when absent or malformed. */
export function parseHeartsBreakdown(metadata: Metadata): HeartsBreakdown | null {
  const hands = metadata.hand_scores;
  const totals = metadata.final_scores;
  const seat = metadata.human_seat;
  if (!Array.isArray(hands) || hands.length === 0) return null;
  if (!Array.isArray(totals) || totals.length !== HEARTS_SEATS || !totals.every(isInt)) return null;
  if (!isInt(seat) || seat < 0 || seat >= HEARTS_SEATS) return null;
  const rows: number[][] = [];
  for (const row of hands) {
    if (!Array.isArray(row) || row.length !== HEARTS_SEATS || !row.every(isInt)) return null;
    rows.push(row as number[]);
  }
  const reconciled = (totals as number[]).every(
    (total, i) => sum(rows.map((r) => r[i] ?? 0)) === total
  );
  return {
    hands: rows.map((scores) => ({ scores, moonSeat: moonSeatOf(scores) })),
    totals: totals as number[],
    humanSeat: seat,
    reconciled,
  };
}

/** Seats with the human first, then the others in seat order. */
export function heartsSeatOrder(humanSeat: number): number[] {
  const others = [0, 1, 2, 3].filter((s) => s !== humanSeat);
  return [humanSeat, ...others];
}

// ─── Yacht ───────────────────────────────────────────────────────────────────

export const YACHT_UPPER = ["ones", "twos", "threes", "fours", "fives", "sixes"] as const;
export const YACHT_LOWER = [
  "three_of_a_kind",
  "four_of_a_kind",
  "full_house",
  "small_straight",
  "large_straight",
  "yacht",
  "chance",
] as const;
export type YachtCategory = (typeof YACHT_UPPER)[number] | (typeof YACHT_LOWER)[number];

/** The yacht namespace's label key for a saved category key. */
export const YACHT_CATEGORY_LABEL: Readonly<Record<YachtCategory, string>> = {
  ones: "yacht:category.ones",
  twos: "yacht:category.twos",
  threes: "yacht:category.threes",
  fours: "yacht:category.fours",
  fives: "yacht:category.fives",
  sixes: "yacht:category.sixes",
  three_of_a_kind: "yacht:category.threeOfAKind",
  four_of_a_kind: "yacht:category.fourOfAKind",
  full_house: "yacht:category.fullHouse",
  small_straight: "yacht:category.smallStraight",
  large_straight: "yacht:category.largeStraight",
  yacht: "yacht:category.yacht",
  chance: "yacht:category.chance",
};

export interface YachtCard {
  /** Filled categories only; an unfilled one (a partial card) is absent, not 0. */
  readonly categories: Readonly<Partial<Record<YachtCategory, number>>>;
  readonly upperBonus: number;
  readonly yachtBonusCount: number;
  readonly yachtBonusTotal: number;
  readonly upperSubtotal: number;
  readonly lowerSubtotal: number;
  readonly total: number;
  /** Every one of the 13 categories is filled. */
  readonly complete: boolean;
}

export interface YachtBreakdown {
  readonly player: YachtCard;
  readonly opponent: YachtCard | null;
  /**
   * Each card adds up to its score and keeps the bonus rules (checked here,
   * per card). False means show the card without claiming it explains the
   * total. `opponentReconciled` is true when there is no opponent card.
   */
  readonly playerReconciled: boolean;
  readonly opponentReconciled: boolean;
}

const UPPER_BONUS_THRESHOLD = 63;
const UPPER_BONUS_VALUE = 35;
const YACHT_BONUS_VALUE = 100;
const YACHT_MAX = 50;

/** The card's bonuses follow the rules (docs/games/yacht.md, "Bonus accounting"). */
function bonusesFollowRules(card: YachtCard): boolean {
  const upperFilled = YACHT_UPPER.every((k) => card.categories[k] != null);
  const expectedUpper =
    upperFilled && card.upperSubtotal >= UPPER_BONUS_THRESHOLD ? UPPER_BONUS_VALUE : 0;
  return (
    card.upperBonus === expectedUpper &&
    card.yachtBonusTotal === card.yachtBonusCount * YACHT_BONUS_VALUE &&
    (card.yachtBonusCount === 0 || card.categories.yacht === YACHT_MAX)
  );
}

/**
 * Whether `card` explains `score`, checked locally. When there is no score
 * to compare its total with, the server's `scorecard_reconciled` (which
 * covers both cards) stands in for that half of the check.
 */
function cardReconciles(card: YachtCard, score: unknown, serverFlag: unknown): boolean {
  if (!bonusesFollowRules(card)) return false;
  return isInt(score) ? score === card.total : serverFlag !== false;
}

function parseYachtCard(raw: unknown): YachtCard | null {
  if (!isRecord(raw) || !isRecord(raw.categories)) return null;
  const categories: Partial<Record<YachtCategory, number>> = {};
  for (const key of [...YACHT_UPPER, ...YACHT_LOWER]) {
    const v = raw.categories[key];
    if (v == null) continue;
    if (!isInt(v) || v < 0) return null;
    categories[key] = v;
  }
  const int = (v: unknown): number | null => (v == null ? 0 : isInt(v) && v >= 0 ? v : null);
  const upperBonus = int(raw.upper_bonus);
  const yachtBonusCount = int(raw.yacht_bonus_count);
  const yachtBonusTotal = int(raw.yacht_bonus_total);
  if (upperBonus == null || yachtBonusCount == null || yachtBonusTotal == null) return null;
  const upperSubtotal = sum(YACHT_UPPER.map((k) => categories[k] ?? 0));
  const lowerSubtotal = sum(YACHT_LOWER.map((k) => categories[k] ?? 0));
  return {
    categories,
    upperBonus,
    yachtBonusCount,
    yachtBonusTotal,
    upperSubtotal,
    lowerSubtotal,
    total: upperSubtotal + lowerSubtotal + upperBonus + yachtBonusTotal,
    complete: Object.keys(categories).length === YACHT_UPPER.length + YACHT_LOWER.length,
  };
}

/** The saved `scorecard` (and `opponent_scorecard`), or null when there is no usable card. */
export function parseYachtBreakdown(
  metadata: Metadata,
  finalScore: number | null
): YachtBreakdown | null {
  const player = parseYachtCard(metadata.scorecard);
  if (player == null) return null;
  const opponent = parseYachtCard(metadata.opponent_scorecard);
  const flag = metadata.scorecard_reconciled;
  return {
    player,
    opponent,
    playerReconciled: cardReconciles(player, finalScore, flag),
    opponentReconciled: opponent == null || cardReconciles(opponent, metadata.opponent_score, flag),
  };
}

// ─── Star Swarm ──────────────────────────────────────────────────────────────

export interface StarSwarmSource {
  readonly key: string;
  readonly points: number;
}

export interface StarSwarmRow {
  /** One detailed wave (`first === last`), or the folded `earlier` span. */
  readonly first: number;
  readonly last: number;
  readonly total: number;
  /** Highest points first. */
  readonly sources: readonly StarSwarmSource[];
}

export interface StarSwarmBreakdown {
  readonly rows: readonly StarSwarmRow[];
  /** Points the ledger didn't attribute to a wave; 0 when none. */
  readonly unattributed: number;
  /** Each row's sources add up to its total, and everything adds up to the final score. */
  readonly reconciled: boolean;
}

function parseSources(pts: unknown): StarSwarmSource[] | null {
  if (!isRecord(pts)) return null;
  const sources: StarSwarmSource[] = [];
  for (const [key, points] of Object.entries(pts)) {
    if (!isInt(points)) return null;
    sources.push({ key, points });
  }
  return sources.sort((a, b) => b.points - a.points);
}

function parseRow(raw: unknown, first: unknown, last: unknown): StarSwarmRow | null {
  if (!isRecord(raw) || !isInt(first) || !isInt(last) || !isInt(raw.total)) return null;
  const sources = parseSources(raw.pts);
  if (sources == null) return null;
  return { first, last, total: raw.total, sources };
}

/** The saved `score_breakdown` (v1), or null when absent, null or malformed. */
export function parseStarSwarmBreakdown(
  metadata: Metadata,
  finalScore: number | null
): StarSwarmBreakdown | null {
  const raw = metadata.score_breakdown;
  if (!isRecord(raw) || raw.v !== 1 || !Array.isArray(raw.waves)) return null;
  const rows: StarSwarmRow[] = [];
  if (raw.earlier != null) {
    if (!isRecord(raw.earlier)) return null;
    const earlier = parseRow(raw.earlier, raw.earlier.first, raw.earlier.last);
    if (earlier == null) return null;
    rows.push(earlier);
  }
  for (const w of raw.waves) {
    if (!isRecord(w)) return null;
    const row = parseRow(w, w.wave, w.wave);
    if (row == null) return null;
    rows.push(row);
  }
  const unattributed = raw.unattributed == null ? 0 : raw.unattributed;
  // A run that scored nothing is a valid `{v: 1, waves: []}`: an empty breakdown, not a missing one.
  if (!isInt(unattributed)) return null;
  const rowsAddUp = rows.every((r) => sum(r.sources.map((s) => s.points)) === r.total);
  const total = sum(rows.map((r) => r.total)) + unattributed;
  return {
    rows,
    unattributed,
    reconciled: rowsAddUp && (finalScore == null || finalScore === total),
  };
}

/** A score source key split into its enemy tier (or "clear") and optional modifier. */
export function splitSource(key: string): { base: string; mod: string | null } {
  const i = key.indexOf(":");
  return i === -1 ? { base: key, mod: null } : { base: key.slice(0, i), mod: key.slice(i + 1) };
}
