/**
 * The partition picker's data for the leaderboard screen (#2633): which
 * boards a partitioned game has, which one to start on, and their labels.
 *
 * The keys come from the game's board (`BOARDS[gameType].partitions`). The
 * values come from the board when it lists them (`partitionValues`, e.g. Star
 * Swarm's ten tiers), else from the game's own constants below (Sudoku's
 * difficulties and variants), else from the per-partition caps.
 */

import type { TFunction } from "i18next";
import type { BoardDefinition, GameType } from "../../api/vocab";
import { DIFFICULTIES, VARIANTS } from "../../game/sudoku/types";
import { difficultyLabel } from "../../game/starswarm/engine";
import type { DifficultyTier } from "../../game/starswarm/types";

export type Partition = Readonly<Record<string, string>>;

interface PartitionMeta {
  /** Values in display order, when the board doesn't list them. */
  values?: readonly string[];
  /** The picker's label for the key. */
  groupLabel: (t: TFunction) => string;
  /** A chip's label. */
  valueLabel: (t: TFunction, value: string) => string;
}

const PARTITION_META: Partial<Record<GameType, Readonly<Record<string, PartitionMeta>>>> = {
  sudoku: {
    difficulty: {
      values: DIFFICULTIES,
      groupLabel: (t) => t("sudoku:difficulty.groupLabel"),
      valueLabel: (t, v) => t(`sudoku:difficulty.${v}`, { defaultValue: v }),
    },
    variant: {
      values: VARIANTS,
      groupLabel: (t) => t("sudoku:variant.groupLabel"),
      valueLabel: (t, v) => t(`sudoku:variant.${v}`, { defaultValue: v }),
    },
  },
  starswarm: {
    difficulty_tier: {
      groupLabel: (t) => t("leaderboard:partition.tier"),
      // The tier names are the game's own and are not translated in-game either.
      valueLabel: (_t, v) => difficultyLabel(v as DifficultyTier) ?? v,
    },
  },
};

/** The values `key` can take on `gameType`'s board, in display order. */
export function partitionChoices(
  gameType: GameType,
  board: BoardDefinition,
  key: string
): readonly string[] {
  return (
    board.partitionValues[key] ??
    PARTITION_META[gameType]?.[key]?.values ??
    Object.keys(board.partitionMaxValues[key] ?? {})
  );
}

/**
 * The board to open: each key takes the requested value when it is one of
 * its choices, else the board's default, else its first choice.
 */
export function initialPartition(
  gameType: GameType,
  board: BoardDefinition,
  requested: Partition = {}
): Partition {
  const out: Record<string, string> = {};
  for (const key of board.partitions) {
    const choices = partitionChoices(gameType, board, key);
    const wanted = requested[key];
    const fallback = board.partitionDefaults[key];
    if (wanted !== undefined && choices.includes(wanted)) out[key] = wanted;
    else if (fallback !== undefined) out[key] = fallback;
    else if (choices[0] !== undefined) out[key] = choices[0];
  }
  return out;
}

export function partitionGroupLabel(t: TFunction, gameType: GameType, key: string): string {
  return PARTITION_META[gameType]?.[key]?.groupLabel(t) ?? key;
}

export function partitionValueLabel(
  t: TFunction,
  gameType: GameType,
  key: string,
  value: string
): string {
  return PARTITION_META[gameType]?.[key]?.valueLabel(t, value) ?? value;
}
