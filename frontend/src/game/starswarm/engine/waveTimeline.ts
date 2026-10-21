/**
 * Star Swarm engine — the wave timeline (#3392, epic #3390).
 *
 * A short, fixed-capacity list of a wave's major transitions, each stamped with the wave's own
 * gameplay clock: when the plating went, when a life went and to what, when the Carrier reached
 * each stage, when a buff ran out. `wave_completed` (waveStats.ts) says how much happened; the
 * timeline says in what order. The contract is docs/games/starswarm-diagnostics.md.
 *
 * Capture: each entry is recorded where the engine makes the change, beside the counter bump
 * that already counts it (the trigger points in the doc). Nothing scans or diffs state per frame,
 * nothing here serializes, and nothing is written to storage or the network. With the run's
 * `timelineOn` false the live buffer is `null` and every capture site is one null check.
 *
 * The buffer: 32 entries a wave — 30 ordinary slots (power-ups at most 8, transitions at most 8,
 * damage the rest), one slot held for the lethal `LIFE_LOST` and one for the terminal entry.
 * Admission is entry by entry in append order and nothing is ever evicted, so seeded runs
 * reproduce it exactly. A refused entry is counted in `ovf` by class and leaves no other trace.
 * Copy-on-write: an append returns a new buffer (copying at most 31 references), a refusal shares
 * the entry list and replaces only `ovf`.
 *
 * Bytes: each buffer keeps the JSON length of its entry list as arithmetic (digit counts, commas
 * and brackets), so a close knows its wire length without `JSON.stringify`.
 *
 * Run-level collection (`collectClosedTimeline`): the terminal wave and every cleared wave that
 * took plating or life damage (decision D1-C, judged from the wave's counters), at most one `died`
 * timeline per wave number (the latest that fits), within 16 KB and 64 timelines a run with room
 * held for one `died` timeline.
 */
import type { GamePhase, StarSwarmState } from "../types";
import {
  CARRIER_STAGES,
  HIT_CAUSES,
  KILL_METHODS,
  POWERUP_TYPES,
  type CarrierStage,
  type HitCause,
  type KillMethod,
  type PowerUpType,
} from "./registries";
import type { WaveOutcome, WaveStatsSnapshot } from "./waveStats";
import {
  TIMELINE_MAX_BYTES,
  TIMELINE_RUN_MAX_BYTES,
  TIMELINE_RUN_MAX_WAVES,
} from "../../_shared/eventQueueConfig";

export { TIMELINE_MAX_BYTES, TIMELINE_RUN_MAX_BYTES, TIMELINE_RUN_MAX_WAVES };

// ---------------------------------------------------------------------------
// Constants and the code table (v1)
// ---------------------------------------------------------------------------

/** The `wave_timeline` schema version (`v`). */
export const TIMELINE_VERSION = 1;
/** The engine-rules version the entries describe (`ev`): bumped when a trigger's meaning changes. */
export const TIMELINE_ENGINE_VERSION = 1;
/**
 * Entries a wave, the lethal and terminal slots included (30 ordinary + 1 + 1).
 * @internal The admission rules use the slot counts; tests and the #3394 fixture read this one.
 */
export const TIMELINE_MAX_ENTRIES = 32;
/** The ordinary slots (every entry but the lethal blow in slot 31 and the terminal one). */
export const TIMELINE_ORDINARY_SLOTS = 30;
/** Class P entries a wave. */
export const TIMELINE_POWERUP_MAX = 8;
/** Class C entries a wave. */
export const TIMELINE_TRANSITION_MAX = 8;
/** `t` saturates here (deciseconds, about 109 minutes). */
export const TIMELINE_T_MAX = 65535;
/** `x` is one of 64 columns. */
export const TIMELINE_X_MAX = 63;
/** Each `ovf` count saturates here. */
export const TIMELINE_OVF_MAX = 65535;
/** Lives and bonus lives on the wire saturate here. */
const TIMELINE_LIVES_MAX = 255;

