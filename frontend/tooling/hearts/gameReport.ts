/**
 * Whole-game report for the conservative CPU (#3162).
 *
 * The principle checker (principles.ts, principleRun.ts) says whether each
 * play is sound; this report says how the conservative CPU does over full
 * games to 100, against fixed opponents, on duplicate deals (harness.ts: the
 * same cards in rotated seats, so a difference between line-ups is the
 * players). Later, deliberate principle breaks in advanced CPUs must show up
 * here as better whole-game results.
 *
 * It is a report, not a gate. Its two pass/fail rules are the sanity floor
 * (docs/TESTING.md): conservative must beat `random-legal` on points per hand
 * by `SANITY_FLOOR_MARGIN`, and the conservative seats in the moon-shooter
 * matchup must commit no principle violation.
 *
 * Metric definitions (per "subject" seat, i.e. each conservative seat; the
 * same numbers are kept for the opponents). Blocks, not games, are the
 * independent unit (metrics.ts): all rates are ratio estimates with a 95% CI.
 * - points_per_hand: points taken per hand, moon-adjusted (a moon is 0 for the
 *   shooter, 26 for each other seat).
 * - points_per_game: final score of a game (a game ends when a seat reaches 100).
 * - win_rate: games won; a tie for the lowest score splits the win.
 * - qs_taken: hands in which the seat took Q♠.
 * - moon_allowed: hands in which another seat shot the moon.
 * - moon_allowed_when_p7 / _no_p7: the same, split by whether the seat decided
 *   at least one play of that hand with P7 (moon guard).
 * - p7_hands: hands in which the seat decided at least one play with P7.
 * - zero_hands: hands in which the seat took 0 points (a shot moon counts for
 *   the shooter).
 * - moon_shot: hands in which the seat shot the moon.
 */

import { detectMoon, getValidPlays, isQueenOfSpades, playCard } from "../../src/game/hearts/engine";
import { explainCardToPlay, explainCardsToPass } from "../../src/game/hearts/ai";
import {
  isSpadeHonour,
  moonComplete,
  viewOf,
  winning,
  xWinsOrCanOvertake,
} from "../../src/game/hearts/conservative/terms";
import type { Card } from "../../src/game/hearts/types";
import {
  fieldMatchup,
  personaPolicy,
  playGame,
  type HeartsPolicy,
  type Lineup,
  type Matchup,
  type PlayOptions,
  type Policies,
} from "./harness";
import { moonShooterPolicy, randomLegalPolicy } from "./bots";
import {
  differenceSeries,
  meanEstimate,
  ratioEstimate,
  type Estimate,
  type Observation,
  type RatioEstimate,
} from "./metrics";
import {
  checkDecision,
  toRulebookYaml,
  type CompletedTrick,
  type PrincipleId,
  type Violation,
} from "./principles";

/** Default deal seed of `--game-report` (the story number). */
export const GAME_REPORT_SEED = 3162;

/** Default games per matchup of `--game-report` (the nightly run). */
export const DEFAULT_GAME_REPORT_GAMES = 2000;

/**
 * Sanity floor (the report's only performance pass/fail): conservative's
 * points per hand must be at least this many below random-legal's, on the
 * same deals. Observed at the default size: see docs/TESTING.md.
 */
export const SANITY_FLOOR_MARGIN = 4.0;

/** A principle that decides more than this share of judged plays is flagged. */
export const FIRE_FLAG_SHARE = 0.6;

const SUBJECT = "conservative";

/** Principles a conservative play / pass card can be credited to (§2.4). */
export const PLAY_PRINCIPLES: readonly PrincipleId[] = [
  "P1-DUCK",
  "P2-FREE-TRICK",
  "P3-SHED",
  "P5-QUEEN",
  "P6-DISCARD",
  "P7-MOON-GUARD",
  "P9-EXIT",
];
export const PASS_PRINCIPLES: readonly string[] = ["P4-DANGER", "P5-QUEEN", "P6-DISCARD"];

