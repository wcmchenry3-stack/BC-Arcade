/**
 * DailyWordScreen French and Spanish (#3241): plain-letter input, a submitted
 * row and the answer reveal shown in the list's accented spelling, a restored
 * board with accents, and the translated share header.
 */

import React from "react";
import { Share } from "react-native";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import i18n from "i18next";

import DailyWordScreen from "../DailyWordScreen";
import { ThemeProvider } from "../../theme/ThemeContext";
import {
  applyServerResult,
  initialState,
  markComplete,
  setCurrentRowLetter,
  tilesWithDisplay,
} from "../../game/daily_word/engine";
import type { DailyWordState } from "../../game/daily_word/types";

const mockPopToTop = jest.fn();
jest.mock("@react-navigation/native", () =>
  mockScreenDeps().mockNavigation(() => ({ popToTop: mockPopToTop, navigate: jest.fn() }), {
    actual: true,
    useRoute: () => ({ name: "DailyWord" }),
  })
);
jest.mock("../../game/_shared/NetworkContext", () => mockScreenDeps().mockNetwork());
jest.mock("../../game/daily_word/api", () => ({
  dailyWordApi: { getToday: jest.fn(), submitGuess: jest.fn(), getAnswer: jest.fn() },
}));
jest.mock("../../game/daily_word/storage", () => ({
  loadState: jest.fn(),
  saveState: jest.fn(),
  clearState: jest.fn(),
  pruneStates: jest.fn(),
  saveTodayMeta: jest.fn().mockResolvedValue(undefined),
  loadTodayMeta: jest.fn().mockResolvedValue(null),
}));
jest.mock("../../game/_shared/gameEventClient", () =>
  mockScreenDeps().mockGameEventClient({
    startGame: jest.fn(() => "game-1"),
    resumeGame: jest.fn(() => null),
  })
);
const mockPlayed: string[] = [];
jest.mock("../../game/_shared/useSound", () => mockScreenDeps().mockSoundByName(() => mockPlayed));
jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn().mockResolvedValue(undefined),
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: "Light", Heavy: "Heavy" },
  NotificationFeedbackType: { Success: "Success", Warning: "Warning", Error: "Error" },
}));

const { dailyWordApi } = jest.requireMock("../../game/daily_word/api") as {
  dailyWordApi: { getToday: jest.Mock; submitGuess: jest.Mock; getAnswer: jest.Mock };
};
const storage = jest.requireMock("../../game/daily_word/storage") as {
  loadState: jest.Mock;
  saveState: jest.Mock;
  clearState: jest.Mock;
  pruneStates: jest.Mock;
};

const FR = { puzzle_id: "2026-10-13:fr:1", word_length: 5 };
const ES = { puzzle_id: "2026-10-13:es:1", word_length: 5 };
const tilesFor = (word: string, status: "correct" | "absent") =>
  Array.from(word, (letter) => ({ letter, status }));

async function mount() {
  await render(
    <ThemeProvider>
      <DailyWordScreen />
    </ThemeProvider>
  );
  await screen.findByTestId("tile-0-0", { includeHiddenElements: true });
}

const key = (k: string) =>
  act(async () => {
    await fireEvent.press(screen.getByTestId(`daily-word-key-${k}`));
  });

/** Asserts that a row shows these letters, tile by tile. */
async function expectRow(row: number, word: string) {
  await waitFor(() => {
    Array.from(word).forEach((ch, c) => {
      expect(
        screen.getByTestId(`tile-${row}-${c}`, { includeHiddenElements: true })
      ).toHaveTextContent(ch, { exact: true });
    });
  });
}

/** A finished board whose first row was scored with a display spelling. */
function savedBoard(
  puzzle: { puzzle_id: string },
  lang: string,
  folded: string,
  display: string,
  won: boolean
): DailyWordState {
  let s = initialState(puzzle.puzzle_id, 5, lang);
  for (const ch of folded) s = setCurrentRowLetter(s, ch);
  return markComplete(
    applyServerResult(s, tilesWithDisplay(tilesFor(folded, won ? "correct" : "absent"), display)),
    won
  );
}

const originalLanguage = i18n.language;

// The test i18n loads English only; the translations under test come from the
// shipped locale files.
beforeAll(() => {
  for (const code of ["fr-CA", "es"]) {
    for (const ns of ["daily_word", "result", "common"]) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      i18n.addResourceBundle(code, ns, require(`../../i18n/locales/${code}/${ns}.json`));
    }
  }
});

beforeEach(() => {
  jest.clearAllMocks();
  mockPlayed.length = 0;
  dailyWordApi.getToday.mockResolvedValue(FR);
  dailyWordApi.getAnswer.mockResolvedValue({ answer: "etait", display: "était" });
  storage.loadState.mockResolvedValue(null);
  storage.saveState.mockResolvedValue(undefined);
  storage.clearState.mockResolvedValue(undefined);
  storage.pruneStates.mockResolvedValue(undefined);
});

afterEach(async () => {
  await i18n.changeLanguage(originalLanguage);
  jest.restoreAllMocks();
});

