import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";
import { waitFor } from "@testing-library/react-native";

const mockPutMe = jest.fn();
const mockDeleteMe = jest.fn();
jest.mock("../../../api/players", () => ({
  playersApi: {
    putMe: (...args: unknown[]) => mockPutMe(...args),
    deleteMe: (...args: unknown[]) => mockDeleteMe(...args),
  },
}));

import {
  loadDisplayName,
  normalizeDisplayName,
  resetDisplayNameCacheForTests,
  saveDisplayName,
  setDisplayNameSaveHook,
} from "../displayName";
import {
  clearDisplayNameSync,
  flushDisplayNameSync,
  registerDisplayNameSync,
  removeDisplayName,
  resetDisplayNameSyncForTests,
  syncDisplayNameOnLaunch,
} from "../displayNameSync";
import { ApiError } from "../httpClient";
import { clearSession } from "../session";

const PENDING_KEY = "player_display_name_pending_sync";
const SYNCED_KEY = "player_display_name_synced";

const ok = (name: string) => Promise.resolve({ display_name: name });
const offline = () => Promise.reject(new TypeError("Network request failed"));

function sentNames(): string[] {
  return mockPutMe.mock.calls.map((c) => c[0] as string);
}

beforeEach(async () => {
  await AsyncStorage.clear();
  resetDisplayNameCacheForTests();
  resetDisplayNameSyncForTests();
  setDisplayNameSaveHook(null);
  mockPutMe.mockReset();
  mockPutMe.mockImplementation(ok);
  mockDeleteMe.mockReset();
  mockDeleteMe.mockResolvedValue(undefined);
  (Sentry.captureMessage as jest.Mock).mockClear();
  registerDisplayNameSync();
});

afterAll(() => setDisplayNameSaveHook(null));

describe("saveDisplayName → PUT /players/me", () => {
  it("sends the saved (trimmed) name once", async () => {
    await expect(saveDisplayName("  Riley ")).resolves.toBe("Riley");
    await expect(flushDisplayNameSync()).resolves.toBe(true);
    expect(sentNames()).toEqual(["Riley"]);
    await expect(AsyncStorage.getItem(PENDING_KEY)).resolves.toBeNull();
  });

  it("sends nothing for a name it rejects", async () => {
    await expect(saveDisplayName("   ")).resolves.toBeNull();
    await flushDisplayNameSync();
    expect(mockPutMe).not.toHaveBeenCalled();
  });

  it("sends nothing when no sync is registered (no NetworkContext)", async () => {
    setDisplayNameSaveHook(null);
    await saveDisplayName("Riley");
    expect(mockPutMe).not.toHaveBeenCalled();
  });

  it("still saves locally when the sync hook throws", async () => {
    setDisplayNameSaveHook(() => {
      throw new Error("boom");
    });
    await expect(saveDisplayName("Riley")).resolves.toBe("Riley");
    expect(Sentry.captureException).toHaveBeenCalled();
  });
});

describe("offline", () => {
  it("collapses saves into one pending sync holding the latest name", async () => {
    mockPutMe.mockImplementation(offline);
    await saveDisplayName("William");
    await saveDisplayName("Will");
    await saveDisplayName("Bill");
    await expect(flushDisplayNameSync()).resolves.toBe(false);
    await expect(AsyncStorage.getItem(PENDING_KEY)).resolves.toBe("Bill");

    // Back online: one PUT, with the latest name.
    mockPutMe.mockReset();
    mockPutMe.mockImplementation(ok);
    await expect(flushDisplayNameSync()).resolves.toBe(true);
    expect(sentNames()).toEqual(["Bill"]);
    await expect(AsyncStorage.getItem(PENDING_KEY)).resolves.toBeNull();
  });

  it("keeps the name pending on a server error or a backend without the route", async () => {
    mockPutMe.mockRejectedValueOnce(new ApiError("Server error", 503));
    await saveDisplayName("Riley");
    await expect(flushDisplayNameSync()).resolves.toBe(true); // the queued retry succeeds
    mockPutMe.mockReset();
    mockPutMe.mockRejectedValue(new ApiError("Not Found", 404));
    await saveDisplayName("Sam");
    await expect(flushDisplayNameSync()).resolves.toBe(false);
    await expect(AsyncStorage.getItem(PENDING_KEY)).resolves.toBe("Sam");
  });

  it("drops a name the server will never accept instead of retrying it", async () => {
    mockPutMe.mockRejectedValue(new ApiError("invalid", 422));
    await saveDisplayName("Riley");
    await expect(flushDisplayNameSync()).resolves.toBe(true);
    await expect(AsyncStorage.getItem(PENDING_KEY)).resolves.toBeNull();
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      "displayNameSync: server rejected the display name",
      expect.objectContaining({ level: "warning" })
    );
    const calls = mockPutMe.mock.calls.length;
    await flushDisplayNameSync();
    expect(mockPutMe).toHaveBeenCalledTimes(calls);
  });

  it("doesn't resend a rejected name on every launch", async () => {
    mockPutMe.mockRejectedValue(new ApiError("invalid", 422));
    await saveDisplayName("Riley");
    await flushDisplayNameSync();
    const calls = mockPutMe.mock.calls.length;
    resetDisplayNameCacheForTests();
    registerDisplayNameSync();
    await syncDisplayNameOnLaunch();
    expect(mockPutMe).toHaveBeenCalledTimes(calls);
  });

  it("sends a name saved during an in-flight PUT right after it", async () => {
    let release: (v: { display_name: string }) => void = () => {};
    mockPutMe.mockImplementationOnce(
      () => new Promise((resolve) => (release = resolve as typeof release))
    );
    await saveDisplayName("First");
    await waitFor(() => expect(mockPutMe).toHaveBeenCalledTimes(1));
    await saveDisplayName("Second"); // First's PUT is still in flight
    release({ display_name: "First" });
    await expect(flushDisplayNameSync()).resolves.toBe(true);
    expect(sentNames()).toEqual(["First", "Second"]);
    await expect(AsyncStorage.getItem(PENDING_KEY)).resolves.toBeNull();
  });
});

