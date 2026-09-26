import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";
import { saveGame, loadGame, clearGame, saveBestScore, loadBestScore } from "../storage";
import { _resetTileIds, move, setRng, createSeededRng } from "../engine";
import { Twenty48State } from "../types";

const GAME_KEY = "twenty48_game_v2";

const sample: Twenty48State = {
  board: [
    [2, 0, 0, 0],
    [0, 4, 0, 0],
    [0, 0, 8, 0],
    [0, 0, 0, 16],
  ],
  tiles: [
    { id: 1, value: 2, row: 0, col: 0, prevRow: 0, prevCol: 0, isNew: false, isMerge: false },
    { id: 2, value: 4, row: 1, col: 1, prevRow: 1, prevCol: 1, isNew: false, isMerge: false },
    { id: 3, value: 8, row: 2, col: 2, prevRow: 2, prevCol: 2, isNew: false, isMerge: false },
    { id: 4, value: 16, row: 3, col: 3, prevRow: 3, prevCol: 3, isNew: false, isMerge: false },
  ],
  score: 120,
  scoreDelta: 0,
  game_over: false,
  has_won: false,
  startedAt: null,
  accumulatedMs: 0,
};

describe("twenty48 storage", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    (Sentry.captureException as jest.Mock).mockClear();
    (Sentry.captureMessage as jest.Mock).mockClear();
  });

  it("saves and loads a game", async () => {
    await saveGame(sample);
    const loaded = await loadGame();
    expect(loaded).toEqual(sample);
  });

  it("returns null when no saved game exists", async () => {
    const loaded = await loadGame();
    expect(loaded).toBeNull();
  });

  it("returns null when saved data is corrupted", async () => {
    await AsyncStorage.setItem(GAME_KEY, "not json");
    const loaded = await loadGame();
    expect(loaded).toBeNull();
  });

  // #501: corrupt payload is fully recovered — should be a warning, not
  // an exception, and the corrupt entry must be cleared.
  it("reports corrupt payload as warning (not exception) and clears the entry", async () => {
    await AsyncStorage.setItem(GAME_KEY, "garbage{not json}");
    expect(await loadGame()).toBeNull();
    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining("corrupt game payload"),
      expect.objectContaining({
        level: "warning",
        tags: expect.objectContaining({ subsystem: "twenty48.storage", op: "load" }),
      })
    );
    expect(await AsyncStorage.getItem(GAME_KEY)).toBeNull();
  });

  // #1094: rawPayload must be included in the Sentry extra so engineers can
  // see what the malformed JSON looked like without unfiltering PII fields.
  it("includes rawPayload in Sentry extra for corrupt payload (#1094)", async () => {
    const corrupt = "truncated{json";
    await AsyncStorage.setItem(GAME_KEY, corrupt);
    await loadGame();
    const call = (Sentry.captureMessage as jest.Mock).mock.calls[0];
    expect(call[1].extra.rawPayload).toBe(corrupt);
  });

  it("returns null when saved data has a different shape", async () => {
    await AsyncStorage.setItem("twenty48_game_v2", JSON.stringify({ foo: "bar" }));
    const loaded = await loadGame();
    expect(loaded).toBeNull();
  });

  it("backfills tiles array for v1 payloads instead of discarding (#570)", async () => {
    const v1Payload = { board: sample.board, score: 0, game_over: false, has_won: false };
    await AsyncStorage.setItem("twenty48_game_v2", JSON.stringify(v1Payload));
    const loaded = await loadGame();
    expect(loaded).not.toBeNull();
    expect(Array.isArray(loaded!.tiles)).toBe(true);
    expect(loaded!.scoreDelta).toBe(0);
    expect(loaded!.startedAt).toBeNull();
    expect(loaded!.accumulatedMs).toBe(0);
  });

  // Events are transient — they must not survive a save/load round-trip so
  // sounds don't replay and the screen doesn't re-emit stale game events on reload.
  it("strips transient events on load even if saveGame received them", async () => {
    const withEvents: Twenty48State = { ...sample, events: ["win2048"] };
    await saveGame(withEvents);
    const loaded = await loadGame();
    expect(loaded).not.toBeNull();
    expect(loaded!.events).toBeUndefined();
  });

  it("clearGame removes the saved state", async () => {
    await saveGame(sample);
    await clearGame();
    expect(await loadGame()).toBeNull();
  });

  it("saves and loads best score", async () => {
    await saveBestScore(1234);
    expect(await loadBestScore()).toBe(1234);
  });

  it("loadBestScore returns 0 when nothing is saved", async () => {
    expect(await loadBestScore()).toBe(0);
  });

  // #698: on app reload, the engine's module-level tile-ID counter restarts
  // at 1. Without re-seeding on load, subsequent spawns/merges issue IDs
  // that collide with surviving tiles and React warns about duplicate keys
  // in Grid.
  it("re-seeds the engine tile-ID counter above max(tile.id) on load (#698)", async () => {
    const highIdState: Twenty48State = {
      board: [
        [2, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ],
      tiles: [
        { id: 100, value: 2, row: 0, col: 0, prevRow: 0, prevCol: 0, isNew: false, isMerge: false },
      ],
      score: 0,
      scoreDelta: 0,
      game_over: false,
      has_won: false,
      startedAt: null,
      accumulatedMs: 0,
    };
    await saveGame(highIdState);

    // Simulate a JS reload: the module counter snaps back to 1.
    _resetTileIds();
    setRng(createSeededRng(42));

    const loaded = await loadGame();
    expect(loaded).not.toBeNull();

    // A successful move spawns a new tile. Without the re-seed fix the
    // spawned tile would get id=1, but the surviving slid tile's id is
    // 100 — no collision here, yet subsequent spawns would march up to
    // 100 and collide. Assert the spawned id is already above max.
    const afterMove = move(loaded!, "right");
    const spawned = afterMove.tiles.find((t) => t.isNew);
    expect(spawned).toBeDefined();
    expect(spawned!.id).toBeGreaterThan(100);

    // And the surviving tile keeps its original id.
    const survivor = afterMove.tiles.find((t) => !t.isNew && t.value === 2);
    expect(survivor?.id).toBe(100);
  });
});

