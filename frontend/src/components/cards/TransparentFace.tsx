/**
 * TransparentFace (#3572): a card's face that can be drawn transparent (Solitaire draws a card in
 * flight in its flight layer) while it still takes a touch.
 *
 * It is a `DraggableCard`'s child, and RNGH's GestureDetector clones its own `ref` and
 * `collapsable: false` onto that child: the view the gesture is attached to. Both platforms
 * skip a nearly transparent view when they hit-test (iOS Fabric below alpha 0.01, RNGH on
 * Android below `MIN_ALPHA_FOR_TOUCH`), so that view must stay opaque. The gesture's `ref` and
 * `collapsable` go on an outer view that is always opaque; only the inner view, which holds
 * the card, turns transparent. Anything else handed down (DraggableCard's test-mode `onPress`)
 * goes on to the card itself.
 */
import React from "react";
import { StyleSheet, View } from "react-native";

export interface TransparentFaceProps {
  /** Draw the card transparent (its label, testID and touch target stay). */
  readonly hidden: boolean;
  readonly children: React.ReactElement;
  /** The gesture's view (cloned on by GestureDetector). */
  readonly ref?: React.Ref<View>;
  readonly collapsable?: boolean;
  readonly [prop: string]: unknown;
}

export function TransparentFace({
  hidden,
  children,
  ref,
  collapsable,
  ...passed
}: TransparentFaceProps) {
  const card =
    Object.keys(passed).length > 0
      ? React.cloneElement(children as React.ReactElement<Record<string, unknown>>, passed)
      : children;
  return (
    <View ref={ref} collapsable={collapsable}>
      {/* Never flattened, so turning it transparent never re-parents the card's native view. */}
      <View collapsable={false} style={hidden ? styles.hidden : undefined}>
        {card}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hidden: {
    opacity: 0,
  },
});