/** The phases a `PHASE` entry indexes, in `GamePhase` order (GameOver is the terminal entry). */
export const TIMELINE_PHASES = [
  "SwoopIn",
  "Playing",
  "ClearAwaitingPickups",
  "Extraction",
] as const;
export type TimelinePhase = (typeof TIMELINE_PHASES)[number];

/** Entry codes. Gaps are unassigned (room for a later code inside its class); never reused. */
export const TL = {
  HULL_HIT: 1,
  LIFE_LOST: 2,
  BONUS_LIFE: 3,
  PLATING_UP: 4,
  WAVE_CLEARED: 8,
  RUN_LOST: 9,
  PHASE: 10,
  CARRIER_STAGE: 11,
  CARRIER_DOWN: 12,
  ROUT: 13,
  PICKUP: 20,
  BUFF_END: 21,
} as const;
export type TimelineCode = (typeof TL)[keyof typeof TL];

/** D damage and defensive state, T terminal, C transitions, P power-ups. */
export type TimelineClass = "D" | "T" | "C" | "P";

/**
 * Each code's class and arity (the entry's array length, `t` and the code included).
 * @internal The code table the tests (and the #3394 parity fixture) check entries against.
 */
export const TIMELINE_CODES: Readonly<
  Record<
    TimelineCode,
    { readonly name: keyof typeof TL; readonly cls: TimelineClass; readonly arity: number }
  >
> = {
  1: { name: "HULL_HIT", cls: "D", arity: 5 },
  2: { name: "LIFE_LOST", cls: "D", arity: 5 },
  3: { name: "BONUS_LIFE", cls: "D", arity: 4 },
  4: { name: "PLATING_UP", cls: "D", arity: 3 },
  8: { name: "WAVE_CLEARED", cls: "T", arity: 2 },
  9: { name: "RUN_LOST", cls: "T", arity: 3 },
  10: { name: "PHASE", cls: "C", arity: 3 },
  11: { name: "CARRIER_STAGE", cls: "C", arity: 3 },
  12: { name: "CARRIER_DOWN", cls: "C", arity: 3 },
  13: { name: "ROUT", cls: "C", arity: 2 },
  20: { name: "PICKUP", cls: "P", arity: 3 },
  21: { name: "BUFF_END", cls: "P", arity: 3 },
};

/** `ovf` indices by class: `[damage, transition, powerUp]`. */
const OVF_D = 0;
const OVF_C = 1;
const OVF_P = 2;

// Registry indices, looked up once (a registry append keeps every index)
function indexOf<T extends string>(list: readonly T[]): Readonly<Record<T, number>> {
  const out = {} as Record<T, number>;
  list.forEach((v, i) => (out[v] = i));
  return out;
}
const CAUSE_IDX = indexOf(HIT_CAUSES);
const POWERUP_IDX = indexOf(POWERUP_TYPES);
const STAGE_IDX = indexOf(CARRIER_STAGES);
const METHOD_IDX = indexOf(KILL_METHODS);
const PHASE_IDX = indexOf(TIMELINE_PHASES);

// ---------------------------------------------------------------------------
// The live buffer
// ---------------------------------------------------------------------------

/** One entry: `[t, code, ...params]`, all non-negative integers, arity fixed by the code. */
export type TimelineEntry = readonly number[];

/** The `ovf` counts: entries refused, by class `[damage, transition, powerUp]`. */
export type TimelineOverflowCounts = readonly [number, number, number];

