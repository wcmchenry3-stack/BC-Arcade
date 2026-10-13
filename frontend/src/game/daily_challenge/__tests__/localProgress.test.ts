import type { ChallengeGoal } from "../api";
import { factsOf, goalMetBy, withLocalProgress } from "../localProgress";
import type { PendingGame } from "../../_shared/pendingGamesStore";

// #3228: the device's preview of /status, mirroring backend definitions.py.

function goal(kind: string, target: number | null, gameSlug = "solitaire"): ChallengeGoal {
  return { id: `${gameSlug}:${kind}:${target}`, gameSlug, kind, target, completed: false };
}

function pending(overrides: Partial<PendingGame> = {}): PendingGame {
  return {
    gameType: "solitaire",
    metadata: {},
    startedAt: 0,
    started: true,
    startedSynced: false,
    nextEventIndex: 3,
    completed: true,
    completedAt: 1_000,
    completeSummary: {},
    completeSynced: false,
    ...overrides,
  };
}

describe("goalMetBy — the per-kind checks", () => {
  it.each([
    ["completed", null, { is_complete: true }, true],
    ["completed", null, { is_complete: false }, false],
    ["won", null, { won: true }, true],
    ["won", null, { won: false }, false],
    ["solved", null, { won: true }, true],
    ["chips_gained", null, { starting_chips: 100, final_chips: 150 }, true],
    ["chips_gained", null, { starting_chips: 100, final_chips: 100 }, false],
    ["moves_at_least", 10, { moves: 10 }, true],
    ["moves_at_least", 10, { moves: 9 }, false],
    ["moves_at_least", 10, { moves: "12" }, false],
    ["won_moves_at_most", 120, { won: true, moves: 120 }, true],
    ["won_moves_at_most", 120, { won: true, moves: 121 }, false],
    ["won_moves_at_most", 120, { won: false, moves: 80 }, false],
    ["some_future_kind", 3, { won: true }, false],
  ])("%s %p with %j → %p", (kind, target, facts, expected) => {
    expect(goalMetBy(goal(kind, target), facts)).toBe(expected);
  });

  it("compares a time limit in milliseconds, though the goal holds minutes", () => {
    const limit = goal("won_duration_ms_at_most", 8, "mahjong"); // 480 000 ms on the wire
    expect(goalMetBy(limit, { won: true, duration_ms: 480_000 })).toBe(true);
    expect(goalMetBy(limit, { won: true, duration_ms: 480_001 })).toBe(false);
  });
});

describe("factsOf — what the server would store for the game", () => {
  it("merges the result block, non-null creation metadata, score and duration", () => {
    const facts = factsOf(
      pending({
        metadata: { difficulty: "hard", moves: null },
        completeSummary: {
          finalScore: 120,
          durationMs: 61_000.4,
          result: { won: true, moves: 88, difficulty: "easy" },
        },
      })
    );
    expect(facts).toEqual({
      won: true,
      moves: 88,
      difficulty: "hard",
      final_score: 120,
      duration_ms: 61_000,
    });
  });

  it("is null for an abandoned or unfinished game", () => {
    expect(factsOf(pending({ completeSummary: { outcome: "abandoned", finalScore: 9 } }))).toBe(
      null
    );
    expect(factsOf(pending({ completed: false, completedAt: null }))).toBeNull();
  });
});

describe("withLocalProgress", () => {
  it("marks a goal met by a game of its own type, and keeps goals already done", () => {
    const challenge = {
      challengeId: "2026-09-27",
      goals: [
        goal("moves_at_least", 10),
        { ...goal("completed", null, "daily_word"), completed: true },
        goal("final_score_at_least", 500, "twenty48"),
      ],
    };
    const out = withLocalProgress(challenge, [
      { gameType: "solitaire", facts: { moves: 12 } },
      { gameType: "yacht", facts: { final_score: 900 } }, // not this goal's game
    ]);
    expect(out.goals.map((g) => g.completed)).toEqual([true, true, false]);
  });
});
