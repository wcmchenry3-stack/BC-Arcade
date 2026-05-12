import { renderHook, act } from "@testing-library/react-native";
import * as Reanimated from "react-native-reanimated";
import { useCardSelection } from "../useCardSelection";

describe("useCardSelection", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("triggerShake runs withSequence with 5 steps and does not call sound", () => {
    const withSequenceSpy = jest.spyOn(Reanimated, "withSequence");
    const playInvalidMove = jest.fn();
    const { result } = renderHook(() => useCardSelection(playInvalidMove));

    act(() => {
      result.current.triggerShake();
    });

    expect(withSequenceSpy).toHaveBeenCalledTimes(1);
    expect(withSequenceSpy.mock.calls[0]).toHaveLength(5);
    expect(playInvalidMove).not.toHaveBeenCalled();
  });

  it("triggerIllegal calls shake and playInvalidMove", () => {
    const withSequenceSpy = jest.spyOn(Reanimated, "withSequence");
    const playInvalidMove = jest.fn();
    const { result } = renderHook(() => useCardSelection(playInvalidMove));

    act(() => {
      result.current.triggerIllegal();
    });

    expect(withSequenceSpy).toHaveBeenCalledTimes(1);
    expect(playInvalidMove).toHaveBeenCalledTimes(1);
  });
});
