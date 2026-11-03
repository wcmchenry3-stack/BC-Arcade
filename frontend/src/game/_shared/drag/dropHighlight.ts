import type { ViewStyle } from "react-native";

// Its own module, not DropTarget.tsx: screen tests replace DropTarget with
// a recorder, and this style must stay real there.
/** Width of the drag-time highlight border drawn by `dropHighlightStyle`. */
export const DROP_HIGHLIGHT_BORDER = 2;

/**
 * A layout-neutral highlight for a legal drop zone whose DropTarget has no
 * fixed size (it wraps a fixed-size slot or card): the border is drawn in a
 * negative margin of the same width, so the zone's box, its child's position
 * and every sibling stay exactly where they were. A plain `borderWidth` there
 * grows the zone by 2 x the border when a drag starts. In FreeCell with Large
 * cards (#3347) the tableau is compressed to fill the board area exactly, so
 * those 4 dp tipped FreeCellScreen's board into its overflow ScrollView,
 * which remounted the board mid-drag and cancelled every drag
 * (`sourceUnmounted`, #3532). Don't use it on a DropTarget with a fixed
 * width/height (its border is already inside the box).
 */
export function dropHighlightStyle(color: string, radius: number): ViewStyle {
  return {
    borderColor: color,
    borderWidth: DROP_HIGHLIGHT_BORDER,
    borderRadius: radius,
    margin: -DROP_HIGHLIGHT_BORDER,
  };
}
