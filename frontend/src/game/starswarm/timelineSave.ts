/**
 * Star Swarm — the wave timeline in a paused-run save (#3393, epic #3390).
 *
 * The timeline fields (`waveTimeline`, `timelineOn`, `timelineLost`, `closedTimelines`,
 * `closedTimelinesLens`, `closedTimelinesBytes`, `closedTimelinesOverflow`) are ADDED_STATE in
 * saveShape.ts: a save may lack them or hold another build's values. `restoreTimelineFields` is
 * the contract in docs/games/starswarm-diagnostics.md ("Pause, resume, abandonment, process
 * death, duplicates"):
 *
 *  - `timelineOn` / `timelineLost` restore as saved when both are booleans. Otherwise (a save from
 *    a build before #3392, or a corrupt one) the run restores as recording lost: `timelineOn`
 *    false, `timelineLost` true, no live buffer, no closed timelines and zero counts, so every wave
 *    it closes from then on counts as `unrecorded`. A partial timeline is never sent.
 *  - The live buffer restores only when the run records, the wave's `waveStats` restored as saved,
 *    the buffer fits this build's wire form (each entry's code, arity and ranges; `t`
 *    non-decreasing; no terminal entry; the admission rules replayed give its saved slot counts
 *    and byte count), and its last `t` is at most the restored wave clock. Otherwise it is null,
 *    and the wave counts as `unrecorded` when it closes.
 *  - `closedTimelines` restores as saved only when every entry fits AND `closedWaves` restored as
 *    saved; else it is cleared, so a restore never sends timelines whose summaries it dropped.
 *    `closedTimelinesLens` and `closedTimelinesBytes` are recomputed from the restored list (one
 *    `JSON.stringify` per kept timeline, here at restore, never in a tick), never trusted.
 *  - `closedTimelinesOverflow` restores as saved when it fits, else as zeros.
 *
 * Runs once per restore of a save a previous process wrote (pauseStore.loadFromDisk), never on the
 * frame path.
 */
import { CARRIER_STAGES, HIT_CAUSES, KILL_METHODS } from "./engine/registries";
import { HULL_MAX } from "./engine/tuning";
import {
  NO_TIMELINE_OVERFLOW,
  TIMELINE_CODES,
  TIMELINE_MAX_BYTES,
  TIMELINE_MAX_ENTRIES,
  TIMELINE_ORDINARY_SLOTS,
  TIMELINE_OVF_MAX,
  TIMELINE_PHASES,
  TIMELINE_POWERUP_MAX,
  TIMELINE_RUN_MAX_BYTES,
  TIMELINE_RUN_MAX_WAVES,
  TIMELINE_TRANSITION_MAX,
  TIMELINE_T_MAX,
  TIMELINE_VERSION,
  TIMELINE_X_MAX,
  TL,
  entryBytes,
  openTimelineRun,
  timelineT,
  type ClosedTimelinesOverflow,
  type TimelineCode,
  type TimelineEntry,
  type TimelineOverflowCounts,
  type TimelineRunFields,
  type WaveTimeline,
  type WaveTimelineWire,
} from "./engine/waveTimeline";

/** The timeline fields as a save holds them: missing, or from any build. */
export type SavedTimelineFields = { readonly [K in keyof TimelineRunFields]?: unknown };

/** What the rest of the restore decided, which the timeline restore depends on. */
export interface TimelineRestoreContext {
  /** The wave's `waveStats` restored as saved (not fresh). */
  readonly waveStatsAsSaved: boolean;
  /** The restored wave clock, `waveStats.pacing.durationMs`. */
  readonly durationMs: number;
  /** `closedWaves` restored as saved (not the `[]` fallback). */
  readonly closedWavesAsSaved: boolean;
}

const LIVES_MAX = 255;
type Range = readonly [number, number];
const indices = (list: readonly unknown[]): Range => [0, list.length - 1];

