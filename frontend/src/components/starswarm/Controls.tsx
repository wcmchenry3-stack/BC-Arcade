import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import * as Haptics from "expo-haptics";
import * as Sentry from "@sentry/react-native";
import { useTranslation } from "react-i18next";
import { typography } from "../../theme/typography";
import type { GameCanvasHandle } from "./GameCanvas";
import { CANVAS_W, CANVAS_H } from "../../game/starswarm/engine";
import { applyDrag, clamp, DRAG_MAX_X, DRAG_MIN_X } from "../../game/starswarm/drag";
import {
  endShipStuckSession,
  flushShipStuckReport,
  noteShipDragBegin,
  noteShipDragEnd,
  noteShipDragIgnored,
  noteShipDragMove,
} from "../../game/starswarm/stuckShipReport";
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

/** The pan gesture's test id, for `react-native-gesture-handler/jest-utils` (#4079). */
export const STARSWARM_PAN_TEST_ID = "starswarm-pan";

/** The first argument that is a finite number; the canvas centre when none is (#4079). */
function firstFinite(...xs: (number | null | undefined)[]): number {
  for (const x of xs) if (typeof x === "number" && Number.isFinite(x)) return x;
  return CANVAS_W / 2;
}

/**
 * Breadcrumb so Sentry captures boundary-overshoot context for any surrounding errors. Throttled
 * to once per second — pan events fire at 60 fps and would flood the trail.
 */