/** Strict positive decimal integer; anything else throws (like `parseHandsArg`). */
export function parseGamesArg(raw: string | undefined, present: boolean): number {
  if (!present) return DEFAULT_GAME_REPORT_GAMES;
  if (raw === undefined || !/^[1-9][0-9]*$/.test(raw) || !Number.isSafeInteger(Number(raw))) {
    throw new RangeError(`--games must be a positive integer (got ${JSON.stringify(raw ?? "")})`);
  }
  return Number(raw);
}

/** Strict non-negative decimal integer seed below 2^32. */
export function parseSeedArg(raw: string | undefined, present: boolean): number {
  if (!present) return GAME_REPORT_SEED;
  if (raw === undefined || !/^(0|[1-9][0-9]*)$/.test(raw) || Number(raw) >= 2 ** 32) {
    throw new RangeError(
      `--seed must be a non-negative integer below 2^32 (got ${JSON.stringify(raw ?? "")})`
    );
  }
  return Number(raw);
}

// ---------------------------------------------------------------------------
// Tallies
// ---------------------------------------------------------------------------

interface Tally {
  games: number;
  winShare: number;
  gamePoints: number;
  hands: number;
  handPoints: number;
  zeroHands: number;
  qsTaken: number;
  moonShots: number;
  moonsAllowed: number;
  p7Hands: number;
  p7MoonsAllowed: number;
  noP7Hands: number;
  noP7MoonsAllowed: number;
}

const TALLY_KEYS: readonly (keyof Tally)[] = [
  "games",
  "winShare",
  "gamePoints",
  "hands",
  "handPoints",
  "zeroHands",
  "qsTaken",
  "moonShots",
  "moonsAllowed",
  "p7Hands",
  "p7MoonsAllowed",
  "noP7Hands",
  "noP7MoonsAllowed",
];

const emptyTally = (): Tally =>
  Object.fromEntries(TALLY_KEYS.map((k) => [k, 0])) as unknown as Tally;

/** One metric: a ratio of two tally fields. */
interface MetricSpec {
  readonly id: string;
  readonly numerator: keyof Tally;
  readonly denominator: keyof Tally;
  readonly description: string;
  readonly percent: boolean;
}

export const REPORT_METRICS: readonly MetricSpec[] = [
  {
    id: "points_per_hand",
    numerator: "handPoints",
    denominator: "hands",
    description: "points taken (moon-adjusted) | hands",
    percent: false,
  },
  {
    id: "points_per_game",
    numerator: "gamePoints",
    denominator: "games",
    description: "final score | games",
    percent: false,
  },
  {
    id: "win_rate",
    numerator: "winShare",
    denominator: "games",
    description: "games won (ties split) | games",
    percent: true,
  },
  {
    id: "qs_taken",
    numerator: "qsTaken",
    denominator: "hands",
    description: "hands taking Q♠ | hands",
    percent: true,
  },
  {
    id: "moon_allowed",
    numerator: "moonsAllowed",
    denominator: "hands",
    description: "hands another seat shot the moon | hands",
    percent: true,
  },
  {
    id: "moon_allowed_when_p7",
    numerator: "p7MoonsAllowed",
    denominator: "p7Hands",
    description: "moons allowed | hands where P7 decided a play",
    percent: true,
  },
  {
    id: "moon_allowed_when_no_p7",
    numerator: "noP7MoonsAllowed",
    denominator: "noP7Hands",
    description: "moons allowed | hands where P7 decided no play",
    percent: true,
  },
  {
    id: "p7_hands",
    numerator: "p7Hands",
    denominator: "hands",
    description: "hands where P7 decided a play | hands",
    percent: true,
  },
  {
    id: "zero_hands",
    numerator: "zeroHands",
    denominator: "hands",
    description: "hands with 0 points | hands",
    percent: true,
  },
  {
    id: "moon_shot",
    numerator: "moonShots",
    denominator: "hands",
    description: "moons shot | hands",
    percent: true,
  },
];

// ---------------------------------------------------------------------------
// Matchups
// ---------------------------------------------------------------------------

export interface ReportMatchup {
  readonly id: string;
  readonly description: string;
  readonly matchup: Matchup;
  /** Run the principle checker on the conservative seats. */
  readonly checkPrinciples: boolean;
}

