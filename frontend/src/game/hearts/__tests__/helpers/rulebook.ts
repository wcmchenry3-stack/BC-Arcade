/**
 * Loader for the CONSERVATIVE_AI.md §5 rulebook (#3160). Not a test file.
 *
 * The doc is the single source of the positions: this reads it at test time,
 * parses every fenced `yaml` block in §5 with a small strict parser for the
 * fixed block format (no yaml dependency is declared in package.json), and
 * builds the engine state from the position's own history. Nothing here
 * imports the CPU.
 */
import * as fs from "fs";
import * as path from "path";
import type { Card, HeartsState, PassDirection } from "../../types";
import { card } from "./conservativeFixtures";

export const RULEBOOK_PATH = path.resolve(
  __dirname,
  "../../../../../../docs/hearts/CONSERVATIVE_AI.md"
);

type Value = string | number | boolean | Value[] | { [k: string]: Value };

/** Parses one flow value (scalar, `[..]`, `{..}`, or "quoted") starting at `s[start]`. */
function parseFlow(s: string, start: number): [Value, number] {
  let i = start;
  const ws = () => {
    while (s[i] === " ") i++;
  };
  ws();
  const ch = s[i];
  if (ch === "[") {
    i++;
    const out: Value[] = [];
    ws();
    if (s[i] === "]") return [out, i + 1];
    for (;;) {
      const [v, j] = parseFlow(s, i);
      out.push(v);
      i = j;
      ws();
      if (s[i] === ",") i++;
      else if (s[i] === "]") return [out, i + 1];
      else throw new Error(`expected , or ] at ${i} in: ${s}`);
    }
  }
  if (ch === "{") {
    i++;
    const out: { [k: string]: Value } = {};
    for (;;) {
      ws();
      const m = /^[a-z_]+/.exec(s.slice(i));
      if (!m || s[i + m[0].length] !== ":") throw new Error(`bad map key at ${i} in: ${s}`);
      i += m[0].length + 1;
      const [v, j] = parseFlow(s, i);
      if (m[0] in out) throw new Error(`duplicate key ${m[0]} in mapping: ${s}`);
      out[m[0]] = v;
      i = j;
      ws();
      if (s[i] === ",") i++;
      else if (s[i] === "}") return [out, i + 1];
      else throw new Error(`expected , or } at ${i} in: ${s}`);
    }
  }
  if (ch === '"') {
    let out = "";
    i++;
    while (s[i] !== '"') {
      if (i >= s.length) throw new Error(`unterminated string in: ${s}`);
      if (s[i] === "\\") i++;
      out += s[i++];
    }
    return [out, i + 1];
  }
  let j = i;
  while (j < s.length && !",]}".includes(s[j]!)) j++;
  const raw = s.slice(i, j).trim();
  if (raw === "") throw new Error(`empty scalar at ${i} in: ${s}`);
  if (/^-?\d+$/.test(raw)) return [Number(raw), j];
  if (raw === "true" || raw === "false") return [raw === "true", j];
  return [raw, j];
}

function parseValue(s: string): Value {
  const [v, end] = parseFlow(s, 0);
  if (s.slice(end).trim() !== "") throw new Error(`trailing text after value: ${s}`);
  return v;
}

/** A block is top-level `key: value` lines; `key:` alone is followed by `  - value` items. */
export function parseBlock(text: string): Record<string, Value> {
  const out: Record<string, Value> = {};
  let listKey: string | null = null;
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    const item = /^ {2}- (.*)$/.exec(line);
    if (item) {
      if (listKey === null) throw new Error(`list item outside a list: ${line}`);
      (out[listKey] as Value[]).push(parseValue(item[1]!));
      continue;
    }
    const kv = /^([a-z_]+):(?: (.*))?$/.exec(line);
    if (!kv) throw new Error(`unparseable line: ${line}`);
    const [, key, rest] = kv;
    if (key! in out) throw new Error(`duplicate key ${key}`);
    if (rest === undefined || rest === "") {
      out[key!] = [];
      listKey = key!;
    } else {
      out[key!] = parseValue(rest);
      listKey = null;
    }
  }
  return out;
}

export interface RulebookPosition {
  readonly id: string;
  readonly decision: "pass" | "lead" | "follow" | "discard";
  readonly seat: number;
  readonly trickNumber: number;
  readonly hand: readonly string[];
  readonly played: readonly { lead: number; cards: readonly string[] }[];
  readonly trick: readonly { seat: number; card: string }[];
  readonly heartsBroken: boolean;
  readonly queenPlayed: boolean;
  readonly points: readonly number[];
  readonly passDirection?: PassDirection;
  readonly expected: readonly string[];
  readonly principle: string;
  readonly reason: string;
}

