/**
 * FreeCell replay recording benchmark (#3289, epic #3273): scripted, seeded
 * games recorded the way the screen does (chunks of 25 actions through the
 * GameRecorder, saved at an idle moment) over the real GameEventClient ->
 * EventStore -> AsyncStorage mock, against the naive alternative of one event
 * and one save per action. The numbers are printed and recorded in
 * docs/games/freecell.md ("Replay recording"). Run it on its own with
 *   cd frontend && npx jest src/game/freecell/__tests__/replay.bench.test.ts
 */

import { playPerAction, playRecorded } from "../../_shared/cards/__tests__/helpers/benchMoves";
import { MOVES_PER_CHUNK } from "../../_shared/cards/moveLog";
import { CARD_MOVES_SESSION_MAX_BYTES, resetLogConfig } from "../../_shared/eventQueueConfig";
import { AUTO_OFFSET, KIND } from "../replay";
import { playGame } from "./helpers/playGame";

/** The epic's budget for one uploaded game: stored bytes, `jsonb` text plus 200 B a row. */
const STORED_BYTES_BUDGET = 40_000;

describe("FreeCell replay recording benchmark (#3289)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    resetLogConfig();
  });

  it("a long 358-action game: 15 saves instead of 358, far fewer writes and bytes", async () => {
    const { actions } = playGame(116, 900);
    expect(actions).toHaveLength(358);
    const before = await playPerAction("freecell", actions);
    const after = await playRecorded("freecell", actions);
    const chunks = Math.ceil(actions.length / MOVES_PER_CHUNK);
    process.stdout.write(
      `[bench #3289] freecell, ${actions.length} actions: per-action ${before.saves} saves, ${before.storageWrites} storage writes, ` +
        `${before.storageBytes} B written, ${before.events} events / ${before.recordedBytes} B recorded / ${before.storedBytes} B stored; ` +
        `chunked ${after.saves} saves, ${after.storageWrites} storage writes, ${after.storageBytes} B written, ` +
        `${after.events} events / ${after.recordedBytes} B recorded / ${after.storedBytes} B stored\n`
    );
    expect(after.saves).toBe(chunks);
    expect(after.events).toBe(chunks);
    expect(after.fetches).toBe(0);
    expect(after.saves).toBeLessThan(before.saves / (MOVES_PER_CHUNK - 1) + 1);
    expect(after.storageWrites).toBeLessThan(before.storageWrites / 10);
    expect(after.storageBytes).toBeLessThan(before.storageBytes / 10);
    expect(after.storedBytes).toBeLessThan(before.storedBytes / 5);
    expect(after.recordedBytes).toBeLessThan(4_000);
    expect(after.storedBytes).toBeLessThan(10_000);
  }, 120_000);

  it("a typical 196-action game stays under the 40 KB plan", async () => {
    const { actions } = playGame(32, 900);
    expect(actions).toHaveLength(196);
    const after = await playRecorded("freecell", actions);
    process.stdout.write(
      `[bench #3289] freecell, ${actions.length} actions: ${after.saves} saves, ${after.storageWrites} storage writes, ` +
        `${after.events} events / ${after.recordedBytes} B recorded / ${after.storedBytes} B stored\n`
    );
    expect(after.saves).toBe(Math.ceil(actions.length / MOVES_PER_CHUNK));
    expect(after.storedBytes).toBeLessThan(STORED_BYTES_BUDGET);
  }, 120_000);

  it("a runaway game is cut at the session cap, still under the 40 KB plan", async () => {
    const actions = Array.from({ length: 4_000 }, () => [
      AUTO_OFFSET + KIND.tableauToTableau,
      7,
      6,
      13,
    ]);
    const after = await playRecorded("freecell", actions);
    process.stdout.write(
      `[bench #3289] freecell, ${actions.length} worst-case actions: ${after.events} events kept / ${after.recordedBytes} B recorded / ${after.storedBytes} B stored\n`
    );
    expect(after.recordedBytes).toBeLessThanOrEqual(CARD_MOVES_SESSION_MAX_BYTES);
    expect(after.events).toBeLessThan(4_000 / MOVES_PER_CHUNK);
    expect(after.storedBytes).toBeLessThan(STORED_BYTES_BUDGET);
  }, 120_000);
});