/** One wave's live timeline. Plain JSON data (it joins the paused-run save in #3393). */
export interface WaveTimeline {
  /** The admitted entries, in append order. */
  readonly e: readonly TimelineEntry[];
  /** Entries refused by the capacity rules, by class. */
  readonly ovf: TimelineOverflowCounts;
  /** Entries in the 30 ordinary slots. */
  readonly ord: number;
  /** Class P entries admitted. */
  readonly p: number;
  /** Class C entries admitted. */
  readonly c: number;
  /** Slot 31 (the lethal blow's) is taken. */
  readonly lethal: boolean;
  /** The terminal entry is present (it is then last). */
  readonly term: boolean;
  /** `JSON.stringify(e).length`, kept as arithmetic. */
  readonly eBytes: number;
}

/** A wave's buffer before anything happened: shared, so opening a wave allocates nothing. */
export const EMPTY_TIMELINE: WaveTimeline = Object.freeze({
  e: Object.freeze([]) as readonly TimelineEntry[],
  ovf: Object.freeze([0, 0, 0]) as unknown as TimelineOverflowCounts,
  ord: 0,
  p: 0,
  c: 0,
  lethal: false,
  term: false,
  eBytes: 2, // "[]"
});

/** Decimal digits of a non-negative integer. */
export function digits(n: number): number {
  let d = 1;
  while (n >= 10) {
    n = Math.floor(n / 10);
    d++;
  }
  return d;
}

/** An entry's JSON length: brackets, the commas between its ints and their digits. */
export function entryBytes(entry: TimelineEntry): number {
  let n = 2 + entry.length - 1;
  for (let i = 0; i < entry.length; i++) n += digits(entry[i]!);
  return n;
}

/** Gameplay deciseconds into the wave: `min(65535, floor(round(durationMs) / 100))` (D8). */
export function timelineT(durationMs: number): number {
  return Math.min(TIMELINE_T_MAX, Math.floor(Math.round(durationMs) / 100));
}

/** The player's X as one of 64 columns, normalized by the run's canvas width. */
export function timelineX(x: number, canvasW: number): number {
  const col = Math.round((x / canvasW) * TIMELINE_X_MAX);
  // NaN (a zero-width canvas) reads as column 0
  return col > TIMELINE_X_MAX ? TIMELINE_X_MAX : col >= 0 ? col : 0;
}

const clampLives = (n: number) => (n <= 0 ? 0 : n >= TIMELINE_LIVES_MAX ? TIMELINE_LIVES_MAX : n);

/** `tl` with one more refusal of the class at `idx` (the entry list is shared). */
function refuse(tl: WaveTimeline, idx: number): WaveTimeline {
  if (tl.ovf[idx]! >= TIMELINE_OVF_MAX) return tl; // saturated: nothing changes
  const ovf = [tl.ovf[0], tl.ovf[1], tl.ovf[2]] as [number, number, number];
  ovf[idx]!++;
  return { ...tl, ovf };
}

/** `tl` with `entry` appended (the caller has admitted it). */
function append(
  tl: WaveTimeline,
  entry: TimelineEntry,
  patch: Partial<Pick<WaveTimeline, "ord" | "p" | "c" | "lethal" | "term">>
): WaveTimeline {
  return {
    ...tl,
    ...patch,
    e: [...tl.e, entry],
    eBytes: tl.eBytes + entryBytes(entry) + (tl.e.length > 0 ? 1 : 0),
  };
}

/** A class D entry into an ordinary slot, or refused. */
function damage(tl: WaveTimeline, entry: () => TimelineEntry): WaveTimeline {
  if (tl.ord >= TIMELINE_ORDINARY_SLOTS) return refuse(tl, OVF_D);
  return append(tl, entry(), { ord: tl.ord + 1 });
}

/** A class C entry: an ordinary slot while fewer than 8 C entries are in, else refused. */
function transition(tl: WaveTimeline, entry: () => TimelineEntry): WaveTimeline {
  if (tl.ord >= TIMELINE_ORDINARY_SLOTS || tl.c >= TIMELINE_TRANSITION_MAX)
    return refuse(tl, OVF_C);
  return append(tl, entry(), { ord: tl.ord + 1, c: tl.c + 1 });
}

