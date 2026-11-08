import React, { useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../theme/ThemeContext";
import type { PassDirection } from "../../game/hearts/types";

interface Props {
  passDirection: PassDirection;
  selectedCount: number;
  onConfirm: () => void;
  /** Placement override: the banner sits inside the felt on the card table (#3587). */
  style?: StyleProp<ViewStyle>;
}

/** Under this width the "N of 3 selected" line is dropped: the prompt needs the room. */
export const NARROW_BANNER_WIDTH = 260;

export default function PassBanner({ passDirection, selectedCount, onConfirm, style }: Props) {
  const { t } = useTranslation("hearts");
  const { colors } = useTheme();

  const direction = t(`pass.direction.${passDirection}`);
  const canConfirm = selectedCount === 3;
  // Unknown until measured: shown, as in a test or the first frame.
  const [narrow, setNarrow] = useState(false);
  const onLayout = (e: LayoutChangeEvent) =>
    setNarrow(e.nativeEvent.layout.width < NARROW_BANNER_WIDTH);

  return (
    <View
      style={[
        styles.banner,
        { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
        style,
      ]}
      testID="hearts-pass-banner"
      onLayout={onLayout}
      accessibilityLiveRegion="polite"
    >
      <View style={styles.text}>
        <Text style={[styles.prompt, { color: colors.text }]} numberOfLines={2}>
          {t("pass.instructions", { direction })}
        </Text>
        {/* On a narrow banner the count lives in the Confirm label; the picked cards are lifted. */}
        {!narrow && (
          <Text
            numberOfLines={1}
            style={[styles.counter, { color: canConfirm ? colors.accent : colors.textMuted }]}
          >
            {t("pass.selected", { count: selectedCount })}
          </Text>
        )}
      </View>
      <Pressable
        onPress={canConfirm ? onConfirm : undefined}
        disabled={!canConfirm}
        testID="hearts-pass-confirm"
        accessibilityLabel={t("pass.confirmLabel", { count: selectedCount })}
        accessibilityRole="button"
        accessibilityState={{ disabled: !canConfirm }}
        style={styles.buttonWrap}
      >
        <LinearGradient
          colors={[colors.accent, colors.accentBright]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={[styles.button, !canConfirm && styles.buttonDisabled]}
        >
          <Text numberOfLines={1} style={[styles.buttonText, { color: colors.textOnAccent }]}>
            {t("pass.confirm")}
          </Text>
        </LinearGradient>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden",
    paddingVertical: 6,
    paddingHorizontal: 14,
    marginHorizontal: 12,
    marginBottom: 8,
  },
  text: {
    flex: 1,
    gap: 2,
  },
  prompt: {
    fontSize: 14,
    lineHeight: 17,
    fontWeight: "700",
  },
  counter: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  buttonWrap: {
    borderRadius: 999,
    overflow: "hidden",
  },
  button: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonDisabled: {
    opacity: 0.35,
  },
  buttonText: {
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
});
