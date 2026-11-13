/**
 * #2222 — accessibility labels come from i18next, not hardcoded English.
 * Each case switches to a non-English language and expects that locale's
 * translated label (and, for Daily Word, the tile's row/column position).
 */
import React from "react";
import { cleanup, render, screen } from "@testing-library/react-native";
import i18n from "i18next";

import TableFelt from "../blackjack/TableFelt";
import { computeTableGeometry } from "../../game/blackjack/layout";
import type { HandResponse } from "../../game/blackjack/types";
import SudokuGrid from "../sudoku/SudokuGrid";
import Grid from "../twenty48/Grid";
import AnimatedTile from "../twenty48/AnimatedTile";
import { TileRow } from "../daily_word/WordTile";
import { ThemeProvider } from "../../theme/ThemeContext";
import { initialState } from "../../game/daily_word/engine";
import type { DailyWordState } from "../../game/daily_word/types";
import type { Grid as SudokuGridData, NoteDigit } from "../../game/sudoku/types";
import type { TileData } from "../../game/twenty48/types";

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

// The totals moved from ScorePill to the table felt's pills in the one-table redesign (#3580).
describe("Blackjack score labels", () => {
  const up = (rank: string) => ({ rank, suit: "♠", face_down: false });
  const player: HandResponse = { cards: [up("10"), up("7")], value: 17, soft: false };

  function felt(dealer: HandResponse, phase: string) {
    const geometry = computeTableGeometry({
      feltWidth: 359,
      feltHeight: 367,
      screenWidth: 390,
      screenHeight: 844,
      dealerCards: dealer.cards.length,
      handCards: [2],
      activeHandIndex: phase === "player" ? 0 : null,
      showResult: false,
    });
    return (
      <TableFelt
        geometry={geometry}
        phase={phase}
        dealerHand={dealer}
        hands={[player]}
        handBets={[10]}
        activeHandIndex={0}
        handOutcomes={[null]}
        handPayouts={[0]}
        result={null}
      />
    );
  }

  it("localizes the player and dealer scores", async () => {
    await i18n.changeLanguage("es");
    await wrap(felt({ cards: [up("9"), up("K")], value: 19, soft: false }, "result"));
    expect(screen.getAllByLabelText(/Puntuación del jugador: 17/).length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Puntuación del crupier: 19")).toBeTruthy();
  });

  it("localizes the hidden dealer score", async () => {
    await i18n.changeLanguage("es");
    const hole = { rank: "K", suit: "♠", face_down: true };
    await wrap(felt({ cards: [up("9"), hole], value: 9, soft: false }, "player"));
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