function logBoundaryHit(
  lastLogMsRef: { current: number },
  rawX: number,
  newX: number,
  phase: string | undefined
): void {
  const now = Date.now();
  if (now - lastLogMsRef.current <= 1000) return;
  lastLogMsRef.current = now;
  Sentry.addBreadcrumb({
    category: "starswarm.player",
    message: "ship hit canvas boundary",
    level: "info",
    data: {
      rawX: Math.round(rawX * 10) / 10,
      clampedX: Math.round(newX * 10) / 10,
      overshootPx: Math.round((rawX - newX) * 10) / 10,
      side: rawX > newX ? "right" : "left",
      phase,
    },
  });
}

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
  // #4079: the scale the current anchor was computed at. A layout change mid-drag re-anchors, so
  // the ship carries on from where it is instead of jumping by the translation re-scaled.
  const anchorScaleRef = useRef(scale);

  // #4079: the gesture is built once (below) and reads everything that changes between renders
  // through this ref, so a re-render mid-drag (score changes re-render the screen) can never
  // hand the gesture handler a reconfigured gesture. Synced after every commit, before any
  // later touch event can read it.
  const liveRef = useRef({ scale, dragZoneY, isPaused, isLiveRun, onPause });
  useLayoutEffect(() => {
    liveRef.current = { scale, dragZoneY, isPaused, isLiveRun, onPause };
  });

  const resetPlayerX = useCallback(() => {
    playerXRef.current = CANVAS_W / 2;
  }, []);

  // Reset player X tracking on new game
  const handleNewGame = useCallback(() => {
    resetPlayerX();
    onNewGame();
  }, [resetPlayerX, onNewGame]);

  // #4079: memoised on the canvas ref alone (stable for the screen's lifetime). This stays on the
  // builder API (`Gesture.Pan()`), which react-native-gesture-handler 3.5.0 still supports and
  // whose callbacks the real-handler test (Controls.realGesture.test.tsx) drives; the v3 hook API
  // would be a rewrite of the drag without a known defect in the builder to fix.
  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .minDistance(0)
        .withTestId(STARSWARM_PAN_TEST_ID)
        .onBegin((e) => {
          activeDragRef.current = e.y > liveRef.current.dragZoneY;
          if (activeDragRef.current) {
            // Anchor on the canvas's commanded ship X, not getState().player.x: the engine only
            // copies input into player.x on a tick, and ticks are frozen during the pre-wave
            // countdown, so engine X can be stale there and the ship would jump back on touch.
            // #4079: each source only if it is a finite number, else the next, else the centre.
            const handle = canvasRef.current;
            anchorWaveRef.current = handle?.getState()?.wave ?? null;
            const anchorX = firstFinite(
              handle?.getPlayerX?.(),
              handle?.getState()?.player.x,
              playerXRef.current
            );
            playerXRef.current = anchorX;
            shipXAtDragStartRef.current = anchorX;
            anchorScaleRef.current = liveRef.current.scale;
            noteShipDragBegin(anchorX, liveRef.current.scale);
          }
        })
        .onChange((e) => {
          if (!activeDragRef.current) return;
          const scale = liveRef.current.scale;
          // #2842: the wave-clear autopilot moves the ship on its own (and the next wave
          // re-centres it). A drag held through that is ignored, then re-anchored on the ship
          // (the canvas keeps its commanded X on the autopilot's) so control resumes from where
          // the ship is instead of snapping back under the finger. The wave change is what
          // triggers the re-anchor, so it works whether or not any move arrived during the
          // extraction. #3132: an extraction can also hand control back within the same wave
          // (salvage while the ship still holds its lane), so the drag also re-anchors whenever
          // the ship isn't where this drag last put it: something else moved it.
          const handle = canvasRef.current;
          const state = handle?.getState();
          if (state?.phase === "Extraction") {
            noteShipDragIgnored(e.translationX, scale);
            return;
          }
          const shipX = handle?.getPlayerX?.() ?? state?.player.x;
          const waveChanged =
            !!state && anchorWaveRef.current !== null && state.wave !== anchorWaveRef.current;
          const movedElsewhere =
            shipX !== undefined && Math.abs(shipX - playerXRef.current) > SHIP_MOVED_EPSILON_PX;
          if (state && shipX !== undefined && (waveChanged || movedElsewhere)) {
            anchorWaveRef.current = state.wave;
            shipXAtDragStartRef.current = shipX - e.translationX / scale;
            anchorScaleRef.current = scale;
          }
          // #4079: the layout changed under the finger: carry on from where the ship is.
          if (scale !== anchorScaleRef.current) {
            anchorScaleRef.current = scale;
            shipXAtDragStartRef.current = playerXRef.current - e.translationX / scale;
          }
          const dragStart = shipXAtDragStartRef.current;
          const { rawX, newX, nextDragStart } = applyDrag(
            dragStart,
            e.translationX,
            scale,
            playerXRef.current
          );
          // Re-anchor so any reversal immediately moves the ship instead of replaying the
          // overshoot (and, #4079, on the held X after an unusable event).
          shipXAtDragStartRef.current = nextDragStart;
          if (Number.isFinite(rawX) && rawX !== newX)
            logBoundaryHit(lastBoundaryLogMsRef, rawX, newX, state?.phase);
          playerXRef.current = newX;
          noteShipDragMove(newX, rawX, dragStart, e.translationX, scale);
          canvasRef.current?.setPlayerX(newX);
        })
        .onEnd((e) => {
          if (
            !activeDragRef.current &&
            e.y < liveRef.current.dragZoneY &&
            Math.abs(e.translationX) < 10
          ) {
            // Short tap in top zone → pause
            if (!liveRef.current.isPaused && liveRef.current.isLiveRun) liveRef.current.onPause();
          }
          activeDragRef.current = false;
          // #4079: the once-per-gesture check that every move was delivered
          noteShipDragEnd(e.translationX, canvasRef.current?.getState());
        })
        .onFinalize((e) => {
          activeDragRef.current = false;
          // A no-op after onEnd; covers a gesture that is cancelled without one.
          noteShipDragEnd(e?.translationX ?? NaN, canvasRef.current?.getState());
        }),
    [canvasRef]
  );

  // #4079: leaving the screen sends a held stuck-ship event and forgets the drag, so a drag
  // that never saw onFinalize can't make a later visit look stuck.
  useEffect(() => endShipStuckSession, []);
  // #4079: a held event goes out on pause, which is also what leaving the app does: the frame
  // loop stops in the background, and the process may be killed there.
  useEffect(() => {
    if (isPaused) flushShipStuckReport();
  }, [isPaused]);

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
  // #3598: the pause overlay in the HUD's brand type — a Space Grotesk headline with the accent
  // glow, Manrope button labels
  pauseTitle: {
    color: STARSWARM_ACCENT,
    fontFamily: typography.heading,
    fontSize: 26,
    letterSpacing: 3,
    textShadowColor: STARSWARM_ACCENT,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
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
    fontFamily: typography.label,
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
    fontFamily: typography.bodyMedium,
    fontWeight: "normal", // the family is the weight; no synthetic bold from newGameBtnText
    fontSize: 12,
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
