/**
 * A drag's legal-zone highlight must not change any layout (#3532).
 *
 * The highlight used to add a 2 dp border to DropTargets with no size of
 * their own (free cells, foundations, empty columns), growing each one by
 * 4 dp when a drag started. With Large cards on (#3347) FreeCell's tableau is
 * compressed to fill the board area exactly, so those 4 dp made
 * FreeCellScreen's board overflow, `wrapBoard` swapped in its ScrollView, the
 * board remounted mid-drag and every drag was cancelled (`sourceUnmounted`,
 * seen on the Android emulator). The real DropTarget and DragProvider run
 * here; the test checks the zone's own box before and during a drag.
 */
import React from "react";
import { StyleSheet, Text } from "react-native";
import { act, render } from "@testing-library/react-native";

import { ThemeProvider } from "../../../theme/ThemeContext";
import { DragProvider, useDragContext } from "../../../game/_shared/drag/DragContext";
import type { DragCard, DragSource } from "../../../game/_shared/drag/DragContext";
import FreeCellSlot from "../FreeCellSlot";
import FoundationPile from "../FoundationPile";
import TableauColumn from "../TableauColumn";

jest.mock("../../../game/_shared/useSound", () => ({
  useSound: () => ({ play: jest.fn(() => true), stop: jest.fn() }),
}));

const IDS = ["freecell-slot-0", "freecell-foundation-hearts", "freecell-tableau-4"];
const CARD: DragCard = { suit: "hearts", rank: 1, width: 40, height: 57 };
const SOURCE: DragSource = { game: "freecell", type: "tableau", col: 0, fromIndex: 0 };

let start: (() => void) | null = null;
function Starter() {
  const { startDrag } = useDragContext();
  start = () => startDrag(SOURCE, [CARD]);
  return <Text>starter</Text>;
}

function Zones() {
  const onDrop = jest.fn(() => true);
  return (
    <DragProvider getLegalDropIds={() => IDS}>
      <ThemeProvider>
        <Starter />
        <FreeCellSlot card={null} cellIndex={0} dropId="freecell-slot-0" onDrop={onDrop} />
        <FoundationPile
          pile={[]}
          suit="hearts"
          dropId="freecell-foundation-hearts"
          onDrop={onDrop}
        />
        <TableauColumn pile={[]} colIndex={4} dropId="freecell-tableau-4" onDrop={onDrop} />
      </ThemeProvider>
    </DragProvider>
  );
}

/** How far the zone's outer box grows on each side: border plus margin. */
function boxGrowth(style: unknown): number {
  const s = StyleSheet.flatten(style as never) ?? {};
  return (Number(s.borderWidth) || 0) + (Number(s.margin) || 0);
}

describe("drop-zone highlight (#3532)", () => {
  it("is layout-neutral on every zone that has no size of its own", async () => {
    const api = await render(<Zones />);
    for (const id of IDS) expect(boxGrowth(api.getByTestId(id).props.style)).toBe(0);

    await act(async () => start!());

    for (const id of IDS) {
      const style = StyleSheet.flatten(api.getByTestId(id).props.style);
      // Still highlighted, so the fix didn't just drop the highlight.
      expect(style.borderWidth).toBe(2);
      expect(boxGrowth(style)).toBe(0);
    }
  });
});
