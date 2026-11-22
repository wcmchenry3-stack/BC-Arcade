/**
 * #3702: Cascade's sounds on the real shared pool (`_shared/soundPool.ts`, expo-audio mocked in
 * jest.setup.ts). A retrigger of the same file while its play is still starting is dropped by the
 * pool's in-flight guard, the next one plays; the Reduce Motion win seeks 0.5 s in, even on its
 * first (lazy) play.
 */
import { act, renderHook } from "@testing-library/react-native";
import { createAudioPlayer } from "expo-audio";
import { useCascadeSounds } from "../useCascadeSounds";
import { CASCADE_SOUND_NAMES } from "../sounds";
import { CALM_WIN_OFFSET_S } from "../soundPacer";
import { pooledPlayerCountForTests } from "../../_shared/soundPool";

jest.mock("../sounds", () => {
  const actual = jest.requireActual("../sounds");
  const ids = (base: number) =>
    Object.fromEntries((actual.CASCADE_SOUND_NAMES as string[]).map((name, i) => [name, base + i]));
  return { ...actual, CASCADE_SOUNDS: { fruits: ids(100), cosmos: ids(200) } };
});
jest.mock("../../_shared/SoundContext", () => ({ useSoundSettings: () => ({ muted: false }) }));

interface MockPlayer {
  play: jest.Mock;
  seekTo: jest.Mock;
}
/** The player made for `name` (fruits set). */
function playerOf(name: string): MockPlayer {
  const create = createAudioPlayer as jest.Mock;
  const i = create.mock.calls.findIndex(
    ([src]) => src === 100 + CASCADE_SOUND_NAMES.indexOf(name as never)
  );
  return create.mock.results[i]!.value as MockPlayer;
}
const flush = () =>
  act(async () => {
    jest.advanceTimersByTime(0);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

beforeEach(() => {
  jest.useFakeTimers();
  (createAudioPlayer as jest.Mock).mockClear();
});
afterEach(() => jest.useRealTimers());

it("a retrigger while the same file is starting is dropped; once started it plays again", async () => {
  const { result, unmount } = await renderHook(() => useCascadeSounds("fruits"));
  expect(pooledPlayerCountForTests()).toBe(8);
  await act(async () => {
    result.current.drop();
    jest.advanceTimersByTime(0);
    result.current.drop();
    jest.advanceTimersByTime(0);
  });
  await flush();
  expect(playerOf("drop").play).toHaveBeenCalledTimes(1);
  result.current.drop();
  await flush();
  expect(playerOf("drop").play).toHaveBeenCalledTimes(2);
  await unmount();
  expect(pooledPlayerCountForTests()).toBe(0);
});

it("under Reduce Motion the win's first play seeks 0.5 s in", async () => {
  const { result, unmount } = await renderHook(() => useCascadeSounds("fruits", true));
  result.current.win();
  await flush();
  const win = playerOf("win");
  expect(win.seekTo).toHaveBeenCalledWith(CALM_WIN_OFFSET_S);
  expect(win.play).toHaveBeenCalledTimes(1);
  await unmount();
});
