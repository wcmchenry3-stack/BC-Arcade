/**
 * Hearts replay recording benchmark (#3283, epic #3273): a whole seeded game
 * (the real engine and conservative AI, every deal, pass, trick and hand score
 * recorded) saved two ways over the real GameEventClient → EventStore →
 * AsyncStorage mock, with an idle moment after every unit:
 *
 *   - as built: the GameRecorder, one unit (one queue save) per deal, per pass
 *     and per trick, `hand_scored` riding on the 13th trick;
 *   - the alternative: one event per card played, one queue save each.
 *
 * Counts are hard budgets: the fixture is seeded and the conservative AI is
 * deterministic. The numbers are printed and recorded in docs/games/hearts.md
 * ("Replay recording"). Run it on its own with
 *   cd frontend && npx jest src/game/hearts/__tests__/replay.bench.test.ts
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

import { BugReportLimiter } from "../../_shared/bugReportLimiter";
import { recordingConfigFor, resetLogConfig } from "../../_shared/eventQueueConfig";
import { EventStore } from "../../_shared/eventStore";
import { GameEventClientImpl } from "../../_shared/gameEventClient";
import { PendingGamesStore } from "../../_shared/pendingGamesStore";
import { createSeededRng, setRng } from "../engine";
import { MAX_PARTS_PER_HAND } from "../replay";
import { playRecordedGame, rebuildGame, type PlayedGame } from "./helpers/replayGame";

/** A seeded game of 11 hands: the median length of a conservative-CPU game. */
const SEED = 1;

interface Measured {
  /** Calls into the queue (`EventStore.enqueueEvent` / `enqueueMany`). */
  saves: number;
  /** AsyncStorage writes of any key while the game was played. */
  storageWrites: number;
  storageBytes: number;
  events: number;
  /** JSON length of every event's `data`. */
  recordedBytes: number;
}

async function newClient() {
  await AsyncStorage.clear();
  resetLogConfig();
  const store = new EventStore();
  const client = new GameEventClientImpl(store, new PendingGamesStore(), new BugReportLimiter());
  await client.init();
  const gameId = client.startGame("hearts");
  client.markStarted(gameId);
  await new Promise((r) => setTimeout(r, 10));
  const saveMany = jest.spyOn(store, "enqueueMany");
  const saveEvent = jest.spyOn(store, "enqueueEvent");
  const setItem = AsyncStorage.setItem as jest.Mock;
  setItem.mockClear();
  const measure = (events: number, recordedBytes: number): Measured => {
    const writes = setItem.mock.calls as [string, string][];
    return {
      saves: saveMany.mock.calls.length + saveEvent.mock.calls.length,
      storageWrites: writes.length,
      storageBytes: writes.reduce((n, [, v]) => n + v.length, 0),
      events,
      recordedBytes,
    };
  };
  return { client, gameId, measure };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

const jsonLength = (e: { data?: unknown }) => JSON.stringify(e.data).length;

/** The game as built: the recorder saves a unit at a time. */
async function asBuilt(seed = SEED): Promise<{ measured: Measured; game: PlayedGame }> {
  const { client, gameId, measure } = await newClient();
  setRng(createSeededRng(seed));
  const game = playRecordedGame({
    onSave: (batch) => {
      client.enqueueEvents(gameId, batch);
    },
  });
  await settle();
  await settle();
  return {
    game,
    measured: measure(
      game.saved.length,
      game.saved.reduce((n, e) => n + jsonLength(e), 0)
    ),
  };
}

/**
 * The alternative this design avoids: one event per card played, each its own
 * queue save (the shape of the dev hand log's plays). `hand_opened` is as
 * built; a hand's plays become `{h, n, s, c}` events, `s` the position in the trick.
 */
async function onePerCard(game: PlayedGame): Promise<Measured> {
  const { client, gameId, measure } = await newClient();
  let events = 0;
  let recorded = 0;
  for (const e of game.saved) {
    const data = e.data as Record<string, unknown>;
    const plays = e.type === "hand_played" ? (data.c as string) : "";
    const batch =
      e.type === "hand_played"
        ? Array.from({ length: plays.length / 2 }, (_, i) => ({
            type: e.type,
            data: {
              v: data.v,
              unit: data.unit,
              t_ms: data.t_ms,
              h: data.h,
              n: ((data.n as number | undefined) ?? 1) + Math.floor(i / 4),
              s: i % 4,
              c: plays.slice(i * 2, i * 2 + 2),
            },
          }))
        : [e];
    for (const event of batch) {
      client.enqueueEvent(gameId, event);
      events += 1;
      recorded += jsonLength(event);
      await settle();
    }
  }
  return measure(events, recorded);
}

/**
 * The length of `value` as Postgres stores it (`jsonb::text`): JSON with a space
 * after each `,` and `:` outside a string (backend/payload_size.py).
 */
function jsonbLength(value: unknown): number {
  const text = JSON.stringify(value);
  let inString = false;
  let extra = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === "," || ch === ":") extra++;
  }
  return text.length + extra;
}

/** What a game's events cost stored on the server: jsonb text plus the 200 B row overhead each. */
const ROW_OVERHEAD_BYTES = 200;
const storedBytes = (events: readonly { data?: unknown }[]) =>
  events.reduce((n, e) => n + jsonbLength(e.data) + ROW_OVERHEAD_BYTES, 0);

/** The epic's plan for the replay storage budget: 40 KB a game (DATA-INVENTORY §2a). */
const PLAN_BYTES_PER_GAME = 40 * 1024;