describe("launch", () => {
  it("syncs a stored name that was never synced, once", async () => {
    // Saved by a build from before #2624: stored locally, never sent.
    await AsyncStorage.setItem("player_display_name", "Riley");
    await expect(syncDisplayNameOnLaunch()).resolves.toBe(true);
    expect(sentNames()).toEqual(["Riley"]);

    resetDisplayNameCacheForTests(); // a later launch
    await syncDisplayNameOnLaunch();
    expect(sentNames()).toEqual(["Riley"]);
  });

  it("sends nothing when no name is stored", async () => {
    await syncDisplayNameOnLaunch();
    expect(mockPutMe).not.toHaveBeenCalled();
  });

  it("retries a launch sync that failed on the next launch", async () => {
    await AsyncStorage.setItem("player_display_name", "Riley");
    mockPutMe.mockImplementationOnce(offline);
    await expect(syncDisplayNameOnLaunch()).resolves.toBe(false);
    resetDisplayNameCacheForTests();
    await expect(syncDisplayNameOnLaunch()).resolves.toBe(true);
    expect(sentNames()).toEqual(["Riley", "Riley"]);
  });

  it("syncs again for a new player id (e.g. after Delete my data)", async () => {
    await saveDisplayName("Riley");
    await flushDisplayNameSync();
    await clearSession();
    resetDisplayNameCacheForTests();
    await syncDisplayNameOnLaunch();
    expect(sentNames()).toEqual(["Riley", "Riley"]);
  });

  it("sends the current name, not an older pending one", async () => {
    mockPutMe.mockImplementation(offline);
    await saveDisplayName("Old");
    await flushDisplayNameSync();
    // The pending slot still says "Old" but the stored name moved on (e.g.
    // the slot write failed after a later save).
    await AsyncStorage.setItem("player_display_name", "New");
    resetDisplayNameCacheForTests();
    mockPutMe.mockReset();
    mockPutMe.mockImplementation(ok);
    await syncDisplayNameOnLaunch();
    expect(sentNames()).toEqual(["New"]);
  });
});

describe("replays", () => {
  it("a replayed sync has no second effect", async () => {
    await saveDisplayName("Riley");
    await flushDisplayNameSync();
    expect(sentNames()).toEqual(["Riley"]);

    // Reconnect, foreground and launch triggers all find nothing to send.
    await Promise.all([flushDisplayNameSync(), flushDisplayNameSync()]);
    await syncDisplayNameOnLaunch();
    expect(sentNames()).toEqual(["Riley"]);
  });

  it("concurrent flushes of one pending name send it once", async () => {
    await AsyncStorage.setItem(PENDING_KEY, "Riley");
    await Promise.all([flushDisplayNameSync(), flushDisplayNameSync(), flushDisplayNameSync()]);
    expect(sentNames()).toEqual(["Riley"]);
  });
});

describe("name rule matches the server", () => {
  it.each(["\u0085", "a\u001fb", "a\u0000b", "\u001c", "tab\there"])(
    "rejects a name with a control character (%j)",
    (raw) => {
      expect(normalizeDisplayName(raw)).toBeNull();
    }
  );

  it("still accepts ordinary names", () => {
    expect(normalizeDisplayName("  Zoë O'Neil ")).toBe("Zoë O'Neil");
  });
});

describe("clearDisplayNameSync (Delete my data)", () => {
  it("waits for a PUT in flight, then forgets the pending and settled state", async () => {
    let release: (v: { display_name: string }) => void = () => {};
    mockPutMe.mockImplementationOnce(
      () => new Promise((resolve) => (release = resolve as typeof release))
    );
    await saveDisplayName("Riley");
    await waitFor(() => expect(mockPutMe).toHaveBeenCalledTimes(1));

    let cleared = false;
    const clearing = clearDisplayNameSync().then(() => (cleared = true));
    await Promise.resolve();
    expect(cleared).toBe(false); // still waiting for the in-flight PUT
    release({ display_name: "Riley" });
    await clearing;

    await expect(AsyncStorage.getItem(PENDING_KEY)).resolves.toBeNull();
    await expect(AsyncStorage.getItem(SYNCED_KEY)).resolves.toBeNull();
  });

  it("never rejects", async () => {
    await expect(clearDisplayNameSync()).resolves.toBeUndefined();
  });
});

