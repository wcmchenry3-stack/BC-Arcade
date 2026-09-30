import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";
import { waitFor } from "@testing-library/react-native";

const mockPutMe = jest.fn();
const mockDeleteMe = jest.fn();
const mockRerollMe = jest.fn();
const mockGetMe = jest.fn();
jest.mock("../../../api/players", () => ({
  playersApi: {
    putMe: (...args: unknown[]) => mockPutMe(...args),
    deleteMe: (...args: unknown[]) => mockDeleteMe(...args),
    rerollMe: (...args: unknown[]) => mockRerollMe(...args),
    getMe: (...args: unknown[]) => mockGetMe(...args),
  },
}));

import {
  loadDisplayName,
  resetDisplayNameCacheForTests,
  storeAssignedDisplayName,
} from "../displayName";
import {
  clearDisplayNameSync,
  flushDisplayNameSync,
  getLeaderboardSyncPending,
  joinLeaderboards,
  leaveLeaderboards,
  refreshDisplayNameFromServer,
  rerollDisplayName,
  resetDisplayNameSyncForTests,
  syncDisplayNameOnLaunch,
} from "../displayNameSync";
import { ApiError } from "../httpClient";
import { clearSession } from "../session";

const NAME_KEY = "player_display_name";
const PENDING_KEY = "player_display_name_pending_sync";
const SYNCED_KEY = "player_display_name_synced";

const GENERATED = "Brave Otter 4821";
const offline = () => Promise.reject(new TypeError("Network request failed"));

/** The server's state for this player: null = not on the boards. */
let serverName: string | null = null;

beforeEach(async () => {
  await AsyncStorage.clear();
  resetDisplayNameCacheForTests();
  resetDisplayNameSyncForTests();
  serverName = null;
  mockPutMe.mockReset();
  mockPutMe.mockImplementation(() => {
    serverName = serverName ?? GENERATED;
    return Promise.resolve({ display_name: serverName });
  });
  mockDeleteMe.mockReset();
  mockDeleteMe.mockImplementation(() => {
    serverName = null;
    return Promise.resolve(undefined);
  });
  mockRerollMe.mockReset();
  mockRerollMe.mockImplementation(() => {
    if (serverName == null) return Promise.reject(new ApiError("Not on the leaderboards.", 404));
    serverName = "Calm Owl 12";
    return Promise.resolve({ display_name: serverName });
  });
  mockGetMe.mockReset();
  mockGetMe.mockImplementation(() => Promise.resolve({ display_name: serverName }));
  (Sentry.captureMessage as jest.Mock).mockClear();
});

describe("joinLeaderboards → PUT /players/me (#2778)", () => {
  it("sends a bodiless join and stores the generated name the server assigns", async () => {
    await expect(joinLeaderboards()).resolves.toBe(true);
    await expect(flushDisplayNameSync()).resolves.toBe(true);
    expect(mockPutMe).toHaveBeenCalledTimes(1);
    expect(mockPutMe).toHaveBeenCalledWith();
    await expect(loadDisplayName()).resolves.toBe(GENERATED);
    await expect(AsyncStorage.getItem(PENDING_KEY)).resolves.toBeNull();
    await expect(getLeaderboardSyncPending()).resolves.toBeNull();
  });

  it("offline: keeps the join pending with no name yet, then sends it once", async () => {
    const online = mockPutMe.getMockImplementation();
    mockPutMe.mockImplementation(offline);
    await joinLeaderboards();
    await expect(flushDisplayNameSync()).resolves.toBe(false);
    await expect(getLeaderboardSyncPending()).resolves.toBe("join");
    await expect(loadDisplayName()).resolves.toBeNull();

    mockPutMe.mockClear();
    mockPutMe.mockImplementation(online);
    await expect(flushDisplayNameSync()).resolves.toBe(true);
    expect(mockPutMe).toHaveBeenCalledTimes(1);
    await expect(loadDisplayName()).resolves.toBe(GENERATED);
  });

  it("drops a join the server will never accept", async () => {
    mockPutMe.mockRejectedValue(new ApiError("bad session", 400));
    await joinLeaderboards();
    await expect(flushDisplayNameSync()).resolves.toBe(true);
    await expect(AsyncStorage.getItem(PENDING_KEY)).resolves.toBeNull();
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      "displayNameSync: server rejected the leaderboard request",
      expect.objectContaining({ level: "warning" })
    );
  });

  it("treats an older build's slot holding typed text as a join, never sending the text", async () => {
    await AsyncStorage.setItem(PENDING_KEY, "Riley");
    await expect(flushDisplayNameSync()).resolves.toBe(true);
    expect(mockPutMe).toHaveBeenCalledWith();
    await expect(loadDisplayName()).resolves.toBe(GENERATED);
  });

  it("concurrent flushes of one pending join send it once", async () => {
    await AsyncStorage.setItem(PENDING_KEY, "__join_every_leaderboard__");
    await Promise.all([flushDisplayNameSync(), flushDisplayNameSync(), flushDisplayNameSync()]);
    expect(mockPutMe).toHaveBeenCalledTimes(1);
  });
});

