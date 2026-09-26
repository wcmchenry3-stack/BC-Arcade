/**
 * How a stored game outcome is shown in the player's history (#2637): the
 * Profile's recent games and the game detail screen share this, so the two
 * never disagree. `GameOutcome` (vocab.ts) is the source; the exhaustive
 * switch makes a new outcome a compile error here until it has a glyph and a
 * label.
 *
 * Also formats a board metric with its label ("412 pts", "87 moves",
 * "Level 19") for the per-game bests and the recent-game rows.
 */

import type { ComponentProps } from "react";
import type MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import type { TFunction } from "i18next";
import type { Colors } from "../theme/ThemeContext";
import type { GameRow } from "./types";
import { BOARDS, GAME_OUTCOMES, type GameOutcome } from "./vocab";

type IconName = ComponentProps<typeof MaterialCommunityIcons>["name"];

export interface OutcomeDisplay {
  /** MaterialCommunityIcons glyph. Decorative: always shown with the label. */
  readonly icon: IconName;
  /** Theme colour for the glyph (the result card's outcome tokens). */
  readonly color: keyof Pick<
    Colors,
    "outcomeWin" | "outcomeLoss" | "outcomeDraw" | "outcomeEnded" | "textMuted"
  >;
  /** Key of the localised label, in the "stats" namespace. */
  readonly labelKey: string;
}

export function outcomeDisplay(outcome: GameOutcome): OutcomeDisplay {
  switch (outcome) {
    case "win":
      return { icon: "trophy-outline", color: "outcomeWin", labelKey: "outcome.win" };
    case "loss":
      return {
        icon: "minus-circle-outline",
        color: "outcomeLoss",
        labelKey: "outcome.loss",
      };
    case "push":
      return { icon: "equal", color: "outcomeDraw", labelKey: "outcome.push" };
    case "completed":
      return {
        icon: "check-circle-outline",
        color: "outcomeEnded",
        labelKey: "outcome.completed",
      };
    case "kept_playing":
      return {
        icon: "play-circle-outline",
        color: "outcomeEnded",
        labelKey: "outcome.kept_playing",
      };
    case "abandoned":
      // Muted, not an error colour: leaving a game carries no penalty (PRODUCT.md).
      return {
        icon: "exit-to-app",
        color: "textMuted",
        labelKey: "outcome.abandoned",
      };
    default: {
      const unhandled: never = outcome;
      throw new Error(`No display for game outcome ${String(unhandled)}`);
    }
  }
}

/** The localised outcome, or "—" for a game with no outcome yet (or one this build doesn't know). */
export function outcomeLabel(t: TFunction, outcome: string | null): string {
  const display = knownOutcome(outcome);
  return display ? t(`stats:${display.labelKey}`) : "—";
}

/** `outcomeDisplay` for an outcome string from the server; null when absent or unknown. */
export function knownOutcome(outcome: string | null): OutcomeDisplay | null {
  // A newer server's outcome shows no glyph rather than crashing the list.
  if (outcome == null || !(GAME_OUTCOMES as readonly string[]).includes(outcome)) return null;
  return outcomeDisplay(outcome as GameOutcome);
}

/** Board label keys with a "stats:metric.*" string. Others show the bare number. */
const METRIC_LABEL_KEYS = new Set(["score", "moves", "level", "guesses", "chips"]);

/**
 * `value` with its label, e.g. "412 pts", "87 moves", "Level 19"; "—" when
 * there is no value. `labelKey` is the board's (`best_label_key`,
 * `BoardDefinition.labelKey`).
 */
export function formatMetric(
  t: TFunction,
  labelKey: string | null | undefined,
  value: number | null | undefined
): string {
  if (value == null) return "—";
  const formatted = value.toLocaleString();
  if (labelKey == null || !METRIC_LABEL_KEYS.has(labelKey)) return formatted;
  return t(`stats:metric.${labelKey}`, { count: value, value: formatted });
}

/**
 * One finished game's value of its board metric: `final_score`, or the
 * metadata key the board ranks by (Sort's `level_reached`, Daily Word's
 * `guesses_used`). Null when the game doesn't carry it.
 */
export function gameMetric(game: Pick<GameRow, "game_type" | "final_score" | "metadata">): {
  value: number | null;
  labelKey: string;
} {
  const board = BOARDS[game.game_type] ?? null;
  if (board == null || board.metric === "final_score") {
    return { value: game.final_score, labelKey: board?.labelKey ?? "score" };
  }
  const raw = game.metadata?.[board.metric];
  return {
    value: typeof raw === "number" && Number.isFinite(raw) ? raw : null,
    labelKey: board.labelKey,
  };
}
