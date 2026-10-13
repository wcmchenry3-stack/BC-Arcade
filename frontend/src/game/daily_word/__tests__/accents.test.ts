/**
 * Accented display for the French and Spanish puzzles (#3241): the board keeps
 * the folded letters the game scores on and the list's spelling to show.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  applyServerResult,
  buildShareText,
  initialState,
  markComplete,
  revealWord,
  setCurrentRowLetter,
  tileDisplayLetter,
  tilesWithDisplay,
} from "../engine";
import { loadState, looksValid, saveState } from "../storage";
import type { TileStatus } from "../types";

const tiles = (word: string, status: TileStatus = "absent") =>
  Array.from(word, (letter) => ({ letter, status }));

describe("tilesWithDisplay", () => {
  it("keeps the folded letter and adds the accented one", () => {
    const out = tilesWithDisplay(tiles("etait"), "était");
    expect(out.map((t) => t.letter).join("")).toBe("etait");
    expect(out.map(tileDisplayLetter).join("")).toBe("était");
    expect(out[0]).toEqual({ letter: "e", status: "absent", display: "é" });
    // An unaccented letter carries no display.
    expect(out[1]).toEqual({ letter: "t", status: "absent" });
  });

  it("keeps ñ, which is its own letter in Spanish", () => {
    const out = tilesWithDisplay(tiles("nino"), "niño");
    expect(out.map((t) => t.letter).join("")).toBe("nino");
    expect(out.map(tileDisplayLetter).join("")).toBe("niño");
  });

  it("lower-cases the display", () => {
    expect(tilesWithDisplay(tiles("arbol"), "ÁRBOL").map(tileDisplayLetter)).toEqual([
      "á",
      "r",
      "b",
      "o",
      "l",
    ]);
  });

  it("falls back to the folded letters without a display (en, hi)", () => {
    const out = tilesWithDisplay(tiles("crane"), undefined);
    expect(out).toEqual(tiles("crane"));
  });

  it("falls back when the display does not line up with the tiles", () => {
    // `cœur` folds to five letters but spells with four.
    const out = tilesWithDisplay(tiles("coeur"), "cœur");
    expect(out).toEqual(tiles("coeur"));
  });
});

describe("a submitted fr/es row", () => {
  it("colours the keyboard on the folded letters", () => {
    let s = initialState("2026-10-13:fr:1", 5, "fr");
    for (const ch of "etait") s = setCurrentRowLetter(s, ch);
    const scored = tilesWithDisplay(
      [
        { letter: "e", status: "correct" },
        { letter: "t", status: "present" },
        { letter: "a", status: "absent" },
        { letter: "i", status: "absent" },
        { letter: "t", status: "absent" },
      ],
      "était"
    );
    const next = applyServerResult(s, scored);
    expect(next.keyboard_state).toEqual({ e: "correct", t: "present", a: "absent", i: "absent" });
    expect(next.rows[0]!.tiles.map(tileDisplayLetter).join("")).toBe("était");
  });
});

describe("revealWord", () => {
  it("shows the accented display, upper-cased", () => {
    expect(revealWord({ answer: "etait", display: "était" })).toBe("ÉTAIT");
    expect(revealWord({ answer: "arbol", display: "árbol" })).toBe("ÁRBOL");
  });

  it("uses the answer when there is no display (en, hi)", () => {
    expect(revealWord({ answer: "crane" })).toBe("CRANE");
    expect(revealWord({ answer: "crane", display: "" })).toBe("CRANE");
  });
});

describe("buildShareText title", () => {
  const won = markComplete(
    applyServerResult(initialState("2026-05-03:fr:1", 5, "fr"), tiles("etait", "correct")),
    true
  );

  it("defaults to the English name", () => {
    expect(buildShareText(won, "https://x")).toContain("Daily Word #1 — 1/6");
  });

  it("takes the translated game name and keeps the grid letter-free", () => {
    const text = buildShareText(won, "https://x", "Mot du jour");
    expect(text).toContain("Mot du jour #1 — 1/6");
    expect(text).toContain("🟩🟩🟩🟩🟩");
    expect(text).not.toMatch(/[ée]tait/i);
  });
});

describe("saved boards keep the display form", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it("round-trips a fr board with accented tiles", async () => {
    const id = "2026-10-13:fr:1";
    const s = applyServerResult(
      initialState(id, 5, "fr"),
      tilesWithDisplay(tiles("etait", "correct"), "était")
    );
    expect(looksValid(s)).toBe(true);
    await saveState(s);
    const loaded = await loadState(id);
    expect(loaded).toEqual(s);
    expect(loaded!.rows[0]!.tiles.map(tileDisplayLetter).join("")).toBe("était");
  });

  it("accepts an es puzzle id", () => {
    expect(looksValid(initialState("2026-10-13:es:1", 5, "es"))).toBe(true);
  });

  it("still accepts a board saved before display existed", () => {
    const s = applyServerResult(initialState("2026-10-13:es:1", 5, "es"), tiles("arbol"));
    expect(looksValid(s)).toBe(true);
    expect(s.rows[0]!.tiles.map(tileDisplayLetter).join("")).toBe("arbol");
  });
});
