/**
 * The principle check's seeded simulator run (#3161): the conservative CPU
 * commits no violation, and the checker catches the legacy personas' known
 * trick-1 mistake (following with a low club), which the old persona-
 * separation gate never saw.
 */
import { setRng } from "../../../src/game/hearts/engine";
import type { Card } from "../../../src/game/hearts/types";
import type { PlayDecision } from "../principles";
import { readFileSync } from "fs";
import { join } from "path";
import { CHECKS } from "../principles";
import {
  DEFAULT_PRINCIPLE_HANDS,
  formatPrincipleReport,
  parseHandsArg,
  runPrincipleCheck,
} from "../principleRun";

afterEach(() => setRng(Math.random));

const rv = (c: Card) => (c.rank === 1 ? 14 : c.rank);

describe("runPrincipleCheck", () => {
  it("conservative x4: zero violations on a seeded run", () => {
    const r = runPrincipleCheck({ persona: "conservative", hands: 300 });
    expect(r.hands).toBe(300);
    // 52 card plays per hand, plus the passes.
    expect(r.decisions).toBeGreaterThan(300 * 52);
    expect(r.judged).toBeGreaterThan(r.decisions / 2);
    expect(r.violations).toBe(0);
    expect(formatPrincipleReport(r)).toContain("Violations: 0");
  });

  it("self-test: catches the legacy CPU's trick-1 low-club follow (P2)", () => {
    const r = runPrincipleCheck({ persona: "cautious", hands: 30, examples: 50 });
    expect(r.byCheck["follow.free-trick"]).toBeGreaterThan(0);
    const lowClub = (r.examples["P2-FREE-TRICK"] ?? []).find((v) => {
      const d = v.position as PlayDecision;
      const clubs = d.hand.filter((c) => c.suit === "clubs");
      return (
        d.trickNumber === 1 &&
        d.chosen.suit === "clubs" &&
        clubs.some((c) => rv(c) > rv(d.chosen)) &&
        v.check === "follow.free-trick"
      );
    });
    expect(lowClub).toBeDefined();
    // The report prints it as a rulebook position.
    expect(formatPrincipleReport(r)).toMatch(/principle: P2-FREE-TRICK/);
  });

  it("captures passes as well as plays (pass checks fire for a legacy persona)", () => {
    const r = runPrincipleCheck({ persona: "cautious", hands: 30 });
    const passViolations = (r.byCheck["pass.order"] ?? 0) + (r.byCheck["pass.queen-spades"] ?? 0);
    expect(passViolations).toBeGreaterThan(0);
  });

  it("is repeatable from its seed", () => {
    const a = runPrincipleCheck({ persona: "cautious", hands: 10, seed: 7 });
    const b = runPrincipleCheck({ persona: "cautious", hands: 10, seed: 7 });
    expect(b).toEqual(a);
  });

  it("refuses a non-positive hand count", () => {
    expect(() => runPrincipleCheck({ persona: "conservative", hands: 0 })).toThrow(RangeError);
  });
});

describe("parseHandsArg (--hands)", () => {
  it("defaults when the flag is absent", () => {
    expect(parseHandsArg(undefined, false)).toBe(DEFAULT_PRINCIPLE_HANDS);
  });

  it("accepts a positive decimal integer", () => {
    expect(parseHandsArg("2000", true)).toBe(2000);
    expect(parseHandsArg("1", true)).toBe(1);
  });

  it.each(["abc", "5abc", "0", "-3", "1e4", "2.5", " 20", "", "0x10", "99999999999999999999"])(
    "refuses %j",
    (raw) => {
      expect(() => parseHandsArg(raw, true)).toThrow(RangeError);
    }
  );

  it("refuses the flag with no value", () => {
    expect(() => parseHandsArg(undefined, true)).toThrow(/positive integer/);
  });
});

describe("docs", () => {
  it("TESTING.md lists every check id with its kind and principle", () => {
    const doc = readFileSync(join(__dirname, "../../../../docs/TESTING.md"), "utf8");
    // Table rows as trimmed cells: | `id` | kind | principle | … |
    const rows = doc
      .split("\n")
      .filter((line) => line.startsWith("| `"))
      .map((line) => line.split("|").map((cell) => cell.trim()));
    for (const [id, spec] of Object.entries(CHECKS)) {
      const row = rows.find((cells) => cells[1] === `\`${id}\``);
      expect(row?.slice(1, 4)).toEqual([`\`${id}\``, spec.kind, spec.principle]);
    }
  });
});
