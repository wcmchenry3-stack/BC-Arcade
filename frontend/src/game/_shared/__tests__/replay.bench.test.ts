/**
 * Replay-recording benchmark with CI budgets (#3275, epic #3273): three games
 * played through the real pipeline — GameRecorder → gameEventClient →
 * eventStore → SyncWorker, over the in-memory AsyncStorage mock and a mocked
 * API — against a queue at its row cap (`SEED_ROWS` of `logConfig.MAX_ROWS`):
 *
 *   - a full Hearts game: 7 hands, a unit per trick plus one for the pass;
 *   - a 300-move Solitaire game: a unit per move;
 *   - a 13-round Yacht game against the CPU: a unit per round (both turns).
 *
 * The payloads are compact ASCII codes, the shapes #3280's adoptions record.
 * After every unit the recorder's idle task runs and a foreground SyncWorker
 * pass runs too (the worst case: a 30 s tick after every unit).
 *
 * Budgets. Counts are hard budgets — the fixture is deterministic, so they
 * never flake: writes per save, reads, bytes recorded, bytes written to
 * storage, and uploads. Time is printed and held only to a generous ceiling
 * (`MAX_MEAN_SAVE_MS`): CI runners are shared, run jest with coverage, and
 * are several times slower than a laptop, so a tight time budget would flake
 * there. The `BUDGETS` table is the input to the budget file (#3294); the
 * measured numbers are recorded in docs/PERFORMANCE.md ("Replay recording").
 *
 * Run it on its own with
 *   cd frontend && npx jest src/game/_shared/__tests__/replay.bench.test.ts
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

import { BugReportLimiter } from "../bugReportLimiter";
import { EventStore, type Row } from "../eventStore";
import {
  Priority,
  logConfig,
  recordingConfigFor,
  resetLogConfig,
  type Priority as PriorityT,
} from "../eventQueueConfig";
import { GameEventClientImpl, type EnqueueEventInput } from "../gameEventClient";
import { GameRecorder, type RecordActor, type RecordingDropReport } from "../gameRecorder";
import { PendingGamesStore } from "../pendingGamesStore";
import { SyncWorker } from "../syncWorker";
import type { GameType } from "../types";
import { MockSyncApi, asSyncApi, ok } from "./helpers/syncWorkerFixtures";

/**
 * 98% of the row cap (`logConfig.MAX_ROWS`, 5,000): a long-offline device's
 * queue. Each game's rows push it over the cap, so saves evict (the oldest
 * rows first: the seeded ones), and the bench checks that no row of the
 * session being held is ever evicted.
 */
const SEED_ROWS = 4_900;
const TIERS: PriorityT[] = [0, 1, 2, 3];

/**
 * A generous ceiling on the mean time of one save (the recorder's call into
 * the queue until its write landed), against the queue at its cap. Measured
 * at 1–3 ms in this container; the ceiling is ~10× that, for CI's shared,
 * coverage-instrumented runners. A regression to per-event writes or reads
 * (the #2959 failure mode, 20+ ms per event) still breaks it.
 */
const MAX_MEAN_SAVE_MS = 40;

interface Budget {
  /** Most queue (`event_queue_v1/*`) writes one save that evicts nothing may cost. */
  readonly queueWritesPerSave: number;
  /**
   * Most queue writes one save that evicts may cost: its own tiers plus the
   * tiers it evicted from, never more than the four tiers.
   */
  readonly queueWritesPerEvictingSave: number;
  /** Most pending-games writes one save may cost (the event_index counter). */
  readonly pendingWritesPerSave: number;
  /** Most JSON length (UTF-16 units) the game's recorded `data` may add up to. */
  readonly recordedBytes: number;
  /** Most bytes written to storage (the setItem values) while the game is played. */
  readonly storageBytesWritten: number;
  /** Most POST /games/:id/events for the whole game, end-of-game flush included. */
  readonly eventPosts: number;
}

