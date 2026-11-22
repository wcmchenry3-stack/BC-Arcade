import { renderHook, act } from "@testing-library/react-native";
import { useLastScored } from "../useLastScored";

const EMPTY = { ones: null, twos: null, chance: null };

describe("useLastScored (#3748)", () => {
  it("highlights nothing for the scores it starts with (a restored game)", async () => {
    const { result } = await renderHook(() => useLastScored({ ...EMPTY, ones: 3 }));
    expect(result.current.lastScored).toBeNull();
  });

  it("is the row that went from open to scored", async () => {
    const { result, rerender } = await renderHook(
      ({ scores }: { scores: Record<string, number | null> }) => useLastScored(scores),
      { initialProps: { scores: EMPTY } }
    );
    await rerender({ scores: { ...EMPTY, chance: 21 } });
    expect(result.current.lastScored).toBe("chance");
    await rerender({ scores: { ...EMPTY, chance: 21, ones: 2 } });
    expect(result.current.lastScored).toBe("ones");
  });

  it("clear drops it", async () => {
    const { result, rerender } = await renderHook(
      ({ scores }: { scores: Record<string, number | null> }) => useLastScored(scores),
      { initialProps: { scores: EMPTY } }
    );
    await rerender({ scores: { ...EMPTY, chance: 21 } });
    await act(async () => result.current.clear());
    expect(result.current.lastScored).toBeNull();
  });

  it("does not mistake a new game's blank card, or the first card of a vs game, for a score", async () => {
    const { result, rerender } = await renderHook(
      ({ scores }: { scores: Record<string, number | null> | null }) => useLastScored(scores),
      { initialProps: { scores: null as Record<string, number | null> | null } }
    );
    await rerender({ scores: EMPTY });
    expect(result.current.lastScored).toBeNull();
    await rerender({ scores: { ...EMPTY, ones: 1 } });
    await rerender({ scores: EMPTY });
    expect(result.current.lastScored).toBe("ones"); // unchanged: nothing was scored by the reset
  });
});
