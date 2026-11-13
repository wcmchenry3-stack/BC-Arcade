/**
 * Sort haptics (#3660): the right pulse per event, none on web, and a failing haptic never
 * throws into play.
 */
import { Platform } from "react-native";
import * as Haptics from "expo-haptics";
import { fireSortHaptic } from "../haptics";

jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy" },
  NotificationFeedbackType: { Success: "success", Warning: "warning", Error: "error" },
}));

const impact = Haptics.impactAsync as jest.Mock;
const notify = Haptics.notificationAsync as jest.Mock;
const originalOS = Platform.OS;

beforeEach(() => {
  impact.mockReset().mockResolvedValue(undefined);
  notify.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  Platform.OS = originalOS;
});

describe("fireSortHaptic", () => {
  it("select is a light impact, landing a medium one", () => {
    fireSortHaptic("select");
    expect(impact).toHaveBeenLastCalledWith("light");
    fireSortHaptic("land");
    expect(impact).toHaveBeenLastCalledWith("medium");
    expect(impact).toHaveBeenCalledTimes(2);
    expect(notify).not.toHaveBeenCalled();
  });

  it("a refused pour is a warning, a completed bottle a success", () => {
    fireSortHaptic("refused");
    expect(notify).toHaveBeenLastCalledWith("warning");
    fireSortHaptic("complete");
    expect(notify).toHaveBeenLastCalledWith("success");
    expect(notify).toHaveBeenCalledTimes(2);
    expect(impact).not.toHaveBeenCalled();
  });

  it("fires nothing on web", () => {
    Platform.OS = "web";
    (["select", "land", "refused", "complete"] as const).forEach(fireSortHaptic);
    expect(impact).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("swallows a rejected promise", async () => {
    impact.mockRejectedValue(new Error("no haptics"));
    notify.mockRejectedValue(new Error("no haptics"));
    expect(() => {
      fireSortHaptic("select");
      fireSortHaptic("complete");
    }).not.toThrow();
    // A rejection nobody caught would fail the test as an unhandled rejection.
    await new Promise((resolve) => setImmediate(resolve));
  });

  it("swallows a synchronous throw, and a module that returns nothing", () => {
    impact.mockImplementation(() => {
      throw new Error("no module");
    });
    notify.mockReturnValue(undefined);
    expect(() => {
      fireSortHaptic("land");
      fireSortHaptic("refused");
    }).not.toThrow();
  });
});
