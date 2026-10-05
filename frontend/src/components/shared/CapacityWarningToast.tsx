/**
 * CapacityWarningToast — #483 (blocker for #373 scenario 6).
 *
 * Subscribes to `eventStore.onStats()` and, after each change to the queue,
 * asks `eventStore.shouldShowCapacityWarning(stats)` whether the banner is
 * due (#2959) — a check against the stats it was just handed, so no timer
 * runs and nothing re-reads the queue. One check also runs on mount and on
 * every return to the foreground. The banner shows once the queue crosses
 * the 80% fill ratio; Dismiss marks the warning shown, which activates the
 * 24h suppression window inside eventStore.markWarningShown().
 *
 * Test builds (EXPO_PUBLIC_TEST_HOOKS=1 at build time) also poll the check
 * every 500 ms, which the scenario 6 e2e spec drives its foreground/dismiss
 * cycles against; production builds never poll.
 *
 * Mount this once at a provider level (NetworkContext) — it's a
 * cross-app concern, not per-screen. The component positions itself
 * absolutely at the top of the screen with a high zIndex so it
 * overlays any child screen without needing navigation context.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { AppState, AppStateStatus, View, Text, StyleSheet, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import * as Sentry from "@sentry/react-native";
import { useTheme } from "../../theme/ThemeContext";
import { isAppInterrupted } from "../../game/_shared/appInterrupted";
import { eventStore, QueueStats, StatsListener } from "../../game/_shared/eventStore";

/**
 * Poll interval for the check; 0 means no polling. Production builds never
 * poll — the `onStats` subscription reacts to every change. Test builds (set
 * via EXPO_PUBLIC_TEST_HOOKS=1 at build time) poll every 500 ms as well, so
 * the scenario 6 e2e spec can wait for a cycle instead of a queue change.
 */
const POLL_INTERVAL_MS = process.env.EXPO_PUBLIC_TEST_HOOKS === "1" ? 500 : 0;

interface Props {
  /**
   * Optional override for the check function — lets unit tests supply
   * a synchronous stub without mocking the whole eventStore singleton.
   * Production code never passes this. Receives the stats that triggered
   * the check when a queue change did.
   */
  shouldShowCheck?: (stats?: QueueStats) => Promise<boolean>;
  /** Optional override for the "mark shown" side effect. */
  markShown?: () => Promise<void>;
  /** Poll interval in ms; 0 disables polling. Tests of the poll path pass one. */
  pollIntervalMs?: number;
  /** Optional override for the stats subscription (defaults to `eventStore.onStats`). */
  subscribe?: (listener: StatsListener) => () => void;
}

export function CapacityWarningToast({
  shouldShowCheck,
  markShown,
  pollIntervalMs = POLL_INTERVAL_MS,
  subscribe,
}: Props = {}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation("common");
  const [visible, setVisible] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const check =
    shouldShowCheck ?? ((stats?: QueueStats) => eventStore.shouldShowCapacityWarning(stats));
  const mark = markShown ?? (() => eventStore.markWarningShown());
  const subscribeToStats = subscribe ?? ((listener: StatsListener) => eventStore.onStats(listener));

  // Bumped on every dismiss. A check captures it when it starts and may only
  // show the banner if no dismiss happened while it ran (#2584 review): the
  // real eventStore check waits on a lock and a storage read, so a poll already
  // in flight when the player taps Dismiss could otherwise resolve "show" and
  // put the banner straight back.
  const dismissGenRef = useRef(0);

  const runCheck = useCallback(async (stats?: QueueStats) => {
    const startedAtGen = dismissGenRef.current;
    try {
      const should = await check(stats);
      if (should && startedAtGen === dismissGenRef.current) setVisible(true);
    } catch (e) {
      Sentry.captureException(e, {
        tags: { subsystem: "capacityWarningToast", op: "check" },
      });
    }
    // check is captured from props — caller supplies a stable ref in tests
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const subscribeStats = useCallback(
    (listener: StatsListener) => subscribeToStats(listener),
    // subscribe is captured from props — caller supplies a stable ref in tests
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // First check fires immediately on mount; after that every queue change
  // triggers one (and, when polling is on, every interval tick). The interval
  // is paused when the app goes to background to avoid keeping a timer
  // running while the user isn't seeing the app; a return to the foreground
  // checks once.
  useEffect(() => {
    void runCheck();
    const unsubscribe = subscribeStats((stats) => {
      void runCheck(stats);
    });
    const arm = () => {
      if (pollIntervalMs > 0 && intervalRef.current === null) {
        intervalRef.current = setInterval(() => void runCheck(), pollIntervalMs);
      }
    };
    const disarm = () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
    arm();

    const appStateSub = AppState.addEventListener("change", (next: AppStateStatus) => {
      if (isAppInterrupted(next)) {
        disarm();
      } else if (next === "active" && intervalRef.current === null) {
        void runCheck();
        arm();
      }
    });

    return () => {
      unsubscribe();
      appStateSub.remove();
      disarm();
    };
  }, [runCheck, subscribeStats, pollIntervalMs]);

  const onDismiss = useCallback(() => {
    dismissGenRef.current += 1;
    setVisible(false);
    mark().catch((e) => {
      Sentry.captureException(e, {
        tags: { subsystem: "capacityWarningToast", op: "markShown" },
      });
    });
    // mark is captured from props — caller supplies a stable ref in tests
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!visible) return null;

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.surfaceAlt,
          borderColor: colors.border,
          top: insets.top + 12,
        },
      ]}
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      testID="capacity-warning-toast"
    >
      <View style={styles.content}>
        <Text style={[styles.title, { color: colors.text }]}>{t("capacityWarning.title")}</Text>
        <Text style={[styles.body, { color: colors.textMuted }]}>{t("capacityWarning.body")}</Text>
      </View>
      <Pressable
        onPress={onDismiss}
        style={[styles.dismissButton, { borderColor: colors.accent }]}
        accessibilityRole="button"
        accessibilityLabel={t("capacityWarning.dismiss")}
        testID="capacity-warning-dismiss"
      >
        <Text style={[styles.dismissText, { color: colors.accent }]}>
          {t("capacityWarning.dismiss")}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    left: 16,
    right: 16,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    // High enough to overlay any screen content, lower than modal scrims.
    zIndex: 9999,
    // RN native elevation for Android shadow parity with web zIndex.
    elevation: 12,
  },
  content: {
    flex: 1,
  },
  title: {
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 2,
  },
  body: {
    fontSize: 12,
    lineHeight: 16,
  },
  dismissButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    minHeight: 32,
    justifyContent: "center",
  },
  dismissText: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
});
