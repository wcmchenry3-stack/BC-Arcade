import React from "react";
import { Text } from "react-native";
import { act, render, fireEvent } from "@testing-library/react-native";

import { ThemeProvider } from "../../../../theme/ThemeContext";
import { DragProvider, useDragContext } from "../DragContext";
import type { DragCard, DragSource } from "../DragContext";
import { DragGhostHost } from "../DragGhostHost";

const dragCards: DragCard[] = [{ suit: "spades", rank: 1, faceDown: false, width: 60, height: 90 }];
const dragSource: DragSource = { game: "solitaire", type: "waste" };

function DragStarter() {
  const { startDrag } = useDragContext();
  return (
    <Text accessibilityLabel="start" onPress={() => startDrag(dragSource, dragCards)}>
      start
    </Text>
  );
}

function wrap(children: React.ReactNode) {
  return (
    <DragProvider>
      <ThemeProvider>{children}</ThemeProvider>
    </DragProvider>
  );
}

describe("DragGhostHost", () => {
  it("renders nothing when no drag is active", async () => {
    const { queryByTestId } = await render(wrap(<DragGhostHost />));
    expect(queryByTestId("drag-overlay-ghost")).toBeNull();
  });

  it("lifts the ghost 8pt above the card position (translateY = cardY - 8)", async () => {
    const { getByLabelText, getByTestId } = await render(
      wrap(
        <>
          <DragStarter />
          <DragGhostHost />
        </>
      )
    );

    await fireEvent.press(getByLabelText("start"));

    const ghost = getByTestId("drag-overlay-ghost");
    // useAnimatedStyle mock calls fn() immediately; cardY starts at 0, so translateY = 0 - 8 = -8.
    const flatStyle = [ghost.props.style].flat().filter(Boolean);
    const merged = Object.assign({}, ...flatStyle);
    const transforms = merged.transform as Array<Record<string, number>>;
    expect(transforms).toContainEqual({ translateY: -8 });
  });
});

// ---------------------------------------------------------------------------
// The root host (#3531)
// ---------------------------------------------------------------------------

const run: DragCard[] = [
  { suit: "hearts", rank: 9, width: 70, height: 100, stackTop: 0 },
  { suit: "clubs", rank: 8, width: 70, height: 100, stackTop: 31 },
  { suit: "hearts", rank: 7, width: 70, height: 100, stackTop: 62 },
];

let ctx: ReturnType<typeof useDragContext> | null = null;
function Grab() {
  ctx = useDragContext();
  return null;
}

/** The app: a game screen's provider, and the host as its sibling at the root. */
function App({ showScreen = true }: { showScreen?: boolean }) {
  return (
    <ThemeProvider>
      {showScreen && (
        <DragProvider>
          <Grab />
        </DragProvider>
      )}
      <DragGhostHost />
    </ThemeProvider>
  );
}

const flat = (style: unknown) => Object.assign({}, ...[style].flat(Infinity).filter(Boolean));

describe("DragGhostHost as the root host (#3531)", () => {
  beforeEach(() => {
    ctx = null;
  });

  it("renders nothing at all without a drag, even with a game screen mounted", async () => {
    const view = await render(<App />);
    expect(view.toJSON()).toBeNull();
  });

  it("shows the active drag of a provider it does not sit inside, and nothing after it ends", async () => {
    const view = await render(<App />);
    await act(() => {
      ctx!.startDrag(dragSource, dragCards);
    });
    expect(view.getByTestId("drag-overlay-ghost")).toBeTruthy();
    // Full-window and never in the way of a touch.
    const host = view.getByTestId("drag-overlay-ghost").parent!;
    expect(host.props.pointerEvents).toBe("none");
    expect(flat(host.props.style)).toMatchObject({ position: "absolute", top: 0, left: 0 });
    await act(() => ctx!.cancelDrag("test"));
    expect(view.toJSON()).toBeNull();
  });

  it("a game screen unmounting mid-drag takes its ghost with it", async () => {
    const view = await render(<App />);
    await act(() => {
      ctx!.startDrag(dragSource, dragCards);
    });
    expect(view.queryByTestId("drag-overlay-ghost")).not.toBeNull();
    await view.rerender(<App showScreen={false} />);
    expect(view.toJSON()).toBeNull();
  });

  it("sizes the cards from DragCard and fans a run by each card's stackTop", async () => {
    const view = await render(<App />);
    await act(() => {
      ctx!.startDrag({ game: "freecell", type: "tableau", col: 1, fromIndex: 4 }, run);
    });
    const tops = run.map(
      (_, i) => flat(view.getByTestId(`drag-overlay-ghost-card-${i}`).props.style).top
    );
    expect(tops).toEqual([0, 31, 62]);
    // The card face is drawn at the DragCard's size (no CardSizeContext here).
    const face = view.getByTestId("drag-overlay-ghost-card-0").children[0] as {
      props: { style: unknown };
    };
    expect(flat(face.props.style)).toMatchObject({ width: 70, height: 100 });
  });

  it("a run without stackTop falls back to 24 px scaled by the card width", async () => {
    const view = await render(<App />);
    const noTops = run.map(({ stackTop: _drop, ...c }) => c);
    await act(() => {
      ctx!.startDrag({ game: "freecell", type: "tableau", col: 1, fromIndex: 4 }, noTops);
    });
    const step = Math.round(24 * (70 / 52));
    const tops = run.map(
      (_, i) => flat(view.getByTestId(`drag-overlay-ghost-card-${i}`).props.style).top
    );
    expect(tops).toEqual([0, step, 2 * step]);
  });

  it("flags the ghost mounted only while it is drawn (#3528 check guard)", async () => {
    const view = await render(<App />);
    expect(ctx!.ghostMounted.value).toBe(false);
    await act(() => {
      ctx!.startDrag(dragSource, dragCards);
    });
    expect(ctx!.ghostMounted.value).toBe(true);
    await act(() => ctx!.cancelDrag("test"));
    expect(ctx!.ghostMounted.value).toBe(false);
    expect(view.toJSON()).toBeNull();
  });
});
