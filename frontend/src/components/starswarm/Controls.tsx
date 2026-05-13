import React, { useCallback, useEffect, useRef } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import * as Haptics from "expo-haptics";
import { useTranslation } from "react-i18next";
import type { GameCanvasHandle } from "./GameCanvas";
import type { GamePhase } from "../../game/starswarm/types";
import { CANVAS_W, CANVAS_H, PLAYER_W } from "../../game/starswarm/engine";

const DRAG_ZONE_Y_RATIO = 0.6; // bottom 40% is the drag zone

interface Props {
  canvasRef: React.RefObject<GameCanvasHandle | null>;
  scale: number;
  phase: GamePhase;
  isPaused: boolean;
  onPause: () => void;
  onResume: () => void;
  onNewGame: () => void;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

export default function Controls({
  canvasRef,
  scale,
  phase,
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
        // Capture ship X at gesture start so we use total translation (not
        // per-event changeX accumulation) — avoids drift over long gestures.
        shipXAtDragStartRef.current = playerXRef.current;
      }
    })
    .onChange((e) => {
      if (!activeDragRef.current) return;
      const hw = PLAYER_W / 2;
      const rawX = shipXAtDragStartRef.current + e.translationX / scale;
      const newX = clamp(rawX, hw, CANVAS_W - hw);
      // When the finger overshoots an edge, rawX diverges from newX. Slide
      // shipXAtDragStartRef so that for the current translationX the formula
      // yields newX exactly — the ship then responds immediately when the user
      // reverses direction instead of requiring them to drag back through the
      // accumulated overshoot first (the "rope" / "sticky edge" feeling).
      if (rawX !== newX) {
        shipXAtDragStartRef.current = newX - e.translationX / scale;
      }
      playerXRef.current = newX;
      canvasRef.current?.setPlayerX(newX);
    })
    .onEnd((e) => {
      if (!activeDragRef.current && e.y < dragZoneY && Math.abs(e.translationX) < 10) {
        // Short tap in top zone → pause
        if (!isPaused && phase === "Playing") onPause();
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
          const hw = PLAYER_W / 2;
          playerXRef.current = clamp(playerXRef.current + dx, hw, CANVAS_W - hw);
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

  const isGameOver = phase === "GameOver";

  return (
    <GestureDetector gesture={panGesture}>
      <View style={[styles.overlay, { width: displayW, height: displayH }]}>
        {/* Pause overlay */}
        {isPaused && !isGameOver && (
          <View style={styles.pauseOverlay}>
            <Pressable
              style={StyleSheet.absoluteFillObject}
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

        {/* Game-over new-game button */}
        {isGameOver && (
          <View style={styles.gameOverActions}>
            <Pressable
              style={styles.newGameBtn}
              onPress={handleNewGame}
              accessibilityLabel={t("controls.newGameLabel")}
              accessibilityRole="button"
            >
              <Text style={styles.newGameBtnText}>{t("controls.newGame")}</Text>
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

/** Call from StarSwarmScreen on player death / game over (medium impact). */
export function hapticPlayerDeath() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
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
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 16, 0.72)",
    alignItems: "center",
    justifyContent: "center",
  },
  pauseTitle: {
    color: "#00ffcc",
    fontSize: 26,
    fontWeight: "bold",
    letterSpacing: 3,
  },
  pauseResumeBtn: {
    marginTop: 16,
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 8,
    backgroundColor: "#00ffcc",
  },
  pauseResumeBtnText: {
    color: "#000010",
    fontWeight: "bold",
    fontSize: 16,
    letterSpacing: 1,
  },
  pauseNewGameBtn: {
    marginTop: 20,
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.35)",
    paddingHorizontal: 18,
    paddingVertical: 7,
  },
  pauseNewGameBtnText: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 12,
    fontWeight: "normal",
    letterSpacing: 0,
  },
  gameOverActions: {
    position: "absolute",
    bottom: 100,
    left: 0,
    right: 0,
    alignItems: "center",
  },
  newGameBtn: {
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 8,
    backgroundColor: "#00ffcc",
  },
  newGameBtnText: {
    color: "#000010",
    fontWeight: "bold",
    fontSize: 16,
    letterSpacing: 1,
  },
});
