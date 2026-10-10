import React, { useCallback, useEffect, useRef } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import * as Haptics from "expo-haptics";
import * as Sentry from "@sentry/react-native";
import { useTranslation } from "react-i18next";
import type { GameCanvasHandle } from "./GameCanvas";
import { CANVAS_W, CANVAS_H } from "../../game/starswarm/engine";
import { applyDrag, clamp, DRAG_MAX_X, DRAG_MIN_X } from "../../game/starswarm/drag";
import {
  STARSWARM_ACCENT,
  STARSWARM_PAUSE_LINK_BORDER,
  STARSWARM_PAUSE_LINK_TEXT,
  STARSWARM_PAUSE_SCRIM,
  STARSWARM_SPACE,
} from "../../theme/theme.starswarm";

const DRAG_ZONE_Y_RATIO = 0.6; // bottom 40% is the drag zone

interface Props {
  canvasRef: React.RefObject<GameCanvasHandle | null>;
  scale: number;
  /** A run is on screen and not over — see StarSwarmScreen. */
  isLiveRun: boolean;
  isPaused: boolean;
  onPause: () => void;
  onResume: () => void;
  onNewGame: () => void;
}

/** How far (px) the ship may sit from this drag's last command before it counts as moved. */
const SHIP_MOVED_EPSILON_PX = 0.5;

export default function Controls({
  canvasRef,
  scale,
  isLiveRun,
  isPaused,
  onPause,
  onResume,
  onNewGame,
}: Props) {
  const { t } = useTranslation("starswarm");

  const displayW = Math.round(CANVAS_W * scale);
  const displayH = Math.round(CANVAS_H * scale);
  const dragZoneY = displayH * DRAG_ZONE_Y_RATIO;

  const playerXRef = useRef(CANVAS_W / 2);
  const activeDragRef = useRef(false);
  // Ship X captured at each touch-start — used to compute delta from gesture start,
  // avoiding cumulative drift from per-event changeX accumulation.
  const shipXAtDragStartRef = useRef(CANVAS_W / 2);
  // Sentry breadcrumb throttle: only log the first boundary-hit per second to avoid flood.
  const lastBoundaryLogMsRef = useRef(0);
  // #2842: the wave the current drag was anchored in. Every extraction ends in a wave change, so
  // a different wave on a later move means the autopilot moved (and re-centred) the ship since —
  // re-anchor then, even if the finger was held still and sent no events through it.
  const anchorWaveRef = useRef<number | null>(null);

  const resetPlayerX = useCallback(() => {
    playerXRef.current = CANVAS_W / 2;
  }, []);

  // Reset player X tracking on new game
  const handleNewGame = useCallback(() => {
    resetPlayerX();
    onNewGame();
  }, [resetPlayerX, onNewGame]);

  const panGesture = Gesture.Pan()
    .runOnJS(true)
    .minDistance(0)
    .onBegin((e) => {
      activeDragRef.current = e.y > dragZoneY;
      if (activeDragRef.current) {
        // Anchor on the canvas's commanded ship X, not getState().player.x: the engine only
        // copies input into player.x on a tick, and ticks are frozen during the pre-wave
        // countdown, so engine X can be stale there and the ship would jump back on touch.
        const handle = canvasRef.current;
        anchorWaveRef.current = handle?.getState()?.wave ?? null;
        const anchorX =
          handle?.getPlayerX?.() ?? handle?.getState()?.player.x ?? playerXRef.current;
        playerXRef.current = anchorX;
        shipXAtDragStartRef.current = anchorX;
      }
    })
    .onChange((e) => {
      if (!activeDragRef.current) return;
      // #2842: the wave-clear autopilot moves the ship on its own (and the next wave re-centres
      // it). A drag held through that is ignored, then re-anchored on the ship (the canvas
      // keeps its commanded X on the autopilot's) so control resumes from where the ship is
      // instead of snapping back under the finger. The wave change is what triggers the
      // re-anchor, so it works whether or not any move arrived during the extraction.
      // #3132: an extraction can also hand control back within the same wave (salvage while
      // the ship still holds its lane), so the drag also re-anchors whenever the ship isn't
      // where this drag last put it: something else moved it.
      const handle = canvasRef.current;
      const state = handle?.getState();
      if (state?.phase === "Extraction") return;
      const shipX = handle?.getPlayerX?.() ?? state?.player.x;
      const waveChanged =
        !!state && anchorWaveRef.current !== null && state.wave !== anchorWaveRef.current;
      const movedElsewhere =
        shipX !== undefined && Math.abs(shipX - playerXRef.current) > SHIP_MOVED_EPSILON_PX;
      if (state && shipX !== undefined && (waveChanged || movedElsewhere)) {
        anchorWaveRef.current = state.wave;
        shipXAtDragStartRef.current = shipX - e.translationX / scale;
      }
      const dragStart = shipXAtDragStartRef.current;
      const { rawX, newX, nextDragStart } = applyDrag(dragStart, e.translationX, scale);
      // Re-anchor so any reversal immediately moves the ship instead of replaying the overshoot.
      shipXAtDragStartRef.current = nextDragStart;
      if (rawX !== newX) {
        // Breadcrumb so Sentry captures boundary-overshoot context for any surrounding errors.
        // Throttled to once per second — pan events fire at 60 fps and would flood the trail.
        const now = Date.now();
        if (now - lastBoundaryLogMsRef.current > 1000) {
          lastBoundaryLogMsRef.current = now;
          Sentry.addBreadcrumb({
            category: "starswarm.player",
            message: "ship hit canvas boundary",
            level: "info",
            data: {
              rawX: Math.round(rawX * 10) / 10,
              clampedX: Math.round(newX * 10) / 10,
              overshootPx: Math.round((rawX - newX) * 10) / 10,
              side: rawX > newX ? "right" : "left",
              phase: canvasRef.current?.getState()?.phase,
            },
          });
        }
      }
      playerXRef.current = newX;
      canvasRef.current?.setPlayerX(newX);
    })
    .onEnd((e) => {
      if (!activeDragRef.current && e.y < dragZoneY && Math.abs(e.translationX) < 10) {
        // Short tap in top zone → pause
        if (!isPaused && isLiveRun) onPause();
      }
      activeDragRef.current = false;
    })
    .onFinalize(() => {
      activeDragRef.current = false;
    });

  // Arrow-key movement for web (and external keyboards on iOS).
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const STEP = 6;
    const held = new Set<string>();
    let rafId: number;

    function loop() {
      if (held.size > 0) {
        const dx = (held.has("ArrowRight") ? STEP : 0) - (held.has("ArrowLeft") ? STEP : 0);
        if (dx !== 0) {
          playerXRef.current = clamp(playerXRef.current + dx, DRAG_MIN_X, DRAG_MAX_X);
          canvasRef.current?.setPlayerX(playerXRef.current);
        }
      }
      rafId = requestAnimationFrame(loop);
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        held.add(e.key);
      }
    }
    function onKeyUp(e: KeyboardEvent) {
      held.delete(e.key);
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    rafId = requestAnimationFrame(loop);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      cancelAnimationFrame(rafId);
    };
  }, [canvasRef]);

  return (
    <GestureDetector gesture={panGesture}>
      <View style={[styles.overlay, { width: displayW, height: displayH }]}>
        {/* Pause overlay */}
        {isPaused && isLiveRun && (
          <View style={styles.pauseOverlay}>
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={onResume}
              accessibilityLabel={t("controls.resumeLabel")}
              accessibilityRole="button"
            />
            <Text style={styles.pauseTitle}>{t("controls.paused")}</Text>
            <Pressable
              style={styles.pauseResumeBtn}
              onPress={onResume}
              accessibilityLabel={t("controls.resumeLabel")}
              accessibilityRole="button"
            >
              <Text style={styles.pauseResumeBtnText}>{t("controls.resume")}</Text>
            </Pressable>
            <Pressable
              style={[styles.newGameBtn, styles.pauseNewGameBtn]}
              onPress={handleNewGame}
              accessibilityLabel={t("controls.newGameFromPauseLabel")}
              accessibilityRole="button"
            >
              <Text style={[styles.newGameBtnText, styles.pauseNewGameBtnText]}>
                {t("controls.newGameFromPause")}
              </Text>
            </Pressable>
          </View>
        )}
      </View>
    </GestureDetector>
  );
}

