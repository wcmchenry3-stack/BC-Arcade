import { rankLabel } from "../_shared/decks/cardId";
import type { Card, PassDirection, TrickCard } from "./types";

const SUIT_EMOJI: Record<string, string> = {
  spades: "♠",
  hearts: "♥",
  diamonds: "♦",
  clubs: "♣",
};

export interface DebugTrick {
  readonly plays: readonly TrickCard[];
  readonly winnerIndex: number;
  readonly pointsWon: number;
}

export interface HandDebugLog {
  readonly handNumber: number;
  readonly passDirection: PassDirection;
  readonly initialHands: readonly (readonly Card[])[];
  readonly passSelections: readonly (readonly Card[])[];
  readonly finalHands: readonly (readonly Card[])[];
  readonly tricks: readonly DebugTrick[];
  readonly scoreDeltas: readonly number[];
  readonly cumulativeScoresAfter: readonly number[];
}

export function cardStr(card: Card): string {
  return `${rankLabel(card.rank)}${SUIT_EMOJI[card.suit] ?? card.suit}`;
}

function handStr(cards: readonly Card[]): string {
  return cards.length > 0 ? cards.map(cardStr).join(" ") : "—";
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

export function passOffset(dir: PassDirection): number {
  if (dir === "left") return 1;
  if (dir === "right") return 3;
  if (dir === "across") return 2;
  return 0;
}

export function formatSessionAsMarkdown(
  logs: readonly HandDebugLog[],
  notes: readonly string[],
  playerLabels: readonly string[],
  aiDifficulty: string
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
    const colLabels = [0, 1, 2, 3].map(label);
    lines.push(`| # | ${colLabels.join(" | ")} | Winner | Pts |`);
    lines.push(`|---|${colLabels.map(() => "---").join("|")}|--------|-----|`);
    for (let t = 0; t < log.tricks.length; t++) {
      const trick = log.tricks[t]!;
      const cellByPlayer: string[] = ["—", "—", "—", "—"];
      for (const play of trick.plays) {
        const s = cardStr(play.card);
        cellByPlayer[play.playerIndex] = play.playerIndex === trick.winnerIndex ? `**${s}**` : s;
      }
      lines.push(
        `| ${t + 1} | ${cellByPlayer.join(" | ")} | ${label(trick.winnerIndex)} | ${trick.pointsWon} |`
      );
    }

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

  return lines.join("\n");
}
