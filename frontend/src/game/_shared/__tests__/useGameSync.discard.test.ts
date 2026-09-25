/**
 * #2619: restart() on a session the player never started must discard it, not
 * leak it. Runs against the real gameEventClient, pendingGamesStore and
 * eventStore (useGameSync.test.ts mocks the client).
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { renderHook, act } from "@testing-library/react-native";

import { eventStore } from "../eventStore";
import { gameEventClient } from "../gameEventClient";
import { pendingGamesStore } from "../pendingGamesStore";
import { useGameSync } from "../useGameSync";

async function settle(): Promise<void> {
  // Fire-and-forget persistence needs a few turns to land.
  await new Promise((r) => setTimeout(r, 10));
}

async function queuedGameIds(): Promise<string[]> {
  const rows = await eventStore.peek(100, { includeDeadLettered: true, includeFuture: true });
  return rows.flatMap((r) => (r.log_type === "game_event" ? [r.game_id] : []));
}

describe("useGameSync restart() with the real client (#2619)", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    await gameEventClient.clearAll();
    await gameEventClient.init();
  });

  it("drops the old pending record and its events when markStarted() was never called", async () => {
    const { result } = await renderHook(() => useGameSync("cascade"));
    await act(() => {
      result.current.start({ fruit_set: "fruits" });
    });
    const oldId = result.current.getGameId()!;
    expect(pendingGamesStore.get(oldId)).toBeDefined();

    await act(() => {
      result.current.restart({ fruit_set: "cosmos" });
    });
    await settle();

    const newId = result.current.getGameId()!;
    expect(newId).not.toBe(oldId);
    expect(pendingGamesStore.get(oldId)).toBeUndefined();
    expect(pendingGamesStore.all().map(([id]) => id)).toEqual([newId]);
    expect(await queuedGameIds()).toEqual([newId]);
  });

  it("abandons (keeps) the old record when the player started it", async () => {
    const { result } = await renderHook(() => useGameSync("cascade"));
    await act(() => {
      result.current.start();
      result.current.markStarted();
    });
    const oldId = result.current.getGameId()!;

    await act(() => {
      result.current.restart();
    });
    await settle();

    const old = pendingGamesStore.get(oldId);
    expect(old?.completed).toBe(true);
    // Real time runs here, so the active-play window (#2684) may add a durationMs.
    expect(old?.completeSummary).toEqual(expect.objectContaining({ outcome: "abandoned" }));
    expect(old?.completeSummary).not.toHaveProperty("finalScore");
  });
});
