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

  it("marks the bonus goal the same way, without touching the core goals (#3995)", () => {
    const challenge = {
      challengeId: "2026-09-27",
      goals: [goal("moves_at_least", 10)],
      bonus: goal("final_score_at_least", 150, "yacht"),
    };
    const met = withLocalProgress(challenge, [{ gameType: "yacht", facts: { final_score: 160 } }]);
    expect(met.bonus?.completed).toBe(true);
    expect(met.goals.map((g) => g.completed)).toEqual([false]);

    const short = withLocalProgress(challenge, [{ gameType: "yacht", facts: { final_score: 90 } }]);
    expect(short.bonus?.completed).toBe(false);
    // A bonus already done stays done; a day without a bonus gains none.
    const done = withLocalProgress(
      { ...challenge, bonus: { ...challenge.bonus, completed: true } },
      []
    );
    expect(done.bonus?.completed).toBe(true);
    expect(withLocalProgress({ ...challenge, bonus: undefined }, []).bonus).toBeUndefined();
  });
});

// #4032: the premium games send an outcome, not won / is_complete; the server writes
// the flags (backend/games/result_flags.py) and the preview mirrors it.
describe("factsOf — server-written outcome flags (#4032)", () => {
  function facts(gameType: string, outcome: string | undefined, result: Record<string, unknown>) {
    return factsOf(
      pending({ gameType, completeSummary: { ...(outcome ? { outcome } : {}), result } })
    );
  }
  const met = (
    slug: string,
    kind: string,
    f: Record<string, unknown> | null,
    target: number | null = null
  ) => f !== null && goalMetBy(goal(kind, target, slug), f);

  it.each(["blackjack", "hearts"])("%s: a win meets finish and win", (g) => {
    const f = facts(g, "win", {});
    expect(met(g, "completed", f)).toBe(true);
    expect(met(g, "won", f)).toBe(true);
  });

  it.each(["blackjack", "hearts"])("%s: a loss finishes but is not a win", (g) => {
    const f = facts(g, "loss", {});
    expect(met(g, "completed", f)).toBe(true);
    expect(met(g, "won", f)).toBe(false);
  });

  it("ignores the app's own won flag", () => {
    const f = facts("hearts", "loss", { won: true, is_complete: false });
    expect(f).toMatchObject({ won: false, is_complete: true });
  });

  it("writes neither flag without an outcome (non-cascade)", () => {
    const f = facts("hearts", undefined, { won: true, is_complete: true });
    expect(f).not.toHaveProperty("won");
    expect(f).not.toHaveProperty("is_complete");
  });

  it("blackjack: a legacy 'completed' with chips left is a win", () => {
    expect(facts("blackjack", "completed", { final_chips: 50 })).toMatchObject({
      won: true,
      is_complete: true,
    });
    expect(facts("blackjack", "completed", { final_chips: 0 })).toMatchObject({ won: false });
    expect(facts("blackjack", "loss", { final_chips: 50 })).toMatchObject({ won: false });
  });

  it("starswarm: completed meets finish and never carries won", () => {
    const f = facts("starswarm", "completed", { won: true });
    expect(met("starswarm", "completed", f)).toBe(true);
    expect(f).not.toHaveProperty("won");
  });

  it("cascade: win meets finish, win and the win-time limit", () => {
    const f = facts("cascade", "win", {});
    const limited = factsOf(
      pending({
        gameType: "cascade",
        completeSummary: { outcome: "win", durationMs: 100_000, result: {} },
      })
    );
    expect(met("cascade", "completed", f)).toBe(true);
    expect(met("cascade", "won", f)).toBe(true);
    expect(met("cascade", "won_duration_ms_at_most", limited, 2)).toBe(true);
  });

  it("cascade: a loss finishes only; no outcome is not won and not complete", () => {
    const loss = facts("cascade", "loss", {});
    expect(met("cascade", "completed", loss)).toBe(true);
    expect(met("cascade", "won", loss)).toBe(false);
    const none = facts("cascade", undefined, { won: true });
    expect(none).toMatchObject({ won: false });
    expect(none).not.toHaveProperty("is_complete");
  });

  it("leaves a free game's own flags unchanged", () => {
    const f = facts("solitaire", "win", { won: false, is_complete: false });
    expect(f).toMatchObject({ won: false, is_complete: false });
    expect(facts("daily_word", undefined, { won: true })).toMatchObject({ won: true });
  });
});
