import React from "react";
import { View, Text, StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { useTranslation } from "react-i18next";
import { useNetwork } from "../../game/_shared/NetworkContext";
import { useTheme } from "../../theme/ThemeContext";

interface Props {
  /** Override the default message. Defaults to common:network.offlineBanner. */
  message?: string;
}

/** The offline notice. Presentational: render it only when offline. */
export function OfflineBanner({ message }: Props) {
  const { t } = useTranslation("common");
  const { colors } = useTheme();

  return (
    <View
      style={[styles.banner, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
    >
      <Text style={[styles.text, { color: colors.textMuted }]}>
        {message ?? t("network.offlineBanner")}
      </Text>
    </View>
  );
}

export interface ConnectedOfflineBannerProps extends Props {
  /** Wrapper style, for margins or absolute placement. */
  style?: StyleProp<ViewStyle>;
}

/**
 * OfflineBanner driven by NetworkContext. Renders nothing while network state
 * is still initializing, so users don't see a flash of "offline" on boot.
 */
export function ConnectedOfflineBanner({ message, style }: ConnectedOfflineBannerProps) {
  const { isOnline, isInitialized } = useNetwork();
  if (!isInitialized || isOnline) return null;
  return (
    <View style={style}>
      <OfflineBanner message={message} />
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    width: "100%",
  },
  text: {
    fontSize: 13,
    textAlign: "center",
  },
});
