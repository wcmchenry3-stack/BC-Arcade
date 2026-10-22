/**
 * "Heavy player's day" replay budget (#3398, part 1 of #3294, epic #3273).
 *
 * One virtual day of a heavy player, on fake timers: a Daily Word, 10 games of
 * 2048, 3 of Hearts, 5 of Yacht against the computer, 5 of Solitaire, 3 Star
 * Swarm runs, a Sudoku and a Mahjong. Each game's events come from its own
 * replay path (the real engine, the game's replay module and a real
 * GameRecorder; see the `build*` functions below); they are then saved into the
 * real GameEventClient → EventStore → AsyncStorage mock over the day, and the
 * real SyncWorker (its 30 s interval, its AppState handling) drains them to a
 * mock API. The day has a trip to the background in the middle of three games,
 * and an hour with the API down (the worker backs off, then recovers).
 *
 * What it asserts is in `frontend/perf/replay-budget.json`, the one place a
 * budget lives: HTTP requests and bytes uploaded, bytes stored per game type
 * (as the server counts them: `jsonb::text` plus 200 B a row), storage writes
 * per game, Sentry events, and gameplay uploads while a session is open in the
 * foreground. Counts are deterministic (seeded games, a fixed clock), so the
 * budgets are the measured values plus a little headroom. Raising a budget is
 * an owner decision tied to revenue (docs/PERFORMANCE.md, "Replay budget").
 *
 * Run it on its own with
 *   cd frontend && npx jest src/game/_shared/__tests__/replay.budget.test.ts
 */

import * as fs from "fs";
import * as path from "path";

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";
import { AppState, type AppStateStatus } from "react-native";

import {
  applyServerResult,
  initialState,
  setCurrentRowLetter,
  tilesWithDisplay,
} from "../../daily_word/engine";
import { scoreGuess } from "../../daily_word/localScoring";
import { createGuessReplay } from "../../daily_word/replay";
import { createSeededRng as heartsSeed, setRng as setHeartsRng } from "../../hearts/engine";
import { playRecordedGame } from "../../hearts/__tests__/helpers/replayGame";
import { playScripted } from "../../mahjong/__tests__/helpers/replayGame";
import { playGame as playSolitaire } from "../../solitaire/__tests__/helpers/playGame";
import { CANVAS_H, CANVAS_W, initStarSwarm } from "../../starswarm/engine";
import {
  clearWave,
  killShip,
  untilPlaying,
} from "../../starswarm/__tests__/helpers/engineFixtures";
import {
  WAVE_COMPLETED_EVENT,
  WAVE_TIMELINE_EVENT,
  timelinesInSendOrder,
} from "../../starswarm/waveEvents";
import { loadPuzzle, selectCell, toggleNotesMode } from "../../sudoku/engine";
import { applyRecorded, createEntryLog, unitOfEntry, type EntryTuple } from "../../sudoku/replay";
import type { CellValue } from "../../sudoku/types";
import {
  createSeededRng as twenty48Seed,
  move as twenty48Move,
  newGame as twenty48New,
  setRng as setTwenty48Rng,
  type Direction,
} from "../../twenty48/engine";
import { createMoveLog as createTwenty48Log, moveTuple } from "../../twenty48/replay";
import { asTurnSink, playGame as playYacht } from "../../yacht/__tests__/helpers/replayGame";
import { BugReportLimiter } from "../bugReportLimiter";
import { createMoveLog, recordChunk } from "../cards/moveLog";
import { GAMEPLAY_HOLD_MAX_MS, Priority, logConfig, resetLogConfig } from "../eventQueueConfig";
import { EventStore } from "../eventStore";
import { GameEventClientImpl, type EnqueueEventInput } from "../gameEventClient";
import { GameRecorder } from "../gameRecorder";
import { PendingGamesStore } from "../pendingGamesStore";
import type { SyncResponse } from "../syncApi";
import { SyncWorker } from "../syncWorker";
import type { GameType } from "../types";
import { MockSyncApi, asSyncApi, ok } from "./helpers/syncWorkerFixtures";

// ---------------------------------------------------------------------------
// The budget file
// ---------------------------------------------------------------------------

