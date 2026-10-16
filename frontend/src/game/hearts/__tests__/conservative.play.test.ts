/**
 * The conservative CPU's play procedures (#3159): docs/hearts/CONSERVATIVE_AI.md
 * §2.4 Leading / Following / Discarding, step by step, with the principle each
 * decision is credited to (§2.3 Attribution). Positions marked Rxx are taken
 * from the §5 rulebook; the full rulebook suite is #3160.
 */
import { selectCardToPlay } from "../ai";
import { getValidPlays, setRng } from "../engine";
import { choosePlay } from "../conservative/play";
import type { Card, HeartsState } from "../types";
import { name, positionState, withHandOrder } from "./helpers/conservativeFixtures";
import type { Position } from "./helpers/conservativeFixtures";

interface Case {
  readonly id: string;
  readonly pos: Position;
  readonly expected: string;
  readonly principle: string | null;
}

const MOON_HISTORY = [
  { lead: 0, cards: "2C AC 3C 9C" },
  { lead: 1, cards: "KD 2H 7D 4D" },
  { lead: 1, cards: "AH 3H JH 4H" },
  { lead: 1, cards: "KH 5H 10H 6H" },
  { lead: 1, cards: "QH 7H 9H 8H" },
  { lead: 1, cards: "4C QC 5C 6C" },
];

// ── Leading ──────────────────────────────────────────────────────────────────
const LEAD: Case[] = [
  {
    id: "step 1 P7: a sure-winning guard heart is led against a moon threat (R24)",
    pos: {
      seat: 2,
      trickNumber: 5,
      hand: "AH 9H 8H 6H 5H 4H 2D 4S 2S",
      played: [
        { lead: 0, cards: "2C AC KC 7C" },
        { lead: 1, cards: "AS 5S 6S QS" },
        { lead: 1, cards: "KD 3D 2H 9D" },
        { lead: 1, cards: "10C QC 8C 3C" },
      ],
      heartsBroken: true,
      points: [0, 14, 0, 0],
    },
    expected: "AH",
    principle: "P7-MOON-GUARD",
  },
  {
    id: "step 2 filter + step 4: A♠ is never led while Q♠ is live, so P9 exits (R20)",
    pos: {
      seat: 3,
      trickNumber: 2,
      hand: "AS 3S 2D 3D 4D 4C 5C 2H 5H 9H JH KH",
      played: [{ lead: 0, cards: "2C 8C QC AC" }],
    },
    expected: "2D",
    principle: "P9-EXIT",
  },
  {
    id: "step 2 filter leaves only A♠ when Q♠/A♠ are the only legal cards; P3 names it (R33)",
    pos: {
      seat: 1,
      trickNumber: 2,
      hand: "QS AS 2H 3H 4H 5H 6H 7H 8H 9H 10H JH",
      played: [{ lead: 0, cards: "2C AC 5C 9C" }],
    },
    expected: "AS",
    principle: "P3-SHED",
  },
  {
    id: "step 3 P3: the top of the dangerous Q-9-8 is led (R19)",
    pos: {
      seat: 2,
      trickNumber: 2,
      hand: "QD 9D 8D 3C 5C 2S 4S 6S 3H 7H 10H KH",
      played: [{ lead: 0, cards: "2C 4C AC 6C" }],
    },
    expected: "QD",
    principle: "P3-SHED",
  },
  {
    id: "step 4 P9: fewest below, then lower rank, then suit order ♣ ♦ ♠ ♥ (R21)",
    pos: {
      seat: 2,
      trickNumber: 2,
      hand: "3C 4C 2D 4D 6D 2S 4S 6S 7H 10H QH KH",
      played: [{ lead: 0, cards: "2C 9C AC 5C" }],
    },
    expected: "2D",
    principle: "P9-EXIT",
  },
  {
    id: "step 4 P9: a low heart is the surest loser once hearts are broken (R22)",
    pos: {
      seat: 0,
      trickNumber: 4,
      hand: "2H 9H 10H JH 3C 4C 6C 9C 7D 5D",
      played: [
        { lead: 0, cards: "2C 8C 10C QC" },
        { lead: 3, cards: "3D 8D KD 9D" },
        { lead: 1, cards: "7S 4S 3H AS" },
      ],
      heartsBroken: true,
      points: [1, 0, 0, 0],
    },
    expected: "2H",
    principle: "P9-EXIT",
  },
  {
    id: "step 5 P9: every card would win, so the lowest non-heart (R35)",
    pos: {
      seat: 2,
      trickNumber: 2,
      hand: "3D 4D 5D 6D 7D 8D 9D 10D JD QD KD AD",
      played: [{ lead: 0, cards: "2C 5C AC 9C" }],
    },
    expected: "3D",
    principle: "P9-EXIT",
  },
  {
    id: "step 5 P9: every card would win and only hearts remain, so the lowest heart",
    pos: { seat: 1, trickNumber: 12, hand: "KH AH", heartsBroken: true },
    expected: "KH",
    principle: "P9-EXIT",
  },
];

