import React from "react";
import { StyleSheet, View } from "react-native";
import MaterialCommunityIcons from "../icons/MaterialCommunityIcons";
import { useTheme } from "../../theme/ThemeContext";
import { MAX_STARS, type BestStars } from "../../game/sort/stars";

interface Props {
  readonly stars: BestStars;
  readonly size: number;
  readonly testID?: string;
}

/**
 * Three stars, `stars` of them filled (#3687). The filled and the outlined
 * star differ in shape, so the count never rests on colour alone. Decorative:
 * the parent carries the screen-reader label.
 */
export function StarRow({ stars, size, testID }: Props) {
  const { colors } = useTheme();
  return (
    <View
      testID={testID}
      style={styles.row}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {Array.from({ length: MAX_STARS }, (_, i) => {
        const filled = i < stars;
        return (
          <MaterialCommunityIcons
            key={i}
            testID={testID ? `${testID}-${i}-${filled ? "filled" : "empty"}` : undefined}
            name={filled ? "star" : "star-outline"}
            size={size}
            color={filled ? colors.celebration : colors.textMuted}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", justifyContent: "center" },
});
