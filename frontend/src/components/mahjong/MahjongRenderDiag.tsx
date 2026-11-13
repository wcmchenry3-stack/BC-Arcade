/**
 * The #3684 render readout (test builds only, native only): a small "diag" chip in the board's
 * top-left corner that opens a text readout and the render-variant switch, so one Maestro run
 * on iOS can show why the tiles look faded or blurry (e2e/maestro/flows/mahjong/demo-diagnose.yaml).
 *
 * Inert outside a test build: `MahjongRenderDiag` renders nothing, so no interval, frame
 * callback or counter runs. In a test build the chip is all there is until it is tapped; the
 * readout then refreshes twice a second from JS (never per frame) and the UI-thread heartbeat
 * (a frame callback) runs only while switched on, so the readout itself does not keep the UI
 * thread's frame loop busy unasked. Nothing is stored or sent.
 */
import React, { useEffect, useRef, useState } from "react";
import { PixelRatio, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useFrameCallback, useSharedValue } from "react-native-reanimated";

import {
  DEV_ACCENT,
  DEV_ACCENT_ACTIVE_BG,
  DEV_ACCENT_BORDER,
  DEV_SIDEBAR_BG_LIGHT,
  DEV_TEXT_SECONDARY,
} from "../../theme/theme.constants";
import {
  RENDER_VARIANTS,
  diagSnapshot,
  formatDiag,
  getRenderVariant,
  isRenderDiagEnabled,
  setRenderVariant,
} from "../../game/mahjong/renderDiag";
import type { RenderVariant } from "../../game/mahjong/renderDiag";

/** The readout is rewritten this often (ms): ~2 Hz, off the frame path. */
export const DIAG_REFRESH_MS = 500;

export interface MahjongRenderDiagProps {
  /** Tiles in `motion.tiles` now. */
  readonly motionTiles: number;
  /** Whether the deal clock is still set (`useBoardMotion().dealing`). */
  readonly dealing: () => boolean;
  readonly reduceMotion: boolean;
  /** Deals the current layout again, with the variant just picked. */
  readonly onRedeal: () => void;
}

/** Whether the screen shows the chip: test builds, on the native canvas only. */
export function isRenderDiagShown(): boolean {
  return isRenderDiagEnabled() && Platform.OS !== "web";
}

export default function MahjongRenderDiag(props: MahjongRenderDiagProps) {
  if (!isRenderDiagShown()) return null;
  return <RenderDiagBody {...props} />;
}

function RenderDiagBody({ motionTiles, dealing, reduceMotion, onRedeal }: MahjongRenderDiagProps) {
  const [open, setOpen] = useState(false);
  const [heartbeat, setHeartbeat] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const mountedAt = useRef(0);
  const frames = useSharedValue(0);
  const frameCallback = useFrameCallback(() => {
    "worklet";
    frames.value += 1;
  }, false);
  // The latest screen facts, for the interval to read (never during a render).
  const live = useRef({ motionTiles, dealing, reduceMotion, heartbeat });
  useEffect(() => {
    live.current = { motionTiles, dealing, reduceMotion, heartbeat };
  });

  useEffect(() => {
    mountedAt.current = Date.now();
  }, []);

  useEffect(() => {
    frameCallback.setActive(heartbeat);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heartbeat]);

  useEffect(() => {
    if (!open) return;
    const read = () => {
      const l = live.current;
      setLines(
        formatDiag(diagSnapshot(), {
          pixelRatio: PixelRatio.get(),
          motionTiles: l.motionTiles,
          dealing: l.dealing(),
          reduceMotion: l.reduceMotion,
          jsMs: Date.now() - mountedAt.current,
          uiFrames: l.heartbeat ? frames.get() : null,
        })
      );
    };
    read();
    const id = setInterval(read, DIAG_REFRESH_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function pick(v: RenderVariant) {
    setRenderVariant(v);
    // Each variant starts with the heartbeat off, as the first deal did.
    setHeartbeat(false);
    frames.set(0);
    onRedeal();
  }

  const current = getRenderVariant();

  return (
    <View style={styles.root} pointerEvents="box-none">
      <Pressable
        onPress={() => setOpen((o) => !o)}
        style={styles.chip}
        testID="mahjong-diag-toggle"
        accessibilityRole="button"
        accessibilityLabel="Render diagnostics"
      >
        <Text style={styles.chipText}>diag</Text>
      </Pressable>
      {open && (
        <View style={styles.panel} testID="mahjong-diag">
          {lines.map((line, i) => (
            <Text key={i} style={styles.text}>
              {line}
            </Text>
          ))}
          <View style={styles.row}>
            {RENDER_VARIANTS.map((v) => (
              <Pressable
                key={v}
                onPress={() => pick(v)}
                style={[styles.btn, v === current && styles.btnActive]}
                testID={`mahjong-variant-${v}`}
                accessibilityRole="button"
                accessibilityLabel={`Render variant ${v}`}
              >
                <Text style={styles.btnText}>{v}</Text>
              </Pressable>
            ))}
            <Pressable
              onPress={() => setHeartbeat((h) => !h)}
              style={[styles.btn, heartbeat && styles.btnActive]}
              testID="mahjong-diag-ui-hb"
              accessibilityRole="button"
              accessibilityLabel="UI heartbeat"
            >
              <Text style={styles.btnText}>ui hb</Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: "absolute",
    top: 4,
    left: 4,
    alignItems: "flex-start",
  },
  chip: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: DEV_ACCENT_BORDER,
    backgroundColor: DEV_SIDEBAR_BG_LIGHT,
  },
  chipText: {
    color: DEV_ACCENT,
    fontSize: 10,
    fontWeight: "700",
  },
  panel: {
    marginTop: 4,
    padding: 6,
    borderRadius: 4,
    backgroundColor: DEV_SIDEBAR_BG_LIGHT,
  },
  text: {
    color: DEV_TEXT_SECONDARY,
    fontSize: 10,
    lineHeight: 14,
    fontVariant: ["tabular-nums"],
  },
  row: {
    flexDirection: "row",
    gap: 6,
    marginTop: 4,
  },
  btn: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: DEV_ACCENT_BORDER,
  },
  btnActive: {
    backgroundColor: DEV_ACCENT_ACTIVE_BG,
    borderColor: DEV_ACCENT,
  },
  btnText: {
    color: DEV_ACCENT,
    fontSize: 11,
    fontWeight: "700",
  },
});