describe("leaveLeaderboards → DELETE /players/me (#2637)", () => {
  beforeEach(async () => {
    await joinLeaderboards();
    await flushDisplayNameSync();
    mockPutMe.mockClear();
  });

  it("forgets the local name and sends one DELETE", async () => {
    await expect(leaveLeaderboards()).resolves.toBe(true);
    await expect(loadDisplayName()).resolves.toBeNull();
    await expect(AsyncStorage.getItem(NAME_KEY)).resolves.toBeNull();
    await expect(flushDisplayNameSync()).resolves.toBe(true);
    expect(mockDeleteMe).toHaveBeenCalledTimes(1);
    await expect(AsyncStorage.getItem(PENDING_KEY)).resolves.toBeNull();
  });

  it("keeps an offline leave pending and sends it on reconnect", async () => {
    const online = mockDeleteMe.getMockImplementation();
    mockDeleteMe.mockImplementation(offline);
    await leaveLeaderboards();
    await expect(flushDisplayNameSync()).resolves.toBe(false);
    await expect(getLeaderboardSyncPending()).resolves.toBe("leave");
    mockDeleteMe.mockClear();
    mockDeleteMe.mockImplementation(online);
    await expect(flushDisplayNameSync()).resolves.toBe(true);
    expect(mockDeleteMe).toHaveBeenCalledTimes(1);
    await expect(getLeaderboardSyncPending()).resolves.toBeNull();
  });

  it("a later join replaces an unsent leave: only the PUT goes out", async () => {
    const online = mockDeleteMe.getMockImplementation();
    mockDeleteMe.mockImplementation(offline);
    await leaveLeaderboards();
    await flushDisplayNameSync();
    mockDeleteMe.mockClear();
    mockDeleteMe.mockImplementation(online);

    await joinLeaderboards();
    await expect(flushDisplayNameSync()).resolves.toBe(true);
    expect(mockDeleteMe).not.toHaveBeenCalled();
    expect(mockPutMe).toHaveBeenCalledTimes(1);
  });

  it("a leave made while a join is in flight wins: the join's name isn't stored", async () => {
    await leaveLeaderboards();
    await flushDisplayNameSync();
    let release: (v: { display_name: string }) => void = () => {};
    mockPutMe.mockImplementationOnce(
      () => new Promise((resolve) => (release = resolve as typeof release))
    );
    await joinLeaderboards();
    await waitFor(() => expect(mockPutMe).toHaveBeenCalledTimes(1));
    await leaveLeaderboards(); // the join's PUT is still in flight
    release({ display_name: GENERATED });
    await expect(flushDisplayNameSync()).resolves.toBe(true);
    expect(mockDeleteMe).toHaveBeenCalledTimes(2);
    await expect(loadDisplayName()).resolves.toBeNull();
  });

  it("changes nothing when the leave can't be stored in the slot", async () => {
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error("disk"));
    await expect(leaveLeaderboards()).resolves.toBe(false);
    expect(mockDeleteMe).not.toHaveBeenCalled();
    await expect(loadDisplayName()).resolves.toBe(GENERATED);
  });

  it("finishes a half-done leave at launch: clears the device name, sends only the DELETE", async () => {
    const online = mockDeleteMe.getMockImplementation();
    mockDeleteMe.mockImplementation(offline);
    (AsyncStorage.removeItem as jest.Mock).mockRejectedValueOnce(new Error("disk"));
    await leaveLeaderboards();
    await flushDisplayNameSync();
    await expect(AsyncStorage.getItem(NAME_KEY)).resolves.toBe(GENERATED);
    mockDeleteMe.mockClear();
    mockDeleteMe.mockImplementation(online);

    resetDisplayNameCacheForTests(); // next launch
    resetDisplayNameSyncForTests();
    await expect(syncDisplayNameOnLaunch()).resolves.toBe(true);
    expect(mockDeleteMe).toHaveBeenCalledTimes(1);
    expect(mockPutMe).not.toHaveBeenCalled();
    await expect(AsyncStorage.getItem(NAME_KEY)).resolves.toBeNull();
  });
});

describe("rerollDisplayName → POST /players/me/reroll", () => {
  it("stores the new generated name", async () => {
    await joinLeaderboards();
    await flushDisplayNameSync();
    await expect(rerollDisplayName()).resolves.toBe("Calm Owl 12");
    await expect(loadDisplayName()).resolves.toBe("Calm Owl 12");
  });

  it("sends a pending join first", async () => {
    await AsyncStorage.setItem(PENDING_KEY, "__join_every_leaderboard__");
    await expect(rerollDisplayName()).resolves.toBe("Calm Owl 12");
    expect(mockPutMe).toHaveBeenCalledTimes(1);
  });

  it("offline: returns null and keeps the current name", async () => {
    await joinLeaderboards();
    await flushDisplayNameSync();
    mockRerollMe.mockImplementationOnce(offline);
    await expect(rerollDisplayName()).resolves.toBeNull();
    await expect(loadDisplayName()).resolves.toBe(GENERATED);
  });

  it("never opts in: a player the server has no name for is cleared locally", async () => {
    await storeAssignedDisplayName("Stale Name 10");
    await expect(rerollDisplayName()).resolves.toBeNull();
    expect(mockPutMe).not.toHaveBeenCalled();
    await expect(loadDisplayName()).resolves.toBeNull();
  });
});

