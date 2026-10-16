/**
 * The principle checker (#3161) against the spec itself: every rulebook
 * position in docs/hearts/CONSERVATIVE_AI.md §5 must come out of the
 * checker's own §2.4 implementation with the rulebook's card and principle,
 * the rulebook's card must pass, and every other legal choice must fail.
 */
import { readFileSync } from "fs";
import { join } from "path";
import type { Card, Rank, Suit } from "../../../src/game/hearts/types";
import {
  CHECKS,
  cardName,
  checkDecision,
  legalCards,
  prescribe,
  toRulebookYaml,
  type CheckId,
  type Decision,
  type PassDecision,
  type PlayDecision,
} from "../principles";

// ---------------------------------------------------------------------------
// A small reader for the rulebook's yaml blocks (flow-style, one key per line)
// ---------------------------------------------------------------------------

const SUIT: Readonly<Record<string, Suit>> = {
  C: "clubs",
  D: "diamonds",
  S: "spades",
  H: "hearts",
};
const FACE: Readonly<Record<string, number>> = { A: 1, J: 11, Q: 12, K: 13 };

function card(s: string): Card {
  const rank = FACE[s.slice(0, -1)] ?? Number(s.slice(0, -1));
  return { suit: SUIT[s.slice(-1)]!, rank: rank as Rank };
}
const cardList = (s: string): Card[] =>
  s
    .replace(/[[\]]/g, "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .map(card);

interface RulebookEntry {
  readonly id: string;
  readonly decision: "pass" | "lead" | "follow" | "discard";
  readonly principle: string;
  readonly expected: Card[];
  readonly position: Decision;
  /** Every top-level field as written. */
  readonly fields: Readonly<Record<string, string>>;
}

function parseBlock(text: string): RulebookEntry {
  const fields: Record<string, string> = {};
  const played: { lead: number; cards: Card[] }[] = [];
  for (const line of text.split("\n")) {
    const trick = /^\s+- \{ lead: (\d+), cards: (\[[^\]]*\]) \}$/.exec(line);
    if (trick) {
      played.push({ lead: Number(trick[1]), cards: cardList(trick[2]!) });
      continue;
    }
    const kv = /^(\w+): ?(.*)$/.exec(line);
    if (kv) fields[kv[1]!] = kv[2]!;
  }
  const seat = Number(fields.seat);
  const expected = cardList(fields.expected!);
  const decision = fields.decision as RulebookEntry["decision"];
  const hand = cardList(fields.hand!);
  const position: Decision =
    decision === "pass"
      ? {
          kind: "pass",
          seat,
          direction: fields.pass_direction as PassDecision["direction"],
          hand,
          chosen: expected,
        }
      : {
          kind: "play",
          seat,
          trickNumber: Number(fields.trick_number),
          hand,
          played,
          trick: [...fields.trick!.matchAll(/seat: (\d+), card: (\w+)/g)].map((m) => ({
            playerIndex: Number(m[1]),
            card: card(m[2]!),
          })),
          heartsBroken: fields.hearts_broken === "true",
          points: fields.points!.replace(/[[\]]/g, "").split(",").map(Number),
          chosen: expected[0]!,
        };
  return { id: fields.id!, decision, principle: fields.principle!, expected, position, fields };
}

function readRulebook(): RulebookEntry[] {
  const doc = readFileSync(join(__dirname, "../../../../docs/hearts/CONSERVATIVE_AI.md"), "utf8");
  const section = doc.slice(doc.indexOf("## 5. Rulebook"), doc.indexOf("## 6. Out of scope"));
  return [...section.matchAll(/```yaml\n([\s\S]*?)```/g)].map((m) => parseBlock(m[1]!));
}

const RULEBOOK = readRulebook();
const entry = (id: string): RulebookEntry => RULEBOOK.find((e) => e.id === id)!;
const names = (cards: readonly Card[]) => cards.map(cardName);

function withChoice(e: RulebookEntry, chosen: string | string[]): Decision {
  return e.position.kind === "pass"
    ? { ...e.position, chosen: (chosen as string[]).map(card) }
    : { ...e.position, chosen: card(chosen as string) };
}

// ---------------------------------------------------------------------------

