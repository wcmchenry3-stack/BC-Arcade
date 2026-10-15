import { renderHook } from "@testing-library/react-native";
import { AppState } from "react-native";

import { useFlushOnBackground } from "../useFlushOnBackground";

describe("useFlushOnBackground", () => {
  let handler: ((state: string) => void) | null = null;
  const remove = jest.fn();

  beforeEach(() => {
    handler = null;
    remove.mockClear();
    jest.spyOn(AppState, "addEventListener").mockImplementation(((
      _type: string,
      h: (state: string) => void
    ) => {
      handler = h;
      return { remove };
    }) as never);
  });
  afterEach(() => jest.restoreAllMocks());

  it("flushes synchronously on background and on inactive, not on active", async () => {
    const flush = jest.fn();
    await renderHook(() => useFlushOnBackground(flush));
    handler?.("active");
    expect(flush).not.toHaveBeenCalled();
    handler?.("inactive");
    expect(flush).toHaveBeenCalledTimes(1);
    handler?.("background");
    expect(flush).toHaveBeenCalledTimes(2);
  });

  it("calls the latest handler without re-subscribing, and unsubscribes on unmount", async () => {
    const first = jest.fn();
    const second = jest.fn();
    const { rerender, unmount } = await renderHook(
      ({ f }: { f: () => void }) => useFlushOnBackground(f),
      { initialProps: { f: first } }
    );
    const subscribed = (AppState.addEventListener as jest.Mock).mock.calls.length;
    await rerender({ f: second });
    expect(AppState.addEventListener).toHaveBeenCalledTimes(subscribed);
    handler?.("background");
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    await unmount();
    expect(remove).toHaveBeenCalled();
  });
});
