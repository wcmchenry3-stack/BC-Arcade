import {
  initialState,
  applyServerResult,
  setCurrentRowLetter,
  deleteLastLetter,
  markComplete,
  buildShareText,
  guessCount,
  parseGuessCount,
  sessionResult,
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

describe("sessionResult (#2451)", () => {
  const tiles = (word: string, status: TileState["status"]): TileState[] =>
    word.split("").map((letter) => ({ letter, status }));

  it("reports an empty attempt when there is no state", () => {
    expect(sessionResult(null)).toEqual({ is_complete: false, won: false, guesses_used: 0 });
  });

  it("reports an untouched puzzle as zero guesses", () => {
    expect(sessionResult(initialState("2026-05-03:en", 5, "en"))).toEqual({
      is_complete: false,
      won: false,
      guesses_used: 0,
    });
  });

  it("counts submitted rows mid-puzzle without marking it complete", () => {
    let s = initialState("2026-05-03:en", 5, "en");
    s = applyServerResult(typeWord(s, "crane"), tiles("crane", "absent"));
    s = applyServerResult(typeWord(s, "stole"), tiles("stole", "present"));
    s = typeWord(s, "bun"); // a half-typed row is not a guess
    expect(sessionResult(s)).toEqual({ is_complete: false, won: false, guesses_used: 2 });
  });

  it("counts the winning guess exactly once (current_row has already advanced)", () => {
    let s = initialState("2026-05-03:en", 5, "en");
    s = applyServerResult(typeWord(s, "crane"), tiles("crane", "correct"));
    s = markComplete(s, true);
    expect(sessionResult(s)).toEqual({ is_complete: true, won: true, guesses_used: 1 });
  });

  it("reports a lost puzzle as complete, not won, all six guesses used", () => {
    let s = initialState("2026-05-03:en", 5, "en");
    for (const word of ["crane", "stole", "bunny", "fizzy", "hippo", "jazzy"]) {
      s = applyServerResult(typeWord(s, word), tiles(word, "absent"));
    }
    s = markComplete(s, false);
    expect(sessionResult(s)).toEqual({ is_complete: true, won: false, guesses_used: 6 });
  });
});

// #2541 — when a guess's response is lost the board falls behind the server,
// so its row count is structurally low. The server's count wins; the board
// covers a missing or stale one.
describe("guessCount (#2541)", () => {
  const tiles = (word: string, status: TileState["status"]): TileState[] =>
    word.split("").map((letter) => ({ letter, status }));

  function boardWithRows(n: number) {
    let s = initialState("2026-05-03:en", 5, "en");
    for (const word of ["crane", "stole", "bunny", "fizzy", "hippo", "jazzy"].slice(0, n)) {
      s = applyServerResult(typeWord(s, word), tiles(word, "absent"));
    }
    return s;
  }

  it("counts submitted rows when the server has given no count", () => {
    expect(guessCount(boardWithRows(3))).toBe(3);
  });

  it("takes the server's count when the board is behind it", () => {
    expect(guessCount({ ...boardWithRows(4), guesses_used: 5 })).toBe(5);
  });

  it("ignores a stale server count that is below the board", () => {
    // A count stored before later guesses were scored while the server's
    // record was unreachable (they return no count).
    expect(guessCount({ ...boardWithRows(4), guesses_used: 2 })).toBe(4);
  });

  it("drives sessionResult, so a lost-response 5-guess win is not reported as 4", () => {
    const s = markComplete({ ...boardWithRows(4), guesses_used: 5 }, true);
    expect(sessionResult(s)).toEqual({ is_complete: true, won: true, guesses_used: 5 });
  });

  it("drives the share text result", () => {
    const s = markComplete({ ...boardWithRows(4), guesses_used: 5 }, true);
    expect(buildShareText(s, "https://bcarcade.com/daily-word")).toContain("Daily Word #1 — 5/6");
  });
});

describe("parseGuessCount (#2541)", () => {
  it("accepts a plausible count", () => {
    expect(parseGuessCount(5)).toBe(5);
    expect(parseGuessCount(0)).toBe(0);
    expect(parseGuessCount(6)).toBe(6);
  });

  it("returns undefined when there is no count, e.g. an older API", () => {
    expect(parseGuessCount(undefined)).toBeUndefined();
  });

  it("rejects anything that is not a plausible count — the source is untrusted", () => {
    for (const bad of ["5", 2.5, -1, 7, NaN, null, true, {}]) {
      expect(parseGuessCount(bad)).toBeUndefined();
    }
  });
});

describe("guessCount — corrupt saved count", () => {
  it("falls back to the board rather than producing NaN", () => {
    const s = initialState("2026-05-03:en", 5, "en");
    expect(guessCount({ ...s, guesses_used: "garbage" as unknown as number })).toBe(0);
  });
});