const KEYS = [
  "id",
  "decision",
  "seat",
  "trick_number",
  "hand",
  "played",
  "trick",
  "hearts_broken",
  "queen_played",
  "points",
  "pass_direction",
  "expected",
  "principle",
  "reason",
];
const CARD = /^(10|[2-9JQKA])[CDSH]$/;
const DIRECTIONS = ["left", "right", "across", "none"];

function str(v: Value, what: string): string {
  if (typeof v !== "string") throw new Error(`${what} must be a string`);
  return v;
}
function int(v: Value, what: string): number {
  if (typeof v !== "number") throw new Error(`${what} must be an integer`);
  return v;
}
function bool(v: Value, what: string): boolean {
  if (typeof v !== "boolean") throw new Error(`${what} must be a boolean`);
  return v;
}
function list(v: Value, what: string): Value[] {
  if (!Array.isArray(v)) throw new Error(`${what} must be a list`);
  return v;
}
function cardName(v: Value, what: string): string {
  const s = str(v, what);
  if (!CARD.test(s)) throw new Error(`${what}: bad card "${s}"`);
  return s;
}
function map(v: Value, what: string, keys: readonly string[]): { [k: string]: Value } {
  if (typeof v !== "object" || Array.isArray(v)) throw new Error(`${what} must be a map`);
  const got = Object.keys(v).sort().join(",");
  if (got !== [...keys].sort().join(","))
    throw new Error(`${what} must have exactly {${keys}}, got {${got}}`);
  return v;
}

/** Validates the parsed block's shape; throws on anything the suite does not understand. */
export function toPosition(raw: Record<string, Value>): RulebookPosition {
  for (const k of Object.keys(raw)) if (!KEYS.includes(k)) throw new Error(`unknown field ${k}`);
  for (const k of KEYS) {
    if (k !== "pass_direction" && !(k in raw)) throw new Error(`missing field ${k}`);
  }
  const id = str(raw.id!, "id");
  const decision = str(raw.decision!, `${id}.decision`);
  if (!["pass", "lead", "follow", "discard"].includes(decision))
    throw new Error(`${id}: bad decision ${decision}`);
  const passDirection =
    raw.pass_direction === undefined ? undefined : str(raw.pass_direction, `${id}.pass_direction`);
  if ((decision === "pass") !== (passDirection !== undefined))
    throw new Error(`${id}: pass_direction belongs to pass positions only`);
  if (passDirection !== undefined && !DIRECTIONS.includes(passDirection))
    throw new Error(`${id}: bad pass_direction`);
  return {
    id,
    decision: decision as RulebookPosition["decision"],
    seat: int(raw.seat!, `${id}.seat`),
    trickNumber: int(raw.trick_number!, `${id}.trick_number`),
    hand: list(raw.hand!, `${id}.hand`).map((c) => cardName(c, `${id}.hand`)),
    played: list(raw.played!, `${id}.played`).map((t) => {
      const m = map(t, `${id}.played`, ["lead", "cards"]);
      return {
        lead: int(m.lead!, `${id}.played.lead`),
        cards: list(m.cards!, `${id}.played.cards`).map((c) => cardName(c, `${id}.played`)),
      };
    }),
    trick: list(raw.trick!, `${id}.trick`).map((t) => {
      const m = map(t, `${id}.trick`, ["seat", "card"]);
      return { seat: int(m.seat!, `${id}.trick.seat`), card: cardName(m.card!, `${id}.trick`) };
    }),
    heartsBroken: bool(raw.hearts_broken!, `${id}.hearts_broken`),
    queenPlayed: bool(raw.queen_played!, `${id}.queen_played`),
    points: list(raw.points!, `${id}.points`).map((p) => int(p, `${id}.points`)),
    passDirection: passDirection as PassDirection | undefined,
    expected: list(raw.expected!, `${id}.expected`).map((c) => cardName(c, `${id}.expected`)),
    principle: str(raw.principle!, `${id}.principle`),
    reason: str(raw.reason!, `${id}.reason`),
  };
}

/**
 * Every yaml block of the §5 text, parsed. Throws if the section is missing, if any fence in it is
 * not a well-formed closed ```yaml block, if the number of blocks differs from the number of `id:`
 * lines counted independently of the fences, or if any block fails to parse.
 */