describe("launch and refresh", () => {
  it("sends nothing and stores nothing for a player who never joined", async () => {
    await expect(syncDisplayNameOnLaunch()).resolves.toBe(true);
    expect(mockPutMe).not.toHaveBeenCalled();
    await expect(loadDisplayName()).resolves.toBeNull();
  });

  it("turns a name typed before #2624 (never synced) into a join, once, under a generated name", async () => {
    await AsyncStorage.setItem(NAME_KEY, "Riley");
    await expect(syncDisplayNameOnLaunch()).resolves.toBe(true);
    expect(mockPutMe).toHaveBeenCalledTimes(1);
    expect(mockPutMe).toHaveBeenCalledWith();
    await expect(loadDisplayName()).resolves.toBe(GENERATED);

    resetDisplayNameCacheForTests(); // a later launch
    await syncDisplayNameOnLaunch();
    expect(mockPutMe).toHaveBeenCalledTimes(1);
  });

  it("replaces a synced typed name with the server's generated one (migration 0030)", async () => {
    const { getOrCreateSessionId } = jest.requireActual("../session");
    const sessionId = await getOrCreateSessionId();
    await AsyncStorage.setItem(NAME_KEY, "Riley");
    await AsyncStorage.setItem(
      SYNCED_KEY,
      JSON.stringify({ session_id: sessionId, name: "Riley" })
    );
    serverName = "Sunny Seal 77";
    await syncDisplayNameOnLaunch();
    expect(mockPutMe).not.toHaveBeenCalled();
    await expect(loadDisplayName()).resolves.toBe("Sunny Seal 77");
  });

  it("clears the device's name when the server has none", async () => {
    await joinLeaderboards();
    await flushDisplayNameSync();
    serverName = null;
    await refreshDisplayNameFromServer();
    await expect(loadDisplayName()).resolves.toBeNull();
  });

  it("doesn't refresh over a pending intent", async () => {
    mockPutMe.mockImplementation(offline);
    await joinLeaderboards();
    await flushDisplayNameSync();
    await refreshDisplayNameFromServer();
    expect(mockGetMe).not.toHaveBeenCalled();
  });

  it("ignores a refresh answer that arrives after a join", async () => {
    let release: (v: { display_name: string | null }) => void = () => {};
    mockGetMe.mockImplementationOnce(
      () => new Promise((resolve) => (release = resolve as typeof release))
    );
    const refreshing = refreshDisplayNameFromServer();
    await waitFor(() => expect(mockGetMe).toHaveBeenCalledTimes(1));
    await joinLeaderboards();
    await flushDisplayNameSync();
    release({ display_name: null });
    await refreshing;
    await expect(loadDisplayName()).resolves.toBe(GENERATED);
  });

  it("leaves the device's name alone when the refresh fails", async () => {
    await storeAssignedDisplayName(GENERATED);
    mockGetMe.mockImplementationOnce(offline);
    await refreshDisplayNameFromServer();
    await expect(loadDisplayName()).resolves.toBe(GENERATED);
  });

  it("joins again for a new player id when the old name is still on the device", async () => {
    await joinLeaderboards();
    await flushDisplayNameSync();
    await clearSession();
    resetDisplayNameCacheForTests();
    serverName = null;
    await syncDisplayNameOnLaunch();
    expect(mockPutMe).toHaveBeenCalledTimes(2);
  });
});

describe("clearDisplayNameSync (Delete my data)", () => {
  it("waits for a PUT in flight, then forgets the pending and settled state", async () => {
    let release: (v: { display_name: string }) => void = () => {};
    mockPutMe.mockImplementationOnce(
      () => new Promise((resolve) => (release = resolve as typeof release))
    );
    await joinLeaderboards();
    await waitFor(() => expect(mockPutMe).toHaveBeenCalledTimes(1));

    let cleared = false;
    const clearing = clearDisplayNameSync().then(() => (cleared = true));
    await Promise.resolve();
    expect(cleared).toBe(false); // still waiting for the in-flight PUT
    release({ display_name: GENERATED });
    await clearing;

    await expect(AsyncStorage.getItem(PENDING_KEY)).resolves.toBeNull();
    await expect(AsyncStorage.getItem(SYNCED_KEY)).resolves.toBeNull();
  });

  it("never rejects", async () => {
    await expect(clearDisplayNameSync()).resolves.toBeUndefined();
  });
});
