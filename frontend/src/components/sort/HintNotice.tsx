/**
 * HintNotice — the small, dismissible notice Sort shows in the play area when
 * Hint has no pour to offer (#2768).
 *
 *   - "dead": the solver proved the board can't be won. Offers "Undo to a
 *     winnable board" (when there is history to step back through) and
 *     "Restart level".
 *   - "unknown": the solver ran out of budget. A plain message, no actions.
 *
 * Presentational and static (no animation, so nothing to gate on Reduce
 * Motion). It sits between the HUD and the board, never over the board, and
 * is announced to screen readers when it appears.
 */

import React, { useEffect } from "react";
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../theme/ThemeContext";
import { typography } from "../../theme/typography";

export type HintNoticeKind = "dead" | "unknown";

interface Props {
  kind: HintNoticeKind;
  /** Whether there is a move to step back from; hides "Undo to a winnable board" when not. */
  canUndo: boolean;
  /** Disables the actions while a search back through the history runs. */
  busy?: boolean;
  onUndoToWinnable: () => void;
  onRestart: () => void;
  onDismiss: () => void;
}

export default function HintNotice({
  kind,
  canUndo,
  busy = false,
  onUndoToWinnable,
  onRestart,
  onDismiss,
}: Props) {
  const { t } = useTranslation("sort");
  const { colors } = useTheme();
  const message = kind === "dead" ? t("hint.noWin") : t("hint.unknown");

  // Live regions are not announced on iOS, so say it explicitly as well.
  useEffect(() => {
    AccessibilityInfo.announceForAccessibility?.(message);
  }, [message]);

  return (
    <View
      style={[styles.box, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
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
      {kind === "dead" && (
        <View style={styles.actions}>
          {canUndo && (
            <Pressable
              onPress={onUndoToWinnable}
              disabled={busy}
              style={[styles.action, { borderColor: colors.accent, opacity: busy ? 0.4 : 1 }]}
              accessibilityRole="button"
              accessibilityLabel={t("hint.undoToWinnable")}
              accessibilityState={{ disabled: busy, busy }}
              testID="sort-hint-undo"
            >
              <Text style={[styles.actionText, { color: colors.accent }]}>
                {t("hint.undoToWinnable")}
              </Text>
            </Pressable>
          )}
          <Pressable
            onPress={onRestart}
            disabled={busy}
            style={[styles.action, { borderColor: colors.accent, opacity: busy ? 0.4 : 1 }]}
            accessibilityRole="button"
            accessibilityLabel={t("hint.restartLevel")}
            accessibilityState={{ disabled: busy, busy }}
            testID="sort-hint-restart"
          >
            <Text style={[styles.actionText, { color: colors.accent }]}>
              {t("hint.restartLevel")}
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    marginHorizontal: 12,
    marginTop: 4,
    paddingLeft: 12,
    borderWidth: 1,
    borderRadius: 12,
  },
  topRow: { flexDirection: "row", alignItems: "center" },
  message: { flex: 1, fontFamily: typography.label, fontSize: 14, paddingVertical: 8 },
  // 44 x 44 pt touch target.
  dismiss: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  dismissGlyph: { fontSize: 24, lineHeight: 26 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingBottom: 8, paddingRight: 12 },
  action: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
  },
  actionText: { fontFamily: typography.label, fontSize: 13, textAlign: "center" },
});