export function parseRulebook(md: string): { positions: RulebookPosition[]; blocks: number } {
  const start = md.indexOf("\n## 5. Rulebook");
  if (start < 0) throw new Error("§5 Rulebook heading not found");
  const next = md.indexOf("\n## ", start + 1);
  const section = md.slice(start, next < 0 ? undefined : next);
  const blocks: string[] = [];
  let open: string[] | null = null;
  for (const line of section.split("\n")) {
    if (open === null) {
      if (line.trimStart().startsWith("```")) {
        if (line !== "```yaml") throw new Error(`§5 fence is not a plain yaml opener: ${line}`);
        open = [];
      }
    } else if (line.trimStart().startsWith("```")) {
      if (line !== "```") throw new Error(`§5 fence closer is malformed: ${line}`);
      blocks.push(open.join("\n"));
      open = null;
    } else {
      open.push(line);
    }
  }
  if (open !== null) throw new Error("§5 has an unclosed code fence");
  const ids = section.match(/^id: R\d+\s*$/gm) ?? [];
  if (ids.length !== blocks.length)
    throw new Error(`§5 has ${ids.length} id: lines but ${blocks.length} yaml blocks`);
  return { positions: blocks.map((b) => toPosition(parseBlock(b))), blocks: blocks.length };
}

export function loadRulebook(): { positions: RulebookPosition[]; blocks: number } {
  return parseRulebook(fs.readFileSync(RULEBOOK_PATH, "utf8"));
}

/** Rotates every seat number by `k` (CPU seat, history leaders, trick seats, points). */
export function rotate(p: RulebookPosition, k: number): RulebookPosition {
  const r = (s: number) => (s + k) % 4;
  const points = [0, 0, 0, 0];
  p.points.forEach((v, s) => (points[r(s)] = v));
  return {
    ...p,
    seat: r(p.seat),
    played: p.played.map((t) => ({ ...t, lead: r(t.lead) })),
    trick: p.trick.map((t) => ({ ...t, seat: r(t.seat) })),
    points,
  };
}

const rv = (c: Card): number => (c.rank === 1 ? 14 : c.rank);
const pts = (c: Card): number =>
  c.suit === "hearts" ? 1 : c.suit === "spades" && c.rank === 12 ? 13 : 0;

/** Winner seat of cards played in order from `lead`: the highest card of the led suit. */
function winnerOf(lead: number, cs: readonly Card[]): number {
  let best = 0;
  cs.forEach((c, i) => {
    if (c.suit === cs[0]!.suit && rv(c) > rv(cs[best]!)) best = i;
  });
  return (lead + best) % 4;
}

export interface Derived {
  readonly wonCards: Card[][];
  readonly points: number[];
  readonly heartsBroken: boolean;
  readonly queenPlayed: boolean;
  /** Problems found re-deriving the position from its own history (empty when consistent). */
  readonly problems: string[];
}

