import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../theme/ThemeContext";
import { typography } from "../../theme/typography";
import type { PlateGeometry } from "../../game/hearts/layout";

interface Props {
  /** The seat's display name (a player may have renamed it). */
  name: string;
  /** The game score so far. */
  score: number;
  /** Penalty points taken so far this hand; shown as "+N♥" once above 0. */
  handPoints: number;
  /** True while it is this seat's turn to play: an accent border and glow. */
  isTurn: boolean;
  /** The human's own plate: its label says "your turn", not "their turn". */
  isSelf?: boolean;
  /** Where the plate sits and how wide it may grow. */
  plate: PlateGeometry;
  height: number;
  /** Opens the cards this seat has taken. */
  onPress: () => void;
  testID?: string;
}

/**
 * A seat's name plate on the card table (#3587): name, game score, this hand's points and a
 * turn glow. The whole plate is one control that opens the seat's captured cards, with one
 * accessibility label that says all of it, so a screen reader hears the table state.
 */
export default function SeatPlate({
  name,
  score,
  handPoints,
  isTurn,
  isSelf = false,
  plate,
  height,
  onPress,
  testID,
}: Props) {
  const { t } = useTranslation("hearts");
  const { colors } = useTheme();

  const hasPoints = handPoints > 0;
  const turnKey = hasPoints
    ? isSelf
      ? "plate.labelPointsYourTurn"
      : "plate.labelPointsTurn"
    : isSelf
      ? "plate.labelYourTurn"
      : "plate.labelTurn";
  const labelKey = isTurn ? turnKey : hasPoints ? "plate.labelPoints" : "plate.label";
  const label = t(labelKey, { name, score, points: handPoints });

  const align =
    plate.anchor === "left" ? "flex-start" : plate.anchor === "right" ? "flex-end" : "center";

  return (
    <View
      testID={testID ? `${testID}-slot` : undefined}
      pointerEvents="box-none"
      style={[
        styles.slot,
        { left: plate.rect.x, top: plate.rect.y, width: plate.rect.w, alignItems: align },
      ]}
    >
      <Pressable
        testID={testID}
        onPress={onPress}
        hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={t("plate.hint")}
        style={[
          styles.plate,
          {
            minHeight: height,
            backgroundColor: colors.surfaceAlt,
            borderColor: isTurn ? colors.accent : colors.border,
            maxWidth: plate.rect.w,
          },
          isTurn && {
            shadowColor: colors.accent,
            shadowOpacity: 0.45,
            shadowRadius: 10,
            shadowOffset: { width: 0, height: 0 },
            // No Android elevation: it would draw the plate above the trick cards sweeping to it.
          },
        ]}
      >
        <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
          {name}
        </Text>
        <Text style={[styles.score, { color: colors.text }]}>{score}</Text>
        {hasPoints && (
          <Text style={[styles.points, { color: colors.errorText }]}>{`+${handPoints}♥`}</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  slot: {
    position: "absolute",
  },
  plate: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
  },
  name: {
    flexShrink: 1,
    fontSize: 12,
    fontFamily: typography.label,
  },
  score: {
    fontSize: 15,
    fontFamily: typography.heading,
  },
  points: {
    fontSize: 12,
    fontFamily: typography.label,
  },
});