// ── Following ────────────────────────────────────────────────────────────────
const FOLLOW: Case[] = [
  {
    id: "step 1 P7: keeps Q♠ off X's A♠ when that completes the moon (R30)",
    pos: {
      seat: 3,
      trickNumber: 6,
      hand: "QS KS 3S 10S JS 5D 6D 5C",
      played: MOON_HISTORY.slice(0, 5),
      trick: [
        [1, "AS"],
        [2, "4S"],
      ],
      heartsBroken: true,
      points: [0, 13, 0, 0],
    },
    expected: "KS",
    principle: "P7-MOON-GUARD",
  },
  {
    id: "step 1 P7: X still to play could overtake K♠, so the queen stays (R38)",
    pos: {
      seat: 3,
      trickNumber: 7,
      hand: "QS 8S 3S 10S JS 5D 6D",
      played: MOON_HISTORY,
      trick: [[2, "KS"]],
      heartsBroken: true,
      points: [0, 13, 0, 0],
    },
    expected: "JS",
    principle: "P7-MOON-GUARD",
  },
  {
    id: "step 2 P5: Q♠ is dropped under a winning A♠ (R11)",
    pos: {
      seat: 3,
      trickNumber: 2,
      hand: "QS KS 4S 3C 8C 5D 8D JD 2H 7H 9H AH",
      played: [{ lead: 0, cards: "2C KC 5C 10C" }],
      trick: [
        [1, "AS"],
        [2, "6S"],
      ],
    },
    expected: "QS",
    principle: "P5-QUEEN",
  },
  {
    id: "step 2 P5: nothing out beats seat 2's A♠, so X cannot win and Q♠ goes (R41)",
    pos: {
      seat: 3,
      trickNumber: 7,
      hand: "QS 8S 3S 10S JS 5D 6D",
      played: MOON_HISTORY,
      trick: [[2, "AS"]],
      heartsBroken: true,
      points: [0, 13, 0, 0],
    },
    expected: "QS",
    principle: "P5-QUEEN",
  },
  {
    id: "step 3 P7: last to play, takes a pointed trick from X (R25)",
    pos: {
      seat: 3,
      trickNumber: 5,
      hand: "AD 3D 6S 9S 7C 8C 3H 8H 10H",
      played: [
        { lead: 0, cards: "2C AC 4C QC" },
        { lead: 1, cards: "KD 2H 4D 9D" },
        { lead: 1, cards: "AS 5S JS QS" },
        { lead: 1, cards: "10C 3C 9C KC" },
      ],
      trick: [
        [0, "6D"],
        [1, "QD"],
        [2, "7H"],
      ],
      heartsBroken: true,
      points: [0, 14, 0, 0],
    },
    expected: "AD",
    principle: "P7-MOON-GUARD",
  },
  {
    id: "step 3 P7: a certain winner takes the trick from X with a player to come (R31)",
    pos: {
      seat: 2,
      trickNumber: 5,
      hand: "AH 10H 9H 8H 7H 6H 5H 2S 2D",
      played: [
        { lead: 0, cards: "2C AC 4C 7C" },
        { lead: 1, cards: "AS 5S 6S QS" },
        { lead: 1, cards: "KD 3D 2H 9D" },
        { lead: 1, cards: "10C 3C 8C KC" },
      ],
      trick: [
        [0, "4H"],
        [1, "JH"],
      ],
      heartsBroken: true,
      points: [0, 14, 0, 0],
    },
    expected: "AH",
    principle: "P7-MOON-GUARD",
  },
  {
    id: "step 3 skipped: A♠ may not be the guard's winner with Q♠ out and a player to come (R40)",
    pos: {
      seat: 3,
      trickNumber: 6,
      hand: "AS 2S AD 6D 5D 3D 5C 4C",
      played: [
        { lead: 0, cards: "2C AC 3C 9C" },
        { lead: 1, cards: "KD 2H 7D 4D" },
        { lead: 1, cards: "AH 3H JH 4H" },
        { lead: 1, cards: "KH 5H 10H 6H" },
        { lead: 1, cards: "QH 7H 9H 8C" },
      ],
      trick: [
        [1, "9S"],
        [2, "8H"],
      ],
      heartsBroken: true,
      points: [0, 12, 0, 0],
    },
    expected: "2S",
    principle: "P1-DUCK",
  },
  {
    id: "step 4 P2: trick 1 from 2nd seat plays the highest club (R01)",
    pos: {
      seat: 1,
      trickNumber: 1,
      hand: "4C 9C KC 3D 8D JD 5S 7S 10S 2H 6H 9H QH",
      trick: [[0, "2C"]],
    },
    expected: "KC",
    principle: "P2-FREE-TRICK",
  },
  {
    id: "step 4 P2: trick 1 from 3rd seat plays the highest club (R02)",
    pos: {
      seat: 2,
      trickNumber: 1,
      hand: "3C 6C AC 4D 7D 10D KD 2S 9S JS 3H 8H KH",
      trick: [
        [0, "2C"],
        [1, "5C"],
      ],
    },
    expected: "AC",
    principle: "P2-FREE-TRICK",
  },
  {
    id: "step 4 P2: trick 1 from 4th seat plays the highest club (R03)",
    pos: {
      seat: 3,
      trickNumber: 1,
      hand: "3C 8C QC 2D 5D 9D 3S 6S 8S 4H 7H 10H AH",
      trick: [
        [0, "2C"],
        [1, "7C"],
        [2, "JC"],
      ],
    },
    expected: "QC",
    principle: "P2-FREE-TRICK",
  },
  {
    id: "step 4 P2: last to a pointless trick, wins with the ace (R12)",
    pos: {
      seat: 0,
      trickNumber: 3,
      hand: "4D AD 7C QC 4S 10S 3H 5H 8H JH QH",
      played: [
        { lead: 0, cards: "2C 4C 10C 6C" },
        { lead: 2, cards: "8S 2S 6S JS" },
      ],
      trick: [
        [1, "3D"],
        [2, "6D"],
        [3, "9D"],
      ],
    },
    expected: "AD",
    principle: "P2-FREE-TRICK",
  },
  {
    id: "step 5 P1: last seat, but a heart in the trick, so it ducks (R13)",
    pos: {
      seat: 0,
      trickNumber: 3,
      hand: "7C KC 5D 8D 3S 7S 10S 2H 6H 9H AH",
      played: [
        { lead: 0, cards: "2C QC 4C 6C" },
        { lead: 1, cards: "KD 10D 2D JD" },
      ],
      trick: [
        [1, "5C"],
        [2, "9C"],
        [3, "3H"],
      ],
      heartsBroken: true,
    },
    expected: "7C",
    principle: "P1-DUCK",
  },
  {
    id: "step 5 P1: the highest card that still loses (R06)",
    pos: {
      seat: 0,
      trickNumber: 2,
      hand: "3D 9D KD 4C 8C 2S 7S 10S 5H 6H 9H QH",
      played: [{ lead: 0, cards: "2C 3C 9C JC" }],
      trick: [[3, "10D"]],
    },
    expected: "9D",
    principle: "P1-DUCK",
  },
  {
    id: "step 5 P7 filter: keeps the guard heart while X can overtake, ducks lower (R42)",
    pos: {
      seat: 3,
      trickNumber: 5,
      hand: "JH 8H 5H 4H 3H 2D 2S 3S 4S",
      played: [
        { lead: 0, cards: "2C AC 4C 7C" },
        { lead: 1, cards: "AS 5S 6S QS" },
        { lead: 1, cards: "KD 2H 3D 9D" },
        { lead: 1, cards: "10C KC 5C 3C" },
      ],
      trick: [[2, "QH"]],
      heartsBroken: true,
      points: [0, 14, 0, 0],
    },
    expected: "8H",
    principle: "P1-DUCK",
  },
  {
    id: "step 6c P1: cannot lose, so wins with the highest (R08)",
    pos: {
      seat: 1,
      trickNumber: 2,
      hand: "7D QD 4C 5C 2S 6S 9S 3H 5H 8H JH KH",
      played: [{ lead: 0, cards: "2C 10C 8C AC" }],
      trick: [
        [3, "3D"],
        [0, "6D"],
      ],
    },
    expected: "QD",
    principle: "P1-DUCK",
  },
  {
    id: "step 6a: a forced spade win never uses its own Q♠; A♠ is fine as it holds her (R09)",
    pos: {
      seat: 2,
      trickNumber: 2,
      hand: "9S QS AS 3C 4C 2D 8D KD 4H 6H 10H QH",
      played: [{ lead: 0, cards: "2C QC 7C 9C" }],
      trick: [[1, "5S"]],
    },
    expected: "AS",
    principle: "P1-DUCK",
  },
  {
    id: "step 6b P5 filter: A♠ removed with Q♠ out and players to come; P1 plays J♠ (R10)",
    pos: {
      seat: 1,
      trickNumber: 3,
      hand: "JS AS 8C 7C 7D 6D 2H 4H 6H 9H KH",
      played: [
        { lead: 0, cards: "2C 10C JC 3C" },
        { lead: 2, cards: "5D 4D AD QD" },
      ],
      trick: [[0, "8S"]],
    },
    expected: "JS",
    principle: "P1-DUCK",
  },
  {
    id: "step 6b P5: only A♠/K♠ left after the filter, so the lower, K♠ (R36)",
    pos: {
      seat: 2,
      trickNumber: 2,
      hand: "KS AS 3C 5C 2D 6D 9D JD 3H 7H 10H QH",
      played: [{ lead: 0, cards: "2C KC 9C 4C" }],
      trick: [[1, "6S"]],
    },
    expected: "KS",
    principle: "P5-QUEEN",
  },
];

