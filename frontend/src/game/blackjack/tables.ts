import { RunRecord } from "./storage";

export interface TableConfig {
  readonly id: "beginner" | "intermediate" | "high_roller";
  readonly labelKey: string;
  readonly startingChips: number;
  readonly runGoal: number;
  readonly betMin: number;
  readonly betMax: number;
  readonly chipDenominations: readonly number[];
}

export const TABLE_CONFIGS: readonly TableConfig[] = [
  {
    id: "beginner",
    labelKey: "table.beginner",
    startingChips: 100,
    runGoal: 250,
    betMin: 5,
    betMax: 25,
    chipDenominations: [5, 10, 25],
  },
  {
    id: "intermediate",
    labelKey: "table.intermediate",
    startingChips: 250,
    runGoal: 750,
    betMin: 10,
    betMax: 50,
    chipDenominations: [10, 25, 50],
  },
  {
    id: "high_roller",
    labelKey: "table.highRoller",
    startingChips: 500,
    runGoal: 1500,
    betMin: 25,
    betMax: 200,
    chipDenominations: [25, 50, 100, 200],
  },
] as const;

/** Returns true if the table at tableIndex has been unlocked. */
export function isTableUnlocked(tableIndex: number, runs: RunRecord[]): boolean {
  if (tableIndex === 0) return true;
  const prev = TABLE_CONFIGS[tableIndex - 1];
  return prev !== undefined && runs.some((r) => r.table === prev.id && r.completed);
}