/** A class P entry: an ordinary slot while fewer than 8 P entries are in, else refused. */
function powerUp(tl: WaveTimeline, entry: () => TimelineEntry): WaveTimeline {
  if (tl.ord >= TIMELINE_ORDINARY_SLOTS || tl.p >= TIMELINE_POWERUP_MAX) return refuse(tl, OVF_P);
  return append(tl, entry(), { ord: tl.ord + 1, p: tl.p + 1 });
}

// ---------------------------------------------------------------------------
// Capture (one function per code; each site guards `timeline !== null` first)
// ---------------------------------------------------------------------------

/** 1 `HULL_HIT`: plating took the tick's hit. */
export function tlHullHit(
  tl: WaveTimeline,
  durationMs: number,
  cause: HitCause,
  x: number,
  canvasW: number,
  hullAfter: number
): WaveTimeline {
  return damage(tl, () => [
    timelineT(durationMs),
    TL.HULL_HIT,
    CAUSE_IDX[cause],
    timelineX(x, canvasW),
    hullAfter,
  ]);
}

/**
 * 2 `LIFE_LOST`: a life went (`livesAfter` before any bonus-life rescue). The lethal blow
 * (`livesAfter` 0) takes an ordinary slot if one is free, else slot 31 once a wave.
 */
export function tlLifeLost(
  tl: WaveTimeline,
  durationMs: number,
  cause: HitCause,
  x: number,
  canvasW: number,
  livesAfter: number
): WaveTimeline {
  const after = clampLives(livesAfter);
  const entry = (): TimelineEntry => [
    timelineT(durationMs),
    TL.LIFE_LOST,
    CAUSE_IDX[cause],
    timelineX(x, canvasW),
    after,
  ];
  if (tl.ord < TIMELINE_ORDINARY_SLOTS) return append(tl, entry(), { ord: tl.ord + 1 });
  if (after === 0 && !tl.lethal) return append(tl, entry(), { lethal: true });
  return refuse(tl, OVF_D);
}

/** 3 `BONUS_LIFE`: `awarded` lives this tick (one entry however many). */
export function tlBonusLife(
  tl: WaveTimeline,
  durationMs: number,
  awarded: number,
  livesAfter: number
): WaveTimeline {
  return damage(tl, () => [
    timelineT(durationMs),
    TL.BONUS_LIFE,
    clampLives(awarded),
    clampLives(livesAfter),
  ]);
}

/** 4 `PLATING_UP`: a hull pickup was collected (or applied from the dev panel). */
export function tlPlatingUp(tl: WaveTimeline, durationMs: number, hullAfter: number): WaveTimeline {
  return damage(tl, () => [timelineT(durationMs), TL.PLATING_UP, hullAfter]);
}

/** 10 `PHASE`: the phase entered (Playing, ClearAwaitingPickups or Extraction). */
export function tlPhase(tl: WaveTimeline, durationMs: number, phase: GamePhase): WaveTimeline {
  const idx = PHASE_IDX[phase as TimelinePhase];
  // SwoopIn is implicit at t 0 and GameOver is the terminal entry: neither is a PHASE entry
  if (idx === undefined || idx === 0) return tl;
  return transition(tl, () => [timelineT(durationMs), TL.PHASE, idx]);
}

/** 11 `CARRIER_STAGE`: a stage past `protected` reached for the first time. */
export function tlCarrierStage(
  tl: WaveTimeline,
  durationMs: number,
  stage: CarrierStage
): WaveTimeline {
  if (stage === "protected") return tl;
  return transition(tl, () => [timelineT(durationMs), TL.CARRIER_STAGE, STAGE_IDX[stage]]);
}

/** 12 `CARRIER_DOWN`: the Carrier died, by `method`. */
export function tlCarrierDown(
  tl: WaveTimeline,
  durationMs: number,
  method: KillMethod
): WaveTimeline {
  return transition(tl, () => [timelineT(durationMs), TL.CARRIER_DOWN, METHOD_IDX[method]]);
}

