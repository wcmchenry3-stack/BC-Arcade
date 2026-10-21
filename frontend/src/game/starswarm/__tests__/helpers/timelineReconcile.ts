/**
 * #3396: the reader's reconciliation of a `wave_timeline` against its `wave_completed`, ported
 * check for check from `backend/starswarm/replay.py` (`reconcile` and the `_*_checks` it calls),
 * plus the exact presence check the backend can only print as advisory
 * (docs/games/starswarm-diagnostics.md#reader-and-reconciliation-3395).
 *
 * Entries are decoded through the shared fixture's code table
 * (`backend/tests/fixtures/starswarm_wave_timeline_v1.json`: each code's name and parameter
 * names), so a code-table change on either side changes what both readers decode. The check list
 * itself is held in step by `timelineReconcile.test.ts`, which runs this port over the backend's
 * own reader fixture (`starswarm_run_lieutenant_7w.json`, clean) and over corrupted copies of
 * it, and by the backend's `test_starswarm_timeline_goldens.py`, which runs `replay.py` over this
 * story's golden timelines. Not a test file.
 */
// Path: 6 levels up from __tests__/helpers/ to the repo root, then into backend/tests/fixtures/.
import fixture from "../../../../../../backend/tests/fixtures/starswarm_wave_timeline_v1.json";

type Json = Record<string, unknown>;

export interface Check {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

interface Entry {
  readonly t: number;
  readonly code: number;
  readonly name: string;
  readonly params: Readonly<Record<string, number>>;
}

const HIT_CAUSES = fixture.registries.HIT_CAUSES as readonly string[];
const CARRIER_STAGES = fixture.registries.CARRIER_STAGES as readonly string[];
const HIT_TYPES = ["lightning", "shield", "buddy", "bomb"] as const; // PICKUP-recorded
const BUFF_TYPES = ["lightning", "shield"] as const; // BUFF_END-recorded
const MAX_TIME = fixture.limits.tMax;
const OVF_NAMES = ["damage", "transition", "powerUp"] as const;
const DAMAGE = 0;
const TRANSITION = 1;
const POWERUP = 2;
const CODES = new Map(fixture.codes.map((c) => [c.code, c]));
/** PLATING_UP.hullAfter's top: the hull cap (replay.py's `HULL_MAX`). */
const HULL_MAX = CODES.get(4)!.params[0]!.max;

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);

function dig(data: unknown, ...path: string[]): unknown {
  let v = data;
  for (const k of path) {
    if (v === null || typeof v !== "object" || Array.isArray(v)) return undefined;
    v = (v as Json)[k];
  }
  return v;
}

/** An int at `path`, else 0 (a left-out wire counter is 0). */
function num(data: unknown, ...path: string[]): number {
  const v = dig(data, ...path);
  return isInt(v) ? v : 0;
}

/** A well-formed `[t, code, ...]` decoded by the shared code table, else null (unknown codes kept). */
function decode(raw: unknown): Entry | null {
  if (!Array.isArray(raw) || raw.length < 2 || !raw.every(isInt)) return null;
  const spec = CODES.get(raw[1] as number);
  if (!spec) return { t: raw[0], code: raw[1], name: `UNKNOWN_${raw[1]}`, params: {} };
  if (raw.length !== spec.arity) return null;
  const params: Record<string, number> = {};
  spec.params.forEach((p, i) => (params[p.name] = raw[2 + i] as number));
  return { t: raw[0], code: raw[1], name: spec.name, params };
}

/** `min(65535, floor(pacing.durationMs / 100))`: a wave's terminal `t`. */
export function terminalT(summary: unknown): number {
  return Math.min(MAX_TIME, Math.floor(num(summary, "pacing", "durationMs") / 100));
}

/** The cleared wave took plating or life damage (`_damaged`). */
export function damaged(summary: unknown): boolean {
  const hits = dig(summary, "damage", "hits");
  if (hits === null || typeof hits !== "object") return false;
  return Object.values(hits as Json).some((row) => num(row, "life") > 0 || num(row, "plating") > 0);
}

const count = (entries: readonly Entry[], name: string, match: Record<string, number> = {}) =>
  entries.filter(
    (e) => e.name === name && Object.entries(match).every(([k, v]) => e.params[k] === v)
  ).length;

function compare(name: string, got: number, want: number, weak: string | null): Check {
  if (weak === null) {
    return {
      name,
      ok: got === want,
      detail: got === want ? "" : `timeline ${got}, summary ${want}`,
    };
  }
  return {
    name: `${name} (at most, ${weak})`,
    ok: got <= want,
    detail: got <= want ? "" : `timeline ${got} > summary ${want}; ${weak}`,
  };
}

