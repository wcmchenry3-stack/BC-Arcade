import React, { useEffect } from "react";
import { AccessibilityInfo, Platform, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../theme/ThemeContext";

export const THANKS_BANNER_DURATION_MS = 4000;

interface Props {
  visible: boolean;
  /** Keep this identity stable (useCallback), or the timer restarts on re-render. */
  onDismiss: () => void;
}

/**
 * Self-dismissing thank-you shown after feedback is sent (#2928). It has no
 * button to tap and no animation: it is removed by a timer, so it works the
 * same with reduce-motion on. It is non-interactive (`pointerEvents="none"`)
 * so it never blocks the screen underneath.
 *
 * Android announces the polite live region; iOS ignores `accessibilityLiveRegion`,
 * so the text is also announced explicitly.
 */
export default function FeedbackThanksBanner({ visible, onDismiss }: Props) {
  const { t } = useTranslation("feedback");
  const { colors } = useTheme();
  const message = t("submit_success");

  useEffect(() => {
    if (!visible) return;
    // Android's polite live region already announces; announcing here too would repeat it.
    if (Platform.OS === "ios") AccessibilityInfo.announceForAccessibility(message);
    const timer = setTimeout(onDismiss, THANKS_BANNER_DURATION_MS);
    return () => clearTimeout(timer);
  }, [visible, message, onDismiss]);

  if (!visible) return null;
  return (
    <View
      pointerEvents="none"
      style={[styles.container, { backgroundColor: colors.text }]}
      accessibilityLiveRegion="polite"
      testID="feedback-thanks-banner"
    >
      <Text style={[styles.text, { color: colors.background }]}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    top: "100%",
    marginTop: 8,
    alignSelf: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    zIndex: 100,
    // Android orders by elevation over zIndex; keep above screen content.
    elevation: 8,
    maxWidth: 320,
  },
  text: {
    fontSize: 13,
    fontWeight: "700",
    textAlign: "center",
  },
});
