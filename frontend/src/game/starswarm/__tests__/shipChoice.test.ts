/** #3600: the saved Star Swarm ship — local, cosmetic, and never a reason for a run to fail. */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";
import { act, renderHook } from "@testing-library/react-native";
import { loadShip, saveShip, SHIP_STORAGE_KEY, useShipChoice } from "../shipChoice";

beforeEach(async () => {
  await AsyncStorage.clear();
  (Sentry.captureException as jest.Mock).mockClear();
});

describe("loadShip / saveShip", () => {
  it("uses its own key", () => {
    expect(SHIP_STORAGE_KEY).toBe("starswarm.ship");
  });

  it("is P1 with nothing stored", async () => {
    expect(await loadShip()).toBe("p1");
  });

  it("restores a stored ship", async () => {
    await saveShip("p2");
    expect(await loadShip()).toBe("p2");
    await saveShip("p3");
    expect(await loadShip()).toBe("p3");
  });

  it("is P1 for a value that is not a ship", async () => {
    for (const bad of ["p4", "P2", "", "arrow", "null"]) {
      await AsyncStorage.setItem(SHIP_STORAGE_KEY, bad);
      expect(await loadShip()).toBe("p1");
    }
  });

  it("is P1 and reports when storage fails to read", async () => {
    (AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(new Error("disk"));
    await expect(loadShip()).resolves.toBe("p1");
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
  });

  it("does not throw when storage fails to write, and reports it", async () => {
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error("full"));
    await expect(saveShip("p2")).resolves.toBeUndefined();
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
  });
});

describe("useShipChoice", () => {
  /** Holds the stored value back, so a test can act before the read lands. */
  function slowRead(value: string | null) {
    let release = () => {};
    (AsyncStorage.getItem as jest.Mock).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve(value);
        })
    );
    return async () => {
      await act(async () => release());
    };
  }

  it("starts on P1, then shows the stored ship", async () => {
    const land = slowRead("p3");
    const { result } = await renderHook(() => useShipChoice());
    expect(result.current.ship).toBe("p1");
    await land();
    expect(result.current.ship).toBe("p3");
  });

  it("keeps a ship tapped before the stored one loads", async () => {
    const land = slowRead("p3");
    const { result } = await renderHook(() => useShipChoice());
    await act(async () => result.current.setShip("p2"));
    await land();
    expect(result.current.ship).toBe("p2");
  });

  it("stores nothing on a tap, and the chosen ship when remembered", async () => {
    const { result } = await renderHook(() => useShipChoice());
    await act(async () => result.current.setShip("p2"));
    expect(await AsyncStorage.getItem(SHIP_STORAGE_KEY)).toBeNull();
    await act(async () => result.current.rememberShip());
    expect(await AsyncStorage.getItem(SHIP_STORAGE_KEY)).toBe("p2");
  });

  it("writes nothing when the player never picked a ship", async () => {
    const { result } = await renderHook(() => useShipChoice());
    (AsyncStorage.setItem as jest.Mock).mockClear();
    await act(async () => result.current.rememberShip());
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });
});
