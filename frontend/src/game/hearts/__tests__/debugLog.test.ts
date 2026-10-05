import {
  cardStr,
  formatSessionAsMarkdown,
  passDirectionLabel,
  passOffset,
  type HandDebugLog,
} from "../debugLog";
import { PLAYER_LABELS, handLog } from "./helpers/debugLogFixtures";

describe("cardStr", () => {
  it("writes the rank label and suit symbol", () => {
    expect(cardStr({ suit: "spades", rank: 1 })).toBe("A♠");
    expect(cardStr({ suit: "hearts", rank: 10 })).toBe("10♥");
    expect(cardStr({ suit: "diamonds", rank: 11 })).toBe("J♦");
    expect(cardStr({ suit: "clubs", rank: 12 })).toBe("Q♣");
    expect(cardStr({ suit: "spades", rank: 13 })).toBe("K♠");
  });
});

describe("passDirectionLabel", () => {
  it.each([
    ["left", "Pass Left"],
    ["right", "Pass Right"],
    ["across", "Pass Across"],
    ["none", "No Pass"],
  ] as const)("%s is %s", (direction, label) => {
    expect(passDirectionLabel(direction)).toBe(label);
  });
});

describe("passOffset", () => {
  it.each([
    ["left", 1],
    ["right", 3],
    ["across", 2],
    ["none", 0],
  ] as const)("%s moves cards %i seats", (direction, offset) => {
    expect(passOffset(direction)).toBe(offset);
  });
});

describe("formatSessionAsMarkdown", () => {
  const format = (logs: readonly HandDebugLog[], notes: readonly string[] = []) =>
    formatSessionAsMarkdown(logs, notes, PLAYER_LABELS, "mixed").split("\n");

  it("heads the session with the hand count, difficulty and players", () => {
    const lines = format([handLog()]);
    expect(lines[0]).toBe("# Hearts Debug Session — 1 hand — Difficulty: mixed");
    expect(lines[2]).toBe("Players: You (P0), Ann (P1), Bo (P2), Cy (P3)");
    expect(format([handLog(), handLog({ handNumber: 2 })])[0]).toBe(
      "# Hearts Debug Session — 2 hands — Difficulty: mixed"
    );
    expect(format([])[0]).toBe("# Hearts Debug Session — 0 hands — Difficulty: mixed");
  });

  it("lists the deals, writing an empty hand as a dash", () => {
    const lines = format([handLog()]);
    expect(lines).toContain("## Hand 1 — Pass Left");
    expect(lines).toContain("- **You**: A♠ 10♥");
    expect(lines).toContain("- **Bo**: Q♠ K♦");
    expect(lines).toContain("- **Cy**: —");
  });

  it("shows who passes to whom, and the hands after the pass", () => {
    const lines = format([handLog({ passDirection: "left" })]);
    expect(lines).toContain("### Pass Selections (Pass Left)");
    expect(lines).toContain("- You → Ann: A♠");
    expect(lines).toContain("- Cy → You: —");
    expect(lines).toContain("### Final Hands (after pass)");
    expect(lines).toContain("- **Ann**: A♠");

    const across = format([handLog({ passDirection: "across" })]);
    expect(across).toContain("- You → Bo: A♠");
    const right = format([handLog({ passDirection: "right" })]);
    expect(right).toContain("- You → Cy: A♠");
  });

  it("leaves out the pass sections on a no-pass hand", () => {
    const text = format([handLog({ passDirection: "none" })]).join("\n");
    expect(text).toContain("## Hand 1 — No Pass");
    expect(text).not.toContain("### Pass Selections");
    expect(text).not.toContain("### Final Hands");
  });

  it("writes each trick with the winner in bold and any points won", () => {
    const lines = format([handLog()]);
    expect(lines).toContain("T1 You:10♥  Ann:J♥  Bo:**K♥**  Cy:2♥  → Bo +4");
    // A trick without points has no suffix.
    expect(lines).toContain("T2 Bo:**5♣**  Cy:3♣  → Bo");
  });

  it("writes the score deltas and the running totals", () => {
    const lines = format([handLog()]);
    expect(lines).toContain("### Scores: You +0, Ann +0, Bo +4, Cy +22");
    expect(lines).toContain("### Running: You 5, Ann 6, Bo 9, Cy 22");
  });

  it("adds the trimmed note under its own hand only", () => {
    const lines = format([handLog(), handLog({ handNumber: 2 })], ["  AI led the queen  ", "  "]);
    expect(lines.filter((l) => l.startsWith("> Note:"))).toEqual(["> Note: AI led the queen"]);
  });

  it("falls back to P<n> for a missing label and 0 for missing scores", () => {
    const text = formatSessionAsMarkdown(
      [handLog({ scoreDeltas: [], cumulativeScoresAfter: [] })],
      [],
      ["You"],
      "cautious"
    );
    expect(text).toContain("Players: You (P0), P1 (P1), P2 (P2), P3 (P3)");
    expect(text).toContain("### Scores: You +0, P1 +0, P2 +0, P3 +0");
    expect(text).toContain("### Running: You 0, P1 0, P2 0, P3 0");
  });
});