const weakOf = (ovf: readonly number[], cls: number): string | null =>
  ovf[cls]! > 0 ? `ovf[${cls}] ${OVF_NAMES[cls]}=${ovf[cls]}` : null;

/** Every check of the reader's list for one paired wave (passes and failures), as replay.py. */
export function reconcile(
  summary: unknown,
  tl: { readonly e: unknown; readonly ovf: unknown; readonly outcome: unknown }
): Check[] {
  const entries = (tl.e as unknown[]).map(decode).filter((e): e is Entry => e !== null);
  const ovf = tl.ovf as readonly number[];
  const wDmg = weakOf(ovf, DAMAGE);
  const wTr = weakOf(ovf, TRANSITION);
  const wPu = weakOf(ovf, POWERUP);
  return [
    ...hitChecks(summary, entries, wDmg),
    ...deathChecks(summary, tl.outcome, entries, wDmg),
    ...livesHullChecks(summary, entries, wDmg),
    ...timingChecks(summary, entries, wTr),
    ...powerUpChecks(summary, entries, wDmg, wPu),
  ];
}

function hitChecks(summary: unknown, entries: readonly Entry[], weak: string | null): Check[] {
  const out: Check[] = [];
  for (const [code, result] of [
    ["HULL_HIT", "plating"],
    ["LIFE_LOST", "life"],
  ] as const) {
    let totalWant = 0;
    HIT_CAUSES.forEach((cause, ci) => {
      const want = num(summary, "damage", "hits", cause, result);
      totalWant += want;
      out.push(compare(`${code} ${cause}`, count(entries, code, { cause: ci }), want, weak));
    });
    out.push(compare(`${code} total`, count(entries, code), totalWant, weak));
  }
  return out;
}

function deathChecks(
  summary: unknown,
  outcome: unknown,
  entries: readonly Entry[],
  weak: string | null
): Check[] {
  if (outcome !== "died") return [];
  const runLost = entries.filter((e) => e.name === "RUN_LOST");
  const want = dig(summary, "damage", "deathCause");
  const got = runLost.length ? (HIT_CAUSES[runLost[0]!.params.cause!] ?? null) : null;
  const out: Check[] = [
    { name: "RUN_LOST cause = deathCause", ok: got === want, detail: `${got} vs ${String(want)}` },
  ];
  const hits = entries.filter((e) => e.name === "HULL_HIT" || e.name === "LIFE_LOST");
  const last = hits.at(-1);
  const lethal = last !== undefined && last.name === "LIFE_LOST" && last.params.livesAfter === 0;
  out.push(
    weak === null
      ? { name: "last hit is the lethal LIFE_LOST", ok: lethal, detail: "" }
      : { name: `last hit is the lethal LIFE_LOST (not required, ${weak})`, ok: true, detail: "" }
  );
  return out;
}

function livesHullChecks(
  summary: unknown,
  entries: readonly Entry[],
  weak: string | null
): Check[] {
  const awarded = entries
    .filter((e) => e.name === "BONUS_LIFE")
    .reduce((n, e) => n + e.params.awarded!, 0);
  const out = [compare("BONUS_LIFE awarded", awarded, num(summary, "pacing", "bonusLives"), weak)];
  if (weak !== null) {
    out.push({ name: `lives and hull arithmetic (not checkable, ${weak})`, ok: true, detail: "" });
    return out;
  }
  let lives = num(summary, "pacing", "start", "lives");
  let hull = num(summary, "pacing", "start", "hull");
  const problems: string[] = [];
  for (const e of entries) {
    const [l, h, problem] = step(e, lives, hull);
    lives = l;
    hull = h;
    if (problem) problems.push(`${(e.t / 10).toFixed(1)}s ${e.name} ${problem}`);
  }
  const endLives = num(summary, "pacing", "end", "lives");
  const endHull = num(summary, "pacing", "end", "hull");
  if (lives !== endLives)
    problems.push(`lives path ends at ${lives}, pacing.end.lives ${endLives}`);
  if (hull !== endHull) problems.push(`hull path ends at ${hull}, pacing.end.hull ${endHull}`);
  out.push({
    name: "lives and hull arithmetic",
    ok: problems.length === 0,
    detail: problems.join("; "),
  });
  return out;
}

