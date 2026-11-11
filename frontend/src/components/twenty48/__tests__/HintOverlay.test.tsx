/**
 * @jest-environment jsdom
 *
 * #3688: the hint arrow and label over the board — the label per direction (with "or ←" on web
 * only), the edge it sits on, no touches taken, and Reduce Motion showing it with no fade.
 */
import React from "react";
import { render } from "@testing-library/react-native";
import HintOverlay from "../HintOverlay";
import { ThemeProvider } from "../../../theme/ThemeContext";
import type { Direction } from "../../../game/twenty48/engine";

let mockReduceMotion = false;
jest.mock("../../shared/useReduceMotion", () => ({
  useReduceMotion: () => mockReduceMotion,
}));

function mount(direction: Direction, showKey: boolean) {
  return render(
    <ThemeProvider>
      <HintOverlay direction={direction} showKey={showKey} />
    </ThemeProvider>
  );
}

const flat = (style: unknown) => Object.assign({}, ...[style].flat(Infinity).filter(Boolean));

beforeEach(() => {
  mockReduceMotion = false;
});

describe("HintOverlay", () => {
  it.each([
    ["up", "Swipe up", "Swipe up or ↑"],
    ["down", "Swipe down", "Swipe down or ↓"],
    ["left", "Swipe left", "Swipe left or ←"],
    ["right", "Swipe right", "Swipe right or →"],
  ] as const)("%s: '%s' on native, '%s' on web", async (direction, native, web) => {
    const a = await mount(direction, false);
    expect(a.getByTestId("twenty48-hint-text")).toHaveTextContent(native);
    expect(a.queryByText(/or [←→↑↓]/)).toBeNull();
    await a.unmount();
    const b = await mount(direction, true);
    expect(b.getByTestId("twenty48-hint-text")).toHaveTextContent(web);
  });

  it("sits on the edge the swipe points to and never takes a touch", async () => {
    const edges: Array<[Direction, object]> = [
      ["up", { justifyContent: "flex-start", alignItems: "center" }],
      ["down", { justifyContent: "flex-end", alignItems: "center" }],
      ["left", { justifyContent: "center", alignItems: "flex-start" }],
      ["right", { justifyContent: "center", alignItems: "flex-end" }],
    ];
    for (const [direction, edge] of edges) {
      const r = await mount(direction, false);
      const root = r.getByTestId("twenty48-hint");
      expect(root.props.pointerEvents).toBe("none");
      expect(flat(root.props.style)).toMatchObject(edge);
      await r.unmount();
    }
  });

  it("is not a live region: the screen announces the hint once (#3715 review)", async () => {
    // A polite live region plus the screen's announceForAccessibility read it twice on Android.
    const r = await mount("left", false);
    expect(r.getByTestId("twenty48-hint-chip").props.accessibilityLiveRegion).toBeUndefined();
  });

  it("under Reduce Motion is fully visible at once, with no fade in", async () => {
    mockReduceMotion = true;
    const r = await mount("left", false);
    const chip = r.getByTestId("twenty48-hint-chip");
    expect(flat(chip.props.style).opacity).toBe(1);
  });

  it("without Reduce Motion starts transparent and fades in", async () => {
    const r = await mount("left", false);
    const chip = r.getByTestId("twenty48-hint-chip");
    expect(flat(chip.props.style).opacity).toBe(0);
  });
});
