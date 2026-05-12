import React from "react";
import { fireEvent, render } from "@testing-library/react-native";
import { ThemeProvider } from "../../../../theme/ThemeContext";
import LevelSelectScreen from "../LevelSelectScreen";
import type { LevelData } from "../../api";
import type { SortProgress } from "../../storage";

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
  it("renders one card per level", () => {
    const { getAllByRole } = render(
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

  it("renders all levels as buttons", () => {
    const { getByLabelText } = render(
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

  it("locked levels have a level-specific accessibility label", () => {
    const { getByLabelText } = render(
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

  it("locked levels are disabled", () => {
    const { getByLabelText } = render(
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

  it("tapping an unlocked level calls onSelectLevel with the correct id", () => {
    const onSelectLevel = jest.fn();
    const { getByLabelText } = render(
      withTheme(
        <LevelSelectScreen
          levels={LEVELS}
          progress={mkProgress({ unlockedLevel: 3 })}
          onSelectLevel={onSelectLevel}
          onContinue={jest.fn()}
        />
      )
    );
    fireEvent.press(getByLabelText("Level 3"));
    expect(onSelectLevel).toHaveBeenCalledWith(3);
  });

  it("tapping a locked level does not call onSelectLevel", () => {
    const onSelectLevel = jest.fn();
    const { getByLabelText } = render(
      withTheme(
        <LevelSelectScreen
          levels={LEVELS}
          progress={mkProgress({ unlockedLevel: 1 })}
          onSelectLevel={onSelectLevel}
          onContinue={jest.fn()}
        />
      )
    );
    fireEvent.press(getByLabelText("Level 2, locked"));
    expect(onSelectLevel).not.toHaveBeenCalled();
  });

  it("Continue button is hidden when there is no in-progress level", () => {
    const { queryByText } = render(
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

  it("Continue button is visible and shows the level number when in-progress", () => {
    const partialState = {
      bottles: [["red" as const]],
      moveCount: 1,
      undosUsed: 0,
      isComplete: false,
      selectedBottleIndex: null,
    };
    const { getByLabelText } = render(
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

  it("Continue button calls onContinue when pressed", () => {
    const onContinue = jest.fn();
    const partialState = {
      bottles: [["red" as const]],
      moveCount: 1,
      undosUsed: 0,
      isComplete: false,
      selectedBottleIndex: null,
    };
    const { getByLabelText } = render(
      withTheme(
        <LevelSelectScreen
          levels={LEVELS}
          progress={mkProgress({ currentLevelId: 1, currentState: partialState })}
          onSelectLevel={jest.fn()}
          onContinue={onContinue}
        />
      )
    );
    fireEvent.press(getByLabelText("Continue Level 1"));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it("renders an empty grid gracefully when no levels are provided", () => {
    const { queryByRole } = render(
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
