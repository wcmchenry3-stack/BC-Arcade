/**
 * Tests for FreeCell hint destination highlighting (#1109).
 *
 * All five move types must highlight BOTH source and destination.
 * Sources are already covered by existing FreeCellBoard.test.tsx;
 * these tests focus on destination highlighting.
 *
 * Board layout used across most cases:
 *   Col 0: [2♣]   Col 1: [3♥]   Cols 2–7: empty
 *   freeCells[0]: A♠   freeCells[1–3]: null
 *   All foundations empty
 */

import React from "react";
import { render } from "@testing-library/react-native";

import { ThemeProvider } from "../../../theme/ThemeContext";
import FreeCellBoard from "../FreeCellBoard";
import type { FreeCellState } from "../../../game/freecell/types";

// Dark theme default: colors.bonus === "#4ade80"
const BONUS_COLOR = "#4ade80";

const BASE: FreeCellState = {
  _v: 1,
  tableau: [[{ suit: "clubs", rank: 2 }], [{ suit: "hearts", rank: 3 }], [], [], [], [], [], []],
  freeCells: [{ suit: "spades", rank: 1 }, null, null, null],
  foundations: { spades: [], hearts: [], diamonds: [], clubs: [] },
  undoStack: [],
  isComplete: false,
  moveCount: 0,
};

function withHint(hint: FreeCellState["hint"]): FreeCellState {
  return { ...BASE, hint };
}

async function renderBoard(state: FreeCellState) {
  return await render(
    <ThemeProvider>
      <FreeCellBoard state={state} onMove={jest.fn()} />
    </ThemeProvider>
  );
}

// ── No hint ──────────────────────────────────────────────────────────────────

describe("hint destination — no hint active", () => {
  it("empty free cell slots have normal border (not bonus)", async () => {
    const { getByLabelText } = await renderBoard(BASE);
    const slot = getByLabelText("Empty free cell 2");
    expect(slot).not.toHaveStyle({ borderColor: BONUS_COLOR });
  });

  it("empty foundation slots have normal border (not bonus)", async () => {
    const { getByLabelText } = await renderBoard(BASE);
    const foundation = getByLabelText("Empty Spades foundation");
    expect(foundation).not.toHaveStyle({ borderColor: BONUS_COLOR });
  });

  it("empty tableau columns have normal border (not bonus)", async () => {
    const { getByLabelText } = await renderBoard(BASE);
    const col = getByLabelText("Empty tableau column 3");
    expect(col).not.toHaveStyle({ borderColor: BONUS_COLOR });
  });
});

// ── tableau-to-freecell ───────────────────────────────────────────────────────

describe("hint destination — tableau-to-freecell", () => {
  it("destination free cell slot gets bonus border", async () => {
    const state = withHint({ type: "tableau-to-freecell", fromCol: 0, toCell: 1 });
    const { getByLabelText } = await renderBoard(state);
    // toCell: 1 → "Empty free cell 2" (1-indexed)
    expect(getByLabelText("Empty free cell 2")).toHaveStyle({ borderColor: BONUS_COLOR });
  });

  it("non-destination free cell slots do not get bonus border", async () => {
    const state = withHint({ type: "tableau-to-freecell", fromCol: 0, toCell: 1 });
    const { getByLabelText } = await renderBoard(state);
    expect(getByLabelText("Empty free cell 3")).not.toHaveStyle({ borderColor: BONUS_COLOR });
    expect(getByLabelText("Empty free cell 4")).not.toHaveStyle({ borderColor: BONUS_COLOR });
  });
});

// ── tableau-to-foundation ─────────────────────────────────────────────────────

describe("hint destination — tableau-to-foundation", () => {
  it("destination foundation slot gets bonus border (derived from top card suit)", async () => {
    // Top of col 0 is 2♣ → clubs foundation
    const state = withHint({ type: "tableau-to-foundation", fromCol: 0 });
    const { getByLabelText } = await renderBoard(state);
    expect(getByLabelText("Empty Clubs foundation")).toHaveStyle({ borderColor: BONUS_COLOR });
  });

  it("non-matching foundations do not get bonus border", async () => {
    const state = withHint({ type: "tableau-to-foundation", fromCol: 0 });
    const { getByLabelText } = await renderBoard(state);
    expect(getByLabelText("Empty Spades foundation")).not.toHaveStyle({ borderColor: BONUS_COLOR });
    expect(getByLabelText("Empty Hearts foundation")).not.toHaveStyle({ borderColor: BONUS_COLOR });
  });
});

// ── freecell-to-foundation ────────────────────────────────────────────────────

describe("hint destination — freecell-to-foundation", () => {
  it("destination foundation slot gets bonus border (derived from freecell card suit)", async () => {
    // freeCells[0] is A♠ → spades foundation
    const state = withHint({ type: "freecell-to-foundation", fromCell: 0 });
    const { getByLabelText } = await renderBoard(state);
    expect(getByLabelText("Empty Spades foundation")).toHaveStyle({ borderColor: BONUS_COLOR });
  });

  it("non-matching foundations do not get bonus border", async () => {
    const state = withHint({ type: "freecell-to-foundation", fromCell: 0 });
    const { getByLabelText } = await renderBoard(state);
    expect(getByLabelText("Empty Clubs foundation")).not.toHaveStyle({ borderColor: BONUS_COLOR });
  });
});

// ── freecell-to-tableau ───────────────────────────────────────────────────────

describe("hint destination — freecell-to-tableau", () => {
  it("destination empty tableau column gets bonus border", async () => {
    // toCol: 2 → "Empty tableau column 3" (1-indexed)
    const state = withHint({ type: "freecell-to-tableau", fromCell: 0, toCol: 2 });
    const { getByLabelText } = await renderBoard(state);
    expect(getByLabelText("Empty tableau column 3")).toHaveStyle({ borderColor: BONUS_COLOR });
  });

  it("non-destination empty columns do not get bonus border", async () => {
    const state = withHint({ type: "freecell-to-tableau", fromCell: 0, toCol: 2 });
    const { getByLabelText } = await renderBoard(state);
    expect(getByLabelText("Empty tableau column 4")).not.toHaveStyle({ borderColor: BONUS_COLOR });
  });
});

// ── tableau-to-tableau ────────────────────────────────────────────────────────

describe("hint destination — tableau-to-tableau", () => {
  it("renders without error when destination column is non-empty", async () => {
    // 2♣ → 3♥ (fromCol 0 → toCol 1)
    const state = withHint({
      type: "tableau-to-tableau",
      fromCol: 0,
      fromIndex: 0,
      toCol: 1,
    });
    await renderBoard(state);
  });

  it("destination empty column gets bonus border", async () => {
    // K♦ → empty col 3
    const stateWithKing: FreeCellState = {
      ...BASE,
      tableau: [
        [{ suit: "diamonds", rank: 13 }],
        [{ suit: "hearts", rank: 3 }],
        [],
        [],
        [],
        [],
        [],
        [],
      ],
      hint: { type: "tableau-to-tableau", fromCol: 0, fromIndex: 0, toCol: 2 },
    };
    const { getByLabelText } = await renderBoard(stateWithKing);
    expect(getByLabelText("Empty tableau column 3")).toHaveStyle({ borderColor: BONUS_COLOR });
  });
});
