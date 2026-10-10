import { rankLabel } from "../_shared/decks/cardId";
import { passOffset as enginePassOffset } from "./types";
import type { Card, PassDirection, TrickCard } from "./types";

const SUIT_EMOJI: Record<string, string> = {
  spades: "♠",
  hearts: "♥",
  diamonds: "♦",
  clubs: "♣",
};

/** The position a CPU play was chosen from: enough to rebuild a rulebook entry (#3163). */
export interface DebugPosition {
  /** 1–13. */
  readonly trickNumber: number;
  /** The CPU's hand before the play. */
  readonly hand: readonly Card[];
  /** The current trick before the play, in play order. */
  readonly trickSoFar: readonly TrickCard[];
  readonly heartsBroken: boolean;
  /** Points taken this hand per seat, from completed tricks only. */
  readonly points: readonly number[];
}

/**
 * A play in a logged trick. `principle`, `reason` and `position` are present
 * only for conservative-CPU plays; human plays, legacy personas and logs from
 * before #3163 omit them.
 */
export interface DebugPlay extends TrickCard {
  readonly principle?: string | null;
  readonly reason?: string;
  readonly position?: DebugPosition;
}

/** A CPU pass card with the principle that listed it (#3163). */
export interface DebugPassCard {
  readonly card: Card;
  readonly principle: string | null;
  readonly reason: string;
}

export interface DebugTrick {
  readonly plays: readonly DebugPlay[];
  readonly winnerIndex: number;
  readonly pointsWon: number;
}

export interface HandDebugLog {
  readonly handNumber: number;
  readonly passDirection: PassDirection;
  readonly initialHands: readonly (readonly Card[])[];
  readonly passSelections: readonly (readonly Card[])[];
  /** Per-seat principle for each CPU pass card; absent in older logs. */
  readonly passDecisions?: readonly (readonly DebugPassCard[])[];
  readonly finalHands: readonly (readonly Card[])[];
  readonly tricks: readonly DebugTrick[];
  readonly scoreDeltas: readonly number[];
  readonly cumulativeScoresAfter: readonly number[];
}

/** The in-progress hand's CPU decisions, for the debug panel while a hand is being played (#3163). */
export interface LiveDecisions {
  readonly handNumber: number;
  readonly tricks: readonly DebugTrick[];
  /** Plays in the trick being played now, in play order. */
  readonly pending: readonly DebugPlay[];
}

export function cardStr(card: Card): string {
  return `${rankLabel(card.rank)}${SUIT_EMOJI[card.suit] ?? card.suit}`;
}

function handStr(cards: readonly Card[]): string {
  return cards.length > 0 ? cards.map(cardStr).join(" ") : "—";
}

const RULEBOOK_SUIT: Record<string, string> = {
  clubs: "C",
  diamonds: "D",
  spades: "S",
  hearts: "H",
};

/** A card in the rulebook's notation: rank + suit letter ("10C", "QS"). */
export function rulebookCard(card: Card): string {
  return `${rankLabel(card.rank)}${RULEBOOK_SUIT[card.suit] ?? card.suit}`;
}

const rbList = (cards: readonly Card[]) => `[${cards.map(rulebookCard).join(", ")}]`;
const isQueenSpades = (c: Card) => c.suit === "spades" && c.rank === 12;

/** A CPU play in a hand's log, with the index of its trick. */
export interface CpuDecision {
  readonly trickIndex: number;
  readonly play: DebugPlay;
}

/** Every conservative-CPU play in the hand, in play order. Older logs yield none. */
export function cpuDecisions(log: HandDebugLog): CpuDecision[] {
  const out: CpuDecision[] = [];
  log.tricks.forEach((trick, trickIndex) => {
    for (const play of trick.plays) {
      if (play.principle !== undefined) out.push({ trickIndex, play });
    }
  });
  return out;
}

/**
 * True when the log holds the whole history behind a recorded position: every
 * earlier trick, in full. A game resumed mid-hand starts with an empty trick
 * buffer, so its positions are incomplete and would rebuild a wrong rulebook entry.
 */
export function isPositionComplete(log: HandDebugLog, d: CpuDecision): boolean {
  const pos = d.play.position;
  if (!pos || pos.trickNumber !== d.trickIndex + 1) return false;
  return log.tricks.slice(0, d.trickIndex).every((t) => t.plays.length === 4);
}

/**
 * One CPU play as a CONSERVATIVE_AI.md §5 rulebook block (yaml), so a
 * suspicious play can be pasted straight into an issue or the rulebook.
 * Returns null when the play has no recorded position (older logs).
 */