/** 13 `ROUT`: the grunts' rout latched. */
export function tlRout(tl: WaveTimeline, durationMs: number): WaveTimeline {
  return transition(tl, () => [timelineT(durationMs), TL.ROUT]);
}

/** 20 `PICKUP`: lightning, shield, buddy or bomb collected or applied (salvage and hull aren't). */
export function tlPickup(tl: WaveTimeline, durationMs: number, type: PowerUpType): WaveTimeline {
  if (type === "salvage" || type === "hull") return tl;
  return powerUp(tl, () => [timelineT(durationMs), TL.PICKUP, POWERUP_IDX[type]]);
}

/** 21 `BUFF_END`: a timed buff (lightning or shield) ran out. */
export function tlBuffEnd(tl: WaveTimeline, durationMs: number, type: PowerUpType): WaveTimeline {
  return powerUp(tl, () => [timelineT(durationMs), TL.BUFF_END, POWERUP_IDX[type]]);
}

/**
 * The terminal entry (8 `WAVE_CLEARED` or 9 `RUN_LOST`), always admitted into its own slot. `t`
 * is the snapshot's own (`pacing.durationMs` is already rounded), so it equals
 * `min(65535, floor(pacing.durationMs / 100))` of the matching `wave_completed`.
 */
export function tlTerminal(tl: WaveTimeline, snap: WaveStatsSnapshot): WaveTimeline {
  const t = timelineT(snap.pacing.durationMs);
  // a died close always follows the lethal hit, which set deathCause; 0 only if a caller broke that
  const entry: TimelineEntry =
    snap.outcome === "cleared"
      ? [t, TL.WAVE_CLEARED]
      : [t, TL.RUN_LOST, snap.damage.deathCause ? CAUSE_IDX[snap.damage.deathCause] : 0];
  return append(tl, entry, { term: true });
}

/** `tl` without its trailing terminal entry (the dev panel's revert of a `died` close). */
export function tlDropTerminal(tl: WaveTimeline): WaveTimeline {
  if (!tl.term) return tl;
  const last = tl.e[tl.e.length - 1]!;
  return {
    ...tl,
    e: tl.e.slice(0, -1),
    term: false,
    eBytes: tl.eBytes - entryBytes(last) - (tl.e.length > 1 ? 1 : 0),
  };
}

// ---------------------------------------------------------------------------
// Wire form and bytes
// ---------------------------------------------------------------------------

/** One closed wave's timeline as sent (`wave_timeline` v1). */
export interface WaveTimelineWire {
  readonly v: number;
  readonly ev: number;
  readonly wave: number;
  readonly outcome: WaveOutcome;
  readonly dev: boolean;
  readonly ovf: TimelineOverflowCounts;
  readonly e: readonly TimelineEntry[];
}

/** Every literal character of the wire form; the values' own lengths are added to it. */
const WIRE_FIXED = '{"v":,"ev":,"wave":,"outcome":"","dev":,"ovf":[,,],"e":}'.length;

/** The JSON length of a wire form with these values (no serialization). */
export function timelineWireBytes(
  wave: number,
  outcome: WaveOutcome,
  dev: boolean,
  ovf: TimelineOverflowCounts,
  eBytes: number
): number {
  return (
    WIRE_FIXED +
    digits(TIMELINE_VERSION) +
    digits(TIMELINE_ENGINE_VERSION) +
    digits(wave) +
    outcome.length +
    (dev ? 4 : 5) +
    digits(ovf[0]) +
    digits(ovf[1]) +
    digits(ovf[2]) +
    eBytes
  );
}

/** The wire form of a closed buffer (its terminal entry appended) for the snapshot's wave. */
export function toTimelineWire(tl: WaveTimeline, snap: WaveStatsSnapshot): WaveTimelineWire {
  return {
    v: TIMELINE_VERSION,
    ev: TIMELINE_ENGINE_VERSION,
    wave: snap.wave,
    outcome: snap.outcome,
    dev: snap.dev,
    ovf: tl.ovf,
    e: tl.e,
  };
}