describe("independence", () => {
  it("imports only the engine's rules and types (not the CPU it checks)", () => {
    const src = readFileSync(join(__dirname, "../principles.ts"), "utf8");
    const imports = [...src.matchAll(/^\s*(?:import|export)[^;]*?from\s+"([^"]+)"/gm)].map(
      (m) => m[1]
    );
    expect(imports.length).toBeGreaterThan(0);
    expect(new Set(imports)).toEqual(
      new Set(["../../src/game/hearts/engine", "../../src/game/hearts/types"])
    );
    expect(src).not.toMatch(/require\(|import\(/);
    // The engine itself must stay free of the CPU, or the import above would reach it.
    const engine = readFileSync(join(__dirname, "../../../src/game/hearts/engine.ts"), "utf8");
    expect(engine).not.toMatch(/from "\.\/(ai|aiConsiderations|aiWeights|conservative\/)/);
  });
});

describe("the rulebook (CONSERVATIVE_AI.md §5)", () => {
  it("parses every position", () => {
    expect(RULEBOOK.length).toBeGreaterThanOrEqual(42);
    for (const e of RULEBOOK) expect(e.expected.length).toBe(e.decision === "pass" ? 3 : 1);
  });

  it.each(RULEBOOK.map((e) => [e.id, e] as const))(
    "%s: §2.4 (as the checker implements it) names the rulebook's card and principle",
    (_id, e) => {
      const p = prescribe(e.position)!;
      expect(p).not.toBeNull();
      const expected = Array.isArray(p.expected) ? p.expected : [p.expected as Card];
      expect(names(expected)).toEqual(names(e.expected));
      expect(p.attributedTo).toBe(e.principle);
      expect(checkDecision(e.position)).toBeNull();
    }
  );

  it.each(RULEBOOK.filter((e) => e.decision !== "pass").map((e) => [e.id, e] as const))(
    "%s: every other legal card is a violation",
    (_id, e) => {
      const d = e.position as PlayDecision;
      if (playDecisionKind(e) !== e.decision) throw new Error(`${e.id}: decision kind mismatch`);
      for (const c of legalCards(d)) {
        if (cardName(c) === cardName(e.expected[0]!)) continue;
        const v = checkDecision({ ...d, chosen: c });
        expect(v).not.toBeNull();
        expect(v!.attributedTo).toBe(e.principle);
      }
    }
  );
});

function playDecisionKind(e: RulebookEntry): string {
  const d = e.position as PlayDecision;
  if (d.trick.length === 0) return "lead";
  return d.hand.some((c) => c.suit === d.trick[0]!.card.suit) ? "follow" : "discard";
}

describe("the story's required violations", () => {
  const cases: [string, string, string | string[], CheckId][] = [
    ["trick-1 follow below the highest club (P2)", "R01", "4C", "follow.free-trick"],
    ["trick-1 follow below the highest club, third seat (P2)", "R02", "3C", "follow.free-trick"],
    ["over the winner while a loser was held (P1)", "R06", "KD", "follow.over-when-could-duck"],
    ["Q♠ into a trick it wins (P5)", "R09", "QS", "follow.queen-into-win"],
    [
      "A♠ into a spade trick the queen can drop on (P5)",
      "R10",
      "AS",
      "follow.spade-honour-under-queen",
    ],
    ["A♠ led while Q♠ is live (P5)", "R20", "AS", "lead.spade-honour"],
    ["Q♠ led (P5)", "R33", "QS", "lead.queen"],
    ["void with a legal Q♠, discarding something else (P5)", "R14", "AH", "discard.queen"],
    ["guard heart discarded during a moon threat (P7)", "R23", "AH", "discard.moon-guard-keep"],
    ["guard heart spent ducking while X can overtake (P7)", "R42", "JH", "follow.moon-guard-keep"],
    [
      "Q♠ dropped where it completes a moon (P7, follow)",
      "R30",
      "QS",
      "follow.moon-complete-queen",
    ],
    [
      "Q♠ discarded where it completes a moon (P7, discard)",
      "R39",
      "QS",
      "discard.moon-complete-queen",
    ],
    ["Q♠ kept under A♠/K♠ (P5)", "R11", "KS", "follow.queen-under-honour"],
    ["a sure winner not taken from a moon threat (P7)", "R25", "3D", "follow.moon-guard-take"],
    ["not the most dangerous lead (P3)", "R19", "9D", "lead.shed"],
    ["not the safest exit (P9)", "R21", "3C", "lead.exit"],
    ["not the highest HIGH heart (P6)", "R16", "JH", "discard.high-heart"],
    ["not the most dangerous discard (P6)", "R17", "AC", "discard.most-dangerous"],
    ["Q♠ kept with spades unprotected (P5 in P8)", "R26", ["AS", "AH", "KD"], "pass.queen-spades"],
    ["Q♠ passed with spades protected (P5 in P8)", "R27", ["QS", "KH", "QH"], "pass.queen-spades"],
    ["not the P8 list (P8)", "R28", ["QD", "9D", "JC"], "pass.order"],
  ];

  it.each(cases)("%s", (_name, id, chosen, check) => {
    const v = checkDecision(withChoice(entry(id), chosen));
    expect(v?.check).toBe(check);
    expect(v?.principleId).toBe(CHECKS[check].principle);
  });

  it("does not care about the order of the three pass cards", () => {
    expect(checkDecision(withChoice(entry("R26"), ["AH", "QS", "AS"]))).toBeNull();
  });

  it("files a P1 duck violation under the P7 guard only when the guard filter applies", () => {
    // R32: seat 0 is winning, so there is no threat to guard against; ducking with the ace is P1.
    expect(checkDecision(withChoice(entry("R32"), "AH"))?.check).toBe(
      "follow.over-when-could-duck"
    );
  });
});

describe("rulebook yaml output", () => {
  it.each([
    ["R01", "4C"],
    ["R23", "AH"],
    ["R40", "AS"],
    ["R26", ["AS", "AH", "KD"]],
  ] as const)("%s: a reported position reads back as the same decision", (id, chosen) => {
    const d = withChoice(entry(id), chosen as string | string[]);
    const v = checkDecision(d)!;
    const yaml = toRulebookYaml(v, "SIM-1");
    const back = parseBlock(yaml);
    expect(back.id).toBe("SIM-1");
    expect(back.principle).toBe(entry(id).principle);
    expect(names(back.expected)).toEqual(names(entry(id).expected));
    const { chosen: _a, ...want } = d;
    const { chosen: _b, ...got } = back.position;
    expect(got).toEqual(want);
    // Field for field the rulebook's own block, apart from its id and reason.
    const { id: _c, reason: _d, ...docFields } = entry(id).fields;
    const { id: _e, reason, ...outFields } = back.fields;
    expect(outFields).toEqual(docFields);
    expect(reason).toMatch(/^".*"$/);
  });
});
