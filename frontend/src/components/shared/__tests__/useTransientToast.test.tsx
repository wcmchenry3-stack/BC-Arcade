import { act, renderHook } from "@testing-library/react-native";
import { useTransientToast } from "../useTransientToast";

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

/** The id the hook got back from its own `setTimeout(fn, durationMs)` call. */
function toastTimerId(setSpy: jest.SpyInstance, durationMs: number): unknown {
  const i = setSpy.mock.calls.map((c) => c[1]).lastIndexOf(durationMs);
  expect(i).toBeGreaterThanOrEqual(0);
  return setSpy.mock.results[i].value;
}

describe("useTransientToast", () => {
  it("starts hidden", async () => {
    const { result } = await renderHook(() => useTransientToast(2000));
    expect(result.current.visible).toBe(false);
  });

  it("shows, then hides itself after the duration", async () => {
    const { result } = await renderHook(() => useTransientToast(2000));
    await act(async () => result.current.show());
    expect(result.current.visible).toBe(true);

    await act(async () => jest.advanceTimersByTime(1999));
    expect(result.current.visible).toBe(true);

    await act(async () => jest.advanceTimersByTime(1));
    expect(result.current.visible).toBe(false);
  });

  it("restarts the timer when shown again while visible", async () => {
    const { result } = await renderHook(() => useTransientToast(3000));
    await act(async () => result.current.show());
    await act(async () => jest.advanceTimersByTime(2000));

    await act(async () => result.current.show());
    // The first timer would have fired at 3000 ms; the reset one fires at 5000.
    await act(async () => jest.advanceTimersByTime(2000));
    expect(result.current.visible).toBe(true);

    await act(async () => jest.advanceTimersByTime(1000));
    expect(result.current.visible).toBe(false);
  });

  it("clears the previous timer on a repeat show", async () => {
    const setSpy = jest.spyOn(global, "setTimeout");
    const clearSpy = jest.spyOn(global, "clearTimeout");
    const { result } = await renderHook(() => useTransientToast(3000));
    await act(async () => result.current.show());
    const firstId = toastTimerId(setSpy, 3000);
    await act(async () => result.current.show());
    expect(clearSpy).toHaveBeenCalledWith(firstId);
  });

  it("hide() hides at once and cancels the pending timer", async () => {
    const { result } = await renderHook(() => useTransientToast(2000));
    const setSpy = jest.spyOn(global, "setTimeout");
    const clearSpy = jest.spyOn(global, "clearTimeout");
    await act(async () => result.current.show());
    const id = toastTimerId(setSpy, 2000);
    await act(async () => result.current.hide());
    expect(result.current.visible).toBe(false);
    expect(clearSpy).toHaveBeenCalledWith(id);
  });

  it("clears its timer on unmount", async () => {
    const setSpy = jest.spyOn(global, "setTimeout");
    const clearSpy = jest.spyOn(global, "clearTimeout");
    const { result, unmount } = await renderHook(() => useTransientToast(2000));
    await act(async () => result.current.show());
    const id = toastTimerId(setSpy, 2000);

    await act(async () => unmount());
    expect(clearSpy).toHaveBeenCalledWith(id);
    // Nothing fires after unmount (no state update on an unmounted component).
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    await act(async () => jest.advanceTimersByTime(5000));
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
