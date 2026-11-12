/** CascadeDevPanel (#3693): the dev panel moved out of CascadeScreen onto DevPanelShell. */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { ThemeProvider } from "../../../theme/ThemeContext";
import { FRUIT_SETS, DEFAULT_FRUIT_SET } from "../../../theme/fruitSets";
import { PIECE_DEFS } from "../../../game/cascade/pieceDefs";
import CascadeDevPanel from "../CascadeDevPanel";

jest.mock("../FruitGlyph", () => "FruitGlyph");

const activeFruitSet = FRUIT_SETS[DEFAULT_FRUIT_SET]!;

async function renderPanel(over: Partial<React.ComponentProps<typeof CascadeDevPanel>> = {}) {
  const props = {
    enabled: true,
    open: true,
    onOpen: jest.fn(),
    onClose: jest.fn(),
    onSpawn: jest.fn(),
    activeFruitSet,
    ...over,
  };
  await render(
    <ThemeProvider>
      <CascadeDevPanel {...props} />
    </ThemeProvider>
  );
  return props;
}

describe("CascadeDevPanel", () => {
  it("draws nothing when disabled", async () => {
    await renderPanel({ enabled: false });
    expect(screen.queryByText("DEV")).toBeNull();
    expect(screen.queryByText("Cascade Dev Panel")).toBeNull();
  });

  it("shows the DEV button, which opens the panel", async () => {
    const p = await renderPanel({ open: false });
    await fireEvent.press(screen.getByText("DEV"));
    expect(p.onOpen).toHaveBeenCalledTimes(1);
  });

  it("lists every engine tier with a Spawn button and the active set", async () => {
    await renderPanel();
    expect(screen.getByText("Cascade Dev Panel")).toBeTruthy();
    expect(screen.getAllByText("Spawn")).toHaveLength(PIECE_DEFS.length);
    expect(screen.getByText(`── Active Set: ${activeFruitSet.label} ──`)).toBeTruthy();
  });

  it("spawns the pressed tier and closes from its Close button", async () => {
    const p = await renderPanel();
    await fireEvent.press(screen.getAllByText("Spawn")[4]!);
    expect(p.onSpawn).toHaveBeenCalledWith(PIECE_DEFS[4]!.tier);
    await fireEvent.press(screen.getByText("Close"));
    expect(p.onClose).toHaveBeenCalledTimes(1);
  });

  it("lists all 12 tiers with the active set's names, and spawns the capstone (#3695)", async () => {
    const p = await renderPanel();
    expect(screen.getAllByText("Spawn")).toHaveLength(12);
    expect(screen.getAllByText("10 · Watermelon").length).toBeGreaterThan(0);
    expect(screen.getAllByText("11 · Pumpkin").length).toBeGreaterThan(0);
    await fireEvent.press(screen.getAllByText("Spawn")[11]!);
    expect(p.onSpawn).toHaveBeenCalledWith(11);
  });
});