// ── Discarding ───────────────────────────────────────────────────────────────
const DISCARD: Case[] = [
  {
    id: "step 1 P7 filter: no Q♠ where X could overtake and complete the moon; P6 next (R39)",
    pos: {
      seat: 3,
      trickNumber: 7,
      hand: "QS 8S 3S 10S JS 5D 6D",
      played: MOON_HISTORY,
      trick: [[2, "JC"]],
      heartsBroken: true,
      points: [0, 13, 0, 0],
    },
    expected: "JS",
    principle: "P6-DISCARD",
  },
  {
    id: "step 2 P5: the first void discards Q♠ (R14)",
    pos: {
      seat: 1,
      trickNumber: 3,
      hand: "QS 3S 6S 8C JC 7C 2H 4H 9H JH AH",
      played: [
        { lead: 0, cards: "2C QC AC 4C" },
        { lead: 2, cards: "3D 9D KD 5D" },
      ],
      trick: [[0, "10D"]],
    },
    expected: "QS",
    principle: "P5-QUEEN",
  },
  {
    id: "step 3 P5: A♠ while Q♠ is live, before high hearts (R15)",
    pos: {
      seat: 0,
      trickNumber: 2,
      hand: "AS 7S 4S 2D 8D JD KD 3H 6H 10H QH KH",
      played: [{ lead: 0, cards: "2C 9C QC 3C" }],
      trick: [
        [2, "5C"],
        [3, "10C"],
      ],
    },
    expected: "AS",
    principle: "P5-QUEEN",
  },
  {
    id: "step 3 P5: on trick 1 too, A♠ goes; hearts are not legal (R04)",
    pos: {
      seat: 2,
      trickNumber: 1,
      hand: "AS 4S 8S 10S 2D 6D 9D QD 3H 5H 8H JH KH",
      trick: [
        [0, "2C"],
        [1, "KC"],
      ],
    },
    expected: "AS",
    principle: "P5-QUEEN",
  },
  {
    id: "step 4 P7 filter: keeps A♥ as the guard; P6 discards K♥ (R23)",
    pos: {
      seat: 0,
      trickNumber: 4,
      hand: "AH KH 7H 3H 3C 10C JC 9D JD QD",
      played: [
        { lead: 0, cards: "2C 5C 9C AC" },
        { lead: 3, cards: "KS 8S QS 3S" },
        { lead: 3, cards: "6D 4D 2D 10D" },
      ],
      trick: [
        [2, "7S"],
        [3, "JS"],
      ],
      points: [0, 0, 0, 13],
    },
    expected: "KH",
    principle: "P6-DISCARD",
  },
  {
    id: "step 5 P6: the highest high heart (R16)",
    pos: {
      seat: 2,
      trickNumber: 3,
      hand: "4C 4S 6S 8S 2H 4H 5H 7H 9H JH QH",
      played: [
        { lead: 0, cards: "2C 6C JC 8C" },
        { lead: 2, cards: "3C KC 5C 9C" },
      ],
      trick: [
        [3, "5D"],
        [0, "9D"],
        [1, "KD"],
      ],
    },
    expected: "QH",
    principle: "P6-DISCARD",
  },
  {
    id: "step 5 P6: Q♠ played, so A♠ is just a card and the high heart goes (R18)",
    pos: {
      seat: 0,
      trickNumber: 4,
      hand: "AS 6S QH 7H 4H 3C 5C 10C JC AC",
      played: [
        { lead: 0, cards: "2C 4C 9C KC" },
        { lead: 3, cards: "KS QS 3S 7S" },
        { lead: 3, cards: "6D 5D 2H JD" },
      ],
      trick: [
        [2, "4D"],
        [3, "8D"],
      ],
      heartsBroken: true,
      points: [0, 0, 1, 13],
    },
    expected: "QH",
    principle: "P6-DISCARD",
  },
  {
    id: "step 6 P6 via P4: the most dangerous card, J♦ of J-10-9-8-6 (R17)",
    pos: {
      seat: 0,
      trickNumber: 2,
      hand: "AC 3C 4C JD 10D 9D 8D 6D 2H 3H 4H 5H",
      played: [{ lead: 0, cards: "2C 9C 5C KC" }],
      trick: [[3, "6S"]],
    },
    expected: "JD",
    principle: "P6-DISCARD",
  },
  {
    id: "step 6 P6 via P4: trick 1 void, the ace of unguarded diamonds (R05)",
    pos: {
      seat: 1,
      trickNumber: 1,
      hand: "AD 9D 8D 2S 3S 7S 9S 4H 6H 10H QH KH AH",
      trick: [[0, "2C"]],
    },
    expected: "AD",
    principle: "P6-DISCARD",
  },
];

