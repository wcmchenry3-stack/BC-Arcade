/** CPU principles in the hand debug log and its export (#3163). */
import {
  cpuDecisions,
  formatPlayAsRulebookYaml,
  formatSessionAsMarkdown,
  rulebookCard,
  type HandDebugLog,
  type LiveDecisions,
} from "../debugLog";
import type { Card, Rank, Suit } from "../types";
import { PLAYER_LABELS, handLog } from "./helpers/debugLogFixtures";

const c = (suit: Suit, rank: Rank): Card => ({ suit, rank });

/** Trick 2: seat 1 follows a club lead with K♣ (P2-FREE-TRICK); seat 1 also passed with principles. */
function principled(): HandDebugLog {
  const base = handLog();
  const passed = [c("spades", 12), c("hearts", 1), c("clubs", 2)];
  return {
    ...base,
    initialHands: [[], passed, [], []],
    passSelections: [[], passed, [], []],
    passDecisions: [
      [],
      [
        { card: passed[0]!, principle: "P5-QUEEN", reason: "spades are unprotected." },
        { card: passed[1]!, principle: "P6-DISCARD", reason: "a high heart." },
        { card: passed[2]!, principle: "P4-DANGER", reason: "next in danger order." },
      ],
      [],
      [],
    ],
    tricks: [
      base.tricks[0]!,
      {
        winnerIndex: 1,
        pointsWon: 0,
        plays: [
          { playerIndex: 0, card: c("clubs", 5) },
          {
            playerIndex: 1,
            card: c("clubs", 13),
            principle: "P2-FREE-TRICK",
            reason: "K♣: no points can fall.",
            position: {
              trickNumber: 2,
              hand: [c("clubs", 13), c("diamonds", 4)],
              trickSoFar: [{ playerIndex: 0, card: c("clubs", 5) }],
              heartsBroken: true,
              points: [0, 0, 4, 0],
            },
          },
        ],
      },
    ],
  };
}

const format = (log: HandDebugLog) =>
  formatSessionAsMarkdown([log], [], PLAYER_LABELS, "conservative");