/** The legacy personas the report compares against (flagged legacy; #3165). */
export const LEGACY_PERSONAS = ["cautious", "schemer", "daring"] as const;

/** A conservative policy that also reports the principle behind each decision. */
interface Probe {
  /** Receives the sink for the block being played. */
  sink: BlockData | null;
  /** The last play's explanation (read by the hooks right after the policy runs). */
  last: { principle: string | null } | null;
  readonly policy: HeartsPolicy;
}

function makeProbe(): Probe {
  const probe: Probe = {
    sink: null,
    last: null,
    policy: {
      label: SUBJECT,
      persona: "conservative",
      pass: (hand, direction, _state, seat) => {
        const picks = explainCardsToPass(hand, direction, "conservative", seat);
        for (const p of picks) {
          const key = p.principle ?? "none";
          if (probe.sink) probe.sink.passFires[key] = (probe.sink.passFires[key] ?? 0) + 1;
        }
        return picks.map((p) => p.card);
      },
      play: (hand, trick, state, seat) => {
        const e = explainCardToPlay(hand, trick, state, seat, "conservative");
        probe.last = { principle: e.principle };
        return e.card;
      },
    },
  };
  return probe;
}

export function buildMatchups(probe: Probe = makeProbe()): ReportMatchup[] {
  const cons = probe.policy;
  const mirrorLineup: Lineup = {
    policies: [cons, cons, cons, cons],
    roles: [SUBJECT, SUBJECT, SUBJECT, SUBJECT],
  };
  const out: ReportMatchup[] = [
    {
      id: "random-legal",
      description: "1 conservative vs 3 random-legal (uniform legal card, random pass)",
      matchup: fieldMatchup("random-legal", randomLegalPolicy(), [cons]),
      checkPrinciples: false,
    },
    {
      id: "conservative-mirror",
      description: "4 conservative",
      matchup: { id: "conservative-mirror", lineups: [mirrorLineup] },
      checkPrinciples: false,
    },
    ...LEGACY_PERSONAS.map((p) => ({
      id: `legacy-${p}`,
      description: `1 conservative vs 3 legacy ${p}`,
      matchup: fieldMatchup(`legacy-${p}`, personaPolicy(p), [cons]),
      checkPrinciples: false,
    })),
    {
      id: "moon-shooter",
      description: "3 conservative vs 1 moon-shooter (always tries to take every point)",
      matchup: fieldMatchup("moon-shooter", cons, [moonShooterPolicy()]),
      checkPrinciples: true,
    },
  ];
  return out;
}

// ---------------------------------------------------------------------------
// Playing
// ---------------------------------------------------------------------------

interface BlockData {
  subject: Tally;
  opponent: Tally;
  playFires: Record<string, number>;
  passFires: Record<string, number>;
  /** Plays by conservative seats with more than one legal card. */
  judgedPlays: number;
  /**
   * Positions where the moon-complete branch is live (§2.4 follow 1 / discard
   * 1: a moon threat X, Q♠ in hand, X's points plus this trick's hearts make
   * 13, and X wins or can overtake), split into follow 1 (spades led, A/K winning: P7 names a card), discard 1
   * (void in the led suit: P7 only filters Q♠ out) and the rest (following in
   * another way, where neither step applies).
   */
  moonCompletePositions: number;
  moonCompleteFollow: number;
  moonCompleteDiscard: number;
  /** Of those, the plays P7 decided. */
  moonCompleteDecidedByP7: number;
  /** Decisions the checker graded (passes + plays) and its violations. */
  checked: number;
  violations: number;
  violationYaml: string[];
}

const emptyBlock = (): BlockData => ({
  subject: emptyTally(),
  opponent: emptyTally(),
  playFires: {},
  passFires: {},
  judgedPlays: 0,
  moonCompletePositions: 0,
  moonCompleteFollow: 0,
  moonCompleteDiscard: 0,
  moonCompleteDecidedByP7: 0,
  checked: 0,
  violations: 0,
  violationYaml: [],
});

