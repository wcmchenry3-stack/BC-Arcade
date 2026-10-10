import { act, renderHook } from "@testing-library/react-native";
import {
  isAppOverlayOpen,
  subscribeAppOverlay,
  useAppOverlayOpen,
  useReportAppOverlay,
} from "../appOverlay";

// The "app overlay open" signal (#2944): AppHeader reports its menu and
// sheets; game screens and the result card read it.

async function reporter(initial: boolean) {
  return renderHook(({ open }: { open: boolean }) => useReportAppOverlay(open), {
    initialProps: { open: initial },
  });
}

describe("appOverlay (#2944)", () => {
  it("is closed with no reporter", () => {
    expect(isAppOverlayOpen()).toBe(false);
  });

  it("is open while a reporter says so, and closes with it", async () => {
    const r = await reporter(false);
    expect(isAppOverlayOpen()).toBe(false);
    await r.rerender({ open: true });
    expect(isAppOverlayOpen()).toBe(true);
    await r.rerender({ open: false });
    expect(isAppOverlayOpen()).toBe(false);
  });

  it("closes when an open reporter unmounts", async () => {
    const r = await reporter(true);
    expect(isAppOverlayOpen()).toBe(true);
    await r.unmount();
    expect(isAppOverlayOpen()).toBe(false);
  });

  it("stays open until every reporter has closed", async () => {
    const a = await reporter(true);
    const b = await reporter(true);
    await a.rerender({ open: false });
    expect(isAppOverlayOpen()).toBe(true);
    await b.rerender({ open: false });
    expect(isAppOverlayOpen()).toBe(false);
  });

  it("notifies subscribers once per change, not per reporter", async () => {
    const listener = jest.fn();
    const off = subscribeAppOverlay(listener);
    const a = await reporter(true);
    const b = await reporter(true);
    expect(listener).toHaveBeenCalledTimes(1);
    await a.unmount();
    expect(listener).toHaveBeenCalledTimes(1);
    await b.unmount();
    expect(listener).toHaveBeenCalledTimes(2);
    off();
  });

  it("useAppOverlayOpen re-renders on a change", async () => {
    const reader = await renderHook(() => useAppOverlayOpen());
    expect(reader.result.current).toBe(false);
    const r = await reporter(true);
    expect(reader.result.current).toBe(true);
    await act(async () => r.unmount());
    expect(reader.result.current).toBe(false);
  });
});
