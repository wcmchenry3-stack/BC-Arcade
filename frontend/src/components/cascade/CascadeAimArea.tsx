/**
 * #3928: the board's touch area. Press, drag and release aim and drop the next piece
 * (`useAimGesture`); a quick tap drops at once, as tap-to-drop always did. `cascade-game-area`
 * stays its testID, so Maestro's `tapOn` and the e2e helpers reach it as before.
 *
 * #3934 (web only): the area is a tab stop with a focus ring; Left / Right / Shift / Space /
 * Enter / Escape aim and drop it (`useAimKeyboard`), through the same aim values and drop path.
 */
import React, { useCallback, type ReactNode } from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import type { BoardMotion } from "./useBoardMotion";
import { useAimGesture } from "./useAimGesture";
import { useAimKeyboard } from "./useAimKeyboard";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../theme/ThemeContext";
import { AIM_STATE } from "../../game/cascade/aim";

export interface CascadeAimAreaProps {
  readonly style: ViewStyle & { width: number; height: number };
  readonly motion: BoardMotion;
  readonly scale: number;
  readonly enabled: boolean;
  /** The screen's drop path; false when a gate refused the drop. */
  readonly onDrop: (worldX: number) => boolean;
  readonly onDragStart: () => void;
  readonly children: ReactNode;
}

export default function CascadeAimArea({
  style,
  motion,
  scale,
  enabled,
  onDrop,
  onDragStart,
  children,
}: CascadeAimAreaProps) {
  const { values, wake } = motion;
  // A refused aimed release (the cooldown, the lid): the piece glides back to the ring, as on a
  // cancel (review N4). The UI thread stamps the start (`aimAt` NaN: "now", `useBoardMotion`).
  const drop = useCallback(
    (x: number, aimed: boolean) => {
      if (onDrop(x) || !aimed) return;
      values.aimFromX.set(x);
      values.aimState.set(AIM_STATE.cancelled);
      values.aimAt.set(Number.NaN);
      wake();
    },
    [onDrop, values, wake]
  );
  const gesture = useAimGesture({
    values,
    wake,
    scale,
    enabled,
    onDrop: drop,
    onDragStart,
  });
  const { colors } = useTheme();
  const { t } = useTranslation("cascade");
  const { attach, focusVisible, webKeyboard } = useAimKeyboard({
    values,
    wake,
    enabled,
    onDrop: drop,
  });
  return (
    <GestureDetector gesture={gesture}>
      <View
        testID="cascade-game-area"
        style={style}
        collapsable={false}
        ref={attach}
        tabIndex={webKeyboard ? 0 : undefined}
        // The web tab stop is named for screen readers (#3934); native is unchanged.
        role={webKeyboard ? "group" : undefined}
        aria-label={webKeyboard ? t("a11y.board") : undefined}
      >
        {children}
        {focusVisible && (
          <View
            testID="cascade-focus-ring"
            pointerEvents="none"
            style={[styles.focusRing, { borderColor: colors.accentText }]}
          />
        )}
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  // Inside the board's edge (the area clips nothing, but the page may), 3:1 on the page surface.
  focusRing: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderWidth: 3,
    borderRadius: 4,
  },
});