const bump = (m: Record<string, number>, k: string) => {
  m[k] = (m[k] ?? 0) + 1;
};

/** Hooks for one game: per-hand tallies for each seat, and the optional principle check. */
function gameHooks(
  policies: Policies,
  data: BlockData,
  probe: Probe,
  check: boolean,
  firstViolations: { count: number }
): PlayOptions {
  let played: CompletedTrick[] = [];
  let p7: boolean[] = [false, false, false, false];
  const isSubject = (seat: number) => policies[seat]!.label === SUBJECT;

  const recordViolation = (v: Violation | null) => {
    data.checked++;
    if (!v) return;
    data.violations++;
    if (firstViolations.count < 5) {
      firstViolations.count++;
      data.violationYaml.push(toRulebookYaml(v, `SIM-GR-${firstViolations.count}`));
    }
  };

  return {
    onPass: (state, seat, cards) => {
      if (!check || !isSubject(seat)) return;
      recordViolation(
        checkDecision({
          kind: "pass",
          seat,
          direction: state.passDirection,
          hand: [...state.playerHands[seat]!],
          chosen: [...cards],
        })
      );
    },
    onPlay: (state, seat, card) => {
      const trick = [...state.currentTrick];
      if (state.tricksPlayedInHand === 0 && trick.length === 0) {
        played = [];
        p7 = [false, false, false, false];
      }
      if (isSubject(seat)) {
        const principle = probe.last?.principle ?? null;
        const legal = getValidPlays(state, seat).length;
        if (legal > 1) {
          data.judgedPlays++;
          const v = viewOf(state, seat);
          const x = trick.length > 0 ? moonComplete(v) : null; // only follow / discard use it
          if (x !== null && xWinsOrCanOvertake(v, x)) {
            data.moonCompletePositions++;
            if (!getValidPlays(state, seat).some((c) => c.suit === trick[0]?.card.suit)) {
              data.moonCompleteDiscard++;
            } else if (trick[0]?.card.suit === "spades" && isSpadeHonour(winning(v).card)) {
              data.moonCompleteFollow++;
            }
            if (principle === "P7-MOON-GUARD") data.moonCompleteDecidedByP7++;
          }
        }
        bump(data.playFires, principle ?? "none");
        if (principle === "P7-MOON-GUARD") p7[seat] = true;
        if (check) {
          const decision = {
            kind: "play" as const,
            seat,
            trickNumber: state.tricksPlayedInHand + 1,
            hand: [...state.playerHands[seat]!],
            played: [...played],
            trick,
            heartsBroken: state.heartsBroken,
            points: [...state.handScores],
            chosen: card,
          };
          recordViolation(checkDecision(decision));
        }
      }
      if (trick.length === 3) {
        played = [
          ...played,
          { lead: trick[0]!.playerIndex, cards: [...trick.map((t) => t.card), card] },
        ];
        if (state.tricksPlayedInHand === 12) finishHand(state, seat, card);
      }
    },
  };

  /** The hand's last card: apply it on a copy to read the hand's result. */
  function finishHand(state: Parameters<typeof playCard>[0], seat: number, card: Card): void {
    const end = playCard(state, seat, card);
    const shooter = detectMoon(end.wonCards);
    for (let i = 0; i < 4; i++) {
      const t = isSubject(i) ? data.subject : data.opponent;
      const pts = shooter === null ? (end.handScores[i] ?? 0) : shooter === i ? 0 : 26;
      const allowed = shooter !== null && shooter !== i;
      t.hands++;
      t.handPoints += pts;
      if (pts === 0) t.zeroHands++;
      if ((end.wonCards[i] ?? []).some(isQueenOfSpades)) t.qsTaken++;
      if (shooter === i) t.moonShots++;
      if (allowed) t.moonsAllowed++;
      if (p7[i]) {
        t.p7Hands++;
        if (allowed) t.p7MoonsAllowed++;
      } else {
        t.noP7Hands++;
        if (allowed) t.noP7MoonsAllowed++;
      }
    }
  }
}

