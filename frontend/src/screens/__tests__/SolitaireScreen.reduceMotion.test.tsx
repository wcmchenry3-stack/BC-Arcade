/**
 * SolitaireScreen with Reduce Motion (#3606): the screen reads the setting once and hands it to
 * every pile, so a selected card gets no lift. `SelectableCard` is wrapped to record the props the
 * board gives it (its own lift / no-lift is covered in SelectableCard.reduceMotion.test.tsx: the
 * reanimated mock cannot show a lift on a card that does not re-render).
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AccessibilityInfo } from "react-native";
import { act } from "@testing-library/react-native";

import { createSeededRng, setRng } from "../../game/solitaire/engine";
import { resetReduceMotionForTests } from "../../components/shared/useReduceMotion";
import { boardState, faceUp, mountOn, pressLabel, tableauOf } from "./helpers/solitaireFixtures";

jest.mock("@react-navigation/native", () =>
  mockScreenDeps().mockNavigation(() => ({
    popToTop: jest.fn(),
    goBack: jest.fn(),
    navigate: jest.fn(),
    addListener: jest.fn(() => jest.fn()),
  }))
);
jest.mock("../../game/_shared/gameEventClient", () => mockScreenDeps().mockGameEventClient());
jest.mock("../../api/stats", () => mockScreenDeps().mockStatsApi({ getGameRank: jest.fn() }));
jest.mock("../../game/_shared/flushQueuedGames", () => mockScreenDeps().mockFlushQueuedGames());

const mockSelectable: Array<{ selected?: boolean; reduceMotion?: boolean; label?: string }> = [];
jest.mock("../../game/_shared/SelectableCard", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactMod = require("react");
  const actual = jest.requireActual("../../game/_shared/SelectableCard");
  return {
    __esModule: true,
    default: (props: {
      selected?: boolean;
      reduceMotion?: boolean;
      accessibilityLabel?: string;
    }) => {
      mockSelectable.push({
        selected: props.selected,
        reduceMotion: props.reduceMotion,
        label: props.accessibilityLabel,
      });
      return ReactMod.createElement(actual.default, props);
    },
  };
});

beforeEach(async () => {
  await AsyncStorage.clear();
  setRng(createSeededRng(42));
  resetReduceMotionForTests();
  mockSelectable.length = 0;
});
afterEach(() => jest.restoreAllMocks());

const board = () =>
  boardState({ tableau: tableauOf([faceUp("spades", 6)], [faceUp("hearts", 7)]) });

async function selectedProps(reduceMotion: boolean) {
  jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(reduceMotion);
  const api = await mountOn(board());
  await act(async () => {});
  await pressLabel(api, "6 of Spades");
  await act(async () => {});
  return mockSelectable.filter((p) => p.selected).pop();
}

describe("SolitaireScreen — Reduce Motion (#3606)", () => {
  it("with Reduce Motion on, the selected tableau card is told not to lift", async () => {
    const selected = await selectedProps(true);
    expect(selected).toBeDefined();
    expect(selected?.reduceMotion).toBe(true);
  });

  it("with Reduce Motion off, the selected card lifts as before", async () => {
    const selected = await selectedProps(false);
    expect(selected).toBeDefined();
    expect(selected?.reduceMotion).toBe(false);
  });
});
