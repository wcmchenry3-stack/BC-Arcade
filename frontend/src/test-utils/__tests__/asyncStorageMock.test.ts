// Guard for #3895: the AsyncStorage mock's methods are already jest.fn()s, so
// spyOn(...).mockRestore() strips their in-memory implementation. jest.setup-after-env.ts
// re-installs it before every test; the tests below are order-dependent on purpose (each
// "after" test runs after a test that spied and restored).
import AsyncStorage from "@react-native-async-storage/async-storage";

const METHODS = ["getItem", "setItem", "removeItem", "getAllKeys", "clear"] as const;

describe("AsyncStorage mock survives spyOn + mockRestore (#3895)", () => {
  it("a test spies on every method and restores it", async () => {
    for (const method of METHODS) {
      const spy = jest.spyOn(AsyncStorage, method);
      spy.mockRestore();
    }
  });

  it("the next test still gets the in-memory implementation", async () => {
    await AsyncStorage.setItem("k", "v");
    expect(await AsyncStorage.getItem("k")).toBe("v");
    expect(await AsyncStorage.getItem("missing")).toBeNull();
    expect(await AsyncStorage.getAllKeys()).toContain("k");
    await AsyncStorage.removeItem("k");
    expect(await AsyncStorage.getItem("k")).toBeNull();
    await AsyncStorage.setItem("a", "1");
    await AsyncStorage.clear();
    expect(await AsyncStorage.getAllKeys()).toEqual([]);
  });

  it("a restore mid-file does not stick across several following tests", async () => {
    const spy = jest.spyOn(AsyncStorage, "getItem").mockRejectedValueOnce(new Error("disk"));
    await expect(AsyncStorage.getItem("x")).rejects.toThrow("disk");
    spy.mockRestore();
    // Same test, after the restore: not covered by the per-test re-install, only the next one is.
  });

  it("and the one after that still reads storage", async () => {
    await AsyncStorage.setItem("x", "1");
    expect(await AsyncStorage.getItem("x")).toBe("1");
  });
});
