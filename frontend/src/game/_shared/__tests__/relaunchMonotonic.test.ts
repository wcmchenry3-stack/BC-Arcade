import AsyncStorage from "@react-native-async-storage/async-storage";

import { clockElapsedMs } from "../playClock";
import { monotonicNow } from "../monotonicNow";
import * as twenty48Storage from "../../twenty48/storage";
import * as solitaireStorage from "../../solitaire/storage";
import * as mahjongStorage from "../../mahjong/storage";
import { newGame } from "../../twenty48/engine";
import { dealGame as dealSolitaire } from "../../solitaire/engine";
import { createGame } from "../../mahjong/engine";
import { TURTLE_LAYOUT } from "../../mahjong/layouts/turtle";
import { dealGame as dealFreeCell } from "../../freecell/engine";
import { forSave, onLoad } from "../../freecell/playClock";
import type { PlayClock } from "../playClock";

/**
 * A relaunch resets `performance.now()` to a small number while the wall clock moves on (#3925).
 * Each game saves through its real storage slot at one origin, loads at another, and its elapsed
 * time must be the banked play plus the time since the load, whatever either clock did.
 */
const SAVE_MONO = 5_000_000;
const LOAD_MONO = 50;

interface Slot {
  name: string;
  make: () => PlayClock & Record<string, unknown>;
  save: (s: never) => Promise<void>;
  load: () => Promise<(PlayClock & Record<string, unknown>) | null>;
  key: string;
}

const slots: Slot[] = [
  {
    name: "twenty48",
    make: () => newGame() as never,
    save: twenty48Storage.saveGame as never,
    load: twenty48Storage.loadGame as never,
    key: "twenty48_game_v2",
  },
  {
    name: "solitaire",
    make: () => dealSolitaire(1, 12345) as never,
    save: solitaireStorage.saveGame as never,
    load: solitaireStorage.loadGame as never,
    key: "solitaire_game",
  },
  {
    name: "mahjong",
    make: () => createGame(TURTLE_LAYOUT, 12345) as never,
    save: mahjongStorage.saveGame as never,
    load: mahjongStorage.loadGame as never,
    key: "mahjong_game",
  },
];

describe("play clock across a relaunch, through the real storage slots (#3925)", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });
  afterEach(() => jest.restoreAllMocks());

  describe.each(slots)("$name", ({ make, save, load, key }) => {
    it("continues from the banked play, with the new run's origin", async () => {
      const wall = jest.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
      const mono = jest.spyOn(performance, "now").mockReturnValue(SAVE_MONO + 10_000);
      await save({ ...make(), startedAt: SAVE_MONO, accumulatedMs: 5_000 } as never);

      // Relaunch: the monotonic origin restarts, the wall clock is two days on.
      wall.mockReturnValue(1_700_000_000_000 + 2 * 86_400_000);
      mono.mockReturnValue(LOAD_MONO);
      const loaded = await load();
      expect(loaded!.startedAt).toBe(LOAD_MONO);
      expect(clockElapsedMs(loaded!)).toBe(15_000);
      mono.mockReturnValue(LOAD_MONO + 3_000);
      expect(clockElapsedMs(loaded!)).toBe(18_000);
      // Wall time moving on its own changes nothing.
      wall.mockReturnValue(1_600_000_000_000);
      expect(clockElapsedMs(loaded!)).toBe(18_000);
    });

    it("counts from the load for an old save holding a wall-time startedAt", async () => {
      const stored = { ...make(), startedAt: 1.7e12, accumulatedMs: 4_000 };
      await AsyncStorage.setItem(key, JSON.stringify(stored));
      const mono = jest.spyOn(performance, "now").mockReturnValue(LOAD_MONO);
      const loaded = await load();
      expect(loaded!.startedAt).toBe(LOAD_MONO);
      expect(clockElapsedMs(loaded!)).toBe(4_000);
      mono.mockReturnValue(LOAD_MONO + 2_000);
      expect(clockElapsedMs(loaded!)).toBe(6_000);
    });
  });

  describe("freecell onLoad", () => {
    it("continues from the banked play, and from an old wall-time startedAt", () => {
      const running = { ...dealFreeCell(3), clock: { startedAt: SAVE_MONO, accumulatedMs: 1_000 } };
      const saved = forSave(running, SAVE_MONO + 9_000);
      const loaded = onLoad(saved, LOAD_MONO);
      expect(clockElapsedMs(loaded.clock!, LOAD_MONO + 500)).toBe(10_500);

      const old = onLoad(
        { ...running, clock: { startedAt: 1.7e12, accumulatedMs: 2_000 } },
        LOAD_MONO
      );
      expect(old.clock).toEqual({ startedAt: LOAD_MONO, accumulatedMs: 2_000 });
    });
  });
});

describe("whole-millisecond durations (#3925)", () => {
  afterEach(() => jest.restoreAllMocks());

  it("monotonicNow returns an integer for a fractional performance.now", () => {
    jest.spyOn(performance, "now").mockReturnValue(1234.567);
    expect(monotonicNow()).toBe(1234);
  });
});
