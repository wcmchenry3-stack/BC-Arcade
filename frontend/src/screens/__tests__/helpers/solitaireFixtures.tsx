/**
 * Shared setup for the SolitaireScreen suites that seed a board (#2957):
 * a saved game is written to storage and the screen resumes it silently, so a
 * test starts from the exact position it names. Not a test file.
 *
 * The importing suite registers its own jest.mock calls (navigation, game
 * event client, stats API, flushQueuedGames); this module only renders.
 */
import React from "react";
import { act, fireEvent, render } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

import SolitaireScreen from "../../SolitaireScreen";
import { ThemeProvider } from "../../../theme/ThemeContext";
import type { Card, Rank, SolitaireState, Suit } from "../../../game/solitaire/types";

export const faceUp = (suit: Suit, rank: Rank): Card => ({ suit, rank, faceUp: true });
export const faceDown = (suit: Suit, rank: Rank): Card => ({ suit, rank, faceUp: false });

/** An empty draw-1 board; override the piles a test cares about. */
export function boardState(overrides: Partial<SolitaireState> = {}): SolitaireState {
  return {
    _v: 1,
    drawMode: 1,
    tableau: [[], [], [], [], [], [], []],
    foundations: { spades: [], hearts: [], diamonds: [], clubs: [] },
    stock: [],
    waste: [],
    score: 0,
    recycleCount: 0,
    undoStack: [],
    isComplete: false,
    startedAt: null,
    accumulatedMs: 0,
    ...overrides,
  };
}

/** `piles[i]` is column i; the rest of the seven columns are empty. */
export function tableauOf(...piles: Card[][]): SolitaireState["tableau"] {
  return Array.from({ length: 7 }, (_, i) => piles[i] ?? []);
}

/** Saves `state` as the game in progress and mounts the screen on it. */
export async function mountOn(state: SolitaireState) {
  await AsyncStorage.setItem("solitaire_game", JSON.stringify(state));
  return mountFresh();
}

/** Mounts the screen with whatever is saved, flushing the load. */
export async function mountFresh() {
  const api = await render(
    <ThemeProvider>
      <SolitaireScreen />
    </ThemeProvider>
  );
  await act(async () => {
    await Promise.resolve();
  });
  return api;
}

/** Presses the element with this accessibility label. */
export async function pressLabel(
  api: Awaited<ReturnType<typeof mountFresh>>,
  label: string
): Promise<void> {
  await act(async () => {
    await fireEvent.press(api.getByLabelText(label));
  });
}
