import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, renderHook } from "@testing-library/react-native";

import { useReportAppOverlay } from "../../../hooks/appOverlay";
import { useLargeCards } from "../largeCards";

const KEY = "freecell_large_cards";

// #3556: on Android, resizing the board while the ⋯ menu's Modal held the
// toggle tap blocked the main thread (ANR). The board's size waits for the menu.
describe("useLargeCards: the board follows the choice only once the menu has closed (#3556)", () => {
  beforeEach(async () => {
    jest.useFakeTimers();
    await AsyncStorage.clear();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  async function setup(menuOpen: boolean) {
    return await renderHook(
      ({ open }: { open: boolean }) => {
        useReportAppOverlay(open);
        return useLargeCards(false);
      },
      { initialProps: { open: menuOpen } }
    );
  }
  /** Lets the two deferred frames run. */
  const frames = async () => {
    await act(async () => {
      jest.runOnlyPendingTimers();
    });
    await act(async () => {
      jest.runOnlyPendingTimers();
    });
  };

  it("applies a stored choice to the board at once", async () => {
    await AsyncStorage.setItem(KEY, "1");
    const hook = await setup(false);
    await act(async () => {});
    expect(hook.result.current.shellLoading).toBe(false);
    expect(hook.result.current.largeCards).toBe(true);
    expect(hook.result.current.boardLargeCards).toBe(true);
  });

  it("shows the choice at once, but resizes the board only after the menu closes", async () => {
    const hook = await setup(true);
    await act(async () => {});
    await act(async () => hook.result.current.toggleLargeCards(true));
    expect(hook.result.current.largeCards).toBe(true);
    expect(await AsyncStorage.getItem(KEY)).toBe("1");
    await act(async () => {
      jest.advanceTimersByTime(10_000);
    });
    expect(hook.result.current.boardLargeCards).toBe(false);

    // The commit that closes the menu doesn't resize the board either.
    await hook.rerender({ open: false });
    expect(hook.result.current.boardLargeCards).toBe(false);
    await frames();
    expect(hook.result.current.boardLargeCards).toBe(true);
  });

  it("drops a pending resize when the menu opens again before it runs", async () => {
    const hook = await setup(true);
    await act(async () => {});
    await act(async () => hook.result.current.toggleLargeCards(true));
    await hook.rerender({ open: false });
    await hook.rerender({ open: true });
    await frames();
    expect(hook.result.current.boardLargeCards).toBe(false);
    await hook.rerender({ open: false });
    await frames();
    expect(hook.result.current.boardLargeCards).toBe(true);
  });
});