/**
 * The CI budgets per game (#3294's input). Byte budgets are the measured
 * value plus ~15% headroom (room for a field or two, not for a new event per
 * move); writes per save and POST counts are structural, so they are exact:
 * one write per tier a save touches (plus, for a save that evicts at the
 * cap, the tiers it evicted from: at most all four), one counter write, and POSTs = 1
 * (game_started) + one per lifecycle row the game records while open (Hearts'
 * hand_resolved) + ceil(rows / GAME_EVENT_BATCH_SIZE) at the end. The
 * measured values are in docs/PERFORMANCE.md ("Replay recording").
 */
const BUDGETS: Readonly<Record<string, Budget>> = {
  hearts: {
    queueWritesPerSave: 2,
    queueWritesPerEvictingSave: 4,
    pendingWritesPerSave: 1,
    recordedBytes: 50_000,
    storageBytesWritten: 111_000_000,
    eventPosts: 11,
  },
  solitaire: {
    queueWritesPerSave: 1,
    queueWritesPerEvictingSave: 4,
    pendingWritesPerSave: 1,
    recordedBytes: 20_000,
    storageBytesWritten: 189_000_000,
    eventPosts: 3,
  },
  yacht: {
    queueWritesPerSave: 2,
    queueWritesPerEvictingSave: 4,
    pendingWritesPerSave: 1,
    recordedBytes: 13_000,
    storageBytesWritten: 11_300_000,
    eventPosts: 2,
  },
};

interface Recorded {
  readonly type: string;
  readonly data: Record<string, unknown>;
  readonly actor?: RecordActor;
}

interface Script {
  readonly name: keyof typeof BUDGETS;
  readonly gameType: GameType;
  readonly units: readonly (readonly Recorded[])[];
}

// ---------------------------------------------------------------------------
// The three games (deterministic)
// ---------------------------------------------------------------------------

const SUITS = ["C", "D", "S", "H"];
const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"];
const card = (i: number) => `${RANKS[i % 13]}${SUITS[Math.floor(i / 13) % 4]}`;
const cpu = (seat: number): RecordActor => ({
  seat,
  kind: "cpu",
  cpu_type: "shark",
  difficulty: "hard",
});
const seatActor = (seat: number): RecordActor => (seat === 0 ? { seat, kind: "human" } : cpu(seat));

function heartsGame(): Script {
  const units: Recorded[][] = [];
  for (let hand = 0; hand < 7; hand += 1) {
    const pass: Recorded[] = [];
    for (let seat = 0; seat < 4; seat += 1) {
      pass.push({
        type: "cards_passed",
        data: { d: hand % 4, c: [card(seat * 3), card(seat * 3 + 1), card(seat * 3 + 2)] },
        actor: seatActor(seat),
      });
    }
    units.push(pass);
    for (let trick = 0; trick < 13; trick += 1) {
      const unit: Recorded[] = [];
      for (let k = 0; k < 4; k += 1) {
        const seat = (trick + k) % 4;
        unit.push({
          type: "card_played",
          data: { c: card(trick * 4 + k) },
          actor: seatActor(seat),
        });
      }
      unit.push({ type: "trick_won", data: { w: trick % 4, p: trick % 3 } });
      if (trick === 12) {
        unit.push({ type: "hand_resolved", data: { h: hand, s: [6, 13, 0, 7], m: false } });
      }
      units.push(unit);
    }
  }
  return { name: "hearts", gameType: "hearts", units };
}

function solitaireGame(): Script {
  const units: Recorded[][] = [];
  for (let move = 0; move < 300; move += 1) {
    const draw = move % 5 === 0;
    units.push([
      draw
        ? { type: "draw", data: { n: 3, w: move % 24 } }
        : {
            type: "move",
            data: {
              f: `t${move % 7}`,
              t: move % 9 === 0 ? `f${move % 4}` : `t${(move + 3) % 7}`,
              n: 1 + (move % 3),
              c: card(move),
            },
          },
    ]);
  }
  return { name: "solitaire", gameType: "solitaire", units };
}

