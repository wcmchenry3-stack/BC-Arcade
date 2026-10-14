import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";
import { act, renderHook } from "@testing-library/react-native";

import { BugReportLimiter } from "../bugReportLimiter";
import { EventStore } from "../eventStore";
import { GameEventClientImpl } from "../gameEventClient";
import { PendingGamesStore } from "../pendingGamesStore";
import { clearSessionTags, difficultyOf, taggedSessionGameId } from "../sessionTags";
import { useGameRecorder } from "../useGameRecorder";

const setTag = Sentry.setTag as jest.Mock;
const captureException = Sentry.captureException as jest.Mock;

const flush = () => new Promise((r) => setTimeout(r, 10));

/** Mirrors Sentry's scope: setTag(k, undefined) removes the tag from later events. */
let scopeTags: Record<string, string | undefined> = {};
function liveTags(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(scopeTags).filter((e): e is [string, string] => e[1] !== undefined)
  );
}

describe("Sentry session tags (#3277)", () => {
  let store: EventStore;
  let games: PendingGamesStore;
  let client: GameEventClientImpl;

  afterEach(() => {
    // Module state: end whatever session a test left tagged.
    const open = taggedSessionGameId();
    if (open) clearSessionTags(open);
  });

  beforeEach(async () => {
    await AsyncStorage.clear();
    scopeTags = {};
    setTag.mockReset();
    setTag.mockImplementation((k: string, v: string | undefined) => {
      scopeTags[k] = v;
    });
    captureException.mockReset();
    captureException.mockImplementation(() => {
      // The tags an event captured right now would carry.
      captured.push(liveTags());
    });
    captured = [];
    store = new EventStore();
    games = new PendingGamesStore();
    client = new GameEventClientImpl(store, games, new BugReportLimiter());
    await client.init();
  });

  let captured: Record<string, string>[] = [];

  it("start sets game.id, game.type and game.difficulty once", () => {
    const id = client.startGame("sudoku", { difficulty: "hard", variant: "classic" });
    expect(liveTags()).toEqual({
      "game.id": id,
      "game.type": "sudoku",
      "game.difficulty": "hard",
    });
    // Once per session, not per event.
    const calls = setTag.mock.calls.length;
    client.enqueueEvent(id, { type: "move" });
    client.enqueueEvent(id, { type: "move" });
    expect(setTag.mock.calls.length).toBe(calls);
  });

  it("reads difficulty from ai_difficulty and difficulty_tier; omits it when absent", () => {
    expect(difficultyOf({ ai_difficulty: "hard" })).toBe("hard");
    expect(difficultyOf({ difficulty_tier: "Captain" })).toBe("Captain");
    expect(difficultyOf({ mode: "solo" })).toBeUndefined();
    client.startGame("yacht", { mode: "solo" });
    expect(liveTags()["game.difficulty"]).toBeUndefined();
    expect(liveTags()["game.type"]).toBe("yacht");
  });

  it("a game without difficulty does not inherit the previous game's", () => {
    client.startGame("sudoku", { difficulty: "easy" });
    client.startGame("yacht", { mode: "solo" });
    expect(liveTags()["game.difficulty"]).toBeUndefined();
  });

  it.each(["complete", "discard"] as const)("%s clears all three tags", (how) => {
    const id = client.startGame("hearts", { ai_difficulty: "hard" });
    expect(liveTags()["game.id"]).toBe(id);
    if (how === "complete") client.completeGame(id, { outcome: "abandoned" });
    else client.discardGame(id);
    expect(liveTags()).toEqual({});
  });

  it("resume sets the tags from the resumed session's metadata", async () => {
    const id = client.startGame("sudoku", { difficulty: "medium" });
    client.markStarted(id);
    await flush();
    // Simulate a killed process: a fresh client loads the pending game.
    scopeTags = {};
    games = new PendingGamesStore();
    const client2 = new GameEventClientImpl(store, games, new BugReportLimiter());
    await client2.init();
    const resumed = client2.resumeGame("sudoku");
    expect(resumed).toBe(id);
    expect(liveTags()).toEqual({
      "game.id": id,
      "game.type": "sudoku",
      "game.difficulty": "medium",
    });
  });

  it("a failed resume leaves the tags alone", () => {
    expect(client.resumeGame("sudoku")).toBeNull();
    expect(setTag).not.toHaveBeenCalled();
  });

  it("ending an older session does not clear a newer session's tags", () => {
    const first = client.startGame("sudoku", { difficulty: "easy" });
    const second = client.startGame("yacht", { mode: "solo" });
    client.completeGame(first, { outcome: "abandoned" });
    expect(liveTags()).toMatchObject({ "game.id": second, "game.type": "yacht" });
    client.discardGame(second);
    expect(liveTags()).toEqual({});
  });

  it("an error thrown mid-game carries the three tags; none after it ends", () => {
    const id = client.startGame("sudoku", { difficulty: "hard" });
    Sentry.captureException(new Error("boom mid-game"));
    client.completeGame(id, { outcome: "completed" });
    Sentry.captureException(new Error("boom after"));
    expect(captured[0]).toEqual({
      "game.id": id,
      "game.type": "sudoku",
      "game.difficulty": "hard",
    });
    expect(captured[1]).toEqual({});
  });

  it("a Sentry that throws on setTag does not break the game", () => {
    setTag.mockImplementation(() => {
      throw new Error("sentry down");
    });
    expect(() => client.startGame("yacht")).not.toThrow();
  });

  describe("reportBug", () => {
    it("attaches the open game_id to the context", async () => {
      const id = client.startGame("yacht");
      client.reportBug("error", "yacht.test", "oops", { a: 1 });
      await flush();
      const bug = (await store.peek(10)).find((r) => r.log_type === "bug_log");
      expect(bug?.payload).toEqual({ message: "oops", context: { game_id: id, a: 1 } });
    });

    it("leaves the context alone with no open game, and keeps a caller's game_id", async () => {
      client.reportBug("error", "yacht.a", "none", { a: 1 });
      const id = client.startGame("yacht");
      client.reportBug("error", "yacht.b", "own", { game_id: "caller" });
      await flush();
      const bugs = (await store.peek(10)).filter((r) => r.log_type === "bug_log");
      const byMsg = Object.fromEntries(
        bugs.map((b) => [(b.payload as { message: string }).message, b.payload])
      );
      expect(byMsg["none"]).toEqual({ message: "none", context: { a: 1 } });
      expect(byMsg["own"]).toEqual({ message: "own", context: { game_id: "caller" } });
      expect(id).toBeTruthy();
    });
  });
});

describe("Sentry session tags through useGameRecorder (#3277)", () => {
  beforeEach(() => {
    scopeTags = {};
    setTag.mockReset();
    setTag.mockImplementation((k: string, v: string | undefined) => {
      scopeTags[k] = v;
    });
  });

  it("start tags, complete clears; unmount closes an open session", async () => {
    const { result, unmount } = await renderHook(() => useGameRecorder("yacht"));
    await act(() => result.current.start(undefined, { mode: "vs", difficulty: "hard" }));
    expect(liveTags()).toMatchObject({ "game.type": "yacht", "game.difficulty": "hard" });
    await act(() => {
      result.current.markStarted();
      result.current.complete({ outcome: "completed", finalScore: 10, result: {} });
    });
    expect(liveTags()).toEqual({});
    await act(() => result.current.restart(undefined, { mode: "solo" }));
    expect(liveTags()["game.type"]).toBe("yacht");
    await unmount();
    expect(liveTags()).toEqual({});
  });
});