describe("Hearts replay recording benchmark (#3283)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    resetLogConfig();
  });

  it("an 11-hand game: two saves a hand, far fewer saves, writes and bytes than one per card", async () => {
    const { measured: built, game } = await asBuilt();
    const perCard = await onePerCard(game);
    const hands = game.final.scoreHistory.length;
    const stored = storedBytes(game.saved);
    process.stdout.write(
      `[bench #3283] hearts, seed ${SEED}, ${hands} hands: as built ${built.saves} saves, ` +
        `${built.storageWrites} storage writes, ${built.storageBytes} B written, ${built.events} events / ` +
        `${built.recordedBytes} B recorded, ${stored} B stored on the server; one event per card ` +
        `${perCard.saves} saves, ${perCard.storageWrites} storage writes, ${perCard.storageBytes} B written, ` +
        `${perCard.events} events / ${perCard.recordedBytes} B recorded, ${storedBytes([...Array(perCard.events)].map(() => ({ data: { v: 1, unit: 100, t_ms: 100000, h: 10, n: 10, s: 3, c: "QS" } })))} B stored\n`
    );
    expect(hands).toBe(11);

    // Two events a hand, one queue save each (a hand is opened once, played once).
    expect(built.events).toBe(2 * hands);
    expect(built.saves).toBe(2 * hands);
    // A save is one queue write plus the pending-games counter.
    expect(built.storageWrites).toBeLessThanOrEqual(built.saves * 2);
    // A fraction of what a save per card would cost.
    expect(perCard.saves).toBe(hands + 52 * hands);
    expect(built.saves).toBeLessThan(perCard.saves / 20);
    expect(built.storageWrites).toBeLessThan(perCard.storageWrites / 20);
    expect(built.storageBytes).toBeLessThan(perCard.storageBytes / 20);
    expect(built.recordedBytes).toBeLessThan(perCard.recordedBytes / 2);

    // Recorded on the device: about 600 B a hand, far inside the session cap.
    expect(built.recordedBytes / hands).toBeLessThan(700);
    expect(built.recordedBytes).toBeLessThan(recordingConfigFor("hearts").sessionMaxBytes / 4);

    // Stored on the server (jsonb text + 200 B a row): the epic plans 40 KB a game.
    expect(game.saved).toHaveLength(22);
    expect(stored).toBeLessThan(12_000);
    expect(stored).toBeLessThan(PLAN_BYTES_PER_GAME / 3);
    expect(game.final.phase).toBe("game_over");
  }, 60_000);

  it("the longest possible game (16 hands, the widest digits) stays under the 40 KB plan, and matches the backend's figure", () => {
    const env = { v: 1, unit: 900, t_ms: 2147483647 };
    const deck = [
      "2C3C4C5C6C7C8C9CTCJCQCKCAC",
      "2D3D4D5D6D7D8D9DTDJDQDKDAD",
      "2S3S4S5S6S7S8S9STSJSQSKSAS",
      "2H3H4H5H6H7H8H9HTHJHQHKHAH",
    ];
    const plays = "23456789TJQKA"
      .split("")
      .flatMap((r) => "CDHS".split("").map((s) => r + s))
      .join("");
    const rows = Array.from({ length: 16 }, (_, i) => [
      {
        data: {
          ...env,
          h: i + 1,
          d: i % 4,
          c: deck,
          p: ["2C3C4C", "2D3D4D", "2S3S4S", "2H3H4H"],
          r: "888888888888",
        },
      },
      {
        data: {
          ...env,
          h: i + 1,
          l: 3,
          c: plays,
          r: "8888".repeat(13),
          s: [26, 26, 26, 0],
          t: [125, 125, 125, 125],
          m: 3,
        },
      },
    ]).flat();
    expect(rows).toHaveLength(32);
    // backend/tests/test_hearts_replay_events.py computes the same figure with payload_size.jsonb_bytes
    expect(storedBytes(rows)).toBe(15_054);
    expect(storedBytes(rows)).toBeLessThan(PLAN_BYTES_PER_GAME / 2);
  });

  it("a game backgrounded and blurred after every trick still makes at most 5 rows a hand, and stays under the plan", () => {
    setRng(createSeededRng(18));
    const game = playRecordedGame({
      flushAfter: () => true, // the app is backgrounded after every trick
      blurAfter: () => true, // and the scorecard is opened after every trick
    });
    const hands = game.final.scoreHistory.length;
    expect(hands).toBe(15);
    const rowsPerHand = Array.from(
      { length: hands },
      (_, i) => game.saved.filter((e) => (e.data as { h: number }).h === i + 1).length
    );
    expect(Math.max(...rowsPerHand)).toBe(1 + MAX_PARTS_PER_HAND + 1);
    const stored = storedBytes(game.saved);
    process.stdout.write(
      `[bench #3283] hearts, seed 18, ${hands} hands, backgrounded after every trick: ${game.saved.length} rows, ${stored} B stored\n`
    );
    expect(stored).toBeLessThan(PLAN_BYTES_PER_GAME);
    expect(rebuildGame(game.saved).problems).toEqual([]);
  }, 60_000);

  it("a long real game (seed 18, 15 hands) is still two rows a hand and under the plan", async () => {
    const { measured, game } = await asBuilt(18);
    expect(game.final.scoreHistory.length).toBe(15);
    expect(measured.saves).toBe(30);
    expect(storedBytes(game.saved)).toBeLessThan(PLAN_BYTES_PER_GAME / 2);
  }, 60_000);
});
