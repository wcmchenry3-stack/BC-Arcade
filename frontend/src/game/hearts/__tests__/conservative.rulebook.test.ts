/**
 * The CONSERVATIVE_AI.md §5 rulebook as a test suite (#3160, epic #3156).
 *
 * The doc is the single source: every `yaml` position in §5 is read at test
 * time and run against the shipped configuration, with no RNG pinning and no
 * mocks. For each position:
 *  - the doc is checked against itself (history re-derived: points, flags,
 *    leaders, hand size, no duplicate cards);
 *  - the card comes from `selectCardToPlay`/`selectCardsToPass` with the
 *    "conservative" persona, exactly as the game calls it, and the principle
 *    from `choosePlay`/`choosePass`;
 *  - the card does not depend on the order of the CPU's hand (ascending,
 *    descending, three seeded shuffles);
 *  - the card does not depend on the seat: the whole position is rotated so
 *    the CPU sits in each of the four seats.
 */
import { selectCardToPlay, selectCardsToPass } from "../ai";
import { choosePass } from "../conservative/pass";
import { getValidPlays } from "../engine";
import { choosePlay } from "../conservative/play";
import { card, name } from "./helpers/conservativeFixtures";
import {
  buildState,
  derive,
  handOrderings,
  loadRulebook,
  parseRulebook,
  parseBlock,
  rotate,
  toPosition,
  type RulebookPosition,
} from "./helpers/rulebook";

const { positions, blocks } = loadRulebook();

/** The card(s) the game would get for `p`, with the CPU's hand in the given order. */
function shipped(p: RulebookPosition, hand: readonly string[]): string[] {
  const h = hand.map(card);
  if (p.decision === "pass") {
    return selectCardsToPass(h, p.passDirection!, "conservative", p.seat).map(name);
  }
  const state = buildState(p, h);
  return [name(selectCardToPlay(h, [...state.currentTrick], state, p.seat, "conservative"))];
}

function principleOf(p: RulebookPosition): string | null {
  const hand = p.hand.map(card);
  if (p.decision === "pass") return choosePass(hand, p.passDirection!).principle;
  return choosePlay(buildState(p, hand), p.seat).principle;
}

const VALID_BLOCK = {
  id: "R00",
  decision: "lead",
  seat: 0,
  trick_number: 1,
  hand: ["2C"],
  played: [],
  trick: [],
  hearts_broken: false,
  queen_played: false,
  points: [0, 0, 0, 0],
  expected: ["2C"],
  principle: "P1-DUCK",
  reason: "x",
};

