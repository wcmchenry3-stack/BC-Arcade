/**
 * FeltTable (#3606) — the rounded green felt a card board sits on.
 *
 * Shared by Solitaire and FreeCell (#3607). It draws only the surface (a vignette
 * from the edge colour to the centre colour, and a rim); the board's own layout
 * is the children's. Pass `onLayout` to learn the felt's real size, so the board
 * can be sized to it (`game/_shared/cards/tableLayout.ts`).
 */

import React from "react";
import {
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";

import { useTheme } from "../../theme/ThemeContext";
import {
  TABLE_FELT_BORDER_DARK,
  TABLE_FELT_BORDER_LIGHT,
  TABLE_FELT_CENTRE_DARK,
  TABLE_FELT_CENTRE_LIGHT,
  TABLE_FELT_EDGE_DARK,
  TABLE_FELT_EDGE_LIGHT,
} from "../../theme/theme.table";

/** Corner radius of the felt, in dp. */
export const FELT_RADIUS = 22;

export interface FeltTableProps {
  readonly children?: React.ReactNode;
  readonly style?: StyleProp<ViewStyle>;
  readonly onLayout?: (event: LayoutChangeEvent) => void;
  readonly testID?: string;
  readonly accessibilityLabel?: string;
}

export function FeltTable({
  children,
  style,
  onLayout,
  testID,
  accessibilityLabel,
}: FeltTableProps) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const centre = dark ? TABLE_FELT_CENTRE_DARK : TABLE_FELT_CENTRE_LIGHT;
  const edge = dark ? TABLE_FELT_EDGE_DARK : TABLE_FELT_EDGE_LIGHT;
  const border = dark ? TABLE_FELT_BORDER_DARK : TABLE_FELT_BORDER_LIGHT;

  return (
    <View
      style={[styles.felt, { backgroundColor: centre, borderColor: border }, style]}
      onLayout={onLayout}
      testID={testID}
      accessibilityLabel={accessibilityLabel}
    >
      <LinearGradient
        pointerEvents="none"
        colors={[centre, edge]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={[StyleSheet.absoluteFill, styles.gradient]}
      />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  felt: {
    borderRadius: FELT_RADIUS,
    borderWidth: 1,
  },
  gradient: {
    borderRadius: FELT_RADIUS,
  },
});
