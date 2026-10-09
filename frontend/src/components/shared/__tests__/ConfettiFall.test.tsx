import React from "react";
import { render } from "@testing-library/react-native";
import { ConfettiFall } from "../ConfettiFall";

const COLORS = ["#f00", "#0f0", "#00f", "#ff0", "#0ff", "#f0f"];
const TIMING = { fromY: -80, toY: 520, staggerMs: 110, holdMs: 700, fadeOutMs: 500 };
const PIECE = { width: 22, height: 32, borderRadius: 3 };

function ui() {
  return <ConfettiFall testID="confetti" colors={COLORS} pieceStyle={PIECE} timing={TIMING} />;
}

function pieceStyles(view: Awaited<ReturnType<typeof render>>) {
  const root = view.getByTestId("confetti", { includeHiddenElements: true });
  return root.children.map((c) =>
    Object.assign({}, ...[(c as { props: { style: unknown } }).props.style].flat(Infinity))
  );
}

describe("ConfettiFall", () => {
  it("is decorative: hidden from screen readers and never blocks touches", async () => {
    const view = await render(ui());
    const root = view.getByTestId("confetti", { includeHiddenElements: true });
    expect(root.props.pointerEvents).toBe("none");
    expect(root.props.accessibilityElementsHidden).toBe(true);
    expect(root.props.importantForAccessibility).toBe("no-hide-descendants");
  });

  it("lays one piece per colour across the board, starting above it", async () => {
    const view = await render(ui());
    const styles = pieceStyles(view);
    expect(styles.map((s) => s.left)).toEqual(["8%", "22%", "36%", "52%", "66%", "80%"]);
    expect(styles.map((s) => s.backgroundColor)).toEqual(COLORS);
    expect(styles[0]).toMatchObject({ position: "absolute", top: 0, ...PIECE });
    expect(styles[0]).toMatchObject({ transform: [{ translateY: -80 }], opacity: 0 });
  });

  it("falls to its target on mount", async () => {
    const view = await render(ui());
    // The fall is written by a mount effect, so it shows on the next render.
    await view.rerender(ui());
    // The jest mock resolves each animation to its final value: the spring's
    // target, and the opacity sequence's last step (faded out).
    pieceStyles(view).forEach((s) =>
      expect(s).toMatchObject({ transform: [{ translateY: 520 }], opacity: 0 })
    );
  });
});
