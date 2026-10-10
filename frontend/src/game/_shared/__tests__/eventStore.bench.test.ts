/**
 * Micro-benchmark for #2959: 500 enqueues against a 4,000-row seeded queue
 * (1,000 rows per tier, seeded through `seedRows` like the e2e harness does).
 *
 * The timing is printed, never asserted — it depends on the machine — so the
 * test is deterministic and quick enough to stay enabled in CI. What is
 * asserted is the storage traffic the enqueues cause, which the timing
 * follows: no reads and one write per enqueue once the mirror is warm.
 *
 * Run it on its own with
 *   cd frontend && npx jest src/game/_shared/__tests__/eventStore.bench.test.ts
 *
 * Recorded when the mirror landed (jest on node, in-memory AsyncStorage mock,
 * this fixture, run alone): before, on origin/dev, 10,543 ms — 21.1 ms per
 * enqueue, 2,500 getItem (five per enqueue) and 500 setItem; after, 697–767 ms
 * — 1.4 ms per enqueue, 0 getItem and 500 setItem. The write of the row's
 * own tier is what remains; it is the on-disk format.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

import { EventStore, Row } from "../eventStore";
import { Priority, resetLogConfig } from "../eventQueueConfig";

const ROWS = 4_000;
const ENQUEUES = 500;
const TIERS: Priority[] = [0, 1, 2, 3];

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

describe("EventStore micro-benchmark (#2959)", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    resetLogConfig();
  });

  it(`${ENQUEUES} enqueues against a ${ROWS}-row queue: no reads, one write each`, async () => {
    const store = new EventStore();
    const base = Date.now() - ROWS;
    await store.seedRows(Array.from({ length: ROWS }, (_, i) => seedRow(i, base)));
    expect((await store.stats()).totalRows).toBe(ROWS);

    const getItem = AsyncStorage.getItem as jest.Mock;
    const setItem = AsyncStorage.setItem as jest.Mock;
    getItem.mockClear();
    setItem.mockClear();

    const t0 = performance.now();
    for (let i = 0; i < ENQUEUES; i += 1) {
      await store.enqueueEvent({
        game_id: "bench",
        event_index: i,
        event_type: "move",
        payload: { dx: 1, dy: 0, i },
      });
    }
    const ms = performance.now() - t0;
    process.stdout.write(
      `[bench #2959] ${ENQUEUES} enqueues over ${ROWS} rows: ${ms.toFixed(0)} ms ` +
        `(${(ms / ENQUEUES).toFixed(2)} ms/enqueue), ` +
        `getItem=${getItem.mock.calls.length} setItem=${setItem.mock.calls.length}\n`
    );

    expect((await store.stats()).totalRows).toBe(ROWS + ENQUEUES);
    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).toHaveBeenCalledTimes(ENQUEUES);
  }, 120_000);
});
