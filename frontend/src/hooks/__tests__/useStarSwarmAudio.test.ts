import { renderHook } from "@testing-library/react-native";
import { DEFAULT_SFX_VOLUMES, STARSWARM_BGM_VOLUME, useStarSwarmAudio } from "../useStarSwarmAudio";
import { STARSWARM_BGM } from "../../game/starswarm/bgmCues";
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
      3,
      false,
      expect.any(Object)
    );
  });

  it("passes undefined newGameTick when not provided", async () => {
    await renderHook(() => useStarSwarmAudio(true));
    expect(mockUseBackgroundMusic).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(Object),
      true,
      undefined,
      false,
      expect.any(Object)
    );
  });

  it("passes paused through, so the music holds while the run is paused", async () => {
    await renderHook(() => useStarSwarmAudio(true, undefined, 3, true));
    expect(mockUseBackgroundMusic).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(Object),
      true,
      3,
      true,
      expect.any(Object)
    );
  });
});

describe("useStarSwarmAudio — music (#3638)", () => {
  it("plays the one track with its starting points, resume key and own volume", async () => {
    await renderHook(() => useStarSwarmAudio(true));
    expect(mockUseBackgroundMusic).toHaveBeenCalledWith(
      ["starswarm.bgm"],
      expect.any(Object),
      true,
      undefined,
      false,
      {
        volume: STARSWARM_BGM_VOLUME,
        cuesMs: STARSWARM_BGM.cuesMs,
        resumeKey: "bgm.resume.starswarm",
      }
    );
    expect(STARSWARM_BGM_VOLUME).toBe(0.57);
    expect(DEFAULT_SFX_VOLUMES.music).toBe(STARSWARM_BGM_VOLUME);
  });

  it("the dev mixer's music volume reaches the hook", async () => {
    await renderHook(() => useStarSwarmAudio(true, { music: 0.42 }));
    const options = mockUseBackgroundMusic.mock.calls.at(-1)?.[5] as { volume: number };
    expect(options.volume).toBe(0.42);
  });
});