describe("removeDisplayName → DELETE /players/me (#2637)", () => {
  it("forgets the local name and sends one DELETE", async () => {
    await saveDisplayName("Riley");
    await flushDisplayNameSync();

    await expect(removeDisplayName()).resolves.toBe(true);
    await expect(loadDisplayName()).resolves.toBeNull();
    await expect(AsyncStorage.getItem("player_display_name")).resolves.toBeNull();
    await expect(flushDisplayNameSync()).resolves.toBe(true);
    expect(mockDeleteMe).toHaveBeenCalledTimes(1);
    await expect(AsyncStorage.getItem(PENDING_KEY)).resolves.toBeNull();
  });

  it("keeps an offline removal pending and sends it on reconnect", async () => {
    await saveDisplayName("Riley");
    await flushDisplayNameSync();
    mockDeleteMe.mockImplementation(offline);

    await expect(removeDisplayName()).resolves.toBe(true);
    await expect(flushDisplayNameSync()).resolves.toBe(false);
    await expect(AsyncStorage.getItem(PENDING_KEY)).resolves.not.toBeNull();

    // Reconnect (NetworkContext flushes): the removal goes out once.
    mockDeleteMe.mockReset();
    mockDeleteMe.mockResolvedValue(undefined);
    await expect(flushDisplayNameSync()).resolves.toBe(true);
    expect(mockDeleteMe).toHaveBeenCalledTimes(1);
    await expect(AsyncStorage.getItem(PENDING_KEY)).resolves.toBeNull();
  });

  it("sends a removal left pending at the next launch, without resending the name", async () => {
    await saveDisplayName("Riley");
    await flushDisplayNameSync();
    mockDeleteMe.mockImplementation(offline);
    await removeDisplayName();
    await flushDisplayNameSync();

    mockDeleteMe.mockReset();
    mockDeleteMe.mockResolvedValue(undefined);
    resetDisplayNameCacheForTests(); // a later launch
    resetDisplayNameSyncForTests();
    await expect(syncDisplayNameOnLaunch()).resolves.toBe(true);
    expect(mockDeleteMe).toHaveBeenCalledTimes(1);
    expect(sentNames()).toEqual(["Riley"]);
  });

  it("replaces an unsent name: only the DELETE goes out", async () => {
    mockPutMe.mockImplementation(offline);
    await saveDisplayName("Riley");
    await flushDisplayNameSync();
    mockPutMe.mockReset();
    mockPutMe.mockImplementation(ok);

    await removeDisplayName();
    await expect(flushDisplayNameSync()).resolves.toBe(true);
    expect(mockPutMe).not.toHaveBeenCalled();
    expect(mockDeleteMe).toHaveBeenCalledTimes(1);
  });

  it("is replaced by a later save: only the new name goes out", async () => {
    mockDeleteMe.mockImplementation(offline);
    await saveDisplayName("Riley");
    await flushDisplayNameSync();
    await removeDisplayName();
    await flushDisplayNameSync();
    mockPutMe.mockClear();
    mockDeleteMe.mockClear();

    await saveDisplayName("Sam");
    await expect(flushDisplayNameSync()).resolves.toBe(true);
    expect(sentNames()).toEqual(["Sam"]);
    expect(mockDeleteMe).not.toHaveBeenCalled();
  });

  it("sends the DELETE after a PUT already in flight, not before it", async () => {
    const order: string[] = [];
    let release: () => void = () => {};
    mockPutMe.mockImplementationOnce((name: string) =>
      new Promise<void>((resolve) => (release = resolve)).then(() => {
        order.push("PUT");
        return { display_name: name };
      })
    );
    mockDeleteMe.mockImplementation(() => {
      order.push("DELETE");
      return Promise.resolve();
    });
    await saveDisplayName("Riley");
    await waitFor(() => expect(mockPutMe).toHaveBeenCalledTimes(1));

    await removeDisplayName(); // Riley's PUT is still in flight
    release();
    await expect(flushDisplayNameSync()).resolves.toBe(true);
    expect(order).toEqual(["PUT", "DELETE"]);
  });

  it("changes nothing and sends nothing when the local name can't be cleared", async () => {
    await saveDisplayName("Riley");
    await flushDisplayNameSync();
    const spy = jest.spyOn(AsyncStorage, "removeItem").mockRejectedValueOnce(new Error("disk"));

    await expect(removeDisplayName()).resolves.toBe(false);
    spy.mockRestore();
    await flushDisplayNameSync();
    expect(mockDeleteMe).not.toHaveBeenCalled();
    await expect(loadDisplayName()).resolves.toBe("Riley");
  });
});