/** Call from StarSwarmScreen when the player is hit (short impact). */
export function hapticPlayerHit() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
}

/** Call from StarSwarmScreen on wave clear (light notification). */
export function hapticWaveClear() {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
}

const styles = StyleSheet.create({
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
  },
  pauseOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: STARSWARM_PAUSE_SCRIM,
    alignItems: "center",
    justifyContent: "center",
  },
  pauseTitle: {
    color: STARSWARM_ACCENT,
    fontSize: 26,
    fontWeight: "bold",
    letterSpacing: 3,
  },
  pauseResumeBtn: {
    marginTop: 16,
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 8,
    backgroundColor: STARSWARM_ACCENT,
    minWidth: 180,
    alignItems: "center",
  },
  pauseResumeBtnText: {
    color: STARSWARM_SPACE,
    fontWeight: "bold",
    fontSize: 16,
    letterSpacing: 1,
  },
  pauseNewGameBtn: {
    marginTop: 20,
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: STARSWARM_PAUSE_LINK_BORDER,
    paddingHorizontal: 18,
    paddingVertical: 7,
    minWidth: 180,
    alignItems: "center",
  },
  pauseNewGameBtnText: {
    color: STARSWARM_PAUSE_LINK_TEXT,
    fontSize: 12,
    fontWeight: "normal",
    letterSpacing: 0,
  },
  newGameBtn: {
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 8,
    backgroundColor: STARSWARM_ACCENT,
  },
  newGameBtnText: {
    color: STARSWARM_SPACE,
    fontWeight: "bold",
    fontSize: 16,
    letterSpacing: 1,
  },
});
