/**
 * The action bar under a game's board (#3614, #3688): icon-over-label buttons at least 44 x 44 pt,
 * in thumb reach above the tab bar. Mahjong (Undo, Hint, Shuffle) and 2048 (Hint, New Game) share
 * it, so a Hint button looks and sits the same in every game that has one. A button may carry a
 * badge (Mahjong's shuffles left) and a spoken value. A toggle (Sudoku's Notes, #3773) shows its
 * on state as a tinted, ringed chip and `accessibilityState.selected`.
 */
import React from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useTheme } from "../../theme/ThemeContext";
import { typography } from "../../theme/typography";
import { PILL_DISABLED_OPACITY } from "./PillButton";

/** The bar has a fixed height; its small labels and badge grow with font size up to this. */
const MAX_FONT_SCALE = 1.3;

/**
 * Below this width per action (a 5-action bar on a 320 pt phone is ~59 pt each), the label shrinks
 * to 9 pt with little letter-spacing and stays on one line (a translated word of up to ~12 capitals
 * fits; on native `adjustsFontSizeToFit` takes a longer one down a little more) (#3773).
 */
const NARROW_ACTION_WIDTH = 64;

export interface GameBarAction {
  readonly key: string;
  readonly icon: React.ComponentProps<typeof MaterialIcons>["name"];
  readonly label: string;
  readonly accessibilityLabel: string;
  readonly color: string;
  readonly disabled?: boolean;
  /** A long action is running (Sort's Hint solver, #3658): a spinner replaces the icon and the button is inert. */
  readonly busy?: boolean;
  readonly onPress: () => void;
  readonly testID: string;
  readonly badge?: number;
  readonly accessibilityValue?: string;
  /**
   * A toggle's on state (Sudoku's Notes, #3773). Omit for a plain action. On draws a tinted chip with
   * a ring in `color` behind the button, and the button reports `accessibilityState.selected`.
   * `color` must be a `#rrggbb` token, as the tint is `color` at 15% alpha.
   */
  readonly selected?: boolean;
}

function Action({
  icon,
  label,
  accessibilityLabel,
  color,
  disabled = false,
  busy,
  onPress,
  testID,
  badge,
  accessibilityValue,
  selected,
  narrow,
}: Omit<GameBarAction, "key"> & { narrow: boolean }) {
  const { colors } = useTheme();
  const inactive = disabled || busy === true;
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{
        ...(busy === undefined ? { disabled } : { disabled: inactive, busy }),
        ...(selected === undefined ? null : { selected }),
      }}
      accessibilityValue={accessibilityValue ? { text: accessibilityValue } : undefined}
      testID={testID}
      hitSlop={4}
      style={({ pressed }) => [
        styles.action,
        selected !== undefined && [
          styles.toggle,
          selected && { backgroundColor: `${color}26`, borderColor: color },
        ],
        { opacity: inactive ? PILL_DISABLED_OPACITY : pressed ? 0.7 : 1 },
        // The pressed dip (#3774): press feedback, not motion, so Reduce Motion keeps it.
        pressed && !inactive && styles.pressed,
      ]}
    >
      <View>
        {busy ? (
          <ActivityIndicator
            size="small"
            color={color}
            style={styles.spinner}
            testID={`${testID}-busy`}
          />
        ) : (
          <MaterialIcons name={icon} size={26} color={color} />
        )}
        {badge !== undefined && (
          <View style={[styles.badge, { backgroundColor: color }]} testID={`${testID}-badge`}>
            <Text
              style={[styles.badgeText, { color: colors.textOnAccent }]}
              maxFontSizeMultiplier={MAX_FONT_SCALE}
            >
              {badge}
            </Text>
          </View>
        )}
      </View>
      <Text
        style={[styles.label, narrow && styles.labelNarrow, { color }]}
        numberOfLines={narrow ? 1 : 2}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
        maxFontSizeMultiplier={MAX_FONT_SCALE}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export interface GameActionBarProps {
  readonly actions: readonly GameBarAction[];
  readonly height: number;
  readonly testID: string;
  /** A hairline above the bar (default). Off when the bar sits inside a card beside other controls (Yacht's tray). */
  readonly bordered?: boolean;
}

export default function GameActionBar({
  actions,
  height,
  testID,
  bordered = true,
}: GameActionBarProps) {
  const { colors } = useTheme();
  const [narrow, setNarrow] = React.useState(false);
  const onLayout = React.useCallback(
    (e: LayoutChangeEvent) => {
      const next = e.nativeEvent.layout.width / actions.length < NARROW_ACTION_WIDTH;
      setNarrow((was) => (was === next ? was : next));
    },
    [actions.length]
  );
  return (
    <View
      onLayout={onLayout}
      style={[
        styles.bar,
        { height },
        bordered && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
      ]}
      testID={testID}
      accessibilityRole="toolbar"
    >
      {actions.map(({ key, ...action }) => (
        <Action key={key} {...action} narrow={narrow} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "stretch",
  },
  action: {
    flex: 1,
    minHeight: 52,
    minWidth: 44,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  pressed: { transform: [{ scale: 0.94 }] },
  // A toggle keeps a transparent ring when off, so switching it does not move the button.
  toggle: { borderRadius: 12, borderWidth: 1.5, borderColor: "transparent" },
  // The spinner takes the icon box so the bar does not shift while busy.
  spinner: { width: 26, height: 26 },
  label: {
    fontFamily: typography.label,
    fontSize: 11,
    letterSpacing: 0.9,
    textTransform: "uppercase",
    textAlign: "center",
  },
  labelNarrow: {
    fontSize: 9,
    letterSpacing: 0.2,
  },
  badge: {
    position: "absolute",
    top: -6,
    right: -12,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: {
    fontFamily: typography.label,
    fontSize: 11,
  },
});