/** One entry applied to the running `(lives, hull)`; the third value says what disagrees. */
function step(e: Entry, lives: number, hull: number): [number, number, string] {
  const p = e.params;
  if (e.name === "LIFE_LOST") {
    let problem = hull !== 0 ? `with hull ${hull} (expected 0)` : "";
    if (p.livesAfter !== lives - 1) problem = `says lives ${p.livesAfter}, running ${lives - 1}`;
    return [lives - 1, hull, problem];
  }
  if (e.name === "BONUS_LIFE") {
    const after = lives + p.awarded!;
    return [
      after,
      hull,
      p.livesAfter === after ? "" : `says lives ${p.livesAfter}, running ${after}`,
    ];
  }
  if (e.name === "HULL_HIT") {
    const ok = p.hullAfter === hull - 1;
    return [lives, p.hullAfter!, ok ? "" : `says hull ${p.hullAfter}, running ${hull - 1}`];
  }
  if (e.name === "PLATING_UP") {
    // at the hull cap a pickup is still collected, so hullAfter may equal the level before
    const ok = p.hullAfter === hull + 1 || (hull === HULL_MAX && p.hullAfter === hull);
    return [lives, p.hullAfter!, ok ? "" : `says hull ${p.hullAfter}, running ${hull}`];
  }
  return [lives, hull, ""];
}

function timingChecks(summary: unknown, entries: readonly Entry[], weak: string | null): Check[] {
  const out: Check[] = [];
  for (const si of [1, 2]) {
    const stage = CARRIER_STAGES[si]!;
    const got = entries.filter((e) => e.name === "CARRIER_STAGE" && e.params.stage === si);
    out.push(
      timeCheck(
        `CARRIER_STAGE ${stage} t`,
        got,
        dig(summary, "carrier", "stageReachedMs", stage),
        weak
      )
    );
  }
  const triggered = dig(summary, "rout", "triggered") === true;
  const atMs = triggered ? dig(summary, "rout", "atMs") : undefined;
  out.push(
    timeCheck(
      "ROUT t",
      entries.filter((e) => e.name === "ROUT"),
      atMs,
      weak
    )
  );
  const terminal = entries.filter((e) => e.name === "WAVE_CLEARED" || e.name === "RUN_LOST");
  const wantT = terminalT(summary);
  out.push({
    name: "terminal t = pacing.durationMs",
    ok: terminal.length === 1 && terminal[0]!.t === wantT,
    detail: `terminal ${terminal[0]?.t} vs ${wantT}`,
  });
  const kills = dig(summary, "combat", "kills", "Carrier");
  const killsN =
    kills !== null && typeof kills === "object"
      ? Object.values(kills as Json).reduce<number>((n, v) => n + (isInt(v) ? v : 0), 0)
      : 0;
  const downs = count(entries, "CARRIER_DOWN");
  out.push({
    name: "CARRIER_DOWN at most once, only after a Carrier kill",
    ok: downs <= 1 && (downs === 0 || killsN > 0),
    detail: `${downs} entries, ${killsN} kills`,
  });
  return out;
}

/** An entry's `t` against a `wave_completed` time in ms (absent: the event did not happen). */
function timeCheck(name: string, got: readonly Entry[], ms: unknown, weak: string | null): Check {
  const want = isInt(ms) ? Math.min(MAX_TIME, Math.floor(ms / 100)) : null;
  if (got.length > 1) return { name, ok: false, detail: `${got.length} entries` };
  if (got.length && want === null) return { name, ok: false, detail: "summary has no time" };
  if (got.length && got[0]!.t !== want)
    return { name, ok: false, detail: `${got[0]!.t} vs ${want}` };
  if (!got.length && want !== null && weak === null) return { name, ok: false, detail: "no entry" };
  return {
    name: weak === null ? name : `${name} (absent entry allowed, ${weak})`,
    ok: true,
    detail: "",
  };
}

function powerUpChecks(
  summary: unknown,
  entries: readonly Entry[],
  wDmg: string | null,
  wPu: string | null
): Check[] {
  const out: Check[] = [];
  HIT_TYPES.forEach((kind, i) =>
    out.push(
      compare(
        `PICKUP ${kind}`,
        count(entries, "PICKUP", { type: i }),
        num(summary, "powerUps", "collected", kind),
        wPu
      )
    )
  );
  BUFF_TYPES.forEach((kind, i) =>
    out.push(
      compare(
        `BUFF_END ${kind}`,
        count(entries, "BUFF_END", { type: i }),
        num(summary, "powerUps", "expired", kind),
        wPu
      )
    )
  );
  out.push(
    compare(
      "PLATING_UP",
      count(entries, "PLATING_UP"),
      num(summary, "powerUps", "collected", "hull"),
      wDmg
    )
  );
  return out;
}

