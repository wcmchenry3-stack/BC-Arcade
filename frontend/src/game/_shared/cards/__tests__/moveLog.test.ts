import * as Sentry from "@sentry/react-native";

import {
  MAX_RECORDED_ACTIONS,
  MAX_RECORDED_ROWS,
  MOVES_PER_CHUNK,
  createMoveLog,
  guardRecording,
  recordChunk,
  savedRows,
} from "../moveLog";

const action = (n: number) => [n % 9, n % 7];

describe("createMoveLog", () => {
  it("hands a chunk over at exactly MOVES_PER_CHUNK actions", () => {
    const emitted: number[][][] = [];
    const log = createMoveLog((a) => emitted.push(a as number[][]));
    for (let i = 0; i < MOVES_PER_CHUNK - 1; i += 1) log.push(action(i));
    expect(emitted).toHaveLength(0);
    log.push(action(MOVES_PER_CHUNK - 1));
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toHaveLength(MOVES_PER_CHUNK);
    log.push(action(MOVES_PER_CHUNK));
    expect(emitted).toHaveLength(1);
  });

  it("passes the index of each chunk's first action", () => {
    const firsts: number[] = [];
    const log = createMoveLog((_a, first) => firsts.push(first));
    for (let i = 0; i < 2 * MOVES_PER_CHUNK + 3; i += 1) log.push(action(i));
    log.flush();
    expect(firsts).toEqual([0, MOVES_PER_CHUNK, 2 * MOVES_PER_CHUNK]);
  });

  it("flush hands over the partial chunk once, and nothing when empty", () => {
    const sizes: number[] = [];
    const log = createMoveLog((a) => sizes.push(a.length));
    log.flush();
    for (let i = 0; i < 7; i += 1) log.push(action(i));
    log.flush();
    log.flush();
    expect(sizes).toEqual([7]);
  });

  it("keeps order, loses nothing and never reuses an emitted array", () => {
    const emitted: (readonly number[])[][] = [];
    const log = createMoveLog((a) => emitted.push(a));
    const total = 2 * MOVES_PER_CHUNK + 3;
    for (let i = 0; i < total; i += 1) log.push([i]);
    log.flush();
    expect(emitted.flat().map((a) => a[0])).toEqual(Array.from({ length: total }, (_, i) => i));
    expect(new Set(emitted).size).toBe(3);
  });

  it("counts the actions it has seen, and counts on from reset(start)", () => {
    const firsts: number[] = [];
    const log = createMoveLog((_a, first) => firsts.push(first));
    expect(log.count).toBe(0);
    for (let i = 0; i < 5; i += 1) log.push(action(i));
    expect(log.count).toBe(5);
    log.reset(60);
    expect(log.count).toBe(60);
    log.push(action(1));
    log.flush();
    expect(firsts).toEqual([60]);
    expect(log.count).toBe(61);
    log.reset();
    expect(log.count).toBe(0);
  });

  it("reset drops what was collected", () => {
    const emitted: unknown[] = [];
    const log = createMoveLog((a) => emitted.push(a));
    log.push(action(1));
    log.reset(0);
    log.flush();
    expect(emitted).toHaveLength(0);
  });

  it("honours a chunk size argument", () => {
    const sizes: number[] = [];
    const log = createMoveLog((a) => sizes.push(a.length), 2);
    for (let i = 0; i < 5; i += 1) log.push(action(i));
    expect(sizes).toEqual([2, 2]);
  });
});

