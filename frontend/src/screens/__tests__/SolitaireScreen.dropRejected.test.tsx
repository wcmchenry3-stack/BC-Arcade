/**
 * #2202 — a drag released on a refusing target gets the same invalid-move
 * sound as a rejected tap, and stays silent during Auto-Complete like a tap.
 * The real DragProvider decides when a drop is rejected (DragContext.test);
 * here the screen must hand it a working `onDropRejected`.
 */
import React from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act } from "@testing-library/react-native";

import { createSeededRng, setRng } from "../../game/solitaire/engine";
import type { DragProviderProps } from "../../game/_shared/drag/DragContext";
import type { Rank, Suit } from "../../game/solitaire/types";
import { boardState, faceUp, mountOn, pressLabel } from "./helpers/solitaireFixtures";

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

const mockProviderProps: DragProviderProps[] = [];
jest.mock("../../game/_shared/drag/DragContext", () => {
  const actual = jest.requireActual("../../game/_shared/drag/DragContext");
  return {
    ...actual,
    DragProvider: (props: DragProviderProps) => {
      mockProviderProps.push(props);
      return <actual.DragProvider {...props} />;
    },
  };
});

const mockPlay = jest.fn(() => true);
const mockUseSound = jest.fn((_name: string, _sounds?: unknown) => ({
  play: mockPlay,
  stop: jest.fn(),
}));
jest.mock("../../game/_shared/useSound", () => ({
  useSound: (name: string, sounds: unknown) => mockUseSound(name, sounds),
}));

const SRC = { game: "solitaire", type: "waste" } as const;
const rejected = () => {
  const { onDropRejected } = mockProviderProps[mockProviderProps.length - 1];
  expect(onDropRejected).toBeDefined();
  onDropRejected!(SRC, []);
};
const sequence = (suit: Suit, upTo: number) =>
  Array.from({ length: upTo }, (_, i) => faceUp(suit, (i + 1) as Rank));

beforeEach(async () => {
  await AsyncStorage.clear();
  setRng(createSeededRng(42));
  mockProviderProps.length = 0;
  mockPlay.mockClear();
  mockUseSound.mockClear();
});

it("plays the invalid-move sound when the drag provider reports a rejected drop", async () => {
  await mountOn(boardState());
  expect(mockUseSound).toHaveBeenCalledWith("solitaire.invalidMove", expect.anything());
  mockPlay.mockClear();
  rejected();
  expect(mockPlay).toHaveBeenCalledTimes(1);
});

it("stays silent for a refused drop while Auto-Complete runs, like a tap", async () => {
  jest.useFakeTimers({ now: 1_700_000_000_000 });
  try {
    const api = await mountOn(
      boardState({
        foundations: {
          spades: sequence("spades", 13),
          hearts: sequence("hearts", 13),
          diamonds: sequence("diamonds", 13),
          clubs: sequence("clubs", 11),
        },
        waste: [faceUp("clubs", 13), faceUp("clubs", 12)],
      })
    );
    await pressLabel(api, "Auto-Complete");
    mockPlay.mockClear();
    rejected();
    expect(mockPlay).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
  } finally {
    jest.useRealTimers();
  }
});