describe("CPU principles in the export", () => {
  it("tags each CPU play with its principle in the trick line", () => {
    expect(format(principled())).toContain("T2 You:5♣  Ann:**K♣** (P2-FREE-TRICK)  → Ann");
  });

  it("writes each CPU play as a rulebook yaml block that rebuilds the position", () => {
    const text = format(principled());
    expect(text).toContain(
      "```yaml\nid: DBG-h1-t2-s1\ndecision: follow\nseat: 1\ntrick_number: 2\n"
    );
    expect(text).toContain("hand: [KC, 4D]");
    expect(text).toContain("played:\n  - { lead: 0, cards: [10H, JH, KH, 2H] }");
    expect(text).toContain("trick: [{ seat: 0, card: 5C }]");
    expect(text).toContain("hearts_broken: true\nqueen_played: false\npoints: [0, 0, 4, 0]");
    expect(text).toContain(
      'expected: [KC]\nprinciple: P2-FREE-TRICK\nreason: "K♣: no points can fall."'
    );
  });

  it("marks the queen as played when an earlier trick had it", () => {
    const log = principled();
    const first = log.tricks[0]!;
    const withQueen: HandDebugLog = {
      ...log,
      tricks: [
        { ...first, plays: [...first.plays.slice(1), { playerIndex: 0, card: c("spades", 12) }] },
        log.tricks[1]!,
      ],
    };
    expect(format(withQueen)).toContain("queen_played: true");
  });

  it("writes a CPU pass as a pass block with P8-PASS and the per-card principles", () => {
    const text = format(principled());
    expect(text).toContain("id: DBG-h1-pass-s1\ndecision: pass\nseat: 1\ntrick_number: 0\n");
    expect(text).toContain("pass_direction: left\nexpected: [QS, AH, 2C]\nprinciple: P8-PASS");
    expect(text).toContain("QS P5-QUEEN: spades are unprotected.");
    expect(text).toContain("AH P6-DISCARD: a high heart.");
  });

  it("adds nothing for a log without principles (legacy personas, older logs)", () => {
    const text = formatSessionAsMarkdown([handLog()], [], PLAYER_LABELS, "mixed");
    expect(text).not.toContain("```yaml");
    expect(text).not.toContain("CPU decisions");
    expect(text).not.toMatch(/\(P\d-/);
    expect(cpuDecisions(handLog())).toEqual([]);
  });

  it("keeps the principle but skips the yaml for a play recorded without a position", () => {
    const log = principled();
    const stripped: HandDebugLog = {
      ...log,
      passDecisions: undefined,
      tricks: log.tricks.map((t) => ({
        ...t,
        plays: t.plays.map(({ position: _position, ...rest }) => rest),
      })),
    };
    const text = format(stripped);
    expect(text).toContain("(P2-FREE-TRICK)");
    expect(text).not.toContain("```yaml");
  });

  it("classifies lead and discard positions", () => {
    const log = principled();
    const play = log.tricks[1]!.plays[1]!;
    const yaml = (
      trickSoFar: Parameters<typeof cpuDecisions>[0]["tricks"][0]["plays"],
      hand: Card[]
    ) =>
      formatPlayAsRulebookYaml(log, {
        trickIndex: 1,
        play: { ...play, position: { ...play.position!, trickSoFar, hand } },
      });
    expect(yaml([], [c("clubs", 5)])).toContain("decision: lead");
    expect(yaml([{ playerIndex: 0, card: c("hearts", 3) }], [c("clubs", 5)])).toContain(
      "decision: discard"
    );
  });
});

describe("a game resumed mid-hand (incomplete history)", () => {
  it("keeps the principle but emits a note instead of an inconsistent yaml block", () => {
    const log = principled();
    // The buffer was empty at the resume: trick 2's play is the first one logged.
    const resumed: HandDebugLog = { ...log, passDecisions: undefined, tricks: [log.tricks[1]!] };
    const text = format(resumed);
    expect(text).toContain("(P2-FREE-TRICK)");
    expect(text).not.toContain("id: DBG-h1-t2-s1");
    expect(text).toContain("position incomplete (resumed mid-hand)");
    expect(text).toContain("- T1 Ann K♣ P2-FREE-TRICK: position incomplete");
  });

  it("still emits the block when every earlier trick is logged", () => {
    expect(format(principled())).toContain("id: DBG-h1-t2-s1");
    expect(format(principled())).not.toContain("position incomplete");
  });
});

describe("the hand in progress in the export", () => {
  const live = (): LiveDecisions => ({
    handNumber: 2,
    tricks: [],
    pending: [principled().tricks[1]!.plays[1]!],
  });

  it("is added after the finished hands, labelled in progress, with its decisions", () => {
    const text = formatSessionAsMarkdown([], [], PLAYER_LABELS, "conservative", live());
    expect(text).toContain("## Hand 2 — in progress");
    expect(text).toContain("- T1 Ann K♣ P2-FREE-TRICK — K♣: no points can fall.");
    // trickNumber 2 recorded but no trick logged before it: incomplete.
    expect(text).toContain("position incomplete (resumed mid-hand)");
  });

  it("is omitted when it has no CPU decisions", () => {
    const text = formatSessionAsMarkdown([], [], PLAYER_LABELS, "conservative", {
      handNumber: 2,
      tricks: [],
      pending: [],
    });
    expect(text).not.toContain("in progress");
  });
});

describe("rulebookCard / cpuDecisions", () => {
  it("writes cards in rulebook notation", () => {
    expect(rulebookCard(c("hearts", 10))).toBe("10H");
    expect(rulebookCard(c("spades", 12))).toBe("QS");
    expect(rulebookCard(c("diamonds", 1))).toBe("AD");
  });

  it("lists only the plays that carry a principle", () => {
    expect(cpuDecisions(principled()).map((d) => [d.trickIndex, d.play.principle])).toEqual([
      [1, "P2-FREE-TRICK"],
    ]);
  });
});
