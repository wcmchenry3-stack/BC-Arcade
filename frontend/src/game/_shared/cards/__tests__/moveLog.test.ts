import * as Sentry from "@sentry/react-native";

import { MOVES_PER_CHUNK, createMoveLog, guardRecording, recordChunk } from "../moveLog";

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
