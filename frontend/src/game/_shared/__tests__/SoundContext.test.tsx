import React from "react";
import { renderHook, act } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { SoundProvider, useSoundSettings } from "../SoundContext";

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
}));

const mockGetItem = AsyncStorage.getItem as jest.Mock;
const mockSetItem = AsyncStorage.setItem as jest.Mock;

function wrapper({ children }: { children: React.ReactNode }) {
  return <SoundProvider>{children}</SoundProvider>;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetItem.mockResolvedValue(null);
});

describe("SoundContext — initial state", () => {
  it("defaults to unmuted when no value in AsyncStorage", async () => {
    const { result } = await renderHook(() => useSoundSettings(), { wrapper });
    await act(async () => {});
    expect(result.current.muted).toBe(false);
  });

  it("reads saved muted=true from AsyncStorage on mount", async () => {
    mockGetItem.mockResolvedValueOnce("true");
    const { result } = await renderHook(() => useSoundSettings(), { wrapper });
    await act(async () => {});
    expect(result.current.muted).toBe(true);
    expect(mockGetItem).toHaveBeenCalledWith("settings.soundMuted");
  });

  it("reads saved muted=false from AsyncStorage on mount", async () => {
    mockGetItem.mockResolvedValueOnce("false");
    const { result } = await renderHook(() => useSoundSettings(), { wrapper });
    await act(async () => {});
    expect(result.current.muted).toBe(false);
  });
});

describe("SoundContext — setMuted", () => {
  it("updates muted state immediately", async () => {
    const { result } = await renderHook(() => useSoundSettings(), { wrapper });
    await act(async () => {});
    await act(() => {
      result.current.setMuted(true);
    });
    expect(result.current.muted).toBe(true);
  });

  it("persists muted=true to AsyncStorage", async () => {
    const { result } = await renderHook(() => useSoundSettings(), { wrapper });
    await act(async () => {});
    await act(() => {
      result.current.setMuted(true);
    });
    expect(mockSetItem).toHaveBeenCalledWith("settings.soundMuted", "true");
  });

  it("persists muted=false to AsyncStorage", async () => {
    mockGetItem.mockResolvedValueOnce("true");
    const { result } = await renderHook(() => useSoundSettings(), { wrapper });
    await act(async () => {});
    await act(() => {
      result.current.setMuted(false);
    });
    expect(mockSetItem).toHaveBeenCalledWith("settings.soundMuted", "false");
  });
});
