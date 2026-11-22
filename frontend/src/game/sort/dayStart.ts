/**
 * Sort's day-start best (#4028): the highest level solved before the local day began,
 * which the Daily Challenge's "solve N new levels" goal counts from. The server reads
 * it from the synced rows (`service.day_start_bests`); offline, the device needs its own.
 *
 * Sort's saves keep only the current standing (the best moves per level, so the highest
 * solved level), not when each level was first solved. So the day's first solve records
 * the standing before it: no level was solved earlier that day, so that standing is the
 * day-start best. One write of about 30 B (`{"day":"YYYY-MM-DD","best":N}`, 29-31 B) per day
 * Sort is played, on the solve event (never on the frame path), and at most one read per
 * app run per day. Any failure is reported (subsystem `sort.storage`) and leaves the
 * offline check without a baseline, which then never marks the goal done: the next
 * `/status` does.
 */
import { createJsonSlot } from "../_shared/storageSlot";

export interface SortDayStart {
  /** The local day (`YYYY-MM-DD`) this standing was taken at the start of. */
  readonly day: string;
  /** The highest level solved before that day, 0 for none. */
  readonly best: number;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function isDayStart(p: unknown): p is SortDayStart {
  if (p === null || typeof p !== "object") return false;
  const { day, best } = p as Partial<SortDayStart>;
  return (
    typeof day === "string" &&
    DAY_RE.test(day) &&
    typeof best === "number" &&
    Number.isInteger(best) &&
    best >= 0
  );
}

const slot = createJsonSlot<SortDayStart>({
  key: "@sort/day_start",
  subsystem: "sort.storage",
  isValid: isDayStart,
  corruptMessage: "sort.storage: corrupt day-start payload, discarding",
});

/** The day the stored standing is known to belong to, so later solves that day skip storage. */
let recordedDay: string | null = null;

/** The stored day-start best, or null when none is stored or it can't be read. */
export function readSortDayStart(): Promise<SortDayStart | null> {
  return slot.load();
}

/**
 * Called on every solve with the standing just before it. Stores it only for the day's
 * first solve (the stored day differs from `day`). Never rejects.
 */
export async function recordSortSolve(day: string, bestBefore: number): Promise<void> {
  if (recordedDay === day) return;
  // Set first: a second solve before this write lands already includes the first one.
  recordedDay = day;
  // Failure mode, safe by design: if this read fails (reported; `load` resolves null) on a
  // day already recorded, the write below replaces that day's standing with a later,
  // higher one. Offline then counts fewer new levels than the server, so it can miss a
  // goal that is done, never show one done that is not; the next `/status` corrects it.
  const stored = await slot.load();
  if (stored?.day !== day) await slot.save({ day, best: Math.max(0, Math.floor(bestBefore)) });
}

/** Tests only: forget the in-memory day. */
export function resetSortDayStartForTests(): void {
  recordedDay = null;
}
