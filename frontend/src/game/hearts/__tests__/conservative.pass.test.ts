/**
 * The conservative CPU's pass (#3159): docs/hearts/CONSERVATIVE_AI.md §2.4
 * Passing (P8). Positions marked Rxx are from the §5 rulebook.
 */
import { selectCardsToPass } from "../ai";
import { setRng } from "../engine";
import { choosePass } from "../conservative/pass";
import type { Card, PassDirection } from "../types";
import { cards, name } from "./helpers/conservativeFixtures";

const DIRECTIONS: PassDirection[] = ["left", "right", "across", "none"];

let rng: jest.Mock;
beforeEach(() => {
  rng = jest.fn(() => 0.5);
  setRng(rng);
});
afterEach(() => {
  expect(rng).not.toHaveBeenCalled();
  setRng(Math.random);
});

const CASES = [
  {
    id: "step 1 P5: unprotected Q♠ and A♠ go, then step 2's highest high heart (R26)",
    hand: "QS AS 5S 2C 7C 9C 3D 8D KD 4H 9H 10H AH",
    expected: ["QS", "AS", "AH"],
    principles: ["P5-QUEEN", "P5-QUEEN", "P6-DISCARD"],
  },
  {
    id: "step 1 PROTECTED keeps Q♠; step 2 high hearts, then step 3 danger order (R27)",
    hand: "QS 9S 6S 2S KH QH 3H AD 10D 7D JC 8C 4C",
    expected: ["KH", "QH", "AD"],
    principles: ["P6-DISCARD", "P6-DISCARD", "P4-DANGER"],
  },
  {
    id: "step 3 P4: the dangerous Q-9-8 goes whole (R28)",
    hand: "QD 9D 8D JC 10C 9C 8C 6C 2S 3S 4S 2H 5H",
    expected: ["QD", "9D", "8D"],
    principles: ["P4-DANGER", "P4-DANGER", "P4-DANGER"],
  },
  {
    id: "step 1 P5 without the queen: A♠ then K♠, then danger order (R29)",
    hand: "AS KS 4S 2C 3C 5C KD 6D 3H 6H 8H 9H 10H",
    expected: ["AS", "KS", "KD"],
    principles: ["P5-QUEEN", "P5-QUEEN", "P4-DANGER"],
  },
];

describe("conservative CPU — passing (§2.4 P8)", () => {
  it.each(CASES.map((c) => [c.id, c] as const))("%s", (_id, c) => {
    const d = choosePass(cards(c.hand), "left");
    expect(d.cards.map(name)).toEqual(c.expected);
    expect(d.principle).toBe("P8-PASS");
    expect(d.principles).toEqual(c.principles);
    expect(d.reasons).toHaveLength(3);
  });

  it("keeps Q♠, A♠ and K♠ when spades are PROTECTED, even though A♠ is the most dangerous card", () => {
    const d = choosePass(cards("QS AS KS 2S 3S 4S 2C 3C 4C 2D 3D 4D 5D"), "left");
    for (const c of ["QS", "AS", "KS"]) expect(d.cards.map(name)).not.toContain(c);
    expect(d.cards).toHaveLength(3);
  });

  it.each(CASES.map((c) => [c.id, c] as const))(
    "the direction and the hand order never change the pass: %s",
    (_id, c) => {
      const hand = cards(c.hand);
      const orders: Card[][] = [hand, [...hand].reverse(), hand.map((_, i) => hand[(i * 5) % 13]!)];
      for (const h of orders) {
        for (const dir of DIRECTIONS)
          expect(choosePass(h, dir).cards.map(name)).toEqual(c.expected);
      }
    }
  );

  it("is what selectCardsToPass passes for the conservative persona", () => {
    for (const c of CASES) {
      expect(selectCardsToPass(cards(c.hand), "across", "conservative", 2).map(name)).toEqual(
        c.expected
      );
    }
  });
});