function runReportBlock(
  def: ReportMatchup,
  probe: Probe,
  seed: number,
  block: number,
  firstViolations: { count: number }
): BlockData {
  const data = emptyBlock();
  probe.sink = data;
  for (const lineup of def.matchup.lineups) {
    probe.last = null;
    const game = playGame(
      lineup.policies,
      seed,
      block,
      gameHooks(lineup.policies, data, probe, def.checkPrinciples, firstViolations)
    );
    game.seats.forEach((c, seat) => {
      const t = lineup.policies[seat]!.label === SUBJECT ? data.subject : data.opponent;
      t.games++;
      t.winShare += c.winShare;
      t.gamePoints += c.points;
    });
  }
  probe.sink = null;
  return data;
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export interface MetricResult {
  readonly estimate: number;
  readonly ciLow: number;
  readonly ciHigh: number;
  readonly num: number;
  readonly den: number;
}

export interface FireRow {
  readonly principle: string;
  readonly count: number;
  /** Share of the matchup's judged plays (plays) or pass cards (passes). */
  readonly share: number;
}

export interface MatchupReport {
  readonly id: string;
  readonly description: string;
  readonly games: number;
  readonly blocks: number;
  /** Conservative seats' metrics, by metric id. */
  readonly subject: Readonly<Record<string, MetricResult>>;
  /** Everyone else's. */
  readonly opponent: Readonly<Record<string, MetricResult>>;
  readonly playFires: readonly FireRow[];
  /** Plays by conservative seats with a choice; the denominator of `playFires` shares. */
  readonly judgedPlays: number;
  /** Plays with a single legal card (no principle). */
  readonly forcedPlays: number;
  readonly passFires: readonly FireRow[];
  readonly moonComplete: {
    readonly positions: number;
    readonly follow: number;
    readonly discard: number;
    readonly decidedByP7: number;
  };
  /** Present only where the checker ran (moon-shooter). */
  readonly principleCheck?: {
    readonly decisions: number;
    readonly violations: number;
    readonly examples: readonly string[];
  };
  /** Points per hand: opponents minus conservative, paired by block (random-legal only). */
  readonly pointsPerHandAdvantage?: MetricResult;
}

export interface FireFlag {
  readonly kind: "never-fires" | "fires-often";
  readonly where: "play" | "pass";
  readonly principle: string;
  readonly detail: string;
}

export interface SanityFloor {
  readonly metric: "points_per_hand";
  /** Required margin: random-legal's minus conservative's points per hand. */
  readonly margin: number;
  /** Observed margin (paired by block), with its CI. */
  readonly observed: MetricResult | null;
  readonly marginPass: boolean;
  /** Principle violations by conservative seats in the moon-shooter matchup. */
  readonly moonShooterViolations: number | null;
  readonly violationsPass: boolean;
  readonly pass: boolean;
}

export interface GameReport {
  readonly seed: number;
  readonly gamesPerMatchup: number;
  readonly matchups: readonly MatchupReport[];
  readonly flags: readonly FireFlag[];
  readonly sanityFloor: SanityFloor;
}

const result = (e: RatioEstimate): MetricResult => ({
  estimate: e.mean,
  ciLow: e.ciLow,
  ciHigh: e.ciHigh,
  num: e.num,
  den: e.den,
});

function metricsOf(blocks: readonly BlockData[], group: "subject" | "opponent") {
  const out: Record<string, MetricResult> = {};
  for (const m of REPORT_METRICS) {
    out[m.id] = result(ratioEstimate(observe(blocks, group, m)));
  }
  return out;
}

function observe(
  blocks: readonly BlockData[],
  group: "subject" | "opponent",
  m: Pick<MetricSpec, "numerator" | "denominator">
): Observation[] {
  return blocks.map((b) => ({ y: b[group][m.numerator], n: b[group][m.denominator] }));
}

function sumFires(blocks: readonly BlockData[], key: "playFires" | "passFires") {
  const total: Record<string, number> = {};
  for (const b of blocks)
    for (const [k, n] of Object.entries(b[key])) total[k] = (total[k] ?? 0) + n;
  return total;
}

function fireRows(
  counts: Record<string, number>,
  order: readonly string[],
  base: number
): FireRow[] {
  const keys = [...order, ...Object.keys(counts).filter((k) => !order.includes(k))];
  return keys.map((principle) => ({
    principle,
    count: counts[principle] ?? 0,
    share: base > 0 ? (counts[principle] ?? 0) / base : 0,
  }));
}

/** Plays the whole report: `games` games per matchup (rounded up to whole blocks). */
export function runGameReport(options: { games?: number; seed?: number } = {}): GameReport {
  const games = options.games ?? DEFAULT_GAME_REPORT_GAMES;
  const seed = options.seed ?? GAME_REPORT_SEED;
  if (!(Number.isInteger(games) && games >= 1)) {
    throw new RangeError(`games must be a positive integer (got ${games})`);
  }
  const probe = makeProbe();
  const matchups: MatchupReport[] = [];
  for (const def of buildMatchups(probe)) {
    const nBlocks = Math.ceil(games / def.matchup.lineups.length);
    const firstViolations = { count: 0 };
    const blocks: BlockData[] = [];
    for (let b = 0; b < nBlocks; b++)
      blocks.push(runReportBlock(def, probe, seed, b, firstViolations));

    const playCounts = sumFires(blocks, "playFires");
    const passCounts = sumFires(blocks, "passFires");
    const judged = blocks.reduce((s, b) => s + b.judgedPlays, 0);
    const passCards = Object.values(passCounts).reduce((s, n) => s + n, 0);
    const sum = (
      k:
        | "moonCompletePositions"
        | "moonCompleteFollow"
        | "moonCompleteDiscard"
        | "moonCompleteDecidedByP7"
        | "checked"
        | "violations"
    ) => blocks.reduce((s, b) => s + b[k], 0);

    const subject = metricsOf(blocks, "subject");
    const opponent = metricsOf(blocks, "opponent");
    const ppH = {
      numerator: "handPoints",
      denominator: "hands",
    } as const;
    const advantage =
      blocks[0]!.opponent.hands > 0 && blocks[0]!.subject.hands > 0
        ? meanEstimate(
            differenceSeries(observe(blocks, "opponent", ppH), observe(blocks, "subject", ppH))
          )
        : null;

    matchups.push({
      id: def.id,
      description: def.description,
      games: nBlocks * def.matchup.lineups.length,
      blocks: nBlocks,
      subject,
      opponent,
      playFires: fireRows(
        Object.fromEntries(Object.entries(playCounts).filter(([k]) => k !== "none")),
        PLAY_PRINCIPLES,
        judged
      ),
      judgedPlays: judged,
      forcedPlays: playCounts["none"] ?? 0,
      passFires: fireRows(passCounts, PASS_PRINCIPLES, passCards),
      moonComplete: {
        positions: sum("moonCompletePositions"),
        follow: sum("moonCompleteFollow"),
        discard: sum("moonCompleteDiscard"),
        decidedByP7: sum("moonCompleteDecidedByP7"),
      },
      ...(def.checkPrinciples
        ? {
            principleCheck: {
              decisions: sum("checked"),
              violations: sum("violations"),
              examples: blocks.flatMap((b) => b.violationYaml).slice(0, 5),
            },
          }
        : {}),
      ...(def.id === "random-legal" && advantage
        ? { pointsPerHandAdvantage: advantageResult(advantage, blocks) }
        : {}),
    });
  }
  const report = { seed, gamesPerMatchup: games, matchups, flags: fireFlags(matchups) };
  return { ...report, sanityFloor: evaluateSanityFloor(report) };
}

function advantageResult(e: Estimate, blocks: readonly BlockData[]): MetricResult {
  return {
    estimate: e.mean,
    ciLow: e.ciLow,
    ciHigh: e.ciHigh,
    num: blocks.reduce((s, b) => s + b.opponent.handPoints, 0),
    den: blocks.reduce((s, b) => s + b.opponent.hands, 0),
  };
}

/** Principles that never fire, or decide more than `FIRE_FLAG_SHARE` of the plays, pooled over all matchups. */
export function fireFlags(
  matchups: readonly Pick<MatchupReport, "playFires" | "passFires" | "judgedPlays">[]
): FireFlag[] {
  const flags: FireFlag[] = [];
  const pool = (key: "playFires" | "passFires") => {
    const t: Record<string, number> = {};
    for (const m of matchups)
      for (const r of m[key]) t[r.principle] = (t[r.principle] ?? 0) + r.count;
    return t;
  };
  const plays = pool("playFires");
  const passes = pool("passFires");
  const judged = matchups.reduce((s, m) => s + m.judgedPlays, 0);
  const passTotal = Object.values(passes).reduce((s, n) => s + n, 0);
  for (const p of PLAY_PRINCIPLES) {
    const n = plays[p] ?? 0;
    if (n === 0)
      flags.push({ kind: "never-fires", where: "play", principle: p, detail: "decided 0 plays" });
    else if (judged > 0 && n / judged > FIRE_FLAG_SHARE) {
      flags.push({
        kind: "fires-often",
        where: "play",
        principle: p,
        detail: `${((100 * n) / judged).toFixed(1)}% of judged plays (> ${FIRE_FLAG_SHARE * 100}%)`,
      });
    }
  }
  for (const p of PASS_PRINCIPLES) {
    const n = passes[p] ?? 0;
    if (n === 0)
      flags.push({
        kind: "never-fires",
        where: "pass",
        principle: p,
        detail: "named 0 pass cards",
      });
    else if (passTotal > 0 && n / passTotal > FIRE_FLAG_SHARE) {
      flags.push({
        kind: "fires-often",
        where: "pass",
        principle: p,
        detail: `${((100 * n) / passTotal).toFixed(1)}% of pass cards (> ${FIRE_FLAG_SHARE * 100}%)`,
      });
    }
  }
  return flags;
}

/**
 * The report's only pass/fail: conservative beats random-legal on points per
 * hand by at least `margin` (observed, paired by block), and the conservative
 * seats of the moon-shooter matchup committed no principle violation. A
 * missing matchup fails.
 */
export function evaluateSanityFloor(
  report: Pick<GameReport, "matchups">,
  margin: number = SANITY_FLOOR_MARGIN
): SanityFloor {
  const random = report.matchups.find((m) => m.id === "random-legal");
  const shooter = report.matchups.find((m) => m.id === "moon-shooter");
  const observed = random?.pointsPerHandAdvantage ?? null;
  const violations = shooter?.principleCheck?.violations ?? null;
  const marginPass = observed !== null && observed.estimate >= margin;
  const violationsPass = violations === 0;
  return {
    metric: "points_per_hand",
    margin,
    observed,
    marginPass,
    moonShooterViolations: violations,
    violationsPass,
    pass: marginPass && violationsPass,
  };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const fmt = (r: MetricResult, percent: boolean): string => {
  if (r.den === 0 || Number.isNaN(r.estimate)) return "n/a";
  const f = (x: number) =>
    percent ? `${(Math.min(1, Math.max(0, x)) * 100).toFixed(2)}%` : x.toFixed(2);
  return `${f(r.estimate)} [${f(r.ciLow)}, ${f(r.ciHigh)}]`;
};

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

/** The report as Markdown (the `--md` output and the CI artifact). */
export function formatGameReportMarkdown(r: GameReport): string {
  const out: string[] = [];
  out.push(
    "# Hearts whole-game report (conservative CPU)",
    "",
    `Seed ${r.seed}, ${r.gamesPerMatchup} games per matchup (rounded up to whole blocks), duplicate deals. Values are mean [95% CI over blocks]. Definitions: \`frontend/tooling/hearts/gameReport.ts\`, docs/TESTING.md.`,
    ""
  );
  const s = r.sanityFloor;
  out.push("## Sanity floor", "");
  out.push(
    `- ${s.marginPass ? "PASS" : "FAIL"}: random-legal minus conservative points per hand >= ${s.margin.toFixed(2)}; observed ${s.observed ? fmt(s.observed, false) : "n/a"}`,
    `- ${s.violationsPass ? "PASS" : "FAIL"}: principle violations by conservative seats vs moon-shooter = 0; observed ${s.moonShooterViolations ?? "n/a"}`,
    ""
  );
  out.push("## Conservative seats by matchup", "");
  out.push("| Matchup | Games | " + REPORT_METRICS.map((m) => m.id).join(" | ") + " |");
  out.push("|---|---|" + REPORT_METRICS.map(() => "---").join("|") + "|");
  for (const m of r.matchups) {
    out.push(
      `| ${m.id} | ${m.games} | ` +
        REPORT_METRICS.map((x) => fmt(m.subject[x.id]!, x.percent)).join(" | ") +
        " |"
    );
  }
  out.push("", "Metric definitions:", "");
  for (const m of REPORT_METRICS) out.push(`- \`${m.id}\`: ${m.description}`);
  out.push("", "## Opponents by matchup", "");
  out.push("| Matchup | Opponent | points_per_hand | points_per_game | win_rate | moon_shot |");
  out.push("|---|---|---|---|---|---|");
  for (const m of r.matchups) {
    const who =
      m.id === "conservative-mirror" ? "(none: all conservative)" : m.id.replace(/^legacy-/, "");
    if (m.id === "conservative-mirror") continue;
    out.push(
      `| ${m.id} | ${who} | ${fmt(m.opponent["points_per_hand"]!, false)} | ${fmt(m.opponent["points_per_game"]!, false)} | ${fmt(m.opponent["win_rate"]!, true)} | ${fmt(m.opponent["moon_shot"]!, true)} |`
    );
  }
  out.push("", "## Principle fire distribution (conservative plays with a choice)", "");
  out.push("| Principle | " + r.matchups.map((m) => m.id).join(" | ") + " |");
  out.push("|---|" + r.matchups.map(() => "---").join("|") + "|");
  for (const p of PLAY_PRINCIPLES) {
    out.push(
      `| ${p} | ` +
        r.matchups
          .map((m) => pct(m.playFires.find((f) => f.principle === p)?.share ?? 0))
          .join(" | ") +
        " |"
    );
  }
  out.push(
    `| (judged plays; forced plays excluded) | ` +
      r.matchups.map((m) => `${m.judgedPlays} (+${m.forcedPlays} forced)`).join(" | ") +
      " |"
  );
  out.push("", "Pass cards by principle:", "");
  out.push("| Principle | " + r.matchups.map((m) => m.id).join(" | ") + " |");
  out.push("|---|" + r.matchups.map(() => "---").join("|") + "|");
  for (const p of PASS_PRINCIPLES) {
    out.push(
      `| ${p} | ` +
        r.matchups
          .map((m) => pct(m.passFires.find((f) => f.principle === p)?.share ?? 0))
          .join(" | ") +
        " |"
    );
  }
  out.push("", "Flags (pooled over all matchups):", "");
  if (r.flags.length === 0) out.push("- none");
  for (const f of r.flags) out.push(`- ${f.where} ${f.principle}: ${f.kind} (${f.detail})`);
  out.push("", "## Moon guard (P7)", "");
  out.push(
    "Moon-complete branch (a threat X, Q♠ in hand, X's points plus the trick's hearts make 13, X wins or can overtake): following = follow step 1 (spades led under an A♠/K♠, P7 names a card); discarding = discard step 1 (P7 only filters Q♠ out); the remainder follow another way.",
    "",
    "| Matchup | positions | following | discarding | decided by P7 |",
    "|---|---|---|---|---|"
  );
  for (const m of r.matchups) {
    out.push(
      `| ${m.id} | ${m.moonComplete.positions} | ${m.moonComplete.follow} | ${m.moonComplete.discard} | ${m.moonComplete.decidedByP7} |`
    );
  }
  const shooter = r.matchups.find((m) => m.principleCheck);
  if (shooter?.principleCheck) {
    out.push(
      "",
      `Principle check of the conservative seats vs moon-shooter: ${shooter.principleCheck.decisions} decisions, ${shooter.principleCheck.violations} violations.`
    );
    for (const y of shooter.principleCheck.examples) out.push("", "```yaml", y, "```");
  }
  return out.join("\n") + "\n";
}
