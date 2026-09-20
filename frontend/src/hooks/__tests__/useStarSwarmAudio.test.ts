import { renderHook } from "@testing-library/react-native";
import { useStarSwarmAudio } from "../useStarSwarmAudio";
import { useSound } from "../../game/_shared/useSound";
import { useBackgroundMusic } from "../../game/_shared/useBackgroundMusic";

jest.mock("../../game/_shared/useBackgroundMusic", () => ({
  useBackgroundMusic: jest.fn(),
}));

jest.mock("../../game/_shared/useSound", () => ({
  useSound: jest.fn().mockReturnValue({ play: jest.fn(), stop: jest.fn() }),
}));

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
}));

const mockUseBackgroundMusic = useBackgroundMusic as jest.Mock;

beforeEach(() => {
  mockUseBackgroundMusic.mockClear();
});

describe("useStarSwarmAudio — PERFECT fanfare (#2422)", () => {
  it("exposes playPerfect and stopPerfect from the fanfare's own sound", async () => {
    const play = jest.fn().mockReturnValue(true);
    const stop = jest.fn();
    (useSound as jest.Mock).mockImplementation((key: string) =>
      key === "starswarm.perfectbonus" ? { play, stop } : { play: jest.fn(), stop: jest.fn() }
    );
    const { result } = await renderHook(() => useStarSwarmAudio(true));
    expect(result.current.playPerfect()).toBe(true);
    result.current.stopPerfect();
    expect(play).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
    (useSound as jest.Mock).mockReturnValue({ play: jest.fn(), stop: jest.fn() });
  });
});

describe("useStarSwarmAudio — newGameTick passthrough", () => {
  it("passes newGameTick to useBackgroundMusic", async () => {
    await renderHook(() => useStarSwarmAudio(true, undefined, 3));
    expect(mockUseBackgroundMusic).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(Object),
      true,
      3
    );
  });

  it("passes undefined newGameTick when not provided", async () => {
    await renderHook(() => useStarSwarmAudio(true));
    expect(mockUseBackgroundMusic).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(Object),
      true,
      undefined
    );
  });
});
