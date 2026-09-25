/**
 * #2567 (epic #2562, phase 5): the on-screen "Frame" readout — frame-time average and p95, and
 * the canvas's React commits per second, over the last second.
 *
 * It polls the canvas at 4 Hz and owns that state, so reading the numbers re-renders only this
 * line — never the screen or the canvas it is measuring.
 */
import React, { useEffect, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { formatFrameStats } from "../../game/starswarm/render/frameStats";
import type { FrameStatsSummary } from "../../game/starswarm/render/frameStats";

export const FRAME_STATS_POLL_MS = 250;

interface Props {
  /** Reads the canvas's last second; null when sampling is off or no frame has landed. */
  readonly read: () => FrameStatsSummary | null;
  /** Which renderer is drawing, so a screenshot of the numbers says what they measure. */
  readonly renderer: string;
}

export default function FrameStatsReadout({ read, renderer }: Props) {
  const [line, setLine] = useState(() => formatFrameStats(read()));
  useEffect(() => {
    const tick = () => setLine(formatFrameStats(read()));
    tick();
    const id = setInterval(tick, FRAME_STATS_POLL_MS);
    return () => clearInterval(id);
  }, [read]);
  const text = `${renderer} · ${line}`;
  return (
    <View
      pointerEvents="none"
      style={styles.wrap}
      testID="starswarm-frame-stats"
      accessibilityLabel={`Frame stats: ${text}`}
    >
      <Text style={styles.text}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    top: 28,
    left: 6,
    right: 6,
    backgroundColor: "rgba(0,0,0,0.6)",
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 4,
    zIndex: 100,
  },
  text: {
    color: "#7CFC00",
    fontSize: 10,
    lineHeight: 14,
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
  },
});
