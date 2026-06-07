import { renderHook } from "@testing-library/react-native";
import { useStarSwarmAudio } from "../useStarSwarmAudio";
import { useBackgroundMusic } from "../../game/_shared/useBackgroundMusic";

jest.mock("../../game/_shared/useBackgroundMusic", () => ({
  useBackgroundMusic: jest.fn(),
}));

jest.mock("../../game/_shared/useSound", () => ({
  useSound: jest.fn().mockReturnValue({ play: jest.fn() }),
}));

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
}));

const mockUseBackgroundMusic = useBackgroundMusic as jest.Mock;

beforeEach(() => {
  mockUseBackgroundMusic.mockClear();
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