function yachtGame(): Script {
  const units: Recorded[][] = [];
  const categories = [
    "ones",
    "twos",
    "threes",
    "fours",
    "fives",
    "sixes",
    "three_of_a_kind",
    "four_of_a_kind",
    "full_house",
    "small_straight",
    "large_straight",
    "yacht",
    "chance",
  ];
  for (let round = 0; round < 13; round += 1) {
    const unit: Recorded[] = [];
    for (let seat = 0; seat < 2; seat += 1) {
      const actor = seat === 0 ? ({ seat, kind: "human" } as const) : cpu(seat);
      for (let roll = 0; roll < 3; roll += 1) {
        const d = [1, 2, 3, 4, 5].map((x) => ((x * (round + 2) + roll + seat) % 6) + 1);
        unit.push({ type: "roll", data: { r: roll + 1, d, h: roll === 0 ? [] : [0, 2] }, actor });
      }
      unit.push({
        type: "score",
        data: { k: categories[(round + seat) % 13], p: (round * 3) % 30 },
        actor,
      });
    }
    units.push(unit);
  }
  return { name: "yacht", gameType: "yacht", units };
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function seedRow(i: number, base: number): Row {
  const priority = TIERS[i % TIERS.length] ?? Priority.GRANULAR;
  const common = {
    id: `seed-${i}`,
    payload: { i, s: "x".repeat(64) },
    created_at: base + i,
    priority,
    retry_count: 0,
    next_retry_at: null,
  };
  if (priority === Priority.BUG_LOG) {
    return {
      ...common,
      log_type: "bug_log",
      bug_uuid: `bug-${i}`,
      bug_level: "warn",
      bug_source: "bench",
    };
  }
  return { ...common, log_type: "game_event", game_id: "seed", event_index: i, event_type: "move" };
}

interface Measured {
  units: number;
  events: number;
  saves: number;
  maxQueueWritesPerSave: number;
  maxPendingWritesPerSave: number;
  /** A save that evicted nothing but wrote more queue keys than the tiers its events touch. */
  savesOverTiers: number;
  /** Saves that evicted rows to stay under the cap, and the most queue writes one of them made. */
  evictingSaves: number;
  maxQueueWritesPerEvictingSave: number;
  evictedRows: number;
  /** The open session's rows that never reached the server (evicted): must be none. */
  sessionRowsLost: number;
  reads: number;
  recordedBytes: number;
  storageBytesWritten: number;
  meanSaveMs: number;
  maxSaveMs: number;
  /** POST /games/:id/events carrying a gameplay (non-lifecycle) row, while the game was open. */
  gameplayPostsWhileOpen: number;
  eventPosts: number;
  uploadedBytes: number;
  drops: RecordingDropReport | null;
}

async function play(script: Script): Promise<Measured> {
  await AsyncStorage.clear();
  resetLogConfig();
  const store = new EventStore();
  const games = new PendingGamesStore();
  const client = new GameEventClientImpl(store, games, new BugReportLimiter());
  const api = new MockSyncApi();
  api.defaultResponse = ok();
  const worker = new SyncWorker(store, games, asSyncApi(api));
  await client.init();
  const base = Date.now() - SEED_ROWS;
  await store.seedRows(Array.from({ length: SEED_ROWS }, (_, i) => seedRow(i, base)));
  // The seeded rows belong to no game here: leave them dead-lettered, as the
  // first pass would, so the passes below post only the game's own rows.
  await store.markDeadLettered(Array.from({ length: SEED_ROWS }, (_, i) => `seed-${i}`));

  const gameId = client.startGame(script.gameType);
  client.markStarted(gameId);
  await worker.flush(); // POST /games and game_started: lifecycle, on time

  // Time each save from the client's call into the queue until its write lands.
  const durations: number[] = [];
  const pending: Promise<unknown>[] = [];
  const enqueueMany = store.enqueueMany.bind(store);
  jest.spyOn(store, "enqueueMany").mockImplementation((inputs) => {
    const t0 = performance.now();
    const p = enqueueMany(inputs).then((rows) => {
      durations.push(performance.now() - t0);
      return rows;
    });
    pending.push(p);
    return p;
  });

  let drops: RecordingDropReport | null = null;
  let recordedBytes = 0;
  const tasks: (() => void)[] = [];
  const recorder = new GameRecorder({
    gameType: script.gameType,
    policy: "on_unit_close",
    sink: {
      canAccept: () => true,
      enqueueMany: (events: readonly EnqueueEventInput[]) => {
        for (const e of events) recordedBytes += JSON.stringify(e.data ?? {}).length;
        client.enqueueEvents(gameId, events);
        return true;
      },
    },
    schedule: (task) => tasks.push(task),
    report: (r) => {
      drops = r;
    },
  });

  const getItem = AsyncStorage.getItem as jest.Mock;
  const setItem = AsyncStorage.setItem as jest.Mock;
  let reads = 0;
  let storageBytesWritten = 0;
  let maxQueueWritesPerSave = 0;
  let maxPendingWritesPerSave = 0;
  let savesOverTiers = 0;
  let evictingSaves = 0;
  let maxQueueWritesPerEvictingSave = 0;
  let evictedRows = 0;
  let gameplayPostsWhileOpen = 0;
  let events = 0;

  const isLifecycle = (type: string) =>
    logConfig.priorityForEvent("game_event", type) === Priority.LIFECYCLE;

  recorder.startSession();
  for (const unit of script.units) {
    const rowsBefore = (await store.stats()).totalRows;
    getItem.mockClear();
    setItem.mockClear();
    pending.length = 0;
    recorder.beginUnit();
    for (const e of unit) recorder.record(e.type, { ...e.data }, e.actor);
    recorder.closeUnit();
    while (tasks.length > 0) tasks.shift()?.(); // the idle moment
    await Promise.all(pending);
    // Let the coalesced counter write land too.
    await new Promise((r) => setTimeout(r, 0));
    events += unit.length;

    const writes = setItem.mock.calls as [string, string][];
    const queueWrites = writes.filter(([k]) => k.startsWith("event_queue_v1/")).length;
    const pendingWrites = writes.filter(([k]) => k === "pending_games_v1").length;
    const tiers = new Set(unit.map((e) => logConfig.priorityForEvent("game_event", e.type)));
    storageBytesWritten += writes.reduce((n, [, v]) => n + v.length, 0);
    reads += getItem.mock.calls.length;
    maxPendingWritesPerSave = Math.max(maxPendingWritesPerSave, pendingWrites);
    const evicted = rowsBefore + unit.length - (await store.stats()).totalRows;
    if (evicted > 0) {
      evictingSaves += 1;
      evictedRows += evicted;
      maxQueueWritesPerEvictingSave = Math.max(maxQueueWritesPerEvictingSave, queueWrites);
    } else {
      if (queueWrites > tiers.size) savesOverTiers += 1;
      maxQueueWritesPerSave = Math.max(maxQueueWritesPerSave, queueWrites);
    }

    // A 30 s tick after every unit, in the foreground.
    const before = api.calls.length;
    await worker.flush();
    for (const c of api.calls.slice(before)) {
      if (c.path !== `/games/${gameId}/events`) continue;
      const types = (c.body as { events: { event_type: string }[] }).events.map(
        (e) => e.event_type
      );
      if (types.some((t) => !isLifecycle(t))) gameplayPostsWhileOpen += 1;
    }
  }
  recorder.endSession();
  client.completeGame(gameId, { outcome: "completed", finalScore: 0 });
  await new Promise((r) => setTimeout(r, 10));
  await worker.flush();
  await worker.flush();

  const posts = api.calls.filter((c) => c.path === `/games/${gameId}/events`);
  // Every event_index the session reserved (game_started to game_ended)
  // reached the server: none of its held rows was evicted at the cap.
  const posted = new Set(
    posts.flatMap((c) =>
      (c.body as { events: { event_index: number }[] }).events.map((e) => e.event_index)
    )
  );
  const reserved = events + 2; // + game_started, game_ended
  let sessionRowsLost = 0;
  for (let i = 0; i < reserved; i += 1) if (!posted.has(i)) sessionRowsLost += 1;
  const uploadedBytes = posts.reduce((n, c) => n + JSON.stringify(c.body).length, 0);
  const saves = durations.length;
  const meanSaveMs = durations.reduce((a, b) => a + b, 0) / Math.max(saves, 1);
  const maxSaveMs = Math.max(...durations);
  worker.stop();
  return {
    units: script.units.length,
    events,
    saves,
    maxQueueWritesPerSave,
    maxPendingWritesPerSave,
    savesOverTiers,
    evictingSaves,
    maxQueueWritesPerEvictingSave,
    evictedRows,
    sessionRowsLost,
    reads,
    recordedBytes,
    storageBytesWritten,
    meanSaveMs,
    maxSaveMs,
    gameplayPostsWhileOpen,
    eventPosts: posts.length,
    uploadedBytes,
    drops,
  };
}

describe(`Replay recording benchmark (#3275): three games against a ${SEED_ROWS}-row queue`, () => {
  afterEach(() => {
    jest.restoreAllMocks();
    resetLogConfig();
  });

  it.each([heartsGame(), solitaireGame(), yachtGame()])(
    "$name stays inside its budgets",
    async (script) => {
      const m = await play(script);
      const budget = BUDGETS[script.name]!;
      process.stdout.write(
        `[bench #3275] ${script.name}: ${m.units} units, ${m.events} events, ${m.saves} saves; ` +
          `queue writes/save ≤ ${m.maxQueueWritesPerSave}, pending writes/save ≤ ${m.maxPendingWritesPerSave}, ` +
          `evicting saves ${m.evictingSaves} (${m.evictedRows} rows, max ${m.maxQueueWritesPerEvictingSave} writes), ` +
          `session rows lost ${m.sessionRowsLost}; reads ${m.reads}; recorded ${m.recordedBytes} B, written to storage ${m.storageBytesWritten} B; ` +
          `save ${m.meanSaveMs.toFixed(2)} ms mean / ${m.maxSaveMs.toFixed(2)} ms max; ` +
          `POST events ${m.eventPosts} (${m.uploadedBytes} B), gameplay POSTs while open ${m.gameplayPostsWhileOpen}\n`
      );

      // The fixture is realistic: nothing over the caps, one save per unit.
      expect(m.drops).toBeNull();
      expect(m.recordedBytes).toBeLessThanOrEqual(
        recordingConfigFor(script.gameType).sessionMaxBytes
      );
      expect(m.saves).toBe(m.units);

      // Hard budgets (counts).
      expect(m.reads).toBe(0);
      expect(m.savesOverTiers).toBe(0);
      expect(m.maxQueueWritesPerSave).toBeLessThanOrEqual(budget.queueWritesPerSave);
      expect(m.evictingSaves).toBeGreaterThan(0); // the queue really is at its cap
      expect(m.maxQueueWritesPerEvictingSave).toBeLessThanOrEqual(
        budget.queueWritesPerEvictingSave
      );
      expect(m.sessionRowsLost).toBe(0);
      expect(m.maxPendingWritesPerSave).toBeLessThanOrEqual(budget.pendingWritesPerSave);
      expect(m.recordedBytes).toBeLessThanOrEqual(budget.recordedBytes);
      expect(m.storageBytesWritten).toBeLessThanOrEqual(budget.storageBytesWritten);
      expect(m.gameplayPostsWhileOpen).toBe(0);
      expect(m.eventPosts).toBeLessThanOrEqual(budget.eventPosts);

      // Time: a generous ceiling only (see MAX_MEAN_SAVE_MS).
      expect(m.meanSaveMs).toBeLessThanOrEqual(MAX_MEAN_SAVE_MS);
    },
    120_000
  );
});
