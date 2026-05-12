import {
  initialState,
  applyServerResult,
  setCurrentRowLetter,
  deleteLastLetter,
  markComplete,
  buildShareText,
} from "../engine";
import type { TileState } from "../types";

function typeWord(state: ReturnType<typeof initialState>, word: string) {
  let s = state;
  for (const ch of word) {
    s = setCurrentRowLetter(s, ch);
  }
  return s;
}

describe("initialState", () => {
  it("creates 6 empty rows with correct metadata", () => {
    const s = initialState("2026-05-03:en", 5, "en");
    expect(s._v).toBe(1);
    expect(s.puzzle_id).toBe("2026-05-03:en");
    expect(s.word_length).toBe(5);
    expect(s.rows).toHaveLength(6);
    expect(s.rows[0]!.submitted).toBe(false);
    expect(s.rows[0]!.tiles).toHaveLength(5);
    expect(s.rows[0]!.tiles[0]).toEqual({ letter: "", status: "empty" });
    expect(s.current_row).toBe(0);
    expect(s.keyboard_state).toEqual({});
    expect(s.is_complete).toBe(false);
    expect(s.won).toBe(false);
    expect(s.completed_at).toBeNull();
  });
});

describe("setCurrentRowLetter", () => {
  it("adds a letter to the current row", () => {
    const s = setCurrentRowLetter(initialState("2026-05-03:en", 5, "en"), "a");
    expect(s.rows[0]!.tiles[0]).toEqual({ letter: "a", status: "tbd" });
    expect(s.rows[0]!.tiles[1]).toEqual({ letter: "", status: "empty" });
  });

  it("fills multiple letters sequentially", () => {
    const s = typeWord(initialState("2026-05-03:en", 5, "en"), "crane");
    expect(s.rows[0]!.tiles.map((t) => t.letter)).toEqual(["c", "r", "a", "n", "e"]);
    expect(s.rows[0]!.tiles.map((t) => t.status)).toEqual(["tbd", "tbd", "tbd", "tbd", "tbd"]);
  });

  it("does nothing when row is full", () => {
    const full = typeWord(initialState("2026-05-03:en", 5, "en"), "crane");
    const after = setCurrentRowLetter(full, "x");
    expect(after).toBe(full);
  });

  it("does nothing when game is complete", () => {
    const s = markComplete(initialState("2026-05-03:en", 5, "en"), true);
    const after = setCurrentRowLetter(s, "a");
    expect(after).toBe(s);
  });
});

describe("deleteLastLetter", () => {
  it("removes the last typed letter", () => {
    let s = typeWord(initialState("2026-05-03:en", 5, "en"), "ab");
    s = deleteLastLetter(s);
    expect(s.rows[0]!.tiles[0]).toEqual({ letter: "a", status: "tbd" });
    expect(s.rows[0]!.tiles[1]).toEqual({ letter: "", status: "empty" });
  });

  it("does nothing on an empty row", () => {
    const s = initialState("2026-05-03:en", 5, "en");
    expect(deleteLastLetter(s)).toBe(s);
  });
});

describe("applyServerResult — duplicate-letter coloring", () => {
  it('only first "e" gets present when answer is "speed" and guess is "spell"', () => {
    // Server scoring: answer="speed", guess="spell"
    // s=correct, p=correct, e=present (answer has one 'e'), l=absent, l=absent
    const tiles: TileState[] = [
      { letter: "s", status: "correct" },
      { letter: "p", status: "correct" },
      { letter: "e", status: "present" },
      { letter: "l", status: "absent" },
      { letter: "l", status: "absent" },
    ];
    let s = typeWord(initialState("2026-05-03:en", 5, "en"), "spell");
    s = applyServerResult(s, tiles);

    expect(s.keyboard_state["s"]).toBe("correct");
    expect(s.keyboard_state["p"]).toBe("correct");
    expect(s.keyboard_state["e"]).toBe("present");
    expect(s.keyboard_state["l"]).toBe("absent");
    expect(s.rows[0]!.submitted).toBe(true);
    expect(s.current_row).toBe(1);
  });
});

describe("applyServerResult — guards", () => {
  it("does nothing when game is complete", () => {
    const tiles: TileState[] = Array.from({ length: 5 }, (_, i) => ({
      letter: "abcde"[i]!,
      status: "absent" as const,
    }));
    const s = markComplete(initialState("2026-05-03:en", 5, "en"), false);
    expect(applyServerResult(s, tiles)).toBe(s);
  });
});