export function formatPlayAsRulebookYaml(log: HandDebugLog, d: CpuDecision): string | null {
  const pos = d.play.position;
  if (!pos || !isPositionComplete(log, d)) return null;
  const seat = d.play.playerIndex;
  const led = pos.trickSoFar[0]?.card.suit;
  const decision =
    led === undefined ? "lead" : pos.hand.some((c) => c.suit === led) ? "follow" : "discard";
  const history = log.tricks.slice(0, d.trickIndex);
  const queenPlayed =
    history.some((t) => t.plays.some((p) => isQueenSpades(p.card))) ||
    pos.trickSoFar.some((p) => isQueenSpades(p.card));
  const lines = [
    `id: DBG-h${log.handNumber}-t${pos.trickNumber}-s${seat}`,
    `decision: ${decision}`,
    `seat: ${seat}`,
    `trick_number: ${pos.trickNumber}`,
    `hand: ${rbList(pos.hand)}`,
  ];
  if (history.length === 0) {
    lines.push("played: []");
  } else {
    lines.push("played:");
    for (const t of history) {
      const cards = rbList(t.plays.map((p) => p.card));
      lines.push(`  - { lead: ${t.plays[0]?.playerIndex ?? 0}, cards: ${cards} }`);
    }
  }
  const trick = pos.trickSoFar
    .map((p) => `{ seat: ${p.playerIndex}, card: ${rulebookCard(p.card)} }`)
    .join(", ");
  lines.push(
    `trick: [${trick}]`,
    `hearts_broken: ${pos.heartsBroken}`,
    `queen_played: ${queenPlayed}`,
    `points: [${pos.points.join(", ")}]`,
    `expected: [${rulebookCard(d.play.card)}]`,
    `principle: ${d.play.principle ?? "null"}`,
    `reason: ${JSON.stringify(d.play.reason ?? "")}`
  );
  return lines.join("\n");
}

/** A CPU seat's pass as a rulebook block (`decision: pass`); null for a human or legacy seat. */
export function formatPassAsRulebookYaml(log: HandDebugLog, seat: number): string | null {
  const decisions = log.passDecisions?.[seat];
  if (!decisions || decisions.length === 0 || decisions.every((p) => p.principle === null)) {
    return null;
  }
  const reason = decisions
    .map((p) => `${rulebookCard(p.card)} ${p.principle ?? "-"}: ${p.reason}`)
    .join(" ");
  return [
    `id: DBG-h${log.handNumber}-pass-s${seat}`,
    "decision: pass",
    `seat: ${seat}`,
    "trick_number: 0",
    `hand: ${rbList(log.initialHands[seat] ?? [])}`,
    "played: []",
    "trick: []",
    "hearts_broken: false",
    "queen_played: false",
    "points: [0, 0, 0, 0]",
    `pass_direction: ${log.passDirection}`,
    `expected: ${rbList(decisions.map((p) => p.card))}`,
    "principle: P8-PASS",
    `reason: ${JSON.stringify(reason)}`,
  ].join("\n");
}

export function passDirectionLabel(dir: PassDirection): string {
  const map: Record<PassDirection, string> = {
    left: "Pass Left",
    right: "Pass Right",
    across: "Pass Across",
    none: "No Pass",
  };
  return map[dir];
}

/**
 * Debug-log-friendly variant of types.ts's passOffset: same direction→seat
 * mapping (single source of truth), but returns 0 (not null) for "none" since
 * every caller here already displays behind a `passDirection !== "none"` guard.
 */
export function passOffset(dir: PassDirection): number {
  return enginePassOffset(dir) ?? 0;
}

/**
 * The "CPU decisions" section of a hand: the pass blocks (when `withPass`) and
 * one rulebook yaml block per CPU play. A play whose earlier tricks were not
 * logged (a game resumed mid-hand) gets a one-line note, not an inconsistent block.
 */
function cpuDecisionLines(
  log: HandDebugLog,
  label: (i: number) => string,
  withPass: boolean
): string[] {
  const blocks: string[] = [];
  const notes: string[] = [];
  for (let seat = 0; withPass && seat < 4; seat++) {
    const y = formatPassAsRulebookYaml(log, seat);
    if (y) blocks.push(y);
  }
  for (const d of cpuDecisions(log)) {
    const y = formatPlayAsRulebookYaml(log, d);
    if (y) blocks.push(y);
    else if (d.play.position) {
      notes.push(
        `- T${d.trickIndex + 1} ${label(d.play.playerIndex)} ${cardStr(d.play.card)} ` +
          `${d.play.principle ?? "forced"}: position incomplete (resumed mid-hand)`
      );
    }
  }
  if (blocks.length === 0 && notes.length === 0) return [];
  const out = ["", "### CPU decisions (rulebook format, docs/hearts/CONSERVATIVE_AI.md §5)"];
  for (const y of blocks) out.push("", "```yaml", y, "```");
  if (notes.length > 0) out.push("", ...notes);
  return out;
}

