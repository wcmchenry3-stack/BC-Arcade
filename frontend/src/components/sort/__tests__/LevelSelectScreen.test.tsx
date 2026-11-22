import React from "react";
import { fireEvent, render } from "@testing-library/react-native";
import { ThemeProvider } from "../../../theme/ThemeContext";
import LevelSelectScreen from "../LevelSelectScreen";
import type { CatalogLevel, LevelData } from "../../../game/sort/catalog";
import type { SortProgress } from "../../../game/sort/storage";

function withTheme(children: React.ReactNode) {
  return <ThemeProvider>{children}</ThemeProvider>;
}

const LEVELS: LevelData[] = Array.from({ length: 5 }, (_, i) => ({
  id: i + 1,
  bottles: [["red", "red", "red", "red"], []],
}));

function mkProgress(overrides: Partial<SortProgress> = {}): SortProgress {
  return {
    unlockedLevel: 1,
    currentLevelId: null,
    currentState: null,
    ...overrides,
  };
}

describe("LevelSelectScreen", () => {
  it("renders one card per level", async () => {
    const { getAllByRole } = await render(
      withTheme(
        <LevelSelectScreen
          levels={LEVELS}
          progress={mkProgress({ unlockedLevel: 5 })}
          onSelectLevel={jest.fn()}
          onContinue={jest.fn()}
        />
      )
    );
    expect(getAllByRole("button")).toHaveLength(LEVELS.length);
  });

  it("renders all levels as buttons", async () => {
    const { getByLabelText } = await render(
      withTheme(
        <LevelSelectScreen
          levels={LEVELS}
          progress={mkProgress({ unlockedLevel: 5 })}
          onSelectLevel={jest.fn()}
          onContinue={jest.fn()}
        />
      )
    );
    for (const level of LEVELS) {
      expect(getByLabelText(`Level ${level.id}`)).toBeTruthy();
    }
  });

  it("locked levels have a level-specific accessibility label", async () => {
    const { getByLabelText } = await render(
      withTheme(
        <LevelSelectScreen
          levels={LEVELS}
          progress={mkProgress({ unlockedLevel: 1 })}
          onSelectLevel={jest.fn()}
          onContinue={jest.fn()}
        />
      )
    );
    expect(getByLabelText("Level 2, locked")).toBeTruthy();
    expect(getByLabelText("Level 5, locked")).toBeTruthy();
  });

  it("locked levels are disabled", async () => {
    const { getByLabelText } = await render(
      withTheme(
        <LevelSelectScreen
          levels={LEVELS}
          progress={mkProgress({ unlockedLevel: 1 })}
          onSelectLevel={jest.fn()}
          onContinue={jest.fn()}
        />
      )
    );
    const lockedCard = getByLabelText("Level 2, locked");
    expect(lockedCard.props.accessibilityState?.disabled).toBe(true);
  });

  it("tapping an unlocked level calls onSelectLevel with the correct id", async () => {
    const onSelectLevel = jest.fn();
    const { getByLabelText } = await render(
      withTheme(
        <LevelSelectScreen
          levels={LEVELS}
          progress={mkProgress({ unlockedLevel: 3 })}
          onSelectLevel={onSelectLevel}
          onContinue={jest.fn()}
        />
      )
    );
    await fireEvent.press(getByLabelText("Level 3"));
    expect(onSelectLevel).toHaveBeenCalledWith(3);
  });

  it("tapping a locked level does not call onSelectLevel", async () => {
    const onSelectLevel = jest.fn();
    const { getByLabelText } = await render(
      withTheme(
        <LevelSelectScreen
          levels={LEVELS}
          progress={mkProgress({ unlockedLevel: 1 })}
          onSelectLevel={onSelectLevel}
          onContinue={jest.fn()}
        />
      )
    );
    await fireEvent.press(getByLabelText("Level 2, locked"));
    expect(onSelectLevel).not.toHaveBeenCalled();
  });

  it("Continue button is hidden when there is no in-progress level", async () => {
    const { queryByText } = await render(
      withTheme(
        <LevelSelectScreen
          levels={LEVELS}
          progress={mkProgress({ currentLevelId: null, currentState: null })}
          onSelectLevel={jest.fn()}
          onContinue={jest.fn()}
        />
      )
    );
    expect(queryByText(/Continue Level/)).toBeNull();
  });

  it("Continue button is visible and shows the level number when in-progress", async () => {
    const partialState = {
      bottles: [["red" as const]],
      moveCount: 1,
      undosUsed: 0,
      isComplete: false,
      selectedBottleIndex: null,
    };
    const { getByLabelText } = await render(
      withTheme(
        <LevelSelectScreen
          levels={LEVELS}
          progress={mkProgress({ currentLevelId: 2, currentState: partialState })}
          onSelectLevel={jest.fn()}
          onContinue={jest.fn()}
        />
      )
    );
    expect(getByLabelText("Continue Level 2")).toBeTruthy();
  });

  it("Continue button calls onContinue when pressed", async () => {
    const onContinue = jest.fn();
    const partialState = {
      bottles: [["red" as const]],
      moveCount: 1,
      undosUsed: 0,
      isComplete: false,
      selectedBottleIndex: null,
    };
    const { getByLabelText } = await render(
      withTheme(
        <LevelSelectScreen
          levels={LEVELS}
          progress={mkProgress({ currentLevelId: 1, currentState: partialState })}
          onSelectLevel={jest.fn()}
          onContinue={onContinue}
        />
      )
    );
    await fireEvent.press(getByLabelText("Continue Level 1"));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it("renders an empty grid gracefully when no levels are provided", async () => {
    const { queryByRole } = await render(
      withTheme(
        <LevelSelectScreen
          levels={[]}
          progress={mkProgress()}
          onSelectLevel={jest.fn()}
          onContinue={jest.fn()}
        />
      )
    );
    expect(queryByRole("button")).toBeNull();
  });
});

describe("LevelSelectScreen — stars and chapters (#3687)", () => {
  // Par 10 on every level: 3 stars up to 10 moves, 2 up to 13, 1 beyond.
  const CATALOG: CatalogLevel[] = Array.from({ length: 45 }, (_, i) => ({
    id: i + 1,
    par: 10,
    bottles: [["red", "red", "red", "red"], []],
  }));

  async function renderGrid(
    bestMoves: Record<string, number>,
    unlockedLevel = 45,
    levels: readonly CatalogLevel[] = CATALOG
  ) {
    return await render(
      withTheme(
        <LevelSelectScreen
          levels={levels}
          progress={mkProgress({ unlockedLevel })}
          bestMoves={bestMoves}
          onSelectLevel={jest.fn()}
          onContinue={jest.fn()}
        />
      )
    );
  }

  it("shows each solved level's best stars, filled and outlined", async () => {
    const r = await renderGrid({ "1": 10, "2": 13, "3": 14 });
    expect(r.getAllByTestId(/^sort-level-1-stars-\d-filled$/, { hidden: true })).toHaveLength(3);
    expect(r.queryAllByTestId(/^sort-level-1-stars-\d-empty$/, { hidden: true })).toHaveLength(0);
    expect(r.getAllByTestId(/^sort-level-2-stars-\d-filled$/, { hidden: true })).toHaveLength(2);
    expect(r.getAllByTestId(/^sort-level-2-stars-\d-empty$/, { hidden: true })).toHaveLength(1);
    expect(r.getAllByTestId(/^sort-level-3-stars-\d-filled$/, { hidden: true })).toHaveLength(1);
    expect(r.getAllByTestId(/^sort-level-3-stars-\d-empty$/, { hidden: true })).toHaveLength(2);
  });

  it("shows three empty outlines on an unlocked level not solved yet", async () => {
    const r = await renderGrid({ "1": 10 });
    expect(r.queryAllByTestId(/^sort-level-4-stars-\d-filled$/, { hidden: true })).toHaveLength(0);
    expect(r.getAllByTestId(/^sort-level-4-stars-\d-empty$/, { hidden: true })).toHaveLength(3);
  });

  it("leaves a locked tile as it was: no stars, the locked label", async () => {
    const r = await renderGrid({ "1": 10 }, 2);
    expect(r.queryByTestId("sort-level-3-stars")).toBeNull();
    expect(r.getByLabelText("Level 3, locked").props.accessibilityState?.disabled).toBe(true);
  });

  it("puts the stars in the tile's screen-reader label", async () => {
    const r = await renderGrid({ "1": 10, "2": 13, "3": 14 });
    expect(r.getByLabelText("Level 1, 3 of 3 stars")).toBeTruthy();
    expect(r.getByLabelText("Level 2, 2 of 3 stars")).toBeTruthy();
    expect(r.getByLabelText("Level 3, 1 of 3 stars")).toBeTruthy();
    // Not solved yet: the label is as before.
    expect(r.getByLabelText("Level 4")).toBeTruthy();
  });

  it("hides the decorative stars from screen readers (the tile's label carries them)", async () => {
    const r = await renderGrid({ "1": 10 });
    expect(
      r.getByTestId("sort-level-1-stars", { hidden: true }).props.accessibilityElementsHidden
    ).toBe(true);
  });

  it("groups the levels under chapter headers of 20", async () => {
    const r = await renderGrid({});
    const headers = r.getAllByRole("header");
    expect(headers.map((h) => h.props.children)).toEqual(["Chapter 1", "Chapter 2", "Chapter 3"]);
    expect(r.getByTestId("sort-chapter-2")).toBeTruthy();
  });

  it("has no stars without a par or without best moves", async () => {
    const noPar = CATALOG.map(({ id, bottles }) => ({ id, bottles }));
    const r = await renderGrid({ "1": 3 }, 45, noPar);
    expect(r.queryAllByTestId(/^sort-level-1-stars-\d-filled$/, { hidden: true })).toHaveLength(0);
    expect(r.getByLabelText("Level 1")).toBeTruthy();
  });
});