describe("French (fr-CA app language)", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("fr-CA");
  });

  it("requests the fr puzzle and shows a QWERTY keyboard without Ñ", async () => {
    await mount();
    expect(dailyWordApi.getToday).toHaveBeenCalledWith(expect.any(Number), "fr");
    expect(screen.getByTestId("daily-word-key-q")).toBeTruthy();
    expect(screen.queryByTestId("daily-word-key-ñ")).toBeNull();
    expect(screen.getByText("Entrée")).toBeTruthy();
  });

  it("types plain letters, submits them folded and renders the row with accents", async () => {
    dailyWordApi.submitGuess.mockResolvedValue({
      tiles: tilesFor("etait", "absent"),
      display: "était",
    });
    await mount();
    for (const ch of "etait") await key(ch);
    // The tiles hold what was typed until the server answers.
    await expectRow(0, "ETAIT");
    await key("enter");

    expect(dailyWordApi.submitGuess).toHaveBeenCalledWith(
      FR.puzzle_id,
      "etait",
      expect.any(Number)
    );
    await expectRow(0, "ÉTAIT");
  });

  it("colours the keyboard on the folded letter an accented tile scored", async () => {
    dailyWordApi.submitGuess.mockResolvedValue({
      tiles: [
        { letter: "e", status: "correct" },
        { letter: "t", status: "absent" },
        { letter: "a", status: "absent" },
        { letter: "i", status: "absent" },
        { letter: "t", status: "absent" },
      ],
      display: "était",
    });
    await mount();
    for (const ch of "etait") await key(ch);
    await key("enter");
    await expectRow(0, "ÉTAIT");
    const saved = storage.saveState.mock.calls.at(-1)![0] as DailyWordState;
    expect(saved.keyboard_state).toMatchObject({ e: "correct", t: "absent" });
    expect(saved.keyboard_state).not.toHaveProperty("é");
  });

  it("a win keeps the accents on the board and opens the result card", async () => {
    dailyWordApi.submitGuess.mockResolvedValue({
      tiles: tilesFor("etait", "correct"),
      display: "était",
    });
    await mount();
    for (const ch of "etait") await key(ch);
    await key("enter");
    await waitFor(() => expect(screen.getByTestId("daily-word-result")).toBeTruthy(), {
      timeout: 3000,
    });
    await expectRow(0, "ÉTAIT");
  });

  it("a restored loss reveals the answer with accents", async () => {
    storage.loadState.mockResolvedValue(savedBoard(FR, "fr", "creme", "crème", false));
    await mount();
    await waitFor(() => expect(screen.getByText(/ÉTAIT/)).toBeTruthy());
    expect(screen.getByText("Le mot était ÉTAIT")).toBeTruthy();
  });

  it("a restored saved board shows its accents", async () => {
    const saved = savedBoard(FR, "fr", "etait", "était", true);
    storage.loadState.mockResolvedValue(saved);
    await mount();
    await expectRow(0, "ÉTAIT");
  });

  it("shares with the French game name in the header", async () => {
    storage.loadState.mockResolvedValue(savedBoard(FR, "fr", "etait", "était", true));
    const share = jest.spyOn(Share, "share").mockResolvedValue({ action: "sharedAction" });
    await mount();
    await fireEvent.press(await screen.findByRole("button", { name: "Partager" }));
    await waitFor(() => expect(share).toHaveBeenCalled());
    const message = share.mock.calls[0]![0].message as string;
    expect(message).toMatch(/^Mot du jour #\d+ — 1\/6\n🟩🟩🟩🟩🟩/);
    expect(message).not.toContain("Daily Word");
  });
});

describe("Spanish (es app language)", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("es");
    dailyWordApi.getToday.mockResolvedValue(ES);
    dailyWordApi.getAnswer.mockResolvedValue({ answer: "arbol", display: "árbol" });
  });

  it("requests the es puzzle and shows Ñ after L", async () => {
    await mount();
    expect(dailyWordApi.getToday).toHaveBeenCalledWith(expect.any(Number), "es");
    expect(screen.getByTestId("daily-word-key-ñ")).toBeTruthy();
    expect(screen.getByText("Enviar")).toBeTruthy();
    expect(screen.getByText("Borrar")).toBeTruthy();
  });

  it("types Ñ as ñ, and renders the accented row from display", async () => {
    dailyWordApi.submitGuess.mockResolvedValue({
      tiles: tilesFor("ñandu", "absent"),
      display: "ñandú",
    });
    await mount();
    await key("ñ");
    for (const ch of "andu") await key(ch);
    await key("enter");
    expect(dailyWordApi.submitGuess).toHaveBeenCalledWith(
      ES.puzzle_id,
      "ñandu",
      expect.any(Number)
    );
    await expectRow(0, "ÑANDÚ");
  });

  it("renders ÁRBOL from display after a guess", async () => {
    dailyWordApi.submitGuess.mockResolvedValue({
      tiles: tilesFor("arbol", "correct"),
      display: "árbol",
    });
    await mount();
    for (const ch of "arbol") await key(ch);
    await key("enter");
    await expectRow(0, "ÁRBOL");
  });

  it("a restored loss reveals ÁRBOL from the answer's display", async () => {
    storage.loadState.mockResolvedValue(savedBoard(ES, "es", "nino", "niño", false));
    await mount();
    await waitFor(() => expect(screen.getByText("La palabra era ÁRBOL")).toBeTruthy());
  });

  it("a restored board shows ñ and accents", async () => {
    storage.loadState.mockResolvedValue(savedBoard(ES, "es", "arbol", "árbol", true));
    await mount();
    await expectRow(0, "ÁRBOL");
  });
});

describe("English", () => {
  it("has no Ñ key and reveals the answer as before", async () => {
    await i18n.changeLanguage("en");
    dailyWordApi.getToday.mockResolvedValue({ puzzle_id: "2026-10-13:en:2", word_length: 5 });
    dailyWordApi.getAnswer.mockResolvedValue({ answer: "crane" });
    storage.loadState.mockResolvedValue(
      savedBoard({ puzzle_id: "2026-10-13:en:2" }, "en", "store", "store", false)
    );
    await mount();
    expect(screen.queryByTestId("daily-word-key-ñ")).toBeNull();
    await waitFor(() => expect(screen.getByText("The word was CRANE")).toBeTruthy());
  });
});
