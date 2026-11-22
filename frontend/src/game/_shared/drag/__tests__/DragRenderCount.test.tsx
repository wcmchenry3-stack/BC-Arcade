/**
 * #2264 / #3554 — picking a card up and putting it down must not re-render the
 * whole board. Through the real DragProvider, a drag start (and its end)
 * re-renders only:
 *   - the DraggableCards of the dragged stack (they hide / show themselves),
 *   - the DropTargets whose drawn state changes (legal highlight, or the dim
 *     style of an illegal zone that has one),
 *   - the root DragGhostHost (it mounts / unmounts the ghost).
 * Every other card and target stays as it was. Each one is wrapped in a
 * React.Profiler, whose onRender fires once per commit its subtree renders in.
 */
import React, { Profiler, useEffect } from "react";
import { Text, View } from "react-native";
import { act, render } from "@testing-library/react-native";

import { ThemeProvider } from "../../../../theme/ThemeContext";
import { DragProvider, useDragContext } from "../DragContext";
import type { Bounds, DragCard, DragSource } from "../DragContext";
import { DraggableCard } from "../DraggableCard";
import { DropTarget } from "../DropTarget";
import { DragGhostHost } from "../DragGhostHost";
import { detectedGesture } from "../../../../test-utils/mockScreenDeps";
import type { DetectorRender } from "../../../../test-utils/mockScreenDeps";

const mockDetected: DetectorRender[] = [];
jest.mock("react-native-gesture-handler", () =>
  mockScreenDeps().mockGestureHandler(() => mockDetected)
);

const COLS = 4;
const PER_COL = 4;
const SIZE = { width: 60, height: 90 };
const DIM = { opacity: 0.4 };
const HIGHLIGHT = { borderWidth: 2 };

// Tableau zones carry a dim style (every one changes look when a drag starts);
// the free-cell-like zones don't, so only their legal one changes look.
const DIMMED_ZONES = ["t-0", "t-1", "t-2", "t-3"];
const PLAIN_ZONES = ["f-0", "f-1", "f-2", "f-3"];
const LEGAL = ["t-1", "f-2"];
const T1_BOUNDS: Bounds = { x: 100, y: 500, ...SIZE };

const renders = new Map<string, number>();
const onRender = (id: string) => {
  renders.set(id, (renders.get(id) ?? 0) + 1);
};
const rendered = () =>
  [...renders.entries()]
    .filter(([, n]) => n > 0)
    .map(([id]) => id)
    .sort();

// Grabs the provider's API and gives zone t-1 bounds (DropTarget's own
// measureInWindow never reports in Jest). Not wrapped in a Profiler.
let api: ReturnType<typeof useDragContext> | null = null;
function Api() {
  const ctx = useDragContext();
  api = ctx;
  const { updateDropZoneLayout } = ctx;
  useEffect(() => {
    updateDropZoneLayout("t-1", T1_BOUNDS);
  }, [updateDropZoneLayout]);
  return null;
}

function cardsFrom(col: number, from: number): DragCard[] {
  const out: DragCard[] = [];
  for (let i = from; i < PER_COL; i++) out.push({ suit: "spades", rank: 13 - i - col, ...SIZE });
  return out;
}

function Board() {
  const columns = [];
  for (let col = 0; col < COLS; col++) {
    for (let i = 0; i < PER_COL; i++) {
      const id = `c${col}-${i}`;
      const source: DragSource = { game: "freecell", type: "tableau", col, fromIndex: i };
      columns.push(
        <Profiler key={id} id={id} onRender={onRender}>
          <DraggableCard testID={id} dragCards={cardsFrom(col, i)} dragSource={source}>
            <Text testID={`face-${id}`}>{id}</Text>
          </DraggableCard>
        </Profiler>
      );
    }
  }
  const zones = [...DIMMED_ZONES, ...PLAIN_ZONES].map((id) => (
    <Profiler key={id} id={id} onRender={onRender}>
      <DropTarget
        id={id}
        testID={id}
        onDrop={() => id === "t-1"}
        highlightStyle={HIGHLIGHT}
        dimStyle={DIMMED_ZONES.includes(id) ? DIM : undefined}
      >
        <View />
      </DropTarget>
    </Profiler>
  ));
  return (
    <>
      {columns}
      {zones}
    </>
  );
}

function App() {
  return (
    <ThemeProvider>
      <DragProvider getLegalDropIds={() => LEGAL}>
        <Api />
        <Board />
      </DragProvider>
      <Profiler id="ghost-host" onRender={onRender}>
        <DragGhostHost />
      </Profiler>
    </ThemeProvider>
  );
}

