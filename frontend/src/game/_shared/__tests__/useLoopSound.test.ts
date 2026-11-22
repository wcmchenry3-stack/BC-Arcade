import { renderHook, act } from "@testing-library/react-native";
import React from "react";
import { SoundProvider, useSoundSettings } from "../SoundContext";
import { useLoopSound } from "../useLoopSound";

const mockPlayer = {
  play: jest.fn(),
  pause: jest.fn(),
  seekTo: jest.fn(),
  remove: jest.fn(),
  loop: false,
  volume: 1,
};

jest.mock("expo-audio", () => ({
  createAudioPlayer: jest.fn(() => mockPlayer),
}));

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
}));

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(SoundProvider, null, children);
}

const REGISTRY: Record<string, number> = { "test.hum": 1 as unknown as number };

function setup(volume = 0.25) {
  return renderHook(
    (props: { volume: number }) => ({
      loop: useLoopSound("test.hum", REGISTRY, props.volume),
      settings: useSoundSettings(),
    }),
    { wrapper, initialProps: { volume } }
  );
}

/** Lets the seekTo()->play() chain settle. */
const settle = () => act(async () => {});

beforeEach(() => {
  jest.clearAllMocks();
  mockPlayer.loop = false;
  mockPlayer.volume = 1;
  mockPlayer.seekTo.mockResolvedValue(undefined);
  mockPlayer.play.mockResolvedValue(undefined);
});

describe("useLoopSound (#3526)", () => {
  it("creates a looping player at the given volume", async () => {
    await setup(0.25);
    expect(mockPlayer.loop).toBe(true);
    expect(mockPlayer.volume).toBe(0.25);
    expect(mockPlayer.play).not.toHaveBeenCalled();
  });

  it("start() plays from the top, and a repeated start() does not restart it", async () => {
    const { result } = await setup();
    await act(() => result.current.loop.start());
    await settle();
    await act(() => result.current.loop.start());
    await act(() => result.current.loop.start());
    await settle();
    expect(mockPlayer.seekTo).toHaveBeenCalledTimes(1);
    expect(mockPlayer.seekTo).toHaveBeenCalledWith(0);
    expect(mockPlayer.play).toHaveBeenCalledTimes(1);
    expect(mockPlayer.loop).toBe(true);
  });

  it("stop() pauses and rewinds, and is a no-op when it is not playing", async () => {
    const { result } = await setup();
    await act(() => result.current.loop.stop());
    expect(mockPlayer.pause).not.toHaveBeenCalled();
    await act(() => result.current.loop.start());
    await settle();
    await act(() => result.current.loop.stop());
    await act(() => result.current.loop.stop());
    expect(mockPlayer.pause).toHaveBeenCalledTimes(1);
  });

  it("a stop() that lands while the start's seek is pending never plays", async () => {
    let finishSeek: () => void = () => {};
    mockPlayer.seekTo.mockImplementationOnce(() => new Promise<void>((r) => (finishSeek = r)));
    const { result } = await setup();
    await act(() => result.current.loop.start());
    await act(() => result.current.loop.stop());
    finishSeek();
    await settle();
    expect(mockPlayer.play).not.toHaveBeenCalled();
  });

  it("start() and stop() keep the same identity across re-renders", async () => {
    const { result, rerender } = await setup();
    const { start, stop } = result.current.loop;
    await rerender({ volume: 0.5 });
    expect(result.current.loop.start).toBe(start);
    expect(result.current.loop.stop).toBe(stop);
  });

  it("a volume change applies to the running loop without restarting it", async () => {
    const { result, rerender } = await setup(0.25);
    await act(() => result.current.loop.start());
    await settle();
    await rerender({ volume: 0.6 });
    expect(mockPlayer.volume).toBe(0.6);
    expect(mockPlayer.play).toHaveBeenCalledTimes(1);
  });

  it("muting stops a running loop; unmuting resumes it while it is still wanted", async () => {
    const { result } = await setup();
    await act(() => result.current.loop.start());
    await settle();
    await act(() => result.current.settings.setMuted(true));
    expect(mockPlayer.pause).toHaveBeenCalledTimes(1);
    await act(() => result.current.settings.setMuted(false));
    await settle();
    expect(mockPlayer.play).toHaveBeenCalledTimes(2);
  });

  it("start() while muted stays silent; a stopped loop does not resume on unmute", async () => {
    const { result } = await setup();
    await act(() => result.current.settings.setMuted(true));
    await act(() => result.current.loop.start());
    await settle();
    expect(mockPlayer.play).not.toHaveBeenCalled();
    await act(() => result.current.loop.stop());
    await act(() => result.current.settings.setMuted(false));
    await settle();
    expect(mockPlayer.play).not.toHaveBeenCalled();
  });

  it("pauses and removes the player on unmount", async () => {
    const { result, unmount } = await setup();
    await act(() => result.current.loop.start());
    await settle();
    await unmount();
    expect(mockPlayer.pause).toHaveBeenCalled();
    expect(mockPlayer.remove).toHaveBeenCalledTimes(1);
  });

  it("an unregistered key is a no-op", async () => {
    const { result } = await renderHook(() => useLoopSound("nope", {}), { wrapper });
    await act(() => result.current.start());
    await settle();
    expect(mockPlayer.play).not.toHaveBeenCalled();
  });
});