/** The in-progress hand as Markdown for the copy export, labelled as such. */
function liveHandLines(live: LiveDecisions, label: (i: number) => string): string[] {
  const tricks: DebugTrick[] = [...live.tricks];
  if (live.pending.length > 0) tricks.push({ plays: live.pending, winnerIndex: -1, pointsWon: 0 });
  const log: HandDebugLog = {
    handNumber: live.handNumber,
    passDirection: "none",
    initialHands: [],
    passSelections: [],
    finalHands: [],
    tricks,
    scoreDeltas: [],
    cumulativeScoresAfter: [],
  };
  const decisions = cpuDecisions(log);
  if (decisions.length === 0) return [];
  const out = ["", "---", "", `## Hand ${live.handNumber} — in progress`, "", "### CPU plays"];
  for (const d of decisions) {
    out.push(
      `- T${d.trickIndex + 1} ${label(d.play.playerIndex)} ${cardStr(d.play.card)} ` +
        `${d.play.principle ?? "forced"}${d.play.reason ? ` — ${d.play.reason}` : ""}`
    );
  }
  out.push(...cpuDecisionLines(log, label, false));
  return out;
}

export function formatSessionAsMarkdown(
  logs: readonly HandDebugLog[],
  notes: readonly string[],
  playerLabels: readonly string[],
  aiDifficulty: string,
  live: LiveDecisions | null = null
): string {
  const label = (i: number) => playerLabels[i] ?? `P${i}`;
  const lines: string[] = [];

  lines.push(
    `# Hearts Debug Session — ${logs.length} hand${logs.length !== 1 ? "s" : ""} — Difficulty: ${aiDifficulty}`
  );
  lines.push("");
  lines.push(`Players: ${[0, 1, 2, 3].map((i) => `${label(i)} (P${i})`).join(", ")}`);

  for (let h = 0; h < logs.length; h++) {
    const log = logs[h]!;
    const note = notes[h] ?? "";

    lines.push("");
    lines.push("---");
    lines.push("");
    lines.push(`## Hand ${log.handNumber} — ${passDirectionLabel(log.passDirection)}`);
    lines.push("");

    lines.push("### Initial Deals");
    for (let i = 0; i < 4; i++) {
      lines.push(`- **${label(i)}**: ${handStr(log.initialHands[i] ?? [])}`);
    }

    if (log.passDirection !== "none") {
      lines.push("");
      lines.push(`### Pass Selections (${passDirectionLabel(log.passDirection)})`);
      const offset = passOffset(log.passDirection);
      for (let from = 0; from < 4; from++) {
        const to = (from + offset) % 4;
        const sel = log.passSelections[from] ?? [];
        lines.push(`- ${label(from)} → ${label(to)}: ${handStr(sel)}`);
      }

      lines.push("");
      lines.push("### Final Hands (after pass)");
      for (let i = 0; i < 4; i++) {
        lines.push(`- **${label(i)}**: ${handStr(log.finalHands[i] ?? [])}`);
      }
    }

    lines.push("");
    lines.push("### Tricks");
    for (let t = 0; t < log.tricks.length; t++) {
      const trick = log.tricks[t]!;
      const plays = trick.plays
        .map((play) => {
          const s = cardStr(play.card);
          const cell = play.playerIndex === trick.winnerIndex ? `**${s}**` : s;
          const tag = play.principle
            ? ` (${play.principle})`
            : play.principle === null
              ? " (forced)"
              : "";
          return `${label(play.playerIndex)}:${cell}${tag}`;
        })
        .join("  ");
      const pts = trick.pointsWon > 0 ? ` +${trick.pointsWon}` : "";
      lines.push(`T${t + 1} ${plays}  → ${label(trick.winnerIndex)}${pts}`);
    }

    lines.push(...cpuDecisionLines(log, label, true));

    lines.push("");
    const deltaStr = [0, 1, 2, 3].map((i) => `${label(i)} +${log.scoreDeltas[i] ?? 0}`).join(", ");
    const runningStr = [0, 1, 2, 3]
      .map((i) => `${label(i)} ${log.cumulativeScoresAfter[i] ?? 0}`)
      .join(", ");
    lines.push(`### Scores: ${deltaStr}`);
    lines.push(`### Running: ${runningStr}`);

    if (note.trim()) {
      lines.push("");
      lines.push(`> Note: ${note.trim()}`);
    }
  }

  if (live) lines.push(...liveHandLines(live, label));

  return lines.join("\n");
}
