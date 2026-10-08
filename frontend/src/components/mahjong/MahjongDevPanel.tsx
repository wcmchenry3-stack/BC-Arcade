/**
 * Mahjong's developer panel (moved out of MahjongScreen in #2978): the board's
 * numbers, its free pairs, the free-tile overlay switch and a link to the
 * layout inspector. Dev builds only. Opened from the HUD's DEV pill, a long
 * press on the clock, or Shift+D on web (listened for here).
 */
import React, { useEffect, useMemo } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text } from "react-native";
import {
  DEV_ACCENT,
  DEV_ACCENT_ACTIVE_BG,
  DEV_ACCENT_BORDER,
  DEV_SIDEBAR_BG_LIGHT,
} from "../../theme/theme.constants";
import { DevPanelShell } from "../dev/DevPanelShell";
import { getAllFreePairs } from "../../game/mahjong/engine";
import type { FreeTiles } from "../../game/mahjong/useFreeTiles";
import type { MahjongState, SlotTile } from "../../game/mahjong/types";

export interface MahjongDevPanelProps {
  readonly enabled: boolean;
  readonly open: boolean;
  /** Opens or closes the panel (Shift+D on web). Keep it stable: the key listener follows it. */
  readonly onToggle: () => void;
  readonly state: MahjongState | null;
  /** The board's free tiles, shared with the screen (#2962). */
  readonly free: FreeTiles;
  readonly showFree: boolean;
  readonly onToggleShowFree: () => void;
  readonly onOpenLayoutInspector: () => void;
}

export default function MahjongDevPanel(props: MahjongDevPanelProps) {
  if (!props.enabled) return null;
  return <MahjongDevPanelBody {...props} />;
}

function MahjongDevPanelBody({
  open,
  onToggle,
  state,
  free,
  showFree,
  onToggleShowFree,
  onOpenLayoutInspector,
}: MahjongDevPanelProps) {
  // Every free pair, searched only while the panel is open.
  const freePairs = useMemo<[SlotTile, SlotTile][]>(
    () => (open ? getAllFreePairs(free.tiles, free.ids) : []),
    [open, free]
  );

  // Shift+D keyboard shortcut on web.
  useEffect(() => {
    if (Platform.OS !== "web") return;
    function onKey(e: KeyboardEvent) {
      if (e.shiftKey && e.key === "D") onToggle();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onToggle]);

  if (state === null) return null;

  return (
    <DevPanelShell
      enabled
      open={open}
      onClose={onToggle}
      showButton={false}
      variant="sidebar"
      scroll={false}
      title="DEV — Mahjong"
      titleStyle={styles.title}
      panelStyle={styles.panel}
      pointerEvents="box-none"
    >
      <Text style={styles.text}>
        tiles: {state.tiles.length} / pairs removed: {state.pairsRemoved}
      </Text>
      <Text style={styles.text}>
        free tiles: {new Set(freePairs.flatMap(([a, b]) => [a.id, b.id])).size} / free pairs:{" "}
        {freePairs.length}
      </Text>
      <Text style={styles.text}>
        shuffles left: {state.shufflesLeft} / score: {state.score}
      </Text>
      <Text style={styles.text}>
        deal #{state.dealId} / undo depth: {state.undoStack.length}
      </Text>
      <Pressable
        onPress={onToggleShowFree}
        style={[styles.toggleBtn, showFree && styles.toggleBtnActive]}
      >
        <Text style={styles.toggleText}>{showFree ? "overlay: ON" : "overlay: off"}</Text>
      </Pressable>
      <Pressable onPress={onOpenLayoutInspector} style={styles.toggleBtn}>
        <Text style={styles.toggleText}>Layout Inspector →</Text>
      </Pressable>
      {freePairs.length > 0 && (
        <>
          <Text style={[styles.title, styles.pairsTitle]}>free pairs</Text>
          <ScrollView style={styles.pairs} showsVerticalScrollIndicator={false}>
            {freePairs.map(([a, b], i) => (
              <Text key={i} style={styles.pairText}>
                {a.suit[0]}
                {a.rank} ↔ {b.suit[0]}
                {b.rank} (ids {a.id},{b.id})
              </Text>
            ))}
          </ScrollView>
        </>
      )}
      {freePairs.length === 0 && <Text style={[styles.text, styles.noPairs]}>no free pairs</Text>}
    </DevPanelShell>
  );
}

const styles = StyleSheet.create({
  panel: {
    width: 220,
    backgroundColor: DEV_SIDEBAR_BG_LIGHT,
    borderLeftColor: DEV_ACCENT_BORDER,
  },
  title: {
    color: DEV_ACCENT,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.8,
    textAlign: "auto",
    textTransform: "uppercase",
    marginBottom: 4,
  },
  pairsTitle: {
    marginTop: 8,
  },
  text: {
    color: "#cccccc",
    fontSize: 10,
    lineHeight: 16,
    fontVariant: ["tabular-nums"],
  },
  noPairs: {
    color: "#ff6644",
    marginTop: 4,
  },
  pairs: {
    maxHeight: 140,
  },
  pairText: {
    color: "#aaccaa",
    fontSize: 10,
    lineHeight: 15,
    fontVariant: ["tabular-nums"],
  },
  toggleBtn: {
    marginTop: 6,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: DEV_ACCENT_BORDER,
    alignSelf: "flex-start",
  },
  toggleBtnActive: {
    backgroundColor: DEV_ACCENT_ACTIVE_BG,
    borderColor: DEV_ACCENT,
  },
  toggleText: {
    color: DEV_ACCENT,
    fontSize: 10,
    fontWeight: "700",
  },
});
