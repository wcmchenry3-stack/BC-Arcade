/**
 * GameCanvas — web platform
 * Rendered via HTML Canvas 2D API.
 * Metro automatically uses this file on web; GameCanvas.tsx is used on native.
 */
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";
import { View, AccessibilityInfo } from "react-native";
import { Asset } from "expo-asset";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import {
  createEngine,
  EngineHandle,
  BodySnapshot,
  GameEvent,
  WALL_THICKNESS,
  DANGER_LINE_RATIO,
} from "../../game/cascade/engine";
import { FruitDefinition, FruitSet } from "../../theme/fruitSets";
import { useTheme } from "../../theme/ThemeContext";
import { useTranslation } from "react-i18next";

const DROP_Y = 30;

/**
 * Debug flag: when true, draws collision polygon outlines over each fruit.
 * Toggle to visualise the mismatch between visual sprite edges and physics
 * boundaries (see GitHub issue #121).
 */
const DEBUG_COLLISION = __DEV__;

export interface CascadeEngineState {
  fruitCount: number;
  dangerRatio: number;
  fruits: Array<{ id: number; tier: number; x: number; y: number; angle: number }>;
}

export interface SavedFruitInput {
  tier: number;
  x: number;
  y: number;
}

export interface GameCanvasHandle {
  drop: (def: FruitDefinition, x: number) => void;
  reset: () => void;
  announceEvent: (message: string) => void;
  /**
   * Returns the current engine state snapshot. Used by #216 reload
   * persistence to serialize in-flight fruits, and by test hooks to
   * inspect the physics state. Always available (was test-only in
   * earlier versions).
   */
  getEngineState: () => CascadeEngineState;
  /**
   * Restore a set of fruits to specific (x, y) positions. Used by
   * #216 reload persistence after loading a saved game. Fruits are
   * spawned at rest; physics will settle them over the next frame or
   * two.
   */
  restoreFruits: (fruits: readonly SavedFruitInput[], fruitSet: FruitSet) => void;
  fastForward?: (ms: number) => void;
  /** True once the physics engine has finished async init (Rapier WASM loaded). */
  isReady?: () => boolean;
  /** Seed the spawn-queue RNG. Only present when EXPO_PUBLIC_TEST_HOOKS=1. */
  setSeed?: (seed: number) => void;
}

interface Props {
  fruitSet: FruitSet;
  nextDef: FruitDefinition;
  /** Called each RAF tick with any game events that fired during that step. */
  onEvents?: (events: GameEvent[]) => void;
  onTap: (x: number) => void;
  /** Called once, after createEngine() resolves and the engine is ready to drop. */
  onReady?: () => void;
  /** Callback that rebuilds the spawn queue with a seeded RNG. Test-only. */
  onSetSeed?: (seed: number) => void;
  width: number; // world width (px) — physics coordinate space
  height: number; // world height (px) — physics coordinate space
  scale: number; // display scale: canvas CSS size = world * scale
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Draw a baked fruit sprite.
 *
 * Baked PNGs are pre-composited and clipped offline by bake_sprites.py.
 * The entire image represents a square of side 2 * bakedClipR * radius,
 * centred on the body position — so a single drawImage is all that's needed.
 */
function drawFruitBody(
  ctx: CanvasRenderingContext2D,
  def: FruitDefinition,
  x: number,
  y: number,
  angle: number,
  image: CanvasImageSource | null
) {
  const r = def.radius;
  const clipR = (def.bakedClipR ?? 1) * r;
  if (image) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.drawImage(image, -clipR, -clipR, clipR * 2, clipR * 2);
    ctx.restore();
  } else {
    ctx.fillStyle = def.color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawCollisionOverlay(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  radius: number,
  verts: { x: number; y: number }[] | null
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);

  if (verts && verts.length >= 3) {
    // Draw the actual polygon collider
    const v0 = verts[0];
    if (v0 === undefined) return;
    ctx.beginPath();
    ctx.moveTo(v0.x * radius, v0.y * radius);
    for (let i = 1; i < verts.length; i++) {
      const v = verts[i];
      if (v === undefined) continue;
      ctx.lineTo(v.x * radius, v.y * radius);
    }
    ctx.closePath();
    ctx.strokeStyle = "rgba(0,255,0,0.8)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = "rgba(0,255,0,0.1)";
    ctx.fill();
  } else {
    // Circle fallback collider
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,255,0,0.8)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,0,0.1)";
    ctx.fill();
  }

  ctx.restore();
}

