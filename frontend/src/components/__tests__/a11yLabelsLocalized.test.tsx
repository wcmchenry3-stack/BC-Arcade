/**
 * #2222 — accessibility labels come from i18next, not hardcoded English.
 * Each case switches to a non-English language and expects that locale's
 * translated label (and, for Daily Word, the tile's row/column position).
 */
import React from "react";
import { cleanup, render, screen } from "@testing-library/react-native";
import i18n from "i18next";

import ScorePill from "../blackjack/ScorePill";
import SudokuGrid from "../sudoku/SudokuGrid";
import Grid from "../twenty48/Grid";
import AnimatedTile from "../twenty48/AnimatedTile";
import { TileRow } from "../daily_word/WordTile";
import { FreeCellFoundationAnimation } from "../freecell/FreeCellFoundationAnimation";
import { ThemeProvider } from "../../theme/ThemeContext";
import { initialState } from "../../game/daily_word/engine";
import type { DailyWordState } from "../../game/daily_word/types";
import type { Grid as SudokuGridData, NoteDigit } from "../../game/sudoku/types";
import type { TileData } from "../../game/twenty48/types";
import { mockReduceMotion } from "../hearts/__tests__/helpers/animationFixtures";

const NAMESPACES = ["blackjack", "sudoku", "twenty48", "daily_word", "freecell"];

beforeAll(() => {
  for (const code of ["es", "fr-CA"]) {
    for (const ns of NAMESPACES) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      i18n.addResourceBundle(code, ns, require(`../../i18n/locales/${code}/${ns}.json`));
    }
  }
});

afterEach(async () => {
  await cleanup();
  await i18n.changeLanguage("en");
});

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

describe("Blackjack ScorePill labels", () => {
  it("localizes the player score", async () => {
    await i18n.changeLanguage("es");
    await wrap(<ScorePill value={17} variant="player" />);
    expect(screen.getByLabelText("Puntuación del jugador: 17")).toBeTruthy();
  });

  it("localizes the dealer score and the hidden state", async () => {
    await i18n.changeLanguage("es");
    await wrap(<ScorePill value={9} variant="dealer" />);
    expect(screen.getByLabelText("Puntuación del crupier: 9")).toBeTruthy();
    await cleanup();
    await wrap(<ScorePill value={9} variant="dealer" concealed />);
    expect(screen.getByLabelText("Puntuación del crupier oculta")).toBeTruthy();
  });
});

describe("Sudoku board label", () => {
  it("is localized", async () => {
    await i18n.changeLanguage("fr-CA");
    const row = Array.from({ length: 9 }, () => ({
      value: 0 as const,
      given: false,
      notes: new Set<NoteDigit>(),
      isError: false,
    }));
    const grid = Array.from({ length: 9 }, () => row) as unknown as SudokuGridData;
    await wrap(
      <SudokuGrid
        variant="classic"
        grid={grid}
        selectedRow={null}
        selectedCol={null}
        onCellPress={() => {}}
      />
    );
    expect(screen.getByLabelText("Grille de Sudoku")).toBeTruthy();
  });
});

describe("Twenty48 labels", () => {
  const tile = (value: number): TileData => ({
    id: 1,
    value,
    row: 0,
    col: 0,
    prevRow: 0,
    prevCol: 0,
    isNew: false,
    isMerge: false,
  });

  it("localizes the board and its empty cells", async () => {
    await i18n.changeLanguage("es");
    await wrap(<Grid tiles={[tile(2)]} />);
    expect(screen.getByLabelText("Tablero de juego")).toBeTruthy();
    expect(screen.getAllByLabelText("vacía")).toHaveLength(15);
    expect(screen.queryByLabelText("empty")).toBeNull();
  });

  it("localizes an empty animated tile", async () => {
    await i18n.changeLanguage("es");
    await wrap(<AnimatedTile tile={tile(0)} tileSize={50} gap={8} />);
    expect(screen.getByLabelText("vacía")).toBeTruthy();
  });
});

describe("Daily Word tile labels", () => {
  function typed(word: string): DailyWordState {
    const base = initialState("2026-10-10:en", 5, "en");
    const [first, ...rest] = base.rows;
    return {
      ...base,
      rows: [
        {
          ...first!,
          tiles: [...word].map((letter, i) => ({
            letter,
            status: i === 0 ? ("correct" as const) : ("tbd" as const),
          })),
        },
        ...rest,
      ],
    };
  }

  it("announces row, column and letter (en)", async () => {
    await wrap(<TileRow state={typed("crane")} rowIndex={0} wordLength={5} isFlipping={false} />);
    expect(screen.getByTestId("tile-0-2").props.accessibilityLabel).toBe(
      "Row 1, column 3, letter A"
    );
    expect(screen.getByTestId("tile-0-0").props.accessibilityLabel).toBe(
      "Row 1, column 1, letter C, correct"
    );
  });

  it("localizes the position and the result", async () => {
    await i18n.changeLanguage("es");
    await wrap(<TileRow state={typed("crane")} rowIndex={0} wordLength={5} isFlipping={false} />);
    expect(screen.getByTestId("tile-0-2").props.accessibilityLabel).toBe(
      "Fila 1, columna 3, letra A"
    );
    expect(screen.getByTestId("tile-0-0").props.accessibilityLabel).toBe(
      "Fila 1, columna 1, letra C, correcta"
    );
  });
});

describe("FreeCell foundation live region", () => {
  it("announces in the active language", async () => {
    mockReduceMotion(false);
    await i18n.changeLanguage("es");
    await render(<FreeCellFoundationAnimation visible onAnimationEnd={jest.fn()} />);
    const icon = screen.getByLabelText("Base completa");
    expect(icon.props.accessibilityLiveRegion).toBe("polite");
  });
});
