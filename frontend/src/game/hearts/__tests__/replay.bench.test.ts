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
import { playRecordedGame, type PlayedGame } from "./helpers/replayGame";

const SEED = 4;

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
async function asBuilt(): Promise<{ measured: Measured; game: PlayedGame }> {
  const { client, gameId, measure } = await newClient();
  setRng(createSeededRng(SEED));
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
 * queue save (the shape of the dev hand log's plays). The other events are as
 * built; a trick becomes four `{h, n, s, c, r?}` plays.
 */
async function onePerCard(game: PlayedGame): Promise<Measured> {
  const { client, gameId, measure } = await newClient();
  let events = 0;
  let recorded = 0;
  for (const e of game.saved) {
    const data = e.data as Record<string, unknown>;
    const batch =
      e.type === "trick_completed"
        ? [0, 1, 2, 3].map((i) => ({
            type: e.type,
            data: {
              v: data.v,
              unit: data.unit,
              t_ms: data.t_ms,
              h: data.h,
              n: data.n,
              s: ((data.l as number) + i) % 4,
              c: (data.c as string).slice(i * 2, i * 2 + 2),
              ...(data.r ? { r: (data.r as number[])[i] } : {}),
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

describe("Hearts replay recording benchmark (#3283)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    resetLogConfig();
  });

  it("a whole game: one save per deal, pass and trick; far fewer saves, writes and bytes than one per card", async () => {
    const { measured: built, game } = await asBuilt();
    const perCard = await onePerCard(game);
    const hands = game.final.scoreHistory.length;
    const passes = Array.from({ length: hands }, (_, i) => i + 1).filter((h) => h % 4 !== 0).length;
    const units = hands + passes + 13 * hands; // deals, passes, tricks (hand_scored rides on a trick)
    process.stdout.write(
      `[bench #3283] hearts, seed ${SEED}, ${hands} hands: as built ${built.saves} saves, ` +
        `${built.storageWrites} storage writes, ${built.storageBytes} B written, ${built.events} events / ` +
        `${built.recordedBytes} B recorded; one event per card ${perCard.saves} saves, ` +
        `${perCard.storageWrites} storage writes, ${perCard.storageBytes} B written, ${perCard.events} events / ` +
        `${perCard.recordedBytes} B recorded\n`
    );

    // Structural: one save per unit (the AC), one event per thing recorded.
    expect(built.saves).toBe(units);
    expect(built.events).toBe(units + hands); // + one hand_scored per hand
    expect(perCard.saves).toBe(built.events + 3 * 13 * hands);

    // One storage write per trick: a unit is one tier, so a save is one queue write
    // plus the pending-games counter.
    expect(built.storageWrites).toBeLessThanOrEqual(built.saves * 2);
    // The game is a fraction of what a save per card would cost.
    expect(built.saves).toBeLessThan(perCard.saves / 3);
    expect(built.storageWrites).toBeLessThan(perCard.storageWrites / 3);
    expect(built.storageBytes).toBeLessThan(perCard.storageBytes / 3);
    expect(built.recordedBytes).toBeLessThan(perCard.recordedBytes);

    // The recording is small and far inside the game's session cap.
    expect(built.recordedBytes).toBeLessThan(recordingConfigFor("hearts").sessionMaxBytes / 2);
    expect(built.recordedBytes / hands).toBeLessThan(1_800); // per hand: a deal, a pass, 13 tricks, a score

    // No game can outgrow the server's cap: the 100-point rule ends one within 16
    // hands, and 16 hands x 16 events is 256 < 500 (docs/games/hearts.md).
    expect(hands).toBeLessThanOrEqual(16);
    expect(game.final.phase).toBe("game_over");
  }, 60_000);
});