/** Each code's parameter ranges, after `t` and the code (the doc's code table, v1). */
const PARAMS: Readonly<Record<TimelineCode, readonly Range[]>> = {
  [TL.HULL_HIT]: [indices(HIT_CAUSES), [0, TIMELINE_X_MAX], [0, HULL_MAX - 1]],
  [TL.LIFE_LOST]: [indices(HIT_CAUSES), [0, TIMELINE_X_MAX], [0, LIVES_MAX]],
  [TL.BONUS_LIFE]: [
    [1, LIVES_MAX],
    [1, LIVES_MAX],
  ],
  [TL.PLATING_UP]: [[1, HULL_MAX]],
  [TL.WAVE_CLEARED]: [],
  [TL.RUN_LOST]: [indices(HIT_CAUSES)],
  // SwoopIn (0) is implicit at t 0; GameOver is the terminal entry
  [TL.PHASE]: [[1, TIMELINE_PHASES.length - 1]],
  // protected (0) is implicit from combat start
  [TL.CARRIER_STAGE]: [[1, CARRIER_STAGES.length - 1]],
  [TL.CARRIER_DOWN]: [indices(KILL_METHODS)],
  [TL.ROUT]: [],
  // POWERUP_TYPES indices: lightning 0, shield 1, buddy 2, bomb 3 (salvage and hull aren't PICKUPs)
  [TL.PICKUP]: [[0, 3]],
  // the timed buffs: lightning 0, shield 1
  [TL.BUFF_END]: [[0, 1]],
};

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

const isIntIn = (v: unknown, min: number, max: number): v is number =>
  Number.isInteger(v) && (v as number) >= min && (v as number) <= max;

const isCount = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;

/** Exactly these keys, no more, no fewer. */
function hasKeys(v: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(v);
  return own.length === keys.length && keys.every((k) => k in v);
}

/** One entry of this build's code table: its arity and every parameter's range. */
function isEntry(v: unknown): v is TimelineEntry {
  if (!Array.isArray(v) || v.length < 2) return false;
  const [t, code] = v as unknown[];
  if (!isIntIn(t, 0, TIMELINE_T_MAX) || !Number.isInteger(code)) return false;
  const params = PARAMS[code as TimelineCode];
  if (params === undefined || v.length !== 2 + params.length) return false;
  return params.every(([min, max], i) => isIntIn(v[2 + i], min, max));
}

function isOvf(v: unknown): v is TimelineOverflowCounts {
  return Array.isArray(v) && v.length === 3 && v.every((n) => isIntIn(n, 0, TIMELINE_OVF_MAX));
}

/** An entry list replayed through the admission rules: the slot counts it implies. */
interface Admitted {
  readonly ord: number;
  readonly p: number;
  readonly c: number;
  readonly lethal: boolean;
  readonly term: boolean;
  readonly eBytes: number;
  readonly lastT: number;
}

/**
 * The counts `e` implies, or null when no buffer of this build could hold it: an unknown code or
 * a value out of range, `t` decreasing, an entry after the terminal one, or an entry the capacity
 * rules would have refused.
 */
function admit(e: unknown): Admitted | null {
  if (!Array.isArray(e) || e.length > TIMELINE_MAX_ENTRIES) return null;
  let ord = 0;
  let p = 0;
  let c = 0;
  let lethal = false;
  let term = false;
  let eBytes = 2; // "[]"
  let lastT = 0;
  for (let i = 0; i < e.length; i++) {
    const entry: unknown = e[i];
    if (term || !isEntry(entry)) return null;
    const t = entry[0]!;
    const code = entry[1] as TimelineCode;
    if (t < lastT) return null;
    lastT = t;
    const cls = TIMELINE_CODES[code].cls;
    const ordinary =
      ord < TIMELINE_ORDINARY_SLOTS &&
      (cls === "D" ||
        (cls === "P" && p < TIMELINE_POWERUP_MAX) ||
        (cls === "C" && c < TIMELINE_TRANSITION_MAX));
    if (cls === "T") term = true;
    else if (ordinary) {
      ord++;
      if (cls === "P") p++;
      if (cls === "C") c++;
    } else if (code === TL.LIFE_LOST && entry[4] === 0 && !lethal) lethal = true;
    else return null;
    eBytes += entryBytes(entry) + (i > 0 ? 1 : 0);
  }
  return { ord, p, c, lethal, term, eBytes, lastT };
}

const LIVE_KEYS: readonly (keyof WaveTimeline)[] = [
  "e",
  "ovf",
  "ord",
  "p",
  "c",
  "lethal",
  "term",
  "eBytes",
];

/**
 * A saved live buffer this build can carry on from, else null: it fits the wire form, its
 * counts are the ones its entries imply, it has no terminal entry (the run is not over), and its
 * last `t` is not past the restored wave clock (so `t` carries on without running backwards).
 */