function pan(id: string) {
  const h = detectedGesture(mockDetected, "pan", { testID: `face-${id}` });
  if (!h) throw new Error(`no pan gesture for ${id}`);
  return h;
}

// The dragged stack: column 1 from index 2 (cards c1-2 and c1-3).
const SOURCE_CARDS = ["c1-2", "c1-3"];
const EXPECTED = [...SOURCE_CARDS, ...DIMMED_ZONES, "f-2", "ghost-host"].sort();

beforeEach(() => {
  mockDetected.length = 0;
  renders.clear();
  api = null;
});

describe("drag start / end render scope (#2264)", () => {
  it("a drag start re-renders only the source stack, the changed targets and the ghost host", async () => {
    const { getByTestId } = await render(<App />);
    const h = pan("c1-2");
    renders.clear();

    await act(() => h.onStart!({ absoluteX: 40, absoluteY: 300, x: 10, y: 10 }));

    expect(getByTestId("drag-overlay-ghost")).toBeTruthy();
    expect(api!.dragState?.source).toEqual({
      game: "freecell",
      type: "tableau",
      col: 1,
      fromIndex: 2,
    });
    expect(rendered()).toEqual(EXPECTED);
    // One commit each: the ghost appears in the same commit the card hides.
    for (const id of EXPECTED) expect(renders.get(id)).toBe(1);
  });

  it("a re-rendered source card keeps its gesture (no fresh worklets)", async () => {
    await render(<App />);
    const detections = () => mockDetected.filter((d) => d.childTestID === "face-c1-2");
    const before = detections();
    expect(before.length).toBeGreaterThan(0);
    const h = pan("c1-2");

    await act(() => h.onStart!({ absoluteX: 40, absoluteY: 300, x: 10, y: 10 }));

    const after = detections();
    // The card did re-render (it hid itself) and handed RNGH the same gesture.
    expect(after.length).toBeGreaterThan(before.length);
    for (const d of after) expect(d.gesture).toBe(before[0]!.gesture);
  });

  it("the kept gesture starts the drag and taps with the card's current props", async () => {
    const tapA = jest.fn();
    const tapB = jest.fn();
    const srcA: DragSource = { game: "solitaire", type: "waste" };
    const srcB: DragSource = { game: "solitaire", type: "tableau", col: 6, fromIndex: 0 };
    function One({ src, onTap }: { src: DragSource; onTap: () => void }) {
      return (
        <ThemeProvider>
          <DragProvider>
            <Api />
            <DraggableCard
              dragCards={cardsFrom(0, src === srcA ? 3 : 1)}
              dragSource={src}
              onTap={onTap}
            >
              <Text testID="face-one">one</Text>
            </DraggableCard>
          </DragProvider>
        </ThemeProvider>
      );
    }
    const { rerender } = await render(<One src={srcA} onTap={tapA} />);
    const first = mockDetected.filter((d) => d.childTestID === "face-one")[0]!.gesture;
    await rerender(<One src={srcB} onTap={tapB} />);
    const latest = mockDetected.filter((d) => d.childTestID === "face-one").at(-1)!.gesture;
    expect(latest).toBe(first);

    const tap = detectedGesture(mockDetected, "tap", { testID: "face-one" })!;
    await act(() => tap.onEnd!({}, true));
    expect(tapA).not.toHaveBeenCalled();
    expect(tapB).toHaveBeenCalledTimes(1);

    await act(() => pan("one").onStart!({ absoluteX: 40, absoluteY: 300, x: 10, y: 10 }));
    expect(api!.dragState?.source).toEqual(srcB);
    expect(api!.dragState?.cards).toHaveLength(3);
  });

  it("a drop re-renders only the source stack, the changed targets and the ghost host", async () => {
    const { queryByTestId } = await render(<App />);
    const h = pan("c1-2");
    await act(() => h.onStart!({ absoluteX: 40, absoluteY: 300, x: 10, y: 10 }));
    renders.clear();

    await act(() => h.onEnd!({ absoluteX: 130, absoluteY: 540, x: 10, y: 10 }, true));

    expect(api!.dragState).toBeNull();
    expect(queryByTestId("drag-overlay-ghost")).toBeNull();
    expect(rendered()).toEqual(EXPECTED);
    for (const id of EXPECTED) expect(renders.get(id)).toBe(1);
  });

  it("a cancel re-renders the same set", async () => {
    await render(<App />);
    const h = pan("c1-2");
    await act(() => h.onStart!({ absoluteX: 40, absoluteY: 300, x: 10, y: 10 }));
    renders.clear();

    await act(() => api!.cancelDrag("test"));

    expect(api!.dragState).toBeNull();
    expect(rendered()).toEqual(EXPECTED);
  });
});
