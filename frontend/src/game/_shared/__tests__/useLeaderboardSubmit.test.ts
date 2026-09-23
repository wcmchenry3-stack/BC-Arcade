import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, renderHook } from "@testing-library/react-native";
import { topTenRank, useLeaderboardSubmit, type LeaderboardAdapter } from "../useLeaderboardSubmit";
import { resetDisplayNameCacheForTests, saveDisplayName, loadDisplayName } from "../displayName";
import { scoreQueue } from "../scoreQueue";

const mockNetwork = { isOnline: true, isInitialized: true };
jest.mock("../NetworkContext", () => ({
  useNetwork: () => mockNetwork,
}));

type Payload = { score: number };

function makeAdapter(submit: jest.Mock): LeaderboardAdapter<Payload> {
  return {
    gameType: "mahjong",
    submit,
    queuePayload: (player_name, { score }) => ({ player_name, score }),
  };
}

async function setup(submit = jest.fn().mockResolvedValue(3)) {
  const adapter = makeAdapter(submit);
  const hook = await renderHook(() => useLeaderboardSubmit(adapter));
  return { ...hook, submit };
}

beforeEach(async () => {
  await AsyncStorage.clear();
  resetDisplayNameCacheForTests();
  mockNetwork.isOnline = true;
  mockNetwork.isInitialized = true;
});

describe("topTenRank", () => {
  it("keeps ranks 1–10 and drops the 'not placed' sentinel", () => {
    expect(topTenRank(1)).toBe(1);
    expect(topTenRank(10)).toBe(10);
    expect(topTenRank(11)).toBeNull();
    expect(topTenRank(null)).toBeNull();
    expect(topTenRank(0)).toBeNull();
  });
});

describe("useLeaderboardSubmit", () => {
  it("submits online under the display name and reports the rank", async () => {
    await saveDisplayName("Riley");
    const { result, submit } = await setup();

    await act(() => result.current.submit({ score: 500 }));

    expect(submit).toHaveBeenCalledWith("Riley", { score: 500 });
    expect(result.current.status).toBe("saved");
    expect(result.current.rank).toBe(3);
    expect(result.current.playerName).toBe("Riley");
  });

  it("reports no rank when the score did not place", async () => {
    await saveDisplayName("Riley");
    const { result } = await setup(jest.fn().mockResolvedValue(11));
    await act(() => result.current.submit({ score: 5 }));
    expect(result.current.status).toBe("saved");
    expect(result.current.rank).toBeNull();
  });

  it("queues the score when offline", async () => {
    await saveDisplayName("Riley");
    mockNetwork.isOnline = false;
    const { result, submit } = await setup();

    await act(() => result.current.submit({ score: 500 }));

    expect(submit).not.toHaveBeenCalled();
    expect(result.current.status).toBe("offline");
    const queued = await scoreQueue.peek();
    expect(queued.at(-1)).toMatchObject({
      game_type: "mahjong",
      payload: { player_name: "Riley", score: 500 },
    });
  });

  it("queues the score when the online request fails", async () => {
    await saveDisplayName("Riley");
    const { result } = await setup(jest.fn().mockRejectedValue(new Error("500")));

    await act(() => result.current.submit({ score: 500 }));

    expect(result.current.status).toBe("offline");
    expect((await scoreQueue.peek()).at(-1)?.payload).toEqual({ player_name: "Riley", score: 500 });
  });

  it("asks for a name first, then sends the waiting score", async () => {
    const { result, submit } = await setup();

    await act(() => result.current.submit({ score: 500 }));
    expect(result.current.status).toBe("needsName");
    expect(submit).not.toHaveBeenCalled();

    let accepted = false;
    await act(async () => {
      accepted = await result.current.provideName(" Riley ");
    });

    expect(accepted).toBe(true);
    expect(submit).toHaveBeenCalledWith("Riley", { score: 500 });
    expect(result.current.status).toBe("saved");
    await expect(loadDisplayName()).resolves.toBe("Riley");
  });

  it("rejects an invalid name and keeps waiting", async () => {
    const { result, submit } = await setup();
    await act(() => result.current.submit({ score: 500 }));

    let accepted = true;
    await act(async () => {
      accepted = await result.current.provideName("   ");
    });

    expect(accepted).toBe(false);
    expect(submit).not.toHaveBeenCalled();
    expect(result.current.status).toBe("needsName");
  });

  it("submits only once per game until reset", async () => {
    await saveDisplayName("Riley");
    const { result, submit } = await setup();

    await act(() => result.current.submit({ score: 1 }));
    await act(() => result.current.submit({ score: 2 }));
    expect(submit).toHaveBeenCalledTimes(1);

    await act(async () => result.current.reset());
    expect(result.current.status).toBe("idle");
    await act(() => result.current.submit({ score: 3 }));
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit).toHaveBeenLastCalledWith("Riley", { score: 3 });
  });

  it("reports an error when the score can be neither sent nor queued, and retries", async () => {
    await saveDisplayName("Riley");
    const submit = jest.fn().mockRejectedValueOnce(new Error("500")).mockResolvedValueOnce(4);
    const { result } = await setup(submit);
    const enqueue = jest.spyOn(scoreQueue, "enqueue").mockRejectedValueOnce(new Error("disk"));

    await act(() => result.current.submit({ score: 500 }));
    expect(result.current.status).toBe("error");

    await act(() => result.current.retry());
    expect(result.current.status).toBe("saved");
    expect(result.current.rank).toBe(4);
    enqueue.mockRestore();
  });
});
