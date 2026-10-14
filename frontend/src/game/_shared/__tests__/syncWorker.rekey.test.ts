/**
 * SyncWorker and the legacy session-id re-key (#3325): a flush resolves the
 * session id before it sends anything, so the re-key's purge of the old
 * player's queue lands first and no old row goes out under the new id.
 *
 * Runs on the app's singleton stores, because the purge clears those.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

import { legacyFallbackUuid, resetLegacyFallbackSeq } from "../../../test-utils/legacyFallbackUuid";
import { eventStore } from "../eventStore";
import { gameEventClient } from "../gameEventClient";
import { pendingGamesStore } from "../pendingGamesStore";
import { getOrCreateSessionId } from "../session";
import type { SyncApi, SyncResponse } from "../syncApi";
import { SyncWorker } from "../syncWorker";
import { isLegacyFallbackId } from "../uuid";
import { flushMicro } from "./helpers/syncWorkerFixtures";

/** A SyncApi double that, like the real one, reads the session id per request. */
class SessionRecordingApi {
  calls: { method: string; path: string; body: unknown; sessionId: string }[] = [];
  async request(method: "POST" | "PATCH", path: string, body: unknown): Promise<SyncResponse> {
    this.calls.push({ method, path, body, sessionId: await getOrCreateSessionId() });
    return { status: 200, ok: true, retryAfterMs: null, body: {} };
  }
}

function legacyId(): string {
  resetLegacyFallbackSeq();
  const origPerf = (globalThis as Record<string, unknown>).performance;
  Object.defineProperty(globalThis, "performance", {
    value: { now: () => 2500.25 },
    configurable: true,
  });
  try {
    return legacyFallbackUuid();
  } finally {
    Object.defineProperty(globalThis, "performance", { value: origPerf, configurable: true });
  }
}

describe("SyncWorker — legacy session id re-key (#3325)", () => {
  let api: SessionRecordingApi;
  let worker: SyncWorker;
  let legacy: string;

  beforeEach(async () => {
    await gameEventClient.clearAll();
    await AsyncStorage.clear();
    api = new SessionRecordingApi();
    worker = new SyncWorker(eventStore, pendingGamesStore, api as unknown as SyncApi);
    legacy = legacyId();
    expect(isLegacyFallbackId(legacy)).toBe(true);
  });

  afterEach(async () => {
    worker.stop();
    await gameEventClient.clearAll();
  });

  function queuePlayedGame(): string {
    const gid = gameEventClient.startGame("yacht");
    gameEventClient.markStarted(gid);
    gameEventClient.enqueueEvent(gid, { type: "roll", data: { dice: [1, 2, 3] } });
    return gid;
  }

  it("the first flush sends nothing from the old queue, and nothing old under the new id", async () => {
    const oldGame = queuePlayedGame();
    gameEventClient.reportBug("warn", "test", "old bug");
    await flushMicro();
    expect((await eventStore.peek(100)).length).toBeGreaterThan(0);
    await AsyncStorage.setItem("game_session_id", legacy);

    await worker.flush();

    expect(api.calls).toEqual([]);
    expect(await eventStore.peek(100, { includeDeadLettered: true })).toEqual([]);
    expect(pendingGamesStore.all()).toEqual([]);
    const fresh = await AsyncStorage.getItem("game_session_id");
    expect(fresh).not.toBe(legacy);
    expect(isLegacyFallbackId(fresh!)).toBe(false);

    // A game played after the re-key syncs under the new id, alone.
    const newGame = queuePlayedGame();
    await flushMicro();
    await worker.flush();
    expect(api.calls.length).toBeGreaterThan(0);
    for (const call of api.calls) {
      expect(call.sessionId).toBe(fresh);
      expect(JSON.stringify(call)).not.toContain(oldGame);
    }
    expect(api.calls.map((c) => c.path)).toContain(`/games/${newGame}/events`);
  });

  it("a queue of bug logs only (no pending game) is dropped too", async () => {
    gameEventClient.reportBug("warn", "test", "old bug");
    await flushMicro();
    expect(pendingGamesStore.all()).toEqual([]);
    await AsyncStorage.setItem("game_session_id", legacy);

    await worker.flush();

    expect(api.calls).toEqual([]);
    expect(await eventStore.peek(100, { includeDeadLettered: true })).toEqual([]);
  });

  it("with no CSPRNG the pass backs off, sends nothing and keeps the queue", async () => {
    queuePlayedGame();
    await flushMicro();
    await AsyncStorage.setItem("game_session_id", legacy);
    const savedCrypto = globalThis.crypto;
    Object.defineProperty(globalThis, "crypto", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    try {
      const result = await worker.flush();
      expect(api.calls).toEqual([]);
      expect(result.backoffMs).toBeGreaterThan(0);
      expect(worker.getBackoffUntil()).toBeGreaterThan(0);
      expect((await eventStore.peek(100)).length).toBeGreaterThan(0);
      expect(await AsyncStorage.getItem("game_session_id")).toBe(legacy);
    } finally {
      Object.defineProperty(globalThis, "crypto", {
        value: savedCrypto,
        configurable: true,
        writable: true,
      });
    }
  });

  it("an empty queue reads no session id (nothing to send)", async () => {
    await AsyncStorage.setItem("game_session_id", legacy);
    await worker.flush();
    expect(api.calls).toEqual([]);
    expect(await AsyncStorage.getItem("game_session_id")).toBe(legacy);
  });
});
