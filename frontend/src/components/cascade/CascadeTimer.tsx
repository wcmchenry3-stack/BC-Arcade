/**
 * Cascade's play timer in the HUD (#4091): the "TIME" label over `mm:ss` (`h:mm:ss` from an hour).
 *
 * It reads the screen's `PlayClock` through `useCascadeClock` and owns its tick (`ElapsedText`),
 * so as time passes only this text re-renders: not the screen, the score row's other parts or the
 * Skia board (#2964). The clock tells it when it starts, pauses and stops via `clock.activity`
 * (no screen render), and a reset or restore via `clock.epoch` (a re-read of the time).
 */
import React, { memo, useCallback, useSyncExternalStore } from "react";
import { View, Text, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../theme/ThemeContext";
import { formatClock } from "../../game/_shared/formatMs";
import type { useCascadeClock } from "../../game/cascade/useCascadeClock";
import { ElapsedText } from "../shared/ElapsedText";

interface Props {
  clock: ReturnType<typeof useCascadeClock>;
}

function CascadeTimer({ clock }: Props) {
  const { t } = useTranslation("cascade");
  const { colors } = useTheme();
  const epoch = useSyncExternalStore(clock.epoch.subscribe, clock.epoch.get);
  const a11yLabel = useCallback((time: string) => t("hud.elapsed", { time }), [t]);
  return (
    <View testID="cascade-hud-time" style={styles.section}>
      <Text style={[styles.label, { color: colors.textMuted }]} importantForAccessibility="no">
        {t("score.time")}
      </Text>
      <ElapsedText
        testID="cascade-hud-time-value"
        getElapsedMs={clock.elapsed}
        running
        activity={clock.activity}
        resetKey={epoch}
        format={formatClock}
        accessibilityLabel={a11yLabel}
        style={[styles.time, { color: colors.textMuted }]}
      />
    </View>
  );
}

export default memo(CascadeTimer);

const styles = StyleSheet.create({
  section: { alignItems: "center" },
  label: {
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  time: {
    fontSize: 14,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
});
