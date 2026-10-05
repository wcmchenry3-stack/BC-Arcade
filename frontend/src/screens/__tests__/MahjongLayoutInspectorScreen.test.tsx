/**
 * #2956: the Mahjong layout inspector (a debug screen reachable only from the Mahjong game,
 * see releaseBuildConfig.test.ts). A two-column grid of every registered layout; a card opens
 * that layout's detail screen.
 */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";

import MahjongLayoutInspectorScreen from "../MahjongLayoutInspectorScreen";
import { LAYOUTS } from "../../game/mahjong/layouts/registry";

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
jest.mock("@react-navigation/native", () =>
  mockScreenDeps().mockNavigation(() => ({ navigate: mockNavigate, goBack: mockGoBack }))
);

beforeEach(() => jest.clearAllMocks());

const label = (m: (typeof LAYOUTS)[number]) => `${m.name}, Tier ${m.tier}, ${m.tileCount} tiles`;

describe("MahjongLayoutInspectorScreen", () => {
  it("lists the layouts as labelled cards with their tier and tile count", async () => {
    await render(<MahjongLayoutInspectorScreen />);
    expect(screen.getByText("Layout Inspector")).toBeTruthy();
    const first = LAYOUTS[0]!;
    const card = screen.getByRole("button", { name: label(first) });
    expect(card).toHaveTextContent(new RegExp(`T${first.tier}`));
    expect(card).toHaveTextContent(new RegExp(first.name));
    expect(card).toHaveTextContent(new RegExp(`${first.tileCount} tiles`));
  });

  it("opens a layout's detail screen", async () => {
    await render(<MahjongLayoutInspectorScreen />);
    const second = LAYOUTS[1]!;
    await fireEvent.press(screen.getByRole("button", { name: label(second) }));
    expect(mockNavigate).toHaveBeenCalledWith("MahjongLayoutDetail", { layoutId: second.id });
  });

  it("the header's back button goes back", async () => {
    await render(<MahjongLayoutInspectorScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "Go back to home screen" }));
    expect(mockGoBack).toHaveBeenCalledTimes(1);
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