function restoreLive(v: unknown, durationMs: number): WaveTimeline | null {
  if (!isObject(v) || !hasKeys(v, LIVE_KEYS) || !isOvf(v.ovf)) return null;
  const got = admit(v.e);
  if (got === null || got.term) return null;
  if (
    v.ord !== got.ord ||
    v.p !== got.p ||
    v.c !== got.c ||
    v.lethal !== got.lethal ||
    v.term !== false ||
    v.eBytes !== got.eBytes
  ) {
    return null;
  }
  if (got.lastT > timelineT(durationMs)) return null;
  return v as unknown as WaveTimeline;
}

const WIRE_KEYS: readonly (keyof WaveTimelineWire)[] = [
  "v",
  "ev",
  "wave",
  "outcome",
  "dev",
  "ovf",
  "e",
];

/** A saved closed timeline in this build's wire form, ending in its outcome's terminal entry. */
function isClosedTimeline(v: unknown): v is WaveTimelineWire {
  if (!isObject(v) || !hasKeys(v, WIRE_KEYS)) return false;
  if (
    v.v !== TIMELINE_VERSION ||
    !isIntIn(v.ev, 1, 65535) ||
    !Number.isInteger(v.wave) ||
    (v.wave as number) < 1 ||
    (v.outcome !== "cleared" && v.outcome !== "died") ||
    typeof v.dev !== "boolean" ||
    !isOvf(v.ovf) ||
    !Array.isArray(v.e) ||
    v.e.length === 0
  ) {
    return false;
  }
  const got = admit(v.e);
  if (got === null || !got.term) return false;
  const last = v.e[v.e.length - 1] as TimelineEntry;
  return last[1] === (v.outcome === "cleared" ? TL.WAVE_CLEARED : TL.RUN_LOST);
}

/** The kept list and its lengths, or null when any entry or the run caps don't fit. */
function restoreClosed(v: unknown): { list: WaveTimelineWire[]; lens: number[] } | null {
  if (!Array.isArray(v) || v.length > TIMELINE_RUN_MAX_WAVES) return null;
  const list: WaveTimelineWire[] = [];
  const lens: number[] = [];
  const deaths = new Set<number>();
  let total = 0;
  for (const tl of v as unknown[]) {
    if (!isClosedTimeline(tl)) return null;
    const prev = list[list.length - 1];
    // closes happen in wave order, and a wave keeps at most one died timeline
    if (prev && tl.wave < prev.wave) return null;
    if (tl.outcome === "died") {
      if (deaths.has(tl.wave)) return null;
      deaths.add(tl.wave);
    }
    const len = JSON.stringify(tl).length;
    if (len > TIMELINE_MAX_BYTES) return null;
    total += len;
    list.push(tl);
    lens.push(len);
  }
  return total <= TIMELINE_RUN_MAX_BYTES ? { list, lens } : null;
}

const OVERFLOW_KEYS: readonly (keyof ClosedTimelinesOverflow)[] = [
  "waves",
  "bytes",
  "clean",
  "devRepeats",
  "unrecorded",
  "full",
];

function isTimelineOverflow(v: unknown): v is ClosedTimelinesOverflow {
  return (
    isObject(v) &&
    hasKeys(v, OVERFLOW_KEYS) &&
    [v.waves, v.bytes, v.clean, v.devRepeats, v.unrecorded].every(isCount) &&
    typeof v.full === "boolean"
  );
}

/** The timeline fields for a restored run (see the header). */
export function restoreTimelineFields(
  saved: SavedTimelineFields,
  ctx: TimelineRestoreContext
): TimelineRunFields {
  const { timelineOn, timelineLost } = saved;
  if (typeof timelineOn !== "boolean" || typeof timelineLost !== "boolean") {
    // an older build's save (or a corrupt one): recording is lost for the rest of the run
    return { ...openTimelineRun(false), timelineLost: true };
  }
  const live =
    timelineOn && ctx.waveStatsAsSaved ? restoreLive(saved.waveTimeline, ctx.durationMs) : null;
  const closed = ctx.closedWavesAsSaved ? restoreClosed(saved.closedTimelines) : null;
  const list = closed?.list ?? [];
  const lens = closed?.lens ?? [];
  let bytes = 0;
  for (const n of lens) bytes += n;
  return {
    waveTimeline: live,
    timelineOn,
    timelineLost,
    closedTimelines: list,
    closedTimelinesLens: lens,
    closedTimelinesBytes: bytes,
    closedTimelinesOverflow: isTimelineOverflow(saved.closedTimelinesOverflow)
      ? saved.closedTimelinesOverflow
      : NO_TIMELINE_OVERFLOW,
  };
}
