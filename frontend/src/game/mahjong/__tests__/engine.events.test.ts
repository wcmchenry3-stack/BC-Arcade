/**
 * The engine's one-shot events (#3087): each action emits a new array of what
 * the screen answers (useMahjongFeedback), in order, and the events never
 * feed back into the game or the RNG.
 */
import {
  createGame,
  createSeededRng,
  getAllFreePairs,
  isFreeTile,
  pauseGame,
  resumeGame,
  selectTile,
  setRng,
  shuffleBoard,
  tilesMatch,
  undoMove,
} from "../engine";
import { TURTLE_LAYOUT } from "../layouts/turtle";
import type { MahjongState, SlotTile } from "../types";

beforeEach(() => {
  setRng(createSeededRng(42));
});

const types = (s: MahjongState) => s.events?.map((e) => e.type);

function tile(id: number, suit: SlotTile["suit"], rank: SlotTile["rank"], col: number, layer = 0) {
  return { id, suit, rank, faceId: id + 1, col, row: 0, layer } as SlotTile;
}

function nonMatchingFreePair(state: MahjongState): [SlotTile, SlotTile] {
  const free = state.tiles.filter((t) => isFreeTile(t, state.tiles));
  for (const a of free) {
    const b = free.find((t) => t.id !== a.id && !tilesMatch(a, t));
    if (b) return [a, b];
  }
  throw new Error("no non-matching pair");
}

describe("mahjong engine events", () => {
  it("a new deal carries none", () => {
    expect(createGame(TURTLE_LAYOUT, 1).events).toBeUndefined();
  });

  it("a select, a non-matching second tap, and a deselect", () => {
    const game = createGame(TURTLE_LAYOUT, 1);
    const [a, b] = nonMatchingFreePair(game);
    const s1 = selectTile(game, a.id);
    expect(types(s1)).toEqual(["tileSelect"]);
    const s2 = selectTile(s1, b.id);
    expect(types(s2)).toEqual(["tileSelect"]);
    // A new array per action, so the screen fires both selects.
    expect(s2.events).not.toBe(s1.events);
    expect(types(selectTile(s2, b.id))).toBeUndefined();
  });

  it("a tap on a blocked tile changes nothing, events included", () => {
    const game = createGame(TURTLE_LAYOUT, 1);
    const blocked = game.tiles.find((t) => !isFreeTile(t, game.tiles))!;
    expect(selectTile(game, blocked.id)).toBe(game);
  });

  it("a match carries the removed pair in board order", () => {
    const game = createGame(TURTLE_LAYOUT, 1);
    const [p, q] = getAllFreePairs(game.tiles)[0]!;
    // Tap the later tile first: the event still lists them in board order.
    const [first, second] = game.tiles.indexOf(p) < game.tiles.indexOf(q) ? [p, q] : [q, p];
    const matched = selectTile(selectTile(game, second.id), first.id);
    expect(matched.events).toEqual([{ type: "tileMatch", tiles: [first, second] }]);
  });

  it("the last pair clears the board: a match, then boardCleared", () => {
    const a = tile(0, "characters", 1, 0);
    const b = tile(1, "characters", 1, 2);
    const state: MahjongState = { ...createGame(TURTLE_LAYOUT, 1), tiles: [a, b] };
    expect(types(selectTile(selectTile(state, a.id), b.id))).toEqual(["tileMatch", "boardCleared"]);
  });

  it("a match that leaves no pair and no shuffle: a match, then deadlock", () => {
    const a = tile(0, "characters", 1, 0);
    const b = tile(1, "characters", 1, 2);
    const c = tile(2, "dragons", 1, 10);
    const d = tile(3, "bamboos", 2, 10, 1);
    const state: MahjongState = {
      ...createGame(TURTLE_LAYOUT, 1),
      tiles: [a, b, c, d],
      shufflesLeft: 0,
    };
    expect(types(selectTile(selectTile(state, a.id), b.id))).toEqual(["tileMatch", "deadlock"]);
    // A board already flagged deadlocked stays so: a match there is no new deadlock.
    const already: MahjongState = { ...state, isDeadlocked: true };
    expect(types(selectTile(selectTile(already, a.id), b.id))).toEqual(["tileMatch"]);
  });

  it("a shuffle, and one that leaves a geometric deadlock", () => {
    const game = createGame(TURTLE_LAYOUT, 1);
    expect(types(shuffleBoard(game))).toEqual(["shuffle"]);

    const stack = [
      tile(0, "characters", 1, 0, 0),
      tile(1, "characters", 1, 0, 1),
      tile(2, "dragons", 1, 0, 2),
      tile(3, "dragons", 1, 0, 3),
    ];
    const stuck: MahjongState = { ...game, tiles: stack };
    expect(types(shuffleBoard(stuck))).toEqual(["shuffle", "deadlock"]);
    // Already deadlocked (a second tap before the overlay shows): the shuffle
    // is spent, but it is no new deadlock.
    const dead = shuffleBoard(stuck);
    expect(dead.isDeadlocked).toBe(true);
    expect(types(shuffleBoard(dead))).toEqual(["shuffle"]);
    // No shuffle left: nothing happens.
    const none = { ...game, shufflesLeft: 0 };
    expect(shuffleBoard(none)).toBe(none);
  });

  it("an undo emits nothing, unless it brings a selection back", () => {
    const game = createGame(TURTLE_LAYOUT, 1);
    const [a, b] = getAllFreePairs(game.tiles)[0]!;
    const matched = selectTile(selectTile(game, a.id), b.id);
    expect(types(undoMove(matched))).toBeUndefined();

    const selected = selectTile(game, a.id);
    const shuffled = shuffleBoard(selected);
    expect(shuffled.selected).toBeNull();
    const undone = undoMove(shuffled);
    expect(undone.selected?.id).toBe(a.id);
    expect(types(undone)).toEqual(["tileSelect"]);
  });

  it("a pause or resume keeps the same array, so it is no new event", () => {
    const game = createGame(TURTLE_LAYOUT, 1);
    const free = game.tiles.find((t) => isFreeTile(t, game.tiles))!;
    const selected = selectTile(game, free.id);
    const paused = pauseGame(selected, Date.now() + 1000);
    expect(paused.events).toBe(selected.events);
    expect(resumeGame(paused).events).toBe(selected.events);
  });

  it("never feed back: the same play with events stripped each step ends identically", () => {
    jest.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const play = (strip: boolean) => {
      setRng(createSeededRng(7));
      let s = createGame(TURTLE_LAYOUT, 7);
      for (let n = 0; n < 40 && !s.isComplete && !s.isDeadlocked; n++) {
        if (strip) s = { ...s, events: undefined };
        if (n % 9 === 4 && s.shufflesLeft > 0) s = shuffleBoard(s);
        else if (n % 11 === 5 && s.undoStack.length > 0) s = undoMove(s, 0);
        else {
          const pair = getAllFreePairs(s.tiles)[0];
          s = pair ? selectTile(selectTile(s, pair[0].id), pair[1].id) : shuffleBoard(s);
        }
      }
      const { events: _events, ...game } = s;
      return game;
    };
    try {
      expect(play(true)).toEqual(play(false));
    } finally {
      jest.restoreAllMocks();
    }
  });
});