// #2750: the save banks the running clock and the load restarts it, so the
// play before an app kill is kept and the time the app was closed never counts.
describe("twenty48 storage — play clock across a relaunch (#2750)", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });
  afterEach(() => jest.restoreAllMocks());

  it("keeps the play before the save and drops the time until the load", async () => {
    const nowSpy = jest.spyOn(Date, "now").mockReturnValue(40_000);
    await saveGame({ ...sample, startedAt: 10_000, accumulatedMs: 5_000 });
    nowSpy.mockReturnValue(40_000 + 2 * 86_400_000);
    const loaded = await loadGame();
    expect(loaded!.accumulatedMs).toBe(35_000);
    expect(loaded!.startedAt).toBe(40_000 + 2 * 86_400_000);
  });

  it("loads an older build's running startedAt without counting the gap", async () => {
    await AsyncStorage.setItem(GAME_KEY, JSON.stringify({ ...sample, startedAt: 1_000 }));
    jest.spyOn(Date, "now").mockReturnValue(172_800_000);
    const loaded = await loadGame();
    expect(loaded!.accumulatedMs).toBe(0);
    expect(loaded!.startedAt).toBe(172_800_000);
  });

  it("keeps a finished game's clock frozen", async () => {
    await AsyncStorage.setItem(
      GAME_KEY,
      JSON.stringify({ ...sample, game_over: true, startedAt: null, accumulatedMs: 9_000 })
    );
    const loaded = await loadGame();
    expect(loaded!.startedAt).toBeNull();
    expect(loaded!.accumulatedMs).toBe(9_000);
  });
});