describe("keyboard promotion rules", () => {
  it("correct is never downgraded to absent", () => {
    const correctTiles: TileState[] = [
      { letter: "a", status: "correct" },
      { letter: "b", status: "absent" },
      { letter: "c", status: "absent" },
      { letter: "d", status: "absent" },
      { letter: "e", status: "absent" },
    ];
    const absentTiles: TileState[] = [
      { letter: "a", status: "absent" },
      { letter: "f", status: "absent" },
      { letter: "g", status: "absent" },
      { letter: "h", status: "absent" },
      { letter: "i", status: "absent" },
    ];

    let s = typeWord(initialState("2026-05-03:en", 5, "en"), "abcde");
    s = applyServerResult(s, correctTiles);
    expect(s.keyboard_state["a"]).toBe("correct");

    s = typeWord(s, "afghi");
    s = applyServerResult(s, absentTiles);
    expect(s.keyboard_state["a"]).toBe("correct");
  });

  it("correct is never downgraded to present", () => {
    const correctTiles: TileState[] = [
      { letter: "a", status: "correct" },
      { letter: "b", status: "absent" },
      { letter: "c", status: "absent" },
      { letter: "d", status: "absent" },
      { letter: "e", status: "absent" },
    ];
    const presentTiles: TileState[] = [
      { letter: "a", status: "present" },
      { letter: "f", status: "absent" },
      { letter: "g", status: "absent" },
      { letter: "h", status: "absent" },
      { letter: "i", status: "absent" },
    ];

    let s = typeWord(initialState("2026-05-03:en", 5, "en"), "abcde");
    s = applyServerResult(s, correctTiles);
    expect(s.keyboard_state["a"]).toBe("correct");

    s = typeWord(s, "afghi");
    s = applyServerResult(s, presentTiles);
    expect(s.keyboard_state["a"]).toBe("correct");
  });

  it("absent is promoted to present when seen later", () => {
    const absentTiles: TileState[] = [
      { letter: "a", status: "absent" },
      { letter: "b", status: "absent" },
      { letter: "c", status: "absent" },
      { letter: "d", status: "absent" },
      { letter: "e", status: "absent" },
    ];
    const presentTiles: TileState[] = [
      { letter: "a", status: "present" },
      { letter: "f", status: "absent" },
      { letter: "g", status: "absent" },
      { letter: "h", status: "absent" },
      { letter: "i", status: "absent" },
    ];

    let s = typeWord(initialState("2026-05-03:en", 5, "en"), "abcde");
    s = applyServerResult(s, absentTiles);
    expect(s.keyboard_state["a"]).toBe("absent");

    s = typeWord(s, "afghi");
    s = applyServerResult(s, presentTiles);
    expect(s.keyboard_state["a"]).toBe("present");
  });
});

describe("markComplete", () => {
  it("sets is_complete and won flags correctly for a win", () => {
    const s = markComplete(initialState("2026-05-03:en", 5, "en"), true);
    expect(s.is_complete).toBe(true);
    expect(s.won).toBe(true);
    expect(s.completed_at).toBeTruthy();
  });

  it("sets is_complete and won flags correctly for a loss", () => {
    const s = markComplete(initialState("2026-05-03:en", 5, "en"), false);
    expect(s.is_complete).toBe(true);
    expect(s.won).toBe(false);
    expect(s.completed_at).toBeTruthy();
  });
});

describe("buildShareText", () => {
  it("produces correct emoji grid for a known 3-guess win", () => {
    const tiles1: TileState[] = [
      { letter: "c", status: "absent" },
      { letter: "r", status: "absent" },
      { letter: "a", status: "absent" },
      { letter: "n", status: "absent" },
      { letter: "e", status: "present" },
    ];
    const tiles2: TileState[] = [
      { letter: "w", status: "absent" },
      { letter: "h", status: "present" },
      { letter: "i", status: "present" },
      { letter: "l", status: "absent" },
      { letter: "e", status: "correct" },
    ];
    const tiles3: TileState[] = [
      { letter: "s", status: "correct" },
      { letter: "h", status: "correct" },
      { letter: "i", status: "correct" },
      { letter: "n", status: "correct" },
      { letter: "e", status: "correct" },
    ];

    let s = typeWord(initialState("2026-05-03:en", 5, "en"), "crane");
    s = applyServerResult(s, tiles1);
    s = typeWord(s, "while");
    s = applyServerResult(s, tiles2);
    s = typeWord(s, "shine");
    s = applyServerResult(s, tiles3);
    s = markComplete(s, true);

    const text = buildShareText(s, "https://bcarcade.com/daily-word");
    expect(text).toContain("Daily Word #1 — 3/6");
    expect(text).toContain("⬜⬜⬜⬜🟨");
    expect(text).toContain("⬜🟨🟨⬜🟩");
    expect(text).toContain("🟩🟩🟩🟩🟩");
    expect(text).toContain("https://bcarcade.com/daily-word");
  });

  it("shows X/6 for a loss", () => {
    let s = initialState("2026-05-03:en", 5, "en");
    const absentTiles = (word: string): TileState[] =>
      word.split("").map((letter) => ({ letter, status: "absent" as const }));
    for (const word of ["crane", "stole", "bunny", "fizzy", "hippo", "jazzy"]) {
      s = typeWord(s, word);
      s = applyServerResult(s, absentTiles(word));
    }
    s = markComplete(s, false);

    const text = buildShareText(s, "https://bcarcade.com/daily-word");
    expect(text).toContain("Daily Word #1 — X/6");
    expect(text).toContain("⬜⬜⬜⬜⬜");
  });
});