/** Every `{ max }` in the budget file, keyed by its path: `day.httpRequests`, `storedBytesPerGameType.hearts`. */
function flattenBudget(node: unknown, prefix = ""): Map<string, number> {
  const out = new Map<string, number>();
  if (node === null || typeof node !== "object") return out;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key.startsWith("_")) continue; // _comment, _measured: documentation only
    const at = prefix === "" ? key : `${prefix}.${key}`;
    if (value !== null && typeof value === "object" && "max" in value) {
      out.set(at, (value as { max: number }).max);
    } else {
      for (const [k, v] of flattenBudget(value, at)) out.set(k, v);
    }
  }
  return out;
}

const BUDGET_FILE = path.join(__dirname, "..", "..", "..", "..", "perf", "replay-budget.json");
const loadBudget = (): Map<string, number> =>
  flattenBudget(JSON.parse(fs.readFileSync(BUDGET_FILE, "utf8")));

/**
 * Every way `measured` is outside `budget`: over a max, a metric with no budget
 * (a new game type or counter must get one), or a budget nothing measured.
 */
function violations(
  measured: ReadonlyMap<string, number>,
  budget: ReadonlyMap<string, number>
): string[] {
  const out: string[] = [];
  for (const [key, value] of measured) {
    const max = budget.get(key);
    if (max === undefined) out.push(`${key}: measured ${value}, but the budget file has no entry`);
    else if (value > max) out.push(`${key}: measured ${value} is over its budget of ${max}`);
  }
  for (const key of budget.keys()) {
    if (!measured.has(key)) out.push(`${key}: budgeted, but the day did not measure it`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// What the server stores for a row
// ---------------------------------------------------------------------------

/** backend/games/replay_caps.py: what a stored event costs beyond its jsonb text. */
const ROW_OVERHEAD_BYTES = 200;

/** `value` as Postgres prints `jsonb::text` (a space after each `,` and `:` outside a string), in bytes. */
function jsonbBytes(value: unknown): number {
  const text = JSON.stringify(value) ?? "null";
  let inString = false;
  let extra = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i += 1;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === "," || ch === ":") extra += 1;
  }
  return Buffer.byteLength(text, "utf8") + extra;
}

// ---------------------------------------------------------------------------
// The games, each through its own replay path
// ---------------------------------------------------------------------------

/** One game as the recorder saved it: a batch of events per save, in order. */
interface Played {
  readonly type: GameType;
  readonly minutes: number;
  readonly saves: EnqueueEventInput[][];
  /** The app goes to the background (and returns 5 minutes later) after this many saves. */
  readonly backgroundAfterSave?: number;
}

/** A clock for `t_ms`: 1.5 s per read, so a seeded game records the same bytes every run. */
const steppingClock = () => {
  let t = 0;
  return () => (t += 1500);
};

/** A recorder over a sink that collects each save; `schedule` runs the idle task at once. */
function recorderInto<G extends GameType>(
  gameType: G,
  saves: EnqueueEventInput[][],
  options: { policy?: "on_unit_close" | "on_session_end" } = {}
): GameRecorder<G> {
  const recorder = new GameRecorder<G>({
    gameType,
    policy: options.policy,
    now: steppingClock(),
    sink: {
      canAccept: () => true,
      enqueueMany: (batch) => {
        saves.push([...batch]);
        return true;
      },
    },
    schedule: (task) => task(),
    report: (r) => {
      throw new Error(`the recorder dropped events: ${JSON.stringify(r)}`);
    },
  });
  recorder.startSession();
  return recorder;
}

/** Hearts: the real engine and AI, every deal, pass and hand recorded through HeartsReplay. */
function buildHearts(seed: number, withBackground: boolean): Played {
  const saves: EnqueueEventInput[][] = [];
  let tricks = 0;
  let backgroundAfterSave: number | undefined;
  setHeartsRng(heartsSeed(seed));
  playRecordedGame({
    onSave: (batch) => saves.push([...batch]),
    // The app goes to the background in the 20th trick: the recorder flushes there.
    flushAfter: () => {
      tricks += 1;
      if (withBackground && tricks === 20) {
        backgroundAfterSave = saves.length;
        return true;
      }
      return false;
    },
  });
  return { type: "hearts", minutes: 15, saves, backgroundAfterSave };
}

/** Yacht vs the computer: the scripted human, the hard CPU, a `turn_completed` per turn through the recorder. */
function buildYacht(seed: number, withBackground: boolean): Played {
  const saves: EnqueueEventInput[][] = [];
  const recorder = recorderInto("yacht", saves);
  playYacht(asTurnSink(recorder), { seed, difficulty: "hard" });
  recorder.endSession();
  return {
    type: "yacht",
    minutes: 8,
    saves,
    backgroundAfterSave: withBackground ? Math.floor(saves.length / 2) : undefined,
  };
}

/** Solitaire: a scripted, seeded game, its actions in chunks of 25 through the move log and recorder. */
function buildSolitaire(seed: number, withBackground: boolean): Played {
  const saves: EnqueueEventInput[][] = [];
  const recorder = recorderInto("solitaire", saves);
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
  let backgroundAfterSave: number | undefined;
  const { actions } = playSolitaire(seed, 1, 300);
  actions.forEach((action, i) => {
    log.push(action);
    // The app goes to the background mid-game: useFlushOnBackground cuts the chunk short.
    if (withBackground && i === 149) {
      log.flush();
      recorder.flush();
      backgroundAfterSave = saves.length;
    }
  });
  log.flush();
  recorder.endSession();
  return { type: "solitaire", minutes: 9, saves, backgroundAfterSave };
}

/**
 * Star Swarm: a seeded run on the real engine with the wave timeline on (#3441, as the canvas does
 * once the replay dial allows it); its closed waves, then its kept timelines, go out at the end
 * (`on_session_end`), as `sendClosedWaves` records them.
 */
function buildStarSwarm(seed: number, waves: number): Played {
  const saves: EnqueueEventInput[][] = [];
  const recorder = recorderInto("starswarm", saves, { policy: "on_session_end" });
  let s = initStarSwarm(CANVAS_W, CANVAS_H, 1, seed, "Commander", undefined, undefined, {
    timelineOn: true,
  });
  for (let i = 0; i < waves; i += 1) s = clearWave(untilPlaying(s));
  s = killShip(untilPlaying(s));
  for (const wave of s.closedWaves) recorder.record(WAVE_COMPLETED_EVENT, { ...wave });
  for (const tl of timelinesInSendOrder(s.closedTimelines ?? []))
    recorder.record(WAVE_TIMELINE_EVENT, { ...tl });
  recorder.endSession();
  return { type: "starswarm", minutes: 6, saves };
}

/** 2048: seeded swipes (a rotation of directions until the board locks), `moves` chunks through the move log. */
function buildTwenty48(seed: number): Played {
  const saves: EnqueueEventInput[][] = [];
  const recorder = recorderInto("twenty48", saves);
  const log = createTwenty48Log((m) => {
    recorder.beginUnit();
    recorder.record("moves", { m });
    recorder.closeUnit();
  });
  const order: readonly Direction[] = ["left", "up", "right", "down"];
  setTwenty48Rng(twenty48Seed(seed));
  let state = twenty48New();
  for (let turn = 0; turn < 3_000 && !state.game_over; turn += 1) {
    let moved = false;
    for (let k = 0; k < order.length && !moved; k += 1) {
      const direction = order[(turn + k) % order.length]!;
      try {
        state = twenty48Move(state, direction);
        const tuple = moveTuple(direction, state);
        if (tuple) log.push(tuple);
        moved = true;
      } catch {
        // no effect: try the next direction
      }
    }
    if (!moved) break;
  }
  log.flush();
  recorder.endSession();
  return { type: "twenty48", minutes: 4, saves };
}

/** Daily Word: a 4-guess win with two refused words, one event when the game ends. */
function buildDailyWord(): Played {
  const saves: EnqueueEventInput[][] = [];
  const recorder = recorderInto("daily_word", saves, { policy: "on_session_end" });
  const replay = createGuessReplay({
    beginUnit: (n) => recorder.beginUnit(n),
    record: (type, data) => recorder.record(type, data),
    closeUnit: () => recorder.closeUnit(),
  });
  const id = "p1";
  for (let i = 0; i < 2; i += 1) replay.refused(id);
  let board = initialState(id, 5, "en");
  for (const guess of ["crane", "least", "stale", "slate"]) {
    for (const ch of Array.from(guess)) board = setCurrentRowLetter(board, ch);
    board = applyServerResult(board, tilesWithDisplay(scoreGuess("slate", guess)));
  }
  replay.finish(board);
  recorder.endSession();
  return { type: "daily_word", minutes: 3, saves };
}

/** Sudoku: a heavy hard game (four pencil notes in every cell, then the digit, with erases and undos). */
function buildSudoku(): Played {
  const saves: EnqueueEventInput[][] = [];
  const recorder = recorderInto("sudoku", saves);
  const log = createEntryLog((first, e) => {
    recorder.beginUnit(unitOfEntry(first));
    recorder.record("entries", { i: first, e });
    recorder.closeUnit();
  });
  let s = loadPuzzle("hard", "classic", () => 0.77);
  const play = (action: Parameters<typeof applyRecorded>[1]) => {
    const r = applyRecorded(s, action);
    if (!r) return;
    s = r.next;
    log.push(r.entry as EntryTuple);
  };
  const empties = [...s.puzzle].flatMap((c, i) => (c === "0" ? [i] : []));
  for (const cell of empties) {
    s = selectCell(s, Math.floor(cell / 9), cell % 9);
    const sol = Number(s.solution[cell]);
    s = toggleNotesMode(s);
    for (const d of [sol, (sol % 9) + 1, ((sol + 1) % 9) + 1, ((sol + 2) % 9) + 1]) {
      play({ kind: "digit", digit: d as CellValue });
    }
    s = toggleNotesMode(s);
    play({ kind: "digit", digit: sol as CellValue });
    if (cell % 5 === 0) {
      play({ kind: "erase" });
      play({ kind: "digit", digit: sol as CellValue });
    }
    if (cell % 7 === 0) {
      play({ kind: "undo" });
      play({ kind: "digit", digit: sol as CellValue });
    }
  }
  log.flush();
  recorder.endSession();
  return { type: "sudoku", minutes: 20, saves };
}

/** Mahjong: a scripted Turtle game (matches, hints, undos, three shuffles) through MahjongReplay. */
function buildMahjong(): Played {
  const saves: EnqueueEventInput[][] = [];
  // The helper's recorder reads Date.now() for `t_ms`: give it the stepping clock.
  const spy = jest.spyOn(Date, "now").mockImplementation(steppingClock());
  try {
    playScripted({ layout: "turtle", seed: 42, forward: (batch) => saves.push([...batch]) });
  } finally {
    spy.mockRestore();
  }
  return { type: "mahjong", minutes: 12, saves };
}

/** The day, in the order it is played. Sudoku starts the offline hour. */
function buildDay(): { games: Played[]; offlineStartsAt: number } {
  const hearts = [buildHearts(1, true), buildHearts(18, false), buildHearts(5, false)];
  const yacht = [11, 12, 13, 14, 15].map((s) => buildYacht(s, s === 13));
  const solitaire = [17, 21, 33, 40, 44].map((s) => buildSolitaire(s, s === 21));
  const starswarm = [buildStarSwarm(1, 3), buildStarSwarm(2, 5), buildStarSwarm(3, 8)];
  const twenty48 = Array.from({ length: 10 }, (_, i) => buildTwenty48(i + 1));
  const sudoku = buildSudoku();
  const games: Played[] = [
    buildDailyWord(),
    ...twenty48.slice(0, 4),
    hearts[0]!,
    yacht[0]!,
    yacht[1]!,
    solitaire[0]!,
    solitaire[1]!,
    sudoku, // the offline hour starts here
    buildMahjong(),
    starswarm[0]!,
    ...twenty48.slice(4, 7),
    hearts[1]!,
    yacht[2]!,
    yacht[3]!,
    yacht[4]!,
    solitaire[2]!,
    solitaire[3]!,
    solitaire[4]!,
    starswarm[1]!,
    starswarm[2]!,
    ...twenty48.slice(7),
    hearts[2]!,
  ];
  return { games, offlineStartsAt: games.indexOf(sudoku) };
}

// ---------------------------------------------------------------------------
// The day
// ---------------------------------------------------------------------------

const MINUTE = 60_000;
const OFFLINE_MS = 60 * MINUTE;
/** The longest backoff (syncWorker.ts: 1 s doubling to 30 min): a recovery may take this long to be noticed. */
const RECOVERY_GRACE_MS = 30 * MINUTE;

interface Call {
  readonly path: string;
  readonly bytes: number;
  readonly ok: boolean;
  readonly offline: boolean;
}

/** A SyncApi that is down for a window of the fake clock, and logs every request it was sent. */
class DayApi extends MockSyncApi {
  readonly log: Call[] = [];
  offlineFrom = Number.POSITIVE_INFINITY;
  offlineUntil = Number.POSITIVE_INFINITY;
  /** Called with every request, before it is answered. */
  onRequest: (path: string, body: unknown) => void = () => undefined;
  /** The data of every accepted event, per game id and event index. */
  readonly accepted = new Map<string, Map<number, unknown>>();

  override async request(
    method: "POST" | "PATCH",
    requestPath: string,
    body: unknown
  ): Promise<SyncResponse> {
    const now = Date.now();
    const offline = now >= this.offlineFrom && now < this.offlineUntil;
    this.onRequest(requestPath, body);
    const bytes = Buffer.byteLength(JSON.stringify(body ?? {}), "utf8");
    if (offline) {
      this.calls.push({ method, path: requestPath, body });
      this.log.push({ path: requestPath, bytes, ok: false, offline });
      return { status: 0, ok: false, retryAfterMs: null, body: null };
    }
    const res = await super.request(method, requestPath, body);
    this.log.push({ path: requestPath, bytes, ok: res.ok, offline });
    const match = /^\/games\/([^/]+)\/events$/.exec(requestPath);
    if (res.ok && match) {
      const rows = this.accepted.get(match[1]!) ?? new Map<number, unknown>();
      for (const e of (body as { events: { event_index: number; data: unknown }[] }).events) {
        rows.set(e.event_index, e.data);
      }
      this.accepted.set(match[1]!, rows);
    }
    return res;
  }
}

interface DayResult {
  readonly measured: Map<string, number>;
  readonly info: Record<string, number>;
}

const appState = AppState as unknown as { currentState: AppStateStatus };

function appStateListener(): (s: AppStateStatus) => void {
  const changes = (AppState.addEventListener as jest.Mock).mock.calls.filter(
    (c: unknown[]) => c[0] === "change"
  );
  const last = changes[changes.length - 1];
  if (!last) throw new Error("SyncWorker did not subscribe to AppState");
  return last[1] as (s: AppStateStatus) => void;
}

const isLifecycleType = (type: string) =>
  logConfig.priorityForEvent("game_event", type) === Priority.LIFECYCLE;

const SENTRY_CAPTURES = () =>
  [Sentry.captureException, Sentry.captureMessage, Sentry.captureFeedback] as jest.Mock[];

async function runDay(
  games: readonly Played[],
  offlineStartsAt: number,
  recordingSentryEvents: number
): Promise<DayResult> {
  await AsyncStorage.clear();
  resetLogConfig();
  appState.currentState = "active";
  (AppState.addEventListener as jest.Mock).mockClear();
  const setItem = AsyncStorage.setItem as jest.Mock;
  setItem.mockClear();

  const store = new EventStore();
  const pending = new PendingGamesStore();
  const client = new GameEventClientImpl(store, pending, new BugReportLimiter());
  const api = new DayApi();
  api.defaultResponse = ok();
  const worker = new SyncWorker(store, pending, asSyncApi(api));
  await client.init();
  worker.start();
  const listener = appStateListener();

  // Sentry: every event the day sends, with the fake time it was sent at.
  const sentryAt: number[] = [];
  for (const fn of SENTRY_CAPTURES()) {
    fn.mockClear(); // the day's own calls only: the recording phase was counted in beforeAll
    fn.mockImplementation(() => {
      sentryAt.push(Date.now());
      return "id";
    });
  }
  const breadcrumbs = Sentry.addBreadcrumb as jest.Mock;
  breadcrumbs.mockClear();

  // Gameplay uploads while a session is open in the foreground. A session's
  // gameplay rows are held (#3275) until it ends, the app leaves the
  // foreground, or the oldest is GAMEPLAY_HOLD_MAX_MS old (the fallback, which
  // is counted on its own: a game longer than the hold is not a leak).
  const open = new Map<string, { heldSince: number | null }>();
  let gameplayWhileHeld = 0;
  let holdFallbackRequests = 0;
  api.onRequest = (requestPath, body) => {
    const match = /^\/games\/([^/]+)\/events$/.exec(requestPath);
    if (!match) return;
    const session = open.get(match[1]!);
    const events = (body as { events: { event_type: string }[] }).events;
    if (!session || !events.some((e) => !isLifecycleType(e.event_type))) return;
    if (appState.currentState === "background" || appState.currentState === "inactive") {
      session.heldSince = null; // released as the app left the foreground
      return;
    }
    if (session.heldSince !== null && Date.now() - session.heldSince >= GAMEPLAY_HOLD_MAX_MS) {
      holdFallbackRequests += 1;
    } else {
      gameplayWhileHeld += 1;
    }
    session.heldSince = null;
  };

  const advance = (ms: number) => jest.advanceTimersByTimeAsync(ms);
  const backgroundTrip = async (): Promise<void> => {
    appState.currentState = "inactive"; // the app switcher: no radio wake-up
    listener("inactive");
    await advance(10_000);
    appState.currentState = "background";
    listener("background");
    await advance(5 * MINUTE);
    appState.currentState = "active";
    listener("active");
  };

  const writesPerGame = new Map<string, number>();
  let offlineStart = 0;
  const dayStart = Date.now();
  for (const [index, game] of games.entries()) {
    if (index === offlineStartsAt) {
      offlineStart = Date.now();
      api.offlineFrom = offlineStart;
      api.offlineUntil = offlineStart + OFFLINE_MS;
    }
    const gameId = client.startGame(game.type);
    client.markStarted(gameId);
    open.set(gameId, { heldSince: null });
    const writesBefore = setItem.mock.calls.length;
    const gap = Math.floor((game.minutes * MINUTE) / (game.saves.length + 1));
    for (const [i, batch] of game.saves.entries()) {
      await advance(gap);
      client.enqueueEvents(gameId, batch);
      const session = open.get(gameId)!;
      if (session.heldSince === null) session.heldSince = Date.now();
      if (game.backgroundAfterSave === i + 1) await backgroundTrip();
    }
    await advance(gap);
    client.completeGame(gameId, { outcome: "completed", finalScore: 0 });
    open.delete(gameId);
    await advance(50); // the recording's own writes land (the upload is the next tick's)
    const writes = setItem.mock.calls.length - writesBefore;
    writesPerGame.set(game.type, Math.max(writesPerGame.get(game.type) ?? 0, writes));
    await advance(3 * MINUTE); // between games: idle ticks, the day's uploads
  }
  await advance(RECOVERY_GRACE_MS + 15 * MINUTE); // evening: whatever backed off drains
  const offlineEnd = api.offlineUntil;
  worker.stop();

  // Nothing is lost, and nothing is left: every row and completion reached the server.
  expect((await store.stats()).totalRows).toBe(0);
  expect(pending.all().length).toBe(0);
  const gameTypes = new Map<string, GameType>();
  for (const call of api.calls) {
    if (call.path === "/games") {
      const b = call.body as { id: string; game_type: GameType };
      gameTypes.set(b.id, b.game_type);
    }
  }
  const storedBytes = new Map<string, number>();
  let rows = 0;
  for (const [id, events] of api.accepted) {
    const type = gameTypes.get(id);
    if (!type) throw new Error(`events for game ${id} that was never created`);
    for (const data of events.values()) {
      rows += 1;
      storedBytes.set(
        type,
        (storedBytes.get(type) ?? 0) + jsonbBytes(data ?? {}) + ROW_OVERHEAD_BYTES
      );
    }
  }
  // + game_started, game_ended
  const expectedRows = games.reduce((n, g) => n + 2 + g.saves.reduce((m, b) => m + b.length, 0), 0);
  expect(rows).toBe(expectedRows);
  expect(api.log.filter((c) => c.ok && c.path.endsWith("/complete"))).toHaveLength(games.length);

  const sentryHealthy = sentryAt.filter(
    (t) => t < offlineStart || t >= offlineEnd + RECOVERY_GRACE_MS
  ).length;
  const measured = new Map<string, number>();
  measured.set("day.httpRequests", api.log.length);
  measured.set(
    "day.uploadedBytes",
    api.log.reduce((n, c) => n + c.bytes, 0)
  );
  measured.set("day.requestsDuringOfflineHour", api.log.filter((c) => c.offline).length);
  measured.set("day.storageWrites", setItem.mock.calls.length);
  measured.set("day.sentryEventsHealthy", sentryHealthy);
  measured.set("day.sentryEventsOffline", sentryAt.length - sentryHealthy);
  measured.set("day.sentryEventsRecording", recordingSentryEvents);
  measured.set("day.gameplayRequestsWhileOpenInForeground", gameplayWhileHeld);
  measured.set("day.holdFallbackRequests", holdFallbackRequests);
  for (const type of new Set(games.map((g) => g.type))) {
    measured.set(`storedBytesPerGameType.${type}`, storedBytes.get(type) ?? 0);
    measured.set(`storageWritesPerGame.${type}`, writesPerGame.get(type) ?? 0);
  }
  return {
    measured,
    info: {
      games: games.length,
      rows,
      breadcrumbs: breadcrumbs.mock.calls.length,
      dayMinutes: Math.round((Date.now() - dayStart) / MINUTE),
      failedRequests: api.log.filter((c) => !c.ok).length,
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Replay budget: a heavy player's day (#3398)", () => {
  let day: ReturnType<typeof buildDay>;

  let recordingSentryEvents = 0;

  beforeAll(() => {
    // The games are recorded here, before the day: count what Sentry is sent
    // while they are (a recorder's default drop report, say), never clear it.
    const calls: number[] = [];
    for (const fn of SENTRY_CAPTURES()) {
      fn.mockClear();
      fn.mockImplementation(() => {
        calls.push(1);
        return "id";
      });
    }
    day = buildDay();
    recordingSentryEvents = calls.length;
  });

  beforeEach(() => {
    jest.useFakeTimers({
      now: new Date("2026-03-02T07:00:00Z"),
      doNotFake: ["nextTick", "queueMicrotask", "setImmediate"],
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    resetLogConfig();
  });

  it("the day stays inside every budget in frontend/perf/replay-budget.json", async () => {
    const { measured, info } = await runDay(day.games, day.offlineStartsAt, recordingSentryEvents);
    process.stdout.write(
      `[budget #3398] ${JSON.stringify(Object.fromEntries(measured))} info ${JSON.stringify(info)}\n`
    );

    // The day is the one the issue asks for.
    const count = (type: GameType) => day.games.filter((g) => g.type === type).length;
    expect([
      count("hearts"),
      count("yacht"),
      count("solitaire"),
      count("starswarm"),
      count("twenty48"),
      count("daily_word"),
      count("sudoku"),
      count("mahjong"),
    ]).toEqual([3, 5, 5, 3, 10, 1, 1, 1]);
    expect(info.failedRequests).toBeGreaterThan(0); // the API really was down for an hour

    expect(violations(measured, loadBudget())).toEqual([]);
  }, 120_000);

  it("the budget check flags a metric over its max, one with no budget and a budget nobody measures", () => {
    const measured = new Map([
      ["day.httpRequests", 11],
      ["day.uploadedBytes", 5],
      ["storedBytesPerGameType.hearts", 7],
    ]);
    const budget = new Map([
      ["day.httpRequests", 10],
      ["day.uploadedBytes", 5],
      ["day.storageWrites", 3],
    ]);
    expect(violations(measured, budget)).toEqual([
      "day.httpRequests: measured 11 is over its budget of 10",
      "storedBytesPerGameType.hearts: measured 7, but the budget file has no entry",
      "day.storageWrites: budgeted, but the day did not measure it",
    ]);
    expect(
      violations(new Map([["day.httpRequests", 10]]), new Map([["day.httpRequests", 10]]))
    ).toEqual([]);
  });

  it("flattenBudget reads every { max } and skips the _measured and _comment documentation", () => {
    const flat = flattenBudget({
      _comment: "x",
      day: { a: { max: 3, _measured: 2 } },
      storedBytesPerGameType: { hearts: { max: 9, _measured: 8 } },
    });
    expect([...flat]).toEqual([
      ["day.a", 3],
      ["storedBytesPerGameType.hearts", 9],
    ]);
  });
});
