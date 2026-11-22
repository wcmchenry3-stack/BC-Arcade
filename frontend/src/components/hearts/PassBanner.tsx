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
import {
  BANNER_COUNTER_LINE_H,
  BANNER_DIRECTION_LINE_H,
  BANNER_FRAME_V,
  BANNER_TEXT_GAP,
  BANNER_TITLE_LINE_H,
  NARROW_BANNER_WIDTH,
} from "../../game/hearts/layout";
import type { PassDirection } from "../../game/hearts/types";

interface Props {
  passDirection: PassDirection;
  selectedCount: number;
  onConfirm: () => void;
  /** Placement override: the banner sits inside the felt on the card table (#3587). */
  style?: StyleProp<ViewStyle>;
  /** The banner is narrower than `NARROW_BANNER_WIDTH`. Known from the geometry, so there is no
   *  wide-then-narrow frame; when omitted it is measured (`onLayout`). */
  narrow?: boolean;
  /** The banner is tall enough for the "N of 3 selected" line (`COUNTER_MIN_BANNER_H`). */
  roomForCounter?: boolean;
}

export default function PassBanner({
  passDirection,
  selectedCount,
  onConfirm,
  style,
  narrow: narrowProp,
  roomForCounter = true,
}: Props) {
  const { t } = useTranslation("hearts");
  const { colors } = useTheme();

  const direction = t(`pass.direction.${passDirection}`);
  const canConfirm = selectedCount === 3;
  // Measured only when the caller does not know the width; wide until then.
  const [measuredNarrow, setMeasuredNarrow] = useState(false);
  const onLayout = (e: LayoutChangeEvent) =>
    setMeasuredNarrow(e.nativeEvent.layout.width < NARROW_BANNER_WIDTH);
  const narrow = narrowProp ?? measuredNarrow;
  const showCounter = !narrow && roomForCounter;

  return (
    <View
      style={[
        styles.banner,
        { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
        narrow && styles.bannerNarrow,
        style,
      ]}
      testID="hearts-pass-banner"
      onLayout={narrowProp === undefined ? onLayout : undefined}
      accessibilityLiveRegion="polite"
    >
      <View style={styles.text}>
        {/* Two lines, so the pass direction always has a line of its own, in every language. */}
        <Text
          style={[styles.prompt, { color: colors.text }]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.8}
        >
          {t("pass.title")}
        </Text>
        <Text
          style={[styles.direction, { color: colors.text }]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.8}
        >
          {direction}
        </Text>
        {/* Without room the count is not drawn but stays in the live region for a screen reader. */}
        <Text
          numberOfLines={1}
          style={[
            styles.counter,
            { color: canConfirm ? colors.accentText : colors.textMuted },
            !showCounter && styles.srOnly,
          ]}
        >
          {t("pass.selected", { count: selectedCount })}
        </Text>
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
          style={[
            styles.button,
            narrow && styles.buttonNarrow,
            !canConfirm && styles.buttonDisabled,
          ]}
        >
          <Text
            numberOfLines={1}
            style={[
              styles.buttonText,
              narrow && styles.buttonTextNarrow,
              { color: colors.textOnAccent },
            ]}
          >
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
    paddingVertical: BANNER_FRAME_V / 2,
    paddingHorizontal: 14,
    marginHorizontal: 12,
    marginBottom: 8,
  },
  text: {
    flex: 1,
    gap: BANNER_TEXT_GAP,
  },
  prompt: {
    fontSize: 14,
    lineHeight: BANNER_TITLE_LINE_H,
    fontWeight: "700",
  },
  direction: {
    fontSize: 13,
    lineHeight: BANNER_DIRECTION_LINE_H,
    fontWeight: "700",
  },
  srOnly: {
    position: "absolute",
    width: 1,
    height: 1,
    overflow: "hidden",
    opacity: 0,
  },
  counter: {
    fontSize: 11,
    lineHeight: BANNER_COUNTER_LINE_H,
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
  // Narrow: a tighter frame and button, so the prompt keeps the room for the pass direction.
  bannerNarrow: {
    paddingHorizontal: 10,
  },
  buttonNarrow: {
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  buttonTextNarrow: {
    fontSize: 11,
    letterSpacing: 0.2,
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