describe("rulebook loading (§5 is the single source)", () => {
  it("loads every yaml block and finds at least the 42 known positions", () => {
    expect(blocks).toBe(positions.length);
    expect(positions.length).toBeGreaterThanOrEqual(42);
  });

  it("has unique, well-formed ids", () => {
    const ids = positions.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^R\d{2,}$/);
  });

  it("covers all four decisions", () => {
    expect(new Set(positions.map((p) => p.decision))).toEqual(
      new Set(["pass", "lead", "follow", "discard"])
    );
  });

  it("rejects what it cannot parse", () => {
    expect(() => parseBlock("id R01")).toThrow(/unparseable/);
    expect(() => parseBlock("hand: [4C, 9C")).toThrow();
    expect(() => parseBlock("hand: [4C]\nhand: [5C]")).toThrow(/duplicate/);
    expect(() => toPosition({ id: "R99" })).toThrow(/missing field/);
    expect(() => toPosition({ ...VALID_BLOCK, bogus: 1 })).toThrow(/unknown field/);
    expect(() => toPosition({ ...VALID_BLOCK, hand: ["1X"] })).toThrow(/bad card/);
  });

  it("rejects unknown keys in nested played / trick mappings", () => {
    const base = { ...VALID_BLOCK, trick_number: 2 };
    expect(() => toPosition({ ...base, played: [{ lead: 0, cards: ["2C"], winner: 3 }] })).toThrow(
      /exactly/
    );
    expect(() => toPosition({ ...base, trick: [{ seat: 0, card: "2C", extra: 1 }] })).toThrow(
      /exactly/
    );
  });

  it("flags a mislabelled decision (lead / follow / discard)", () => {
    const follow = positions.find((q) => q.id === "R01")!;
    expect(derive(follow).problems).toEqual([]);
    expect(derive({ ...follow, decision: "lead" }).problems.join()).toMatch(/labelled lead/);
    expect(derive({ ...follow, decision: "discard" }).problems.join()).toMatch(/labelled discard/);
    const discard = positions.find((q) => q.id === "R04")!;
    expect(derive({ ...discard, decision: "follow" }).problems.join()).toMatch(/labelled follow/);
  });

  it("rejects duplicate keys inside a flow mapping", () => {
    expect(() => parseBlock("played:\n  - { lead: 0, lead: 1, cards: [2C] }")).toThrow(/duplicate/);
  });

  describe("fence and id accounting", () => {
    const block = (id: string, fence = "```yaml") =>
      [
        fence,
        `id: ${id}`,
        ...Object.entries(VALID_BLOCK)
          .filter(([k]) => k !== "id")
          .map(([k, v]) => `${k}: ${JSON.stringify(v)}`),
        "```",
      ].join("\n");
    const doc = (...parts: string[]) =>
      `# t\n\n## 5. Rulebook\n\n${parts.join("\n\n")}\n\n## 6. Next\n`;

    it("accepts a well-formed section", () => {
      expect(parseRulebook(doc(block("R01"), block("R02"))).positions).toHaveLength(2);
    });
    it("rejects a ```yml fence", () => {
      expect(() => parseRulebook(doc(block("R01"), block("R02", "```yml")))).toThrow(
        /plain yaml opener/
      );
    });
    it("rejects an unclosed fence", () => {
      expect(() => parseRulebook(doc(block("R01"), "```yaml\nid: R02\nseat: 0"))).toThrow(
        /unclosed|malformed/
      );
    });
    it("rejects a malformed 43rd block", () => {
      expect(() => parseRulebook(doc(block("R01"), "```yaml\nid: R02\nnot a field\n```"))).toThrow(
        /unparseable/
      );
    });
    it("rejects an id: line outside any yaml block", () => {
      expect(() => parseRulebook(doc(block("R01"), "id: R02"))).toThrow(/id: lines/);
    });
  });

  it("parses the doc's block shapes", () => {
    const b = parseBlock(
      [
        "id: R00",
        "played:",
        "  - { lead: 0, cards: [2C, 5C, AC, 9C] }",
        "trick: [{ seat: 3, card: 10D }]",
        "hearts_broken: true",
        'reason: "a, b: c"',
      ].join("\n")
    );
    expect(b).toEqual({
      id: "R00",
      played: [{ lead: 0, cards: ["2C", "5C", "AC", "9C"] }],
      trick: [{ seat: 3, card: "10D" }],
      hearts_broken: true,
      reason: "a, b: c",
    });
  });
});

describe.each(positions.map((p) => [p.id, p] as const))("%s", (_id, p) => {
  it("is consistent with its own history", () => {
    const d = derive(p);
    expect(d.problems).toEqual([]);
    expect(d.points).toEqual(p.points);
    expect(d.heartsBroken).toBe(p.heartsBroken);
    expect(d.queenPlayed).toBe(p.queenPlayed);
  });

  it("plays the expected card(s) as the game calls the CPU", () => {
    expect(shipped(p, p.hand)).toEqual(p.expected);
  });

  it("expects cards from the CPU's hand that are legal under getValidPlays", () => {
    expect(p.expected.every((c) => p.hand.includes(c))).toBe(true);
    if (p.decision !== "pass") {
      const legal = getValidPlays(buildState(p, p.hand.map(card)), p.seat).map(name);
      expect(legal).toEqual(expect.arrayContaining([...p.expected]));
    }
  });

  it("credits the expected principle", () => {
    expect(principleOf(p)).toBe(p.principle);
  });

  it.each(handOrderings(p.hand.map(card)).map((o) => [o.label, o.hand.map(name)] as const))(
    "does not depend on hand order (%s)",
    (_label, order) => {
      expect([...order].sort()).toEqual([...p.hand].sort());
      expect(shipped(p, order)).toEqual(p.expected);
    }
  );

  it.each([1, 2, 3])("does not depend on the seat (rotated by %i)", (k) => {
    const r = rotate(p, k);
    const d = derive(r);
    expect(d.problems).toEqual([]);
    expect(d.points).toEqual(r.points);
    expect(shipped(r, r.hand)).toEqual(p.expected);
    expect(principleOf(r)).toBe(p.principle);
  });
});