/** Re-derives points, hearts_broken, queen_played and leadership from the trick history. */
export function derive(p: RulebookPosition): Derived {
  const problems: string[] = [];
  const wonCards: Card[][] = [[], [], [], []];
  const points = [0, 0, 0, 0];
  let heartsBroken = false;
  let queenPlayed = false;
  // Trick 1 is led by the 2♣ holder, seat 0 in the rulebook (rotated with the position).
  let leader = p.trickNumber === 0 ? p.seat : (p.played[0]?.lead ?? p.trick[0]?.seat ?? p.seat);
  const seen = new Set<string>(p.hand);
  if (seen.size !== p.hand.length) problems.push("duplicate card in hand");
  const see = (c: string) => {
    if (seen.has(c)) problems.push(`card ${c} appears twice`);
    seen.add(c);
  };

  // Follow-suit in the replayed history: a seat that played off the led suit is void in it.
  const voidIn = new Set<string>();
  const checkFollow = (seat: number, c: Card, led: Card["suit"], where: string) => {
    if (voidIn.has(`${seat}${c.suit}`))
      problems.push(`${where}: seat ${seat} played ${c.suit} after showing void`);
    if (c.suit !== led) voidIn.add(`${seat}${led}`);
  };

  // Trick 1 opens with the 2♣ (led by the seat that holds it).
  const first = p.played[0]?.cards[0] ?? p.trick[0]?.card;
  if (p.trickNumber >= 1) {
    if (first !== undefined && first !== "2C") problems.push(`trick 1 opens with ${first}, not 2C`);
    if (first === undefined && p.trickNumber === 1 && !p.hand.includes("2C"))
      problems.push("CPU leads trick 1 without the 2C");
  }

  p.played.forEach((t, n) => {
    t.cards.forEach((cn, i) =>
      checkFollow((t.lead + i) % 4, card(cn), card(t.cards[0]!).suit, `trick ${n + 1}`)
    );
    if (t.lead !== leader) problems.push(`trick ${n + 1} led by ${t.lead}, expected ${leader}`);
    if (t.cards.length !== 4) problems.push(`trick ${n + 1} has ${t.cards.length} cards`);
    const cs = t.cards.map(card);
    t.cards.forEach(see);
    const w = winnerOf(t.lead, cs);
    wonCards[w]!.push(...cs);
    for (const c of cs) {
      points[w]! += pts(c);
      if (c.suit === "hearts") heartsBroken = true;
      if (pts(c) === 13) queenPlayed = true;
    }
    leader = w;
  });

  p.trick.forEach((t, i) => {
    see(t.card);
    const c = card(t.card);
    checkFollow(t.seat, c, card(p.trick[0]!.card).suit, "current trick");
    if (c.suit === "hearts") heartsBroken = true;
    if (pts(c) === 13) queenPlayed = true;
    if (t.seat !== (leader + i) % 4) problems.push(`trick card ${i} from seat ${t.seat}`);
  });
  if (p.trickNumber > 0 && p.seat !== (leader + p.trick.length) % 4)
    problems.push(`seat ${p.seat} is not the next to play`);
  for (const h of p.hand)
    if (voidIn.has(`${p.seat}${card(h).suit}`)) problems.push(`CPU holds ${h} after showing void`);
  if (p.decision !== "pass") {
    const led = p.trick[0] ? card(p.trick[0].card).suit : undefined;
    const holdsLed = led !== undefined && p.hand.some((h) => card(h).suit === led);
    const actual = led === undefined ? "lead" : holdsLed ? "follow" : "discard";
    if (p.decision !== actual) problems.push(`labelled ${p.decision} but the state is ${actual}`);
  }
  const expectedHand = p.trickNumber === 0 ? 13 : 14 - p.trickNumber;
  if (p.hand.length !== expectedHand) problems.push(`hand has ${p.hand.length} cards`);
  if (p.played.length !== Math.max(p.trickNumber - 1, 0))
    problems.push(`played has ${p.played.length} tricks for trick ${p.trickNumber}`);
  return { wonCards, points, heartsBroken, queenPlayed, problems };
}

/** The engine state a position describes (only the CPU seat's hand is known). */
export function buildState(p: RulebookPosition, hand: readonly Card[]): HeartsState {
  const d = derive(p);
  const playerHands: Card[][] = [[], [], [], []];
  playerHands[p.seat] = [...hand];
  const trick = p.trick.map((t) => ({ card: card(t.card), playerIndex: t.seat }));
  return {
    _v: 3,
    aiDifficulty: "conservative",
    phase: "playing",
    handNumber: 1,
    passDirection: "left",
    playerHands,
    cumulativeScores: [0, 0, 0, 0],
    handScores: d.points,
    scoreHistory: [],
    passSelections: [[], [], [], []],
    passingComplete: true,
    currentTrick: trick,
    currentLeaderIndex: trick[0]?.playerIndex ?? p.seat,
    currentPlayerIndex: p.seat,
    wonCards: d.wonCards,
    heartsBroken: d.heartsBroken,
    tricksPlayedInHand: Math.max(p.trickNumber - 1, 0),
    isComplete: false,
    winnerIndex: null,
  };
}

/** Deterministic PRNG (mulberry32) so shuffles are reproducible without touching Math.random. */
export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Ascending, descending (by suit then rank) and three seeded shuffles of the hand. */
export function handOrderings(hand: readonly Card[]): { label: string; hand: Card[] }[] {
  const key = (c: Card) => ["clubs", "diamonds", "spades", "hearts"].indexOf(c.suit) * 20 + rv(c);
  const asc = [...hand].sort((a, b) => key(a) - key(b));
  return [
    { label: "ascending", hand: asc },
    { label: "descending", hand: [...asc].reverse() },
    ...[11, 22, 33].map((s) => ({ label: `shuffle ${s}`, hand: seededShuffle(hand, s) })),
  ];
}