const GameCanvas = forwardRef<GameCanvasHandle, Props>(
  ({ fruitSet, nextDef, onEvents, onTap, onReady, onSetSeed, width, height, scale }, ref) => {
    const { colors } = useTheme();
    const { t } = useTranslation("cascade");

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const engineRef = useRef<EngineHandle | null>(null);
    const onEventsRef = useRef(onEvents);
    const onReadyRef = useRef(onReady);
    const fruitSetRef = useRef(fruitSet);
    const colorsRef = useRef(colors);
    const nextDefRef = useRef(nextDef);
    const bodiesRef = useRef<BodySnapshot[]>([]);
    const pointerXRef = useRef<number | null>(null);
    const scaleRef = useRef(scale);
    const htmlImagesRef = useRef<(CanvasImageSource | null)[]>([]);
    const lastFrameTimeRef = useRef<number>(0); // tracks last RAF timestamp for elapsed-time physics

    useEffect(() => {
      onEventsRef.current = onEvents;
    }, [onEvents]);
    useEffect(() => {
      onReadyRef.current = onReady;
    }, [onReady]);
    useEffect(() => {
      fruitSetRef.current = fruitSet;
    }, [fruitSet]);
    useEffect(() => {
      colorsRef.current = colors;
    }, [colors]);
    useEffect(() => {
      nextDefRef.current = nextDef;
    }, [nextDef]);
    useEffect(() => {
      scaleRef.current = scale;
    }, [scale]);

    // Load baked HTMLImageElements for the current fruit set via expo-asset.
    // Baked PNGs are pre-composited and clipped — no cleanImage() needed at runtime.
    useEffect(() => {
      const fruits = fruitSet.fruits;
      const images: (CanvasImageSource | null)[] = new Array(fruits.length).fill(null);
      htmlImagesRef.current = images;
      let cancelled = false;

      (async () => {
        await Promise.all(
          fruits.map(async (def, i) => {
            const iconSrc = def.bakedIcon ?? def.icon;
            if (!iconSrc) return;
            try {
              const asset = Asset.fromModule(iconSrc as number);
              await asset.downloadAsync();
              const uri = asset.localUri ?? asset.uri;
              if (!uri || cancelled) return;
              await new Promise<void>((resolve) => {
                const img = new window.Image();
                img.crossOrigin = "anonymous";
                img.src = uri;
                img.onload = () => {
                  if (!cancelled) images[i] = img;
                  resolve();
                };
                img.onerror = () => resolve();
              });
            } catch {
              // Image failed to load — colored circle fallback stays
            }
          })
        );
      })();

      return () => {
        cancelled = true;
      };
    }, [fruitSet]);

    // Stable draw function — reads everything from refs to avoid recreating the RAF loop
    const draw = useCallback(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const c = colorsRef.current;
      const nd = nextDefRef.current;
      const fs = fruitSetRef.current;
      const dangerY = height * DANGER_LINE_RATIO;

      const s = scaleRef.current;
      const displayW = width * s;
      const displayH = height * s;

      ctx.clearRect(0, 0, displayW, displayH);

      // Apply uniform scale: all drawing coords are in world units
      ctx.save();
      ctx.scale(s, s);

      // Background
      ctx.fillStyle = c.fruitBackground;
      ctx.fillRect(0, 0, width, height);

      // Walls
      ctx.fillStyle = c.border;
      ctx.fillRect(0, 0, WALL_THICKNESS, height);
      ctx.fillRect(width - WALL_THICKNESS, 0, WALL_THICKNESS, height);
      ctx.fillRect(0, height - WALL_THICKNESS, width, WALL_THICKNESS);

      // Danger line
      ctx.save();
      ctx.strokeStyle = "rgba(239,68,68,0.4)";
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(WALL_THICKNESS, dangerY);
      ctx.lineTo(width - WALL_THICKNESS, dangerY);
      ctx.stroke();
      ctx.restore();

      // Ghost fruit + guide line
      const pointerX = pointerXRef.current;
      if (pointerX !== null) {
        const ghostCx = clamp(
          pointerX,
          WALL_THICKNESS + nd.radius,
          width - WALL_THICKNESS - nd.radius
        );
        ctx.save();
        ctx.globalAlpha = 0.7;
        ctx.strokeStyle = "rgba(255,255,255,0.25)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 6]);
        ctx.beginPath();
        ctx.moveTo(ghostCx, dangerY);
        ctx.lineTo(ghostCx, height - WALL_THICKNESS);
        ctx.stroke();
        // Drop shadow
        ctx.fillStyle = "rgba(0,0,0,0.25)";
        ctx.beginPath();
        ctx.arc(ghostCx + 2, DROP_Y + 3, nd.radius + 1, 0, Math.PI * 2);
        ctx.fill();
        drawFruitBody(
          ctx,
          nd,
          ghostCx,
          DROP_Y,
          0, // ghost has no rotation
          htmlImagesRef.current[nd.tier] ?? null
        );
        ctx.restore();
      }

      // Physics bodies — sorted by Y so lower fruits draw on top of higher ones
      const bodies = [...bodiesRef.current].sort((a, b) => a.y - b.y);
      for (const body of bodies) {
        const def = fs.fruits[body.tier];
        if (!def) continue;
        drawFruitBody(
          ctx,
          def,
          body.x,
          body.y,
          body.angle,
          htmlImagesRef.current[body.tier] ?? null
        );
        if (DEBUG_COLLISION) {
          drawCollisionOverlay(ctx, body.x, body.y, body.angle, def.radius, body.collisionVerts);
        }
      }

      // Redraw walls on top so bin edges are always in front of fruit sprites
      ctx.fillStyle = c.border;
      ctx.fillRect(0, 0, WALL_THICKNESS, height);
      ctx.fillRect(width - WALL_THICKNESS, 0, WALL_THICKNESS, height);
      ctx.fillRect(0, height - WALL_THICKNESS, width, WALL_THICKNESS);

      ctx.restore(); // undo ctx.scale(s, s)
    }, [width, height]); // width/height trigger engine reset anyway, so deps here are stable

    // Keep latest draw in a ref so the RAF loop never needs to be torn down
    const drawRef = useRef(draw);
    useEffect(() => {
      drawRef.current = draw;
    }, [draw]);

    const initEngine = useCallback(async () => {
      engineRef.current?.cleanup();
      engineRef.current = null;
      bodiesRef.current = [];
      engineRef.current = await createEngine(width, height, fruitSet);
      // Notify listeners — CascadeScreen uses this to know when it's
      // safe to restore saved fruits via restoreFruits().
      onReadyRef.current?.();
    }, [width, height, fruitSet]);

    useEffect(() => {
      initEngine();
      return () => {
        engineRef.current?.cleanup();
      };
    }, [initEngine]);

    // Debug: keyboard shortcuts to spawn any tier fruit (0-9, 'q' for tier 10)
    useEffect(() => {
      if (!DEBUG_COLLISION) return;
      function onKey(e: KeyboardEvent) {
        const engine = engineRef.current;
        const fs = fruitSetRef.current;
        if (!engine || !fs) return;
        let tier = -1;
        if (e.key >= "0" && e.key <= "9") tier = parseInt(e.key, 10);
        else if (e.key === "q" || e.key === "Q") tier = 10;
        else return;
        const def = fs.fruits[tier];
        if (!def) return;
        const spawnX =
          WALL_THICKNESS +
          def.radius +
          Math.random() * (width - 2 * WALL_THICKNESS - 2 * def.radius);
        engine.drop(def, fs.id, spawnX, DROP_Y);
      }
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }, [width]);

    // Single long-lived RAF loop: steps physics then draws.
    // Uses the RAF timestamp to compute elapsed time so physics runs at real
    // wall-clock speed regardless of display refresh rate (60 Hz, 120 Hz, etc.).
    useEffect(() => {
      let id: number;
      function loop(timestamp: number) {
        if (lastFrameTimeRef.current === 0) lastFrameTimeRef.current = timestamp;
        const elapsed = (timestamp - lastFrameTimeRef.current) / 1000; // seconds
        lastFrameTimeRef.current = timestamp;

        // Warn when dt hits the engine clamp boundaries (1/120 s – 1/30 s).
        // Triggers on: slow frames, foldable display-panel switches, tab
        // backgrounding, or a blocking network call on the main thread.
        if (__DEV__ && elapsed > 0 && (elapsed > 1 / 30 || elapsed < 1 / 120)) {
          console.warn(
            `[GameCanvas] dt=${elapsed.toFixed(4)}s outside [1/120, 1/30] — will be clamped by engine`
          );
        }

        if (engineRef.current) {
          const result = engineRef.current.step(elapsed);
          bodiesRef.current = result.snapshots;
          if (result.events.length > 0) {
            onEventsRef.current?.(result.events);
          }
        }
        drawRef.current();
        id = requestAnimationFrame(loop);
      }

      // When the tab/display becomes visible again after a suspension (e.g.
      // foldable display-panel switch, app backgrounding), reset the frame
      // timer so the first post-resume frame doesn't simulate accumulated
      // idle time.  Without this, a long suspension produces a large elapsed
      // that — even after the engine clamps it to 1/30 s — can trigger the
      // upward-velocity anomaly reported in #552.
      function handleVisibilityChange() {
        if (!document.hidden) {
          lastFrameTimeRef.current = 0;
        }
      }
      document.addEventListener("visibilitychange", handleVisibilityChange);

      id = requestAnimationFrame(loop);
      return () => {
        cancelAnimationFrame(id);
        document.removeEventListener("visibilitychange", handleVisibilityChange);
      };
    }, []); // intentionally empty — loop lives for component lifetime

    useImperativeHandle(ref, () => {
      const getEngineState = (): CascadeEngineState => {
        const bodies = bodiesRef.current;
        const dangerY = height * DANGER_LINE_RATIO;
        let dangerRatio = 0;
        if (bodies.length > 0) {
          const minTopY = Math.min(
            ...bodies.map((b) => b.y - (fruitSetRef.current.fruits[b.tier]?.radius ?? 0))
          );
          dangerRatio = Math.max(0, Math.min(1, 1 - minTopY / dangerY));
        }
        return {
          fruitCount: bodies.length,
          dangerRatio,
          fruits: bodies.map((b) => ({
            id: b.id,
            tier: b.tier,
            x: Math.round(b.x),
            y: Math.round(b.y),
            angle: b.angle,
          })),
        };
      };

      const base: GameCanvasHandle = {
        drop(def, x) {
          if (!engineRef.current) return;
          const clamped = clamp(
            x,
            WALL_THICKNESS + def.radius,
            width - WALL_THICKNESS - def.radius
          );
          engineRef.current.drop(def, fruitSetRef.current.id, clamped, DROP_Y);
        },
        reset() {
          initEngine();
        },
        announceEvent(message) {
          AccessibilityInfo.announceForAccessibility(message);
        },
        isReady() {
          return engineRef.current !== null;
        },
        getEngineState,
        restoreFruits(fruits, restoringSet) {
          if (!engineRef.current) return;
          for (const f of fruits) {
            const def = restoringSet.fruits[f.tier];
            if (!def) continue;
            // Drop at the saved (x, y) with zero velocity. The fruit
            // starts at rest and physics settles it over the next frame.
            const clampedX = clamp(
              f.x,
              WALL_THICKNESS + def.radius,
              width - WALL_THICKNESS - def.radius
            );
            engineRef.current.drop(def, restoringSet.id, clampedX, f.y);
          }
        },
      };

      if (process.env.EXPO_PUBLIC_TEST_HOOKS !== "1") return base;

      return {
        ...base,
        fastForward(ms: number) {
          if (!engineRef.current) return;
          const STEP_S = 1 / 60; // ~16.67 ms per step
          const steps = Math.ceil(ms / (STEP_S * 1000));
          for (let i = 0; i < steps; i++) {
            const result = engineRef.current.step(STEP_S);
            bodiesRef.current = result.snapshots;
            if (result.events.length > 0) {
              onEventsRef.current?.(result.events);
            }
          }
          drawRef.current();
        },
        setSeed(seed: number) {
          onSetSeed?.(seed);
        },
      };
    }, [initEngine, width, height, onSetSeed]);

    const panGesture = Gesture.Pan()
      .runOnJS(true)
      .minDistance(0)
      .onBegin((e) => {
        pointerXRef.current = e.x / scaleRef.current;
      })
      .onChange((e) => {
        pointerXRef.current = e.x / scaleRef.current;
      })
      .onEnd((e) => {
        if (pointerXRef.current !== null) onTap(e.x / scaleRef.current);
      })
      .onFinalize(() => {
        pointerXRef.current = null;
      });
    const tapGesture = Gesture.Tap()
      .runOnJS(true)
      .onEnd((e, ok) => {
        if (ok) onTap(e.x / scaleRef.current);
      });
    const composed = Gesture.Exclusive(panGesture, tapGesture);

    const displayW = Math.round(width * scale);
    const displayH = Math.round(height * scale);

    return (
      <GestureDetector gesture={composed}>
        <View
          style={{ width: displayW, height: displayH, borderRadius: 12, overflow: "hidden" }}
          accessibilityLabel={t("game.canvasLabel")}
          accessibilityRole="image"
        >
          <canvas
            ref={canvasRef}
            width={displayW}
            height={displayH}
            style={{ display: "block", borderRadius: 12 }}
          />
        </View>
      </GestureDetector>
    );
  }
);

GameCanvas.displayName = "GameCanvas";
export default GameCanvas;