// ---------------------------------------------------------------------------
// Run-level collection
// ---------------------------------------------------------------------------

/** What the run did not keep, by count (see the doc's run-level collection). */
export interface ClosedTimelinesOverflow {
  /** Candidates refused by the run budget or the per-event cap. */
  readonly waves: number;
  /** Their wire bytes. */
  readonly bytes: number;
  /** Cleared waves with no plating or life damage: not kept, by policy (D1-C). */
  readonly clean: number;
  /** Repeated `died` closes of one wave number (dev infinite lives). */
  readonly devRepeats: number;
  /** Waves that closed with no live buffer (recording lost on restore). */
  readonly unrecorded: number;
  /** A cleared candidate didn't fit the budget: no later cleared wave is kept. */
  readonly full: boolean;
}

export const NO_TIMELINE_OVERFLOW: ClosedTimelinesOverflow = Object.freeze({
  waves: 0,
  bytes: 0,
  clean: 0,
  devRepeats: 0,
  unrecorded: 0,
  full: false,
});

/** The run-level timeline fields of a fresh run (or a fresh wave carrying none over). */
export interface TimelineRunFields {
  readonly waveTimeline: WaveTimeline | null;
  readonly timelineOn: boolean;
  readonly timelineLost: boolean;
  readonly closedTimelines: readonly WaveTimelineWire[];
  readonly closedTimelinesLens: readonly number[];
  readonly closedTimelinesBytes: number;
  readonly closedTimelinesOverflow: ClosedTimelinesOverflow;
}

/** A new run's timeline fields: a buffer for the first wave only when recording is on. */
export function openTimelineRun(timelineOn: boolean): TimelineRunFields {
  return {
    waveTimeline: timelineOn ? EMPTY_TIMELINE : null,
    timelineOn,
    timelineLost: false,
    closedTimelines: [],
    closedTimelinesLens: [],
    closedTimelinesBytes: 0,
    closedTimelinesOverflow: NO_TIMELINE_OVERFLOW,
  };
}

/** The cleared wave took plating or life damage, judged from its counters (not the buffer). */
function tookDamage(snap: WaveStatsSnapshot): boolean {
  for (const cause of HIT_CAUSES) {
    const h = snap.damage.hits[cause];
    if (h.plating + h.life > 0) return true;
  }
  return false;
}

/**
 * `target` with the wave `buf` recorded closed as `snap`: its terminal entry appended, then kept
 * on `closedTimelines` or counted in `closedTimelinesOverflow`. A `died` close also leaves the
 * closed buffer live (the dev panel's revert pops its terminal entry and the wave carries on).
 * `target` is the state the close lands in — the run's own on a `died` close, the next wave's
 * on a `cleared` one — and carries the run's closed list and counts.
 */
