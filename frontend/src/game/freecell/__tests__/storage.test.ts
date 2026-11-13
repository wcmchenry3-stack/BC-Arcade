import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";

import { clearGame, loadGame, saveGame } from "../storage";
import { applyMove, dealGame, getHintMoves } from "../engine";
import type { FreeCellState } from "../types";

const GAME_KEY = "freecell_game";

function seedState(): FreeCellState {
  return dealGame();
}

describe("freecell storage", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    (Sentry.captureException as jest.Mock).mockClear();
    (Sentry.captureMessage as jest.Mock).mockClear();
  });

  it("round-trips a fresh deal via save → load", async () => {
    const s = seedState();
    await saveGame(s);
    const loaded = await loadGame();
    expect(loaded).not.toBeNull();
    expect(loaded!.tableau.length).toBe(8);
    expect(loaded!.freeCells.length).toBe(4);
    expect(loaded!.isComplete).toBe(false);
  });

  it("restores a save whose stored events include the removed foundationComplete (#3567)", async () => {
    const s = seedState();
    await AsyncStorage.setItem(
      GAME_KEY,
      JSON.stringify({
        ...s,
        events: [{ type: "cardPlace" }, { type: "foundationComplete", suit: "spades" }],
      })
    );
    const loaded = await loadGame();
    expect(loaded).not.toBeNull();
    expect(loaded!.tableau.length).toBe(8);
    // The restored game plays on normally: the next move's events replace the stale ones.
    const move = getHintMoves(loaded!)[0]!;
    const next = applyMove(loaded!, move);
    expect(next.moveCount).toBe(loaded!.moveCount + 1);
    expect(JSON.stringify(next.events)).not.toContain("foundationComplete");
  });

  it("never saves the one-shot events (#3826)", async () => {
    const s: FreeCellState = { ...seedState(), events: [{ type: "cardPlace" }] };
    await saveGame(s);
    const parsed = JSON.parse((await AsyncStorage.getItem(GAME_KEY))!);
    expect("events" in parsed).toBe(false);
    expect(parsed.moveCount).toBe(s.moveCount);
  });

  it("restores an older save that has events without them (#3826)", async () => {
    const s = seedState();
    await AsyncStorage.setItem(
      GAME_KEY,
      JSON.stringify({ ...s, _v: 1, events: [{ type: "cardPlace" }] })
    );
    const loaded = await loadGame();
    expect(loaded).not.toBeNull();
    expect("events" in loaded!).toBe(false);
    expect(loaded!.moveCount).toBe(s.moveCount);
    expect(loaded!.tableau.length).toBe(8);
  });

  it("returns null when no save exists", async () => {
    expect(await loadGame()).toBeNull();
  });

  it("strips nested undoStack snapshots at save time so storage cannot balloon", async () => {
    const s = seedState();
    const nested: FreeCellState = {
      ...s,
      undoStack: [{ ...s, undoStack: [{ ...s, undoStack: [] }] }],
    };
    await saveGame(nested);
    const raw = await AsyncStorage.getItem(GAME_KEY);
    const parsed = JSON.parse(raw!);
    for (const snap of parsed.undoStack) {
      expect(snap.undoStack).toEqual([]);
    }
  });

  it("returns null and captures a warning on a corrupt JSON payload", async () => {
    await AsyncStorage.setItem(GAME_KEY, "not-json{{");
    expect(await loadGame()).toBeNull();
    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining("corrupt game payload"),
      expect.objectContaining({
        level: "warning",
        tags: expect.objectContaining({ subsystem: "freecell.storage", op: "load" }),
      })
    );
    // Corrupt entry is removed so subsequent loads don't keep warning.
    expect(await AsyncStorage.getItem(GAME_KEY)).toBeNull();
  });

  it("returns null when the payload has a different shape (missing fields)", async () => {
    await AsyncStorage.setItem(GAME_KEY, JSON.stringify({ foo: "bar" }));
    expect(await loadGame()).toBeNull();
    // Malformed entry is also removed so the next mount starts clean.
    expect(await AsyncStorage.getItem(GAME_KEY)).toBeNull();
  });

  it("returns null on a schema version mismatch (_v !== 1)", async () => {
    const future = { ...seedState(), _v: 2 };
    await AsyncStorage.setItem(GAME_KEY, JSON.stringify(future));
    expect(await loadGame()).toBeNull();
  });

  it("strips the play clock from undo snapshots at save time, keeping the game's own (#3607)", async () => {
    const s = seedState();
    const clock = { startedAt: 1_000, accumulatedMs: 2_000 };
    await saveGame({
      ...s,
      clock,
      undoStack: [{ ...s, clock: { startedAt: 5, accumulatedMs: 9 } }],
    });
    const parsed = JSON.parse((await AsyncStorage.getItem(GAME_KEY))!);
    expect(parsed.clock).toEqual(clock);
    expect(parsed.undoStack).toHaveLength(1);
    expect("clock" in parsed.undoStack[0]).toBe(false);
  });

  it("loads a well-formed clock as saved", async () => {
    const clock = { startedAt: null, accumulatedMs: 134_000, paused: true };
    await AsyncStorage.setItem(GAME_KEY, JSON.stringify({ ...seedState(), clock }));
    expect((await loadGame())!.clock).toEqual(clock);
  });

  it.each([
    ["a string", "soon"],
    ["a missing banked time", { startedAt: 12 }],
    ["a non-numeric start", { startedAt: "noon", accumulatedMs: 0 }],
    ["a non-boolean pause", { startedAt: null, accumulatedMs: 0, paused: "yes" }],
  ])("drops a malformed clock (%s) and keeps the game, as not started", async (_name, clock) => {
    const s = seedState();
    await AsyncStorage.setItem(GAME_KEY, JSON.stringify({ ...s, clock }));
    const loaded = await loadGame();
    expect(loaded).not.toBeNull();
    expect(loaded!.clock).toBeUndefined();
    expect(loaded!.tableau).toEqual(s.tableau);
  });

  it("clamps a negative banked time to 0 and keeps the clock (#3607 review)", async () => {
    const clock = { startedAt: 2_000, accumulatedMs: -5_000, paused: true };
    await AsyncStorage.setItem(GAME_KEY, JSON.stringify({ ...seedState(), clock }));
    expect((await loadGame())!.clock).toEqual({ startedAt: 2_000, accumulatedMs: 0, paused: true });
  });

  it("clearGame removes the saved state", async () => {
    await saveGame(seedState());
    await clearGame();
    expect(await loadGame()).toBeNull();
  });
});
