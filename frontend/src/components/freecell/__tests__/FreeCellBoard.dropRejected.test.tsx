/**
 * #2202 — a drag released on a refusing target gets the same invalid-move
 * sound as a rejected tap. The real DragProvider decides when a drop is
 * rejected (covered in DragContext.test); here the board must hand it the
 * invalid-move sound as `onDropRejected`.
 */
import React from "react";
import { render } from "@testing-library/react-native";

import { ThemeProvider } from "../../../theme/ThemeContext";
import FreeCellBoard from "../FreeCellBoard";
import type { DragProviderProps } from "../../../game/_shared/drag/DragContext";
import type { FreeCellState } from "../../../game/freecell/types";

const mockProviderProps: DragProviderProps[] = [];
jest.mock("../../../game/_shared/drag/DragContext", () => {
  const actual = jest.requireActual("../../../game/_shared/drag/DragContext");
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
jest.mock("../../../game/_shared/useSound", () => ({
  useSound: (name: string, sounds: unknown) => mockUseSound(name, sounds),
}));

const STATE: FreeCellState = {
  _v: 1,
  tableau: [[], [], [], [], [], [], [], []],
  freeCells: [null, null, null, null],
  foundations: { spades: [], hearts: [], diamonds: [], clubs: [] },
  undoStack: [],
  isComplete: false,
  moveCount: 0,
};

beforeEach(() => {
  mockProviderProps.length = 0;
  mockPlay.mockClear();
});

it("plays the invalid-move sound when the drag provider reports a rejected drop", async () => {
  await render(
    <ThemeProvider>
      <FreeCellBoard state={STATE} onMove={jest.fn()} />
    </ThemeProvider>
  );
  const { onDropRejected } = mockProviderProps[mockProviderProps.length - 1];
  expect(onDropRejected).toBeDefined();
  expect(mockUseSound).toHaveBeenCalledWith("freecell.invalidMove", expect.anything());
  expect(mockPlay).not.toHaveBeenCalled();
  onDropRejected!({ game: "freecell", type: "freecell", cell: 0 }, []);
  expect(mockPlay).toHaveBeenCalledTimes(1);
});