const ALL = [...LEAD, ...FOLLOW, ...DISCARD];

let rng: jest.Mock;
beforeEach(() => {
  rng = jest.fn(() => 0.5);
  setRng(rng);
});
afterEach(() => {
  expect(rng).not.toHaveBeenCalled();
  setRng(Math.random);
});

describe.each([
  ["Leading", LEAD],
  ["Following", FOLLOW],
  ["Discarding", DISCARD],
])("conservative CPU — %s (§2.4)", (_label, cases) => {
  it.each(cases.map((c) => [c.id, c] as const))("%s", (_id, c) => {
    const state = positionState(c.pos);
    const d = choosePlay(state, c.pos.seat);
    expect(name(d.card)).toBe(c.expected);
    expect(d.principle).toBe(c.principle);
    expect(d.reason).toMatch(/\S/);
  });
});

describe("conservative CPU — invariants", () => {
  it("plays the only legal card with no principle", () => {
    const state = positionState({ seat: 0, trickNumber: 1, hand: "2C 3C KH QS AS" });
    expect(choosePlay(state, 0)).toMatchObject({
      card: { suit: "clubs", rank: 2 },
      principle: null,
    });
  });

  // A fixed, non-sorted reordering: deterministic, so the test is too.
  const shuffle = (h: Card[]): Card[] =>
    h
      .map((c, i) => [(i * 7) % h.length, c] as const)
      .sort((a, b) => a[0] - b[0])
      .map(([, c]) => c);
  const key = (c: Card): number =>
    "CDSH".indexOf(name(c).slice(-1)) * 20 + (c.rank === 1 ? 14 : c.rank);
  const orders: [string, (h: Card[]) => Card[]][] = [
    ["ascending", (h) => [...h].sort((a, b) => key(a) - key(b))],
    ["descending", (h) => [...h].sort((a, b) => key(b) - key(a))],
    ["shuffled", shuffle],
  ];

  it.each(ALL.map((c) => [c.id, c] as const))("hand order never changes the card: %s", (_id, c) => {
    const base = positionState(c.pos);
    const results = orders.map(([, order]) =>
      choosePlay(withHandOrder(base, c.pos.seat, order), c.pos.seat)
    );
    for (const r of results) {
      expect(name(r.card)).toBe(c.expected);
      expect(r.principle).toBe(c.principle);
    }
  });

  it.each(ALL.map((c) => [c.id, c] as const))("never returns an illegal card: %s", (_id, c) => {
    const state = positionState(c.pos);
    const legal = getValidPlays(state, c.pos.seat).map(name);
    expect(legal).toContain(name(choosePlay(state, c.pos.seat).card));
  });

  it("is what selectCardToPlay plays for the conservative persona", () => {
    for (const c of ALL) {
      const state: HeartsState = positionState(c.pos);
      const hand = [...state.playerHands[c.pos.seat]!];
      const card = selectCardToPlay(
        hand,
        [...state.currentTrick],
        state,
        c.pos.seat,
        "conservative"
      );
      expect(name(card)).toBe(c.expected);
    }
  });
});
