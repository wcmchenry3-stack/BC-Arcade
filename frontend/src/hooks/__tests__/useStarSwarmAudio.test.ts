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

describe("useStarSwarmAudio — boss wave sting (#2490)", () => {
  it("exposes playBossWave from its own sound key", async () => {
    const play = jest.fn().mockReturnValue(true);
    (useSound as jest.Mock).mockImplementation((key: string) =>
      key === "starswarm.bosswave"
        ? { play, stop: jest.fn() }
        : { play: jest.fn(), stop: jest.fn() }
    );
    const { result } = await renderHook(() => useStarSwarmAudio(true));
    result.current.playBossWave();
    expect(play).toHaveBeenCalledTimes(1);
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
