/**
 * Cascade's developer panel (moved out of CascadeScreen in #3693, the #2978 pattern): spawn any
 * engine tier at the canvas centre, and list the active fruit set. Dev builds only; the screen
 * passes its own gate as `enabled`, so store builds draw nothing.
 *
 * #2960: the frame readout (Star Swarm's `render/frameStats.ts` ring buffer): the loop's frame
 * time and the screen's React commits per second over the last second, polled at 4 Hz while the
 * panel is open. A settled board should read 0 commits/s.
 */
import React, { useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "../../theme/ThemeContext";
import { DEV_ACCENT_DIM } from "../../theme/theme.constants";
import { DevActionButton, DevPanelShell, DevSection } from "../dev/DevPanelShell";
import FruitGlyph from "./FruitGlyph";
import { PIECE_DEFS } from "../../game/cascade/pieceDefs";
import { tierRadius } from "../../game/cascade/tiers";
import type { FruitSet } from "../../theme/fruitSets";
import { formatFrameStats } from "../../game/starswarm/render/frameStats";
import type { FrameStatsSummary } from "../../game/starswarm/render/frameStats";

/** How often the open panel re-reads the frame stats. */
export const FRAME_STATS_POLL_MS = 250;

export interface CascadeDevPanelProps {
  readonly enabled: boolean;
  readonly open: boolean;
  readonly onOpen: () => void;
  readonly onClose: () => void;
  readonly activeFruitSet: FruitSet;
  /** Drops this engine tier at the canvas centre. */
  readonly onSpawn: (tier: number) => void;
  /** The last second of frames and commits; null when sampling is off or nothing has landed. */
  readonly readFrameStats?: () => FrameStatsSummary | null;
}

/** The frame readout line; owns its polling state, so a poll re-renders only this line. */
function FrameStatsLine({ read }: { read: () => FrameStatsSummary | null }) {
  const { colors } = useTheme();
  const [line, setLine] = useState(() => formatFrameStats(read()));
  useEffect(() => {
    const id = setInterval(() => setLine(formatFrameStats(read())), FRAME_STATS_POLL_MS);
    return () => clearInterval(id);
  }, [read]);
  return (
    <Text
      style={[styles.frameStats, { color: colors.text }]}
      testID="cascade-frame-stats"
      accessibilityLabel={`Frame stats: ${line}`}
    >
      {line}
    </Text>
  );
}

export default function CascadeDevPanel({
  enabled,
  open,
  onOpen,
  onClose,
  activeFruitSet,
  onSpawn,
  readFrameStats,
}: CascadeDevPanelProps) {
  const { colors } = useTheme();
  return (
    <DevPanelShell
      enabled={enabled}
      open={open}
      onOpen={onOpen}
      onClose={onClose}
      title="Cascade Dev Panel"
      buttonPosition="bottom-right"
      testID="cascade-dev-panel"
    >
      {readFrameStats && open ? (
        <>
          <DevSection title="Frame" color={colors.textMuted} />
          <FrameStatsLine read={readFrameStats} />
        </>
      ) : null}

      <DevSection title="Engine Pieces" color={colors.textMuted} />
      <Text style={[styles.hint, { color: colors.textMuted }]}>
        Spawns at canvas center · tiers 0–{PIECE_DEFS.length - 1}
      </Text>

      {PIECE_DEFS.map((def) => {
        const r = tierRadius(def.tier);
        const name = activeFruitSet.fruits[def.tier]?.name ?? "";
        return (
          <View key={def.tier} style={styles.tierRow}>
            <View style={[styles.swatch, { backgroundColor: def.color }]} />
            <Text style={[styles.tierLabel, { color: colors.text }]}>
              {def.tier} · {name}
            </Text>
            <Text style={[styles.tierMeta, { color: colors.textMuted }]}>r={r}</Text>
            <Pressable style={styles.spawnBtn} onPress={() => onSpawn(def.tier)}>
              <Text style={styles.spawnText}>Spawn</Text>
            </Pressable>
          </View>
        );
      })}

      <DevSection title={`Active Set: ${activeFruitSet.label}`} color={colors.textMuted} />

      {activeFruitSet.fruits.map((fruit) => (
        <View key={fruit.tier} style={styles.tierRow}>
          <FruitGlyph fruit={fruit} size={32} />
          <Text style={[styles.tierLabel, { color: colors.text }]}>
            {fruit.tier} · {fruit.name}
          </Text>
          <Text style={[styles.tierMeta, { color: colors.textMuted }]}>{fruit.emoji}</Text>
        </View>
      ))}

      <DevActionButton label="Close" onPress={onClose} />
    </DevPanelShell>
  );
}

const styles = StyleSheet.create({
  frameStats: {
    fontSize: 11,
    textAlign: "center",
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
  },
  hint: {
    fontSize: 11,
    textAlign: "center",
  },
  tierRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  swatch: {
    width: 20,
    height: 20,
    borderRadius: 10,
    flexShrink: 0,
  },
  tierLabel: {
    flex: 1,
    fontSize: 12,
    fontWeight: "600",
  },
  tierMeta: {
    fontSize: 11,
    minWidth: 32,
    textAlign: "right",
  },
  spawnBtn: {
    backgroundColor: DEV_ACCENT_DIM,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  spawnText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "700",
  },
});
