import React from "react";
import { StyleSheet, Text } from "react-native";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { ThemeProvider } from "../../../theme/ThemeContext";
import { LockableGrid, type LockableGridProps } from "../LockableGrid";

interface Item {
  id: number;
}

const ITEMS: Item[] = [1, 2, 3, 4, 5].map((id) => ({ id }));

async function renderGrid(overrides: Partial<LockableGridProps<Item>> = {}) {
  const props: LockableGridProps<Item> = {
    title: "Pick a level",
    onContinue: jest.fn(),
    items: ITEMS,
    columns: 2,
    gap: 8,
    keyOf: (item) => item.id,
    isUnlocked: (item) => item.id <= 2,
    onSelect: jest.fn(),
    testIDOf: (item) => `level-${item.id}`,
    accessibilityLabelOf: (item, unlocked) =>
      unlocked ? `Level ${item.id}` : `Level ${item.id}, locked`,
    renderContent: (item) => <Text>{`#${item.id}`}</Text>,
    ...overrides,
  };
  await render(
    <ThemeProvider>
      <LockableGrid {...props} />
    </ThemeProvider>
  );
  return props;
}

/** The nearest host ancestor laid out as a row. */
function rowOf(testID: string) {
  let node = screen.getByTestId(testID).parent;
  while (node && StyleSheet.flatten(node.props.style)?.flexDirection !== "row") {
    node = node.parent;
  }
  return node;
}

describe("LockableGrid", () => {
  it("renders the title and one card per item", async () => {
    await renderGrid();
    expect(screen.getByText("Pick a level")).toBeTruthy();
    for (const { id } of ITEMS) {
      expect(screen.getByTestId(`level-${id}`)).toBeTruthy();
      expect(screen.getByText(`#${id}`)).toBeTruthy();
    }
  });

  it("only announces the title as a header when asked", async () => {
    await renderGrid();
    expect(screen.getByText("Pick a level").props.accessibilityRole).toBeUndefined();
  });

  it("announces the title as a header with titleAccessibilityRole", async () => {
    await renderGrid({ titleAccessibilityRole: "header" });
    expect(screen.getByRole("header", { name: "Pick a level" })).toBeTruthy();
  });

  it("chunks items into rows of `columns` cards", async () => {
    await renderGrid();
    expect(rowOf("level-1")).toBe(rowOf("level-2"));
    expect(rowOf("level-3")).toBe(rowOf("level-4"));
    expect(rowOf("level-2")).not.toBe(rowOf("level-3"));
    expect(rowOf("level-5")).not.toBe(rowOf("level-4"));
  });

  it("pads a short last row so its cards keep their width", async () => {
    await renderGrid({ columns: 3 });
    // Row two holds items 4 and 5 plus one filler.
    expect(rowOf("level-4")!.children).toHaveLength(3);
  });

  it("selects an unlocked item on tap", async () => {
    const { onSelect } = await renderGrid();
    await fireEvent.press(screen.getByTestId("level-2"));
    expect(onSelect).toHaveBeenCalledWith({ id: 2 });
  });

  it("disables a locked item, shows a lock and labels it as locked", async () => {
    const { onSelect } = await renderGrid();
    const locked = screen.getByTestId("level-3");
    expect(locked.props.accessibilityState).toEqual({ disabled: true });
    expect(locked.props.accessibilityLabel).toBe("Level 3, locked");
    await fireEvent.press(locked);
    expect(onSelect).not.toHaveBeenCalled();
    // Items 3, 4 and 5 are locked.
    expect(screen.getAllByText("🔒")).toHaveLength(3);
  });

  it("labels and enables an unlocked item", async () => {
    await renderGrid();
    const open = screen.getByTestId("level-1");
    expect(open.props.accessibilityState).toEqual({ disabled: false });
    expect(open.props.accessibilityLabel).toBe("Level 1");
  });

  it("passes the unlocked state to renderContent", async () => {
    const renderContent = jest.fn((item: Item, unlocked: boolean) => (
      <Text>{`${item.id}:${unlocked}`}</Text>
    ));
    await renderGrid({ renderContent });
    expect(screen.getByText("1:true")).toBeTruthy();
    expect(screen.getByText("3:false")).toBeTruthy();
  });

  it("hides Continue without a continueLabel", async () => {
    await renderGrid();
    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
  });

  it("shows Continue with a continueLabel and calls onContinue", async () => {
    const { onContinue } = await renderGrid({ continueLabel: "Continue" });
    await fireEvent.press(screen.getByRole("button", { name: "Continue" }));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });
});
