import { CATEGORIES, getRng, possibleScores, setRng, type Category } from "../../engine";
import type { GameState } from "../../types";
import {
  difficultyPolicy,
  playBlock,
  playGame,
  runMatchup,
  type MatchupConfig,
  type SimPolicy,
} from "../harness";
import { deriveSeed, turnDiceTable } from "../streams";

// Instant fixture policies — the real AI takes ~0.3-1s per game, too slow to
// exercise the harness mechanics in the PR suite.
const firstLegal = (state: GameState): Category =>
  Object.keys(possibleScores(state))[0] as Category;

const neverHold: SimPolicy = {
  label: "never-hold",
  hold: () => [false, false, false, false, false],
  category: firstLegal,
};

const keepFirstRoll: SimPolicy = {
  label: "keep-first-roll",
  hold: () => [true, true, true, true, true],
  category: firstLegal,
};

function config(overrides: Partial<MatchupConfig> = {}): MatchupConfig {
  return {
    a: neverHold,
    b: neverHold,
    blocks: 3,
    mode: "paired",
    seed: 99,
    recordDice: true,
    ...overrides,
  };
}

afterEach(() => setRng(Math.random));

describe("playBlock — paired mode", () => {
  it("plays A-first twice then B-first twice, alternating dice streams", () => {
    const { games } = playBlock(config(), 0);
    expect(games.map((g) => g.aFirst)).toEqual([true, true, false, false]);
    expect(games.map((g) => g.aStream)).toEqual(["X", "Y", "X", "Y"]);
  });

  it("mirrors dice: each mirrored pair swaps the two players' dice sequences", () => {
    const [g0, g1, g2, g3] = playBlock(config(), 0).games;
    expect(g0.a.diceLog).toEqual(g1.b.diceLog);
    expect(g0.b.diceLog).toEqual(g1.a.diceLog);
    expect(g2.a.diceLog).toEqual(g3.b.diceLog);
    expect(g0.a.diceLog).not.toEqual(g0.b.diceLog);
  });

  it("order swap keeps each player's dice identical", () => {
    const [g0, g1, g2, g3] = playBlock(config(), 0).games;
    expect(g2.a.diceLog).toEqual(g0.a.diceLog);
    expect(g2.b.diceLog).toEqual(g0.b.diceLog);
    expect(g3.a.diceLog).toEqual(g1.a.diceLog);
  });

  it("gives different policies the same random numbers at the same decision points", () => {
    // A rerolls everything; B keeps its opening roll. On the same stream,
    // every round's opening roll must match, whatever the other player did.
    const [g0, g1] = playBlock(config({ b: keepFirstRoll }), 0).games;
    const openingRolls = (log: readonly (readonly number[])[], rollsPerTurn: number) =>
      log.filter((_, i) => i % rollsPerTurn === 0);
    // A (stream X in g0) vs B (stream X in g1).
    expect(openingRolls(g0.a.diceLog!, 3)).toEqual(openingRolls(g1.b.diceLog!, 1));
  });

  it("takes each roll from the stream's per-round dice table", () => {
    const g0 = playBlock(config(), 0).games[0];
    const streamX = deriveSeed(99, 0, 0); // block 0, stream X of seed 99
    const log = g0.a.diceLog!;
    expect(log).toHaveLength(13 * 3);
    // never-hold rerolls all five dice, so roll k of round r is table row k.
    for (let round = 1; round <= 13; round++) {
      expect(log.slice((round - 1) * 3, round * 3)).toEqual(turnDiceTable(streamX, round));
    }
  });
});

describe("playBlock — independent mode", () => {
  it("gives every player-game its own dice, keeping the order layout", () => {
    const { games } = playBlock(config({ mode: "independent" }), 0);
    expect(games.map((g) => g.aFirst)).toEqual([true, true, false, false]);
    const logs = games.flatMap((g) => [g.a.diceLog, g.b.diceLog]).map((l) => JSON.stringify(l));
    expect(new Set(logs).size).toBe(8);
  });
});

describe("runMatchup", () => {
  it("is deterministic for a given config and varies with the seed", () => {
    const strip = (c: MatchupConfig) =>
      runMatchup(c).blocks.map((b) => b.games.map((g) => [g.a.score, g.b.score]));
    expect(strip(config())).toEqual(strip(config()));
    expect(strip(config())).not.toEqual(strip(config({ seed: 100 })));
  });

  it("records labels, mode, seed and block count", () => {
    const run = runMatchup(config({ blocks: 2, b: keepFirstRoll }));
    expect(run).toMatchObject({ a: "never-hold", b: "keep-first-roll", mode: "paired", seed: 99 });
    expect(run.blocks).toHaveLength(2);
  });

  it("fills every category on every scorecard", () => {
    const run = runMatchup(config({ blocks: 1 }));
    for (const g of run.blocks[0]!.games) {
      expect(Object.keys(g.a.categories).sort()).toEqual([...CATEGORIES].sort());
      expect(g.a.score).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("playGame", () => {
  it("restores the engine RNG afterwards, even when a policy throws", () => {
    const sentinel = () => 0.5;
    setRng(sentinel);
    playGame({ policy: neverHold, streamSeed: 1 }, { policy: neverHold, streamSeed: 2 });
    expect(getRng()).toBe(sentinel);

    const broken: SimPolicy = {
      ...neverHold,
      hold: () => {
        throw new Error("boom");
      },
    };
    expect(() =>
      playGame({ policy: broken, streamSeed: 1 }, { policy: neverHold, streamSeed: 2 })
    ).toThrow("boom");
    expect(getRng()).toBe(sentinel);
  });

  it("passes the opponent's live score and round to category()", () => {
    const seen: { round: number; oppRound: number }[] = [];
    const spy: SimPolicy = {
      ...neverHold,
      category: (state, _score, opponentRound) => {
        seen.push({ round: state.round, oppRound: opponentRound });
        return firstLegal(state);
      },
    };
    playGame({ policy: neverHold, streamSeed: 1 }, { policy: spy, streamSeed: 2 });
    // The second mover always sees the first mover already one round ahead.
    expect(
      seen.every((s) => s.oppRound === s.round + 1 || (s.round === 13 && s.oppRound === 13))
    ).toBe(true);
  });

  it("plays a real AI game to completion", () => {
    const hard = difficultyPolicy("hard");
    const { first, second } = playGame(
      { policy: hard, streamSeed: 3 },
      { policy: difficultyPolicy("easy"), streamSeed: 4 }
    );
    expect(first.label).toBe("hard");
    expect(second.label).toBe("easy");
    expect(first.score).toBeGreaterThan(0);
    expect(second.score).toBeGreaterThan(0);
  });
});
