/**
 * The Hearts replay units kept across a kill (#3283): written off the tap that
 * causes the write, at once on a flush, and read back only when valid.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

import { loadPendingReplay, pendingReplayPort } from "../pendingReplay";
import type { ReplayUnit } from "../replay";

const KEY = "hearts.replay_pending_v1";
const unit: ReplayUnit = {
  n: 1,
  events: [{ type: "hand_opened", data: { h: 1, d: 0, c: ["2C"] } }],
};

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

describe("pendingReplayPort", () => {
  it("does not write inside the call: the write waits for the interactions", () => {
    pendingReplayPort.save([unit]);
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
    pendingReplayPort.clear();
    expect(AsyncStorage.removeItem).not.toHaveBeenCalled();
    pendingReplayPort.flush?.(); // leave nothing scheduled for the next test
  });

  it("flush writes what was put off, now, and only the latest", async () => {
    pendingReplayPort.save([unit]);
    pendingReplayPort.save([unit, { ...unit, n: 2 }]);
    pendingReplayPort.flush?.();
    expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);
    expect(await loadPendingReplay()).toEqual([unit, { ...unit, n: 2 }]);
    pendingReplayPort.flush?.(); // nothing left to write
    expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);
  });

  it("a clear after a save wins; a flush then removes the key", async () => {
    pendingReplayPort.save([unit]);
    pendingReplayPort.flush?.();
    pendingReplayPort.save([unit]);
    pendingReplayPort.clear();
    pendingReplayPort.flush?.();
    expect(await AsyncStorage.getItem(KEY)).toBeNull();
  });
});

describe("loadPendingReplay", () => {
  it("returns nothing for no key, bad JSON or the wrong shape, and keeps only valid units", async () => {
    expect(await loadPendingReplay()).toEqual([]);
    await AsyncStorage.setItem(KEY, "{not json");
    expect(await loadPendingReplay()).toEqual([]);
    await AsyncStorage.setItem(KEY, JSON.stringify({ n: 1 }));
    expect(await loadPendingReplay()).toEqual([]);
    await AsyncStorage.setItem(
      KEY,
      JSON.stringify([unit, { n: 2, events: [{ type: "game_ended", data: { h: 1 } }] }, "x"])
    );
    expect(await loadPendingReplay()).toEqual([unit]);
  });
});