export function collectClosedTimeline(
  target: StarSwarmState,
  buf: WaveTimeline | null,
  snap: WaveStatsSnapshot
): StarSwarmState {
  const over = target.closedTimelinesOverflow;
  if (buf === null) {
    // the dial off from the start counts nothing; a buffer lost on restore counts the wave
    if (!target.timelineOn && !target.timelineLost) return target;
    return { ...target, closedTimelinesOverflow: { ...over, unrecorded: over.unrecorded + 1 } };
  }
  const closed = tlTerminal(buf, snap);
  const s = snap.outcome === "died" ? { ...target, waveTimeline: closed } : target;
  const wire = toTimelineWire(closed, snap);
  const bytes = timelineWireBytes(snap.wave, snap.outcome, snap.dev, closed.ovf, closed.eBytes);
  const kept = s.closedTimelines;
  const lens = s.closedTimelinesLens;
  const total = s.closedTimelinesBytes;
  const refused = (full: boolean): StarSwarmState => ({
    ...s,
    closedTimelinesOverflow: { ...over, waves: over.waves + 1, bytes: over.bytes + bytes, full },
  });
  const keep = (): StarSwarmState => ({
    ...s,
    closedTimelines: [...kept, wire],
    closedTimelinesLens: [...lens, bytes],
    closedTimelinesBytes: total + bytes,
  });
  const oversize = bytes > TIMELINE_MAX_BYTES;

  if (snap.outcome === "cleared") {
    if (!tookDamage(snap)) {
      return { ...s, closedTimelinesOverflow: { ...over, clean: over.clean + 1 } };
    }
    if (oversize) return refused(over.full);
    // room is held for one worst-case died timeline
    const fits =
      !over.full &&
      total + bytes <= TIMELINE_RUN_MAX_BYTES - TIMELINE_MAX_BYTES &&
      kept.length + 1 <= TIMELINE_RUN_MAX_WAVES - 1;
    return fits ? keep() : refused(true);
  }

  // died: at most one kept per wave number, the latest that fits the hard caps
  let i = -1;
  for (let k = 0; k < kept.length; k++) {
    if (kept[k]!.wave === snap.wave && kept[k]!.outcome === "died") {
      i = k;
      break;
    }
  }
  if (i >= 0) {
    const repeats = { ...over, devRepeats: over.devRepeats + 1 };
    const fitsReplace = !oversize && total - lens[i]! + bytes <= TIMELINE_RUN_MAX_BYTES;
    if (!fitsReplace) return { ...s, closedTimelinesOverflow: repeats };
    const nextKept = kept.slice();
    const nextLens = lens.slice();
    nextKept[i] = wire;
    nextLens[i] = bytes;
    return {
      ...s,
      closedTimelines: nextKept,
      closedTimelinesLens: nextLens,
      closedTimelinesBytes: total - lens[i]! + bytes,
      closedTimelinesOverflow: repeats,
    };
  }
  const fits =
    !oversize &&
    total + bytes <= TIMELINE_RUN_MAX_BYTES &&
    kept.length + 1 <= TIMELINE_RUN_MAX_WAVES;
  return fits ? keep() : refused(over.full);
}

/**
 * The dev panel's infinite-lives revert (`devRevert`, waveEvents.ts) for the timeline: the
 * trailing `RUN_LOST` leaves the live buffer (the wave carries on with its terminal slot free),
 * and the timeline this tick kept is flagged `dev`, one byte shorter — as `devRevert` flags the
 * wave it closed, so a timeline's `dev` equals its `wave_completed`'s whenever that row exists
 * (when `closedWaves` is full the timeline can still be kept and flagged, with no row). The newest
 * one when the list grew (a `died` close, or a `cleared` one on the tick the extraction completed),
 * or the wave's `died` one when a repeated close replaced it in place.
 */
export function revertTimeline(prev: StarSwarmState, s: StarSwarmState): StarSwarmState {
  let out = s;
  const live = s.waveTimeline;
  if (live !== null && live.term) out = { ...out, waveTimeline: tlDropTerminal(live) };
  const kept = out.closedTimelines;
  if (kept === prev.closedTimelines) return out; // nothing kept this tick
  const i =
    kept.length > prev.closedTimelines.length
      ? kept.length - 1
      : kept.findIndex((tl) => tl.wave === out.wave && tl.outcome === "died");
  const tl = kept[i];
  if (!tl || tl.dev) return out;
  const nextKept = kept.slice();
  const nextLens = out.closedTimelinesLens.slice();
  nextKept[i] = { ...tl, dev: true };
  nextLens[i] = nextLens[i]! - 1; // `true` is one byte shorter than `false`
  return {
    ...out,
    closedTimelines: nextKept,
    closedTimelinesLens: nextLens,
    closedTimelinesBytes: out.closedTimelinesBytes - 1,
  };
}
