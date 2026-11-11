import React from "react";
import { Image, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../theme/ThemeContext";
import { SHIP_IDS } from "../../game/starswarm/render/ship";
import type { ShipId } from "../../game/starswarm/render/ship";
import { SHIP_BASE_IMAGE } from "./hudImages";

/** The preview of each ship: its base layer (the hull, no guns or plating). */
const PREVIEW: Readonly<Record<ShipId, number>> = SHIP_BASE_IMAGE;

/** The preview's edge, dp. The layer image is square with a transparent margin round the hull. */
const PREVIEW_SIZE = 60;

export interface ShipPickerProps {
  value: ShipId;
  onChange: (ship: ShipId) => void;
}

/**
 * #3600: the pre-game ship choice, a row of three tiles above the difficulty picker. The ships
 * are cosmetic and free; a tile is a radio of a group.
 */
export default function ShipPicker({ value, onChange }: ShipPickerProps) {
  const { t } = useTranslation("starswarm");
  const { colors } = useTheme();
  // Narrow phones (320 px) get a smaller picture and tighter tiles so a whole word fits a line
  const narrow = useWindowDimensions().width < 360;
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={t("ship.title")}
      testID="starswarm-ship-picker"
      style={styles.wrap}
    >
      <Text
        style={[styles.title, { color: colors.textMuted }]}
        importantForAccessibility="no"
        accessibilityElementsHidden
      >
        {t("ship.title")}
      </Text>
      <View style={styles.row}>
        {SHIP_IDS.map((id) => {
          const selected = id === value;
          const name = t(`ship.${id}`);
          return (
            <Pressable
              key={id}
              onPress={() => onChange(id)}
              accessibilityRole="radio"
              accessibilityLabel={name}
              accessibilityState={{ checked: selected }}
              aria-checked={selected}
              testID={`starswarm-ship-${id}`}
              style={[
                styles.tile,
                {
                  backgroundColor: colors.surface,
                  borderColor: selected ? colors.accent : colors.border,
                },
                selected && styles.tileSelected,
              ]}
            >
              <Image
                source={PREVIEW[id]}
                style={narrow ? styles.previewNarrow : styles.preview}
                resizeMode="contain"
                accessible={false}
                importantForAccessibility="no"
              />
              <Text
                style={[styles.name, { color: selected ? colors.accent : colors.text }]}
                maxFontSizeMultiplier={1.1}
                numberOfLines={2}
              >
                {name}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: "100%",
    marginBottom: 12,
    gap: 6,
  },
  title: {
    fontSize: 13,
    fontWeight: "600",
    textAlign: "center",
  },
  row: {
    flexDirection: "row",
    gap: 8,
  },
  // flex: 1 with minWidth 0: three tiles share any width (320 px included) and the name wraps
  tile: {
    flex: 1,
    minWidth: 0,
    alignItems: "center",
    justifyContent: "flex-start",
    paddingVertical: 8,
    paddingHorizontal: 2,
    borderWidth: 1,
    borderRadius: 8,
    gap: 4,
  },
  tileSelected: {
    borderWidth: 2,
    paddingVertical: 7,
    paddingHorizontal: 1,
  },
  preview: {
    width: PREVIEW_SIZE,
    height: PREVIEW_SIZE,
  },
  previewNarrow: {
    width: 48,
    height: 48,
  },
  // Words wrap whole; the tile is wide enough for the longest name at 1.1x (no mid-word breaks)
  name: {
    fontSize: 12,
    fontWeight: "600",
    textAlign: "center",
  },
});
