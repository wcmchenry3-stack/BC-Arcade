import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";

import { createJsonSlot, createRecord } from "../storageSlot";

interface Thing {
  _v: 1;
  n: number;
}

const KEY = "thing_slot";
const SUBSYSTEM = "thing.storage";

function isThing(p: unknown): p is Thing {
  const t = p as Thing; // reads a stored null as corrupt, as the games do
  return t._v === 1 && typeof t.n === "number";
}

const captureException = Sentry.captureException as jest.Mock;
const captureMessage = Sentry.captureMessage as jest.Mock;

beforeEach(async () => {
  jest.restoreAllMocks();
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

function failOnce(method: "getItem" | "setItem" | "removeItem") {
  jest.spyOn(AsyncStorage, method).mockRejectedValueOnce(new Error(`${method} failed`));
}

describe("createJsonSlot", () => {
  const slot = createJsonSlot<Thing>({ key: KEY, subsystem: SUBSYSTEM, isValid: isThing });

  it("round-trips a value under its key, as plain JSON", async () => {
    await slot.save({ _v: 1, n: 4 });
    await expect(AsyncStorage.getItem(KEY)).resolves.toBe('{"_v":1,"n":4}');
    await expect(slot.load()).resolves.toEqual({ _v: 1, n: 4 });
  });

  it("loads null when nothing (or an empty string) is stored", async () => {
    await expect(slot.load()).resolves.toBeNull();
    await AsyncStorage.setItem(KEY, "");
    await expect(slot.load()).resolves.toBeNull();
    expect(captureMessage).not.toHaveBeenCalled();
  });

  it("removes a corrupt payload and reports a warning tagged load", async () => {
    await AsyncStorage.setItem(KEY, "{nope");
    await expect(slot.load()).resolves.toBeNull();
    await expect(AsyncStorage.getItem(KEY)).resolves.toBeNull();
    expect(captureMessage).toHaveBeenCalledWith("thing.storage: corrupt game payload, discarding", {
      level: "warning",
      tags: { subsystem: SUBSYSTEM, op: "load" },
      extra: { error: expect.stringContaining("SyntaxError"), key: KEY },
    });
    expect(captureException).not.toHaveBeenCalled();
  });

  it("treats a check that throws (a stored null) as corrupt", async () => {
    await AsyncStorage.setItem(KEY, "null");
    await expect(slot.load()).resolves.toBeNull();
    await expect(AsyncStorage.getItem(KEY)).resolves.toBeNull();
    expect(captureMessage).toHaveBeenCalledTimes(1);
  });

  it("removes a payload of another version silently", async () => {
    await AsyncStorage.setItem(KEY, '{"_v":2,"n":1}');
    await expect(slot.load()).resolves.toBeNull();
    await expect(AsyncStorage.getItem(KEY)).resolves.toBeNull();
    expect(captureMessage).not.toHaveBeenCalled();
  });

  it("treats a failed read as corrupt", async () => {
    await slot.save({ _v: 1, n: 1 });
    failOnce("getItem");
    await expect(slot.load()).resolves.toBeNull();
    expect(captureMessage).toHaveBeenCalledWith(
      "thing.storage: corrupt game payload, discarding",
      expect.objectContaining({ extra: { error: "Error: getItem failed", key: KEY } })
    );
    await expect(AsyncStorage.getItem(KEY)).resolves.toBeNull();
  });

  it("still resolves when removing a corrupt payload fails", async () => {
    await AsyncStorage.setItem(KEY, "{nope");
    failOnce("removeItem");
    await expect(slot.load()).resolves.toBeNull();
  });

  it("reports save and clear failures as exceptions tagged with their op", async () => {
    failOnce("setItem");
    await expect(slot.save({ _v: 1, n: 1 })).resolves.toBeUndefined();
    expect(captureException).toHaveBeenLastCalledWith(expect.any(Error), {
      tags: { subsystem: SUBSYSTEM, op: "save" },
    });
    failOnce("removeItem");
    await expect(slot.clear()).resolves.toBeUndefined();
    expect(captureException).toHaveBeenLastCalledWith(expect.any(Error), {
      tags: { subsystem: SUBSYSTEM, op: "clear" },
    });
  });

  it("clear removes the slot", async () => {
    await slot.save({ _v: 1, n: 1 });
    await slot.clear();
    await expect(AsyncStorage.getItem(KEY)).resolves.toBeNull();
  });

  describe("options", () => {
    it("migrates before the check, transforms before save and after load", async () => {
      const s = createJsonSlot<{ n: number; loaded: boolean }, Thing>({
        key: KEY,
        subsystem: SUBSYSTEM,
        migrate: (p) => {
          const o = p as { _v: number; n: number };
          return o._v === 0 ? { _v: 1, n: o.n * 10 } : o;
        },
        isValid: isThing,
        onLoad: async (t) => ({ n: t.n, loaded: true }),
        beforeSave: (v) => ({ _v: 1, n: v.n }),
      });
      await s.save({ n: 3, loaded: false });
      await expect(AsyncStorage.getItem(KEY)).resolves.toBe('{"_v":1,"n":3}');
      await expect(s.load()).resolves.toEqual({ n: 3, loaded: true });
      await AsyncStorage.setItem(KEY, '{"_v":0,"n":2}');
      await expect(s.load()).resolves.toEqual({ n: 20, loaded: true });
    });

    it("treats an onLoad that throws as corrupt", async () => {
      const s = createJsonSlot<Thing>({
        key: KEY,
        subsystem: SUBSYSTEM,
        isValid: isThing,
        onLoad: () => {
          throw new Error("bad");
        },
      });
      await AsyncStorage.setItem(KEY, '{"_v":1,"n":1}');
      await expect(s.load()).resolves.toBeNull();
      expect(captureMessage).toHaveBeenCalledTimes(1);
      await expect(AsyncStorage.getItem(KEY)).resolves.toBeNull();
    });

    it("keepInvalid leaves a payload that fails the check stored", async () => {
      const s = createJsonSlot<Thing>({
        key: KEY,
        subsystem: SUBSYSTEM,
        isValid: isThing,
        keepInvalid: true,
      });
      await AsyncStorage.setItem(KEY, '{"_v":2}');
      await expect(s.load()).resolves.toBeNull();
      await expect(AsyncStorage.getItem(KEY)).resolves.toBe('{"_v":2}');
    });

    it("invalidWarning reports a payload that fails the check", async () => {
      const s = createJsonSlot<Thing>({
        key: KEY,
        subsystem: SUBSYSTEM,
        isValid: isThing,
        invalidWarning: (p) =>
          (p as Thing)._v === 1 ? { message: "bad thing", extra: { n: (p as Thing).n } } : null,
      });
      await AsyncStorage.setItem(KEY, '{"_v":1,"n":"x"}');
      await expect(s.load()).resolves.toBeNull();
      expect(captureMessage).toHaveBeenCalledWith("bad thing", {
        level: "warning",
        tags: { subsystem: SUBSYSTEM, op: "load" },
        extra: { n: "x" },
      });
      captureMessage.mockClear();
      await AsyncStorage.setItem(KEY, '{"_v":7}');
      await expect(s.load()).resolves.toBeNull();
      expect(captureMessage).not.toHaveBeenCalled();
    });

    it("corruptMessage and corruptExtra shape the corrupt warning", async () => {
      const withRaw = createJsonSlot<Thing>({
        key: KEY,
        subsystem: SUBSYSTEM,
        isValid: isThing,
        corruptMessage: "custom",
        corruptExtra: "keyAndRaw",
      });
      await AsyncStorage.setItem(KEY, "{" + "x".repeat(600));
      await withRaw.load();
      const [message, ctx] = captureMessage.mock.calls[0]!;
      expect(message).toBe("custom");
      expect(ctx.extra.rawPayload).toHaveLength(500);

      const bare = createJsonSlot<Thing>({
        key: KEY,
        subsystem: SUBSYSTEM,
        isValid: isThing,
        corruptExtra: "none",
      });
      await AsyncStorage.setItem(KEY, "{");
      await bare.load();
      expect(captureMessage.mock.calls[1]![1]).toEqual({
        level: "warning",
        tags: { subsystem: SUBSYSTEM, op: "load" },
      });
    });

    it("readFailureIsError reports a failed read and keeps the payload", async () => {
      const s = createJsonSlot<Thing>({
        key: KEY,
        subsystem: SUBSYSTEM,
        isValid: isThing,
        readFailureIsError: true,
      });
      await s.save({ _v: 1, n: 2 });
      failOnce("getItem");
      await expect(s.load()).resolves.toBeNull();
      expect(captureException).toHaveBeenCalledWith(expect.any(Error), {
        tags: { subsystem: SUBSYSTEM, op: "load" },
      });
      expect(captureMessage).not.toHaveBeenCalled();
      await expect(s.load()).resolves.toEqual({ _v: 1, n: 2 });
    });

    it("clearAlso removes the other keys with the slot", async () => {
      const s = createJsonSlot<Thing>({
        key: KEY,
        subsystem: SUBSYSTEM,
        isValid: isThing,
        clearAlso: ["other_a", "other_b"],
      });
      await s.save({ _v: 1, n: 2 });
      await AsyncStorage.setItem("other_a", "1");
      await AsyncStorage.setItem("other_b", "2");
      await AsyncStorage.setItem("kept", "3");
      await s.clear();
      expect([...(await AsyncStorage.getAllKeys())]).toEqual(["kept"]);
    });
  });
});

describe("createRecord", () => {
  const record = createRecord<{ best: number }>({
    key: "thing_stats",
    subsystem: SUBSYSTEM,
    ops: { load: "loadStats", save: "saveStats" },
    fallback: () => ({ best: 0 }),
    read: (raw) => {
      const p = JSON.parse(raw);
      return { best: typeof p.best === "number" ? p.best : 0 };
    },
    write: (v) => JSON.stringify(v),
  });

  it("round-trips, and reads the fallback when nothing is stored", async () => {
    await expect(record.load()).resolves.toEqual({ best: 0 });
    await record.save({ best: 9 });
    await expect(AsyncStorage.getItem("thing_stats")).resolves.toBe('{"best":9}');
    await expect(record.load()).resolves.toEqual({ best: 9 });
  });

  it("returns a fresh fallback each time", async () => {
    const a = await record.load();
    a.best = 5;
    await expect(record.load()).resolves.toEqual({ best: 0 });
  });

  it("reports a value it can't read with its load op, and leaves it stored", async () => {
    await AsyncStorage.setItem("thing_stats", "{x");
    await expect(record.load()).resolves.toEqual({ best: 0 });
    expect(captureException).toHaveBeenCalledWith(expect.any(SyntaxError), {
      tags: { subsystem: SUBSYSTEM, op: "loadStats" },
    });
    await expect(AsyncStorage.getItem("thing_stats")).resolves.toBe("{x");
  });

  it("reports a failed read or write with its op", async () => {
    failOnce("getItem");
    await expect(record.load()).resolves.toEqual({ best: 0 });
    failOnce("setItem");
    await expect(record.save({ best: 1 })).resolves.toBeUndefined();
    expect(captureException.mock.calls.map((c) => c[1].tags.op)).toEqual([
      "loadStats",
      "saveStats",
    ]);
  });
});
