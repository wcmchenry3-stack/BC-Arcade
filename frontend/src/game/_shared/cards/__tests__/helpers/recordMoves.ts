/**
 * Test helper (#3289): the screens' recording wiring over a fake sink. A move
 * log feeds `recordChunk` into a real `GameRecorder`, whose saves land in
 * `saved`; no idle task runs on its own (`tasks` holds them), so an event is
 * saved by `flush`, `endSession` or `runIdle`.
 */

import type { EnqueueEventInput } from "../../../gameEventClient";
import { GameRecorder, type RecordingDropReport } from "../../../gameRecorder";
import { createMoveLog, recordChunk, type Action, type MoveLog } from "../../moveLog";

export type CardGame = "solitaire" | "freecell";

export interface Wired {
  readonly recorder: GameRecorder<CardGame>;
  readonly log: MoveLog;
  /** Every event the sink took, in order. */
  readonly saved: EnqueueEventInput[];
  readonly enqueueMany: jest.Mock;
  readonly canAccept: jest.Mock;
  readonly report: jest.Mock;
  /** Idle tasks the recorder scheduled and has not run. */
  readonly tasks: (() => void)[];
  /** Runs the scheduled idle tasks. */
  runIdle(): void;
}

export interface WireOptions {
  readonly enabled?: boolean;
  /** `canAccept()`: whether a game session is open. */
  readonly open?: boolean;
  /** The count the game's save carried (a resumed game). */
  readonly start?: number;
}

export function wire(gameType: CardGame, options: WireOptions = {}): Wired {
  const saved: EnqueueEventInput[] = [];
  const tasks: (() => void)[] = [];
  const enqueueMany = jest.fn((events: readonly EnqueueEventInput[]) => {
    saved.push(...events);
    return true;
  });
  const canAccept = jest.fn(() => options.open !== false);
  const report = jest.fn((_report: RecordingDropReport) => undefined);
  const recorder = new GameRecorder<CardGame>({
    gameType,
    sink: { canAccept, enqueueMany },
    schedule: (task) => tasks.push(task),
    report,
    enabled: () => options.enabled !== false,
  });
  const log = createMoveLog((actions, first) =>
    recordChunk(
      {
        beginUnit: (n) => recorder.beginUnit(n),
        record: (type, data) => recorder.record(type, data),
        closeUnit: () => recorder.closeUnit(),
      },
      actions,
      first
    )
  );
  log.reset(options.start ?? 0);
  return {
    recorder,
    log,
    saved,
    enqueueMany,
    canAccept,
    report,
    tasks,
    runIdle() {
      while (tasks.length > 0) tasks.shift()?.();
    },
  };
}

/** Records `actions` as the screen does, then ends the session: every event the game saved. */
export function recordMoves(
  gameType: CardGame,
  actions: readonly Action[],
  options: WireOptions = {}
): Wired {
  const wired = wire(gameType, options);
  wired.recorder.startSession();
  for (const action of actions) wired.log.push(action);
  wired.log.flush();
  wired.recorder.endSession();
  return wired;
}

/** The `moves` events among `saved`, as `{ s, m, unit }`. */
export function movesOf(
  saved: readonly EnqueueEventInput[]
): { s: number; m: number[][]; unit: number; part?: number; parts?: number }[] {
  return saved
    .filter((e) => e.type === "moves")
    .map(
      (e) => e.data as { s: number; m: number[][]; unit: number; part?: number; parts?: number }
    );
}
