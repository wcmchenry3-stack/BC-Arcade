/**
 * HintNotice — the small, dismissible notice Sort shows in the play area when
 * Hint has no pour to offer (#2768).
 *
 *   - "dead": the solver proved the board can't be won. Offers the actions the
 *     caller passes: "Back to last good move" and "Restart level".
 *   - "unknown": the solver ran out of budget. A plain message, no actions.
 *
 * An overlay: it is absolutely positioned at the top of its (positioned)
 * parent, so showing or dismissing it never changes the board's layout. Static
 * (no animation, so nothing to gate on Reduce Motion). Announced to screen
 * readers when it mounts: remount it (change its `key`) to announce it again.
 */

import React, { useEffect } from "react";
import { AccessibilityInfo, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../theme/ThemeContext";
import { typography } from "../../theme/typography";

export type HintNoticeKind = "dead" | "unknown";

interface Props {
  kind: HintNoticeKind;
  /** Shows "Back to last good move"; omit when there is nothing to step back to. */
  onBackToLastGoodMove?: () => void;
  /** Shows "Restart level"; omit to hide it. Neither is shown for "unknown". */
  onRestart?: () => void;
  /** Disables the actions while a search back through the history runs. */
  busy?: boolean;
  onDismiss: () => void;
}

export default function HintNotice({
  kind,
  onBackToLastGoodMove,
  onRestart,
  busy = false,
  onDismiss,
}: Props) {
  const { t } = useTranslation("sort");
  const { colors } = useTheme();
  const message = kind === "dead" ? t("hint.noWin") : t("hint.unknown");

  // iOS doesn't read live regions, so announce there; Android and web use the
  // live region, so announcing too would say it twice.
  useEffect(() => {
    if (Platform.OS === "ios") AccessibilityInfo.announceForAccessibility(message);
  }, [message]);

  const showUndo = kind === "dead" && !!onBackToLastGoodMove;
  const showRestart = kind === "dead" && !!onRestart;

  return (
    <View
      style={[styles.box, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}
      accessibilityRole="alert"
      accessibilityLiveRegion={Platform.OS === "ios" ? undefined : "polite"}
      testID="sort-hint-notice"
    >
      <View style={styles.topRow}>
        <Text style={[styles.message, { color: colors.text }]}>{message}</Text>
        <Pressable
          onPress={onDismiss}
          style={styles.dismiss}
          accessibilityRole="button"
          accessibilityLabel={t("hint.dismiss")}
          testID="sort-hint-dismiss"
        >
          <Text style={[styles.dismissGlyph, { color: colors.textMuted }]}>{"×"}</Text>
        </Pressable>
      </View>
      {(showUndo || showRestart) && (
        <View style={styles.actions}>
          {showUndo && (
            <Pressable
              onPress={onBackToLastGoodMove}
              disabled={busy}
              style={[styles.action, { borderColor: colors.accent, opacity: busy ? 0.4 : 1 }]}
              accessibilityRole="button"
              accessibilityLabel={t("hint.backToLastGoodMove")}
              accessibilityState={{ disabled: busy, busy }}
              testID="sort-hint-undo"
            >
              <Text style={[styles.actionText, { color: colors.accentText }]}>
                {t("hint.backToLastGoodMove")}
              </Text>
            </Pressable>
          )}
          {showRestart && (
            <Pressable
              onPress={onRestart}
              disabled={busy}
              style={[styles.action, { borderColor: colors.accent, opacity: busy ? 0.4 : 1 }]}
              accessibilityRole="button"
              accessibilityLabel={t("hint.restartLevel")}
              accessibilityState={{ disabled: busy, busy }}
              testID="sort-hint-restart"
            >
              <Text style={[styles.actionText, { color: colors.accentText }]}>
                {t("hint.restartLevel")}
              </Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    position: "absolute",
    top: 0,
    left: 12,
    right: 12,
    zIndex: 10,
    elevation: 10,
    paddingStart: 12,
    borderWidth: 1,
    borderRadius: 12,
  },
  topRow: { flexDirection: "row", alignItems: "center" },
  message: { flex: 1, fontFamily: typography.label, fontSize: 14, paddingVertical: 8 },
  // 44 x 44 pt touch target.
  dismiss: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  dismissGlyph: { fontSize: 24, lineHeight: 26 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingBottom: 8, paddingEnd: 12 },
  action: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
  },
  actionText: { fontFamily: typography.label, fontSize: 13, textAlign: "center" },
});