// ---------------------------------------------------------------------------
// Pairing (replay.py `pair_waves`) and presence (exact, with the device's counts)
// ---------------------------------------------------------------------------

interface Wire {
  readonly wave: number;
  readonly outcome: string;
  readonly dev: boolean;
}
interface TimelineWire extends Wire {
  readonly e: readonly (readonly number[])[];
  readonly ovf: readonly number[];
}

export interface Paired<S extends Wire, T extends TimelineWire> {
  readonly summary: S | null;
  readonly timeline: T | null;
}

/** Each timeline joined to its summary on `(wave, outcome)`, the terminal `t` deciding dev deaths. */
export function pairWaves<S extends Wire, T extends TimelineWire>(
  summaries: readonly S[],
  timelines: readonly T[]
): Paired<S, T>[] {
  const claimed = new Set<S>();
  const out: Paired<S, T>[] = [];
  const of = (w: Wire) => summaries.filter((s) => s.wave === w.wave && s.outcome === w.outcome);
  for (const tl of timelines) {
    const all = of(tl);
    let candidates = all.filter((s) => !claimed.has(s));
    const devDied = tl.outcome === "died" && (tl.dev || all.some((s) => s.dev));
    if (all.length > 1 || devDied) {
      const t = tl.e.at(-1)?.[0];
      candidates = candidates.filter((s) => terminalT(s) === t);
    }
    const match = candidates[0] ?? null;
    if (match) claimed.add(match);
    out.push({ summary: match, timeline: tl });
  }
  for (const s of summaries) if (!claimed.has(s)) out.push({ summary: s, timeline: null });
  return out;
}

/** What the run counted against its timelines (`closedTimelinesOverflow`) and its waves. */
export interface PresenceCounts {
  readonly waves: number;
  readonly clean: number;
  readonly devRepeats: number;
  readonly unrecorded: number;
  /** `closedWavesOverflow.waves`: summaries the waves' own cap refused. */
  readonly summariesDropped: number;
  /** `timelineOn || timelineLost`: false when the dial was off from the start. */
  readonly recording: boolean;
}

/**
 * Presence per D1-C, exactly (with the dial off from the start: nothing kept, nothing counted): `closes` is every wave close the run made (in order), `kept` the
 * run's `closedTimelines`. Returns the problems (empty when presence holds):
 *  - every close is accounted once: kept + waves + clean + devRepeats + unrecorded = closes;
 *  - `clean` is exactly the undamaged cleared closes (when nothing was unrecorded);
 *  - every `died` or damaged cleared summary has a timeline, and the ones without are exactly
 *    what `waves` and `unrecorded` (and dev repeats) account for; no clean summary has one;
 *  - a timeline without a summary only when the waves' cap refused summaries.
 */
export function presenceProblems<S extends Wire, T extends TimelineWire>(
  closes: readonly S[],
  summaries: readonly S[],
  kept: readonly T[],
  c: PresenceCounts
): string[] {
  const problems: string[] = [];
  if (!c.recording) {
    // the dial off from the start: nothing kept and nothing counted
    const counted = c.waves + c.clean + c.devRepeats + c.unrecorded;
    if (kept.length > 0 || counted > 0)
      problems.push(`dial off, yet ${kept.length} kept, ${counted} counted`);
    return problems;
  }
  const accounted = kept.length + c.waves + c.clean + c.devRepeats + c.unrecorded;
  if (accounted !== closes.length)
    problems.push(
      `closes ${closes.length}, accounted ${accounted} (${JSON.stringify(c)}, kept ${kept.length})`
    );
  const cleanCloses = closes.filter((s) => s.outcome === "cleared" && !damaged(s)).length;
  if (c.unrecorded === 0 ? c.clean !== cleanCloses : c.clean > cleanCloses)
    problems.push(`clean ${c.clean}, undamaged cleared closes ${cleanCloses}`);
  let missing = 0;
  for (const { summary, timeline } of pairWaves(summaries, kept)) {
    if (summary === null) {
      if (c.summariesDropped === 0)
        problems.push(`orphan timeline ${timeline!.wave} ${timeline!.outcome}`);
      continue;
    }
    const candidate = summary.outcome === "died" || damaged(summary);
    if (!candidate && timeline !== null) problems.push(`clean wave ${summary.wave} has a timeline`);
    if (candidate && timeline === null) missing++;
  }
  const allowance = c.waves + c.unrecorded + c.devRepeats;
  if (c.unrecorded === 0 && c.devRepeats === 0 ? missing !== c.waves : missing > allowance)
    problems.push(`${missing} candidate waves without a timeline, ${allowance} accounted`);
  return problems;
}