describe("the limits of a game's recording", () => {
  it("is 1,200 actions and 60 rows: 48 full chunks, with room for partial ones", () => {
    expect(MAX_RECORDED_ACTIONS).toBe(1_200);
    expect(MAX_RECORDED_ROWS).toBe(60);
    expect(MAX_RECORDED_ACTIONS / MOVES_PER_CHUNK).toBeLessThan(MAX_RECORDED_ROWS);
  });

  it("stops collecting at the action limit, and a game's later actions are ignored", () => {
    const emitted: number[] = [];
    const log = createMoveLog((a) => emitted.push(a.length));
    for (let i = 0; i < MAX_RECORDED_ACTIONS + 200; i += 1) log.push(action(i));
    log.flush();
    expect(log.capped).toBe(true);
    expect(log.count).toBe(MAX_RECORDED_ACTIONS);
    expect(emitted.reduce((a, b) => a + b, 0)).toBe(MAX_RECORDED_ACTIONS);
    expect(log.rows).toBe(MAX_RECORDED_ACTIONS / MOVES_PER_CHUNK);
  });

  it("stops at the row limit when every flush cuts a chunk short (flush spam)", () => {
    const emitted: number[] = [];
    const log = createMoveLog((a) => emitted.push(a.length));
    for (let i = 0; i < 1_000; i += 1) {
      log.push(action(i));
      log.flush();
    }
    expect(log.capped).toBe(true);
    expect(log.rows).toBe(MAX_RECORDED_ROWS);
    expect(emitted).toHaveLength(MAX_RECORDED_ROWS);
    expect(log.count).toBe(MAX_RECORDED_ROWS);
  });

  it("a game resumed at the limit records nothing: the counts come from its save", () => {
    const emitted: unknown[] = [];
    const log = createMoveLog((a) => emitted.push(a));
    log.reset(MAX_RECORDED_ACTIONS, 60);
    expect(log.capped).toBe(true);
    log.push(action(1));
    log.flush();
    expect(emitted).toHaveLength(0);
    log.reset(40, MAX_RECORDED_ROWS);
    expect(log.capped).toBe(true);
    log.reset(40, 3);
    expect(log.capped).toBe(false);
    log.push(action(1));
    log.flush();
    expect(emitted).toHaveLength(1);
    expect(log.rows).toBe(4);
  });

  it("counts the rows it hands over, and counts on from the saved rows", () => {
    const log = createMoveLog(() => undefined);
    log.reset(0, 5);
    for (let i = 0; i < 2 * MOVES_PER_CHUNK + 1; i += 1) log.push(action(i));
    expect(log.rows).toBe(7);
    log.flush();
    expect(log.rows).toBe(8);
  });

  it("reads a saved rows count: absent is 0, a corrupt one is the limit", () => {
    expect(savedRows(undefined)).toBe(0);
    expect(savedRows(7)).toBe(7);
    for (const bad of [-1, 2.5, "7", null, Number.NaN]) {
      expect(savedRows(bad)).toBe(MAX_RECORDED_ROWS);
    }
  });
});

describe("recordChunk", () => {
  it("records one moves event in one unit, numbered from the first action", () => {
    const calls: unknown[][] = [];
    const sink = {
      beginUnit: (n?: number) => calls.push(["begin", n]) as unknown as number,
      record: (type: "moves", data?: Record<string, unknown>) => calls.push(["record", type, data]),
      closeUnit: () => calls.push(["close"]),
    };
    recordChunk(sink, [[1], [2]], 60);
    expect(calls).toEqual([["begin", 3], ["record", "moves", { s: 60, m: [[1], [2]] }], ["close"]]);
    calls.length = 0;
    recordChunk(sink, [[1]], 0);
    expect(calls[0]).toEqual(["begin", 1]);
    calls.length = 0;
    recordChunk(sink, [[1]], 49);
    expect(calls[0]).toEqual(["begin", 2]);
  });
});

describe("guardRecording", () => {
  it("runs the call", () => {
    const call = jest.fn();
    guardRecording("solitaire", call);
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("swallows a throw and reports it once per game, with fixed text", () => {
    const capture = jest.spyOn(Sentry, "captureMessage").mockImplementation(() => "id");
    const boom = () => {
      throw new Error("secret detail 4242");
    };
    expect(() => guardRecording("guardtest", boom)).not.toThrow();
    expect(() => guardRecording("guardtest", boom)).not.toThrow();
    expect(capture).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(capture.mock.calls)).not.toContain("4242");
    capture.mockRestore();
  });
});
