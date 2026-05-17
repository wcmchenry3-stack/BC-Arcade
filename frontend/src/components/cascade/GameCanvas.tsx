/**
 * GameCanvas — native (iOS / Android)
 * Rendered via @shopify/react-native-skia.
 * Metro automatically uses GameCanvas.web.tsx on the web platform.
 */
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { AccessibilityInfo, View, Text, StyleSheet } from "react-native";
import {
  Canvas,
  Circle,
  DashPathEffect,
  Fill,
  Group,
  Image as SkiaImage,
  Path,
  Rect,
  Skia,
} from "@shopify/react-native-skia";
import type { SkImage } from "@shopify/react-native-skia";
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
import { useFruitImages, getImagesForSet } from "../../theme/useFruitImages";

const DROP_Y = 30;

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
   * Current engine state snapshot. Returns empty on native — native
   * Skia canvas doesn't mirror bodies outside of React state yet, so
   * #216 reload persistence falls back to saving score only on mobile.
   */
  getEngineState: () => CascadeEngineState;
  /**
   * Restore fruits from a saved snapshot. No-op on native until the
   * native canvas exposes its body ref; see #216 PR description.
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
  /** Fires once after createEngine() resolves. */
  onReady?: () => void;
  /** Callback that rebuilds the spawn queue with a seeded RNG. Test-only. */
  onSetSeed?: (seed: number) => void;
  width: number; // world width (px) — physics coordinate space
  height: number; // world height (px) — physics coordinate space
  scale: number; // display scale: canvas CSS size = world * scale
}

/**
 * Renders a single baked fruit sprite.
 *
 * Baked PNGs are pre-composited and clipped offline by bake_sprites.py.
 * The image represents a square of side 2 * bakedClipR * radius centred on
 * the body — a single SkiaImage draw is all that's needed.
 */
function FruitBodySkia({
  x,
  y,
  radius,
  color,
  image,
  angle,
  bakedClipR,
}: {
  x: number;
  y: number;
  radius: number;
  color: string;
  image: SkImage | null;
  angle: number;
  bakedClipR: number;
}) {
  if (image) {
    const clipR = bakedClipR * radius;
    return (
      <Group transform={[{ translateX: x }, { translateY: y }, { rotate: angle }]}>
        <SkiaImage
          image={image}
          x={-clipR}
          y={-clipR}
          width={clipR * 2}
          height={clipR * 2}
          fit="fill"
        />
      </Group>
    );
  }
  return <Circle cx={x} cy={y} r={radius} color={color} />;
}

const GameCanvas = forwardRef<GameCanvasHandle, Props>(
  ({ fruitSet, nextDef, onEvents, onTap, onReady, width, height, scale }, ref) => {
    const { colors } = useTheme();
    const { t } = useTranslation("cascade");

    // Load all fruit/planet images via Skia (native only)
    const allImages = useFruitImages();
    const images = getImagesForSet(allImages, fruitSet.id);

    const [bodies, setBodies] = useState<BodySnapshot[]>([]);
    const [pointerX, setPointerX] = useState<number | null>(null);
    const [engineError, setEngineError] = useState<string | null>(null);

    const engineRef = useRef<EngineHandle | null>(null);
    const lastFrameTimeRef = useRef<number>(0); // tracks last RAF timestamp for elapsed-time physics
    const onEventsRef = useRef(onEvents);
    const onReadyRef = useRef(onReady);
    const fruitSetRef = useRef(fruitSet);

    useEffect(() => {
      onEventsRef.current = onEvents;
    }, [onEvents]);
    useEffect(() => {
      onReadyRef.current = onReady;
    }, [onReady]);
    useEffect(() => {
      fruitSetRef.current = fruitSet;
    }, [fruitSet]);

    const initEngine = useCallback(async () => {
      engineRef.current?.cleanup();
      engineRef.current = null;
      setBodies([]);
      setEngineError(null);
      try {
        engineRef.current = await createEngine(width, height, fruitSet);
      } catch (err) {
        setEngineError(err instanceof Error ? err.message : String(err));
        return;
      }
      onReadyRef.current?.();
    }, [width, height, fruitSet]);

    useEffect(() => {
      initEngine();
      return () => {
        engineRef.current?.cleanup();
      };
    }, [initEngine]);

    // RAF loop drives physics steps and triggers re-renders
    // RAF loop: steps physics with wall-clock elapsed time so speed is
    // frame-rate-independent (60 Hz, 120 Hz, etc.).
    useEffect(() => {
      let id: number;
      function loop(timestamp: number) {
        if (lastFrameTimeRef.current === 0) lastFrameTimeRef.current = timestamp;
        // Clamp to 1/30s (33ms) so a panel-switch or tab-resume can't feed a
        // multi-second delta that causes impulse spikes and boundary tunnelling.
        const elapsed = Math.min((timestamp - lastFrameTimeRef.current) / 1000, 1 / 30);
        lastFrameTimeRef.current = timestamp;
        if (engineRef.current) {
          const result = engineRef.current.step(elapsed);
          setBodies(result.snapshots);
          if (result.events.length > 0) {
            onEventsRef.current?.(result.events);
          }
        }
        id = requestAnimationFrame(loop);
      }
      id = requestAnimationFrame(loop);
      return () => cancelAnimationFrame(id);
    }, []); // intentionally empty — loop lives for component lifetime

    useImperativeHandle(
      ref,
      () => ({
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
        // Native fallbacks — the native Skia canvas doesn't expose its
        // body ref, so #216 reload persistence saves score only on
        // mobile. Full parity is tracked as a native-canvas follow-up.
        getEngineState() {
          return { fruitCount: 0, dangerRatio: 0, fruits: [] };
        },
        restoreFruits() {
          // no-op
        },
      }),
      [initEngine, width]
    );

    const dangerY = height * DANGER_LINE_RATIO;

    const dangerPath = useMemo(() => {
      const p = Skia.Path.Make();
      p.moveTo(WALL_THICKNESS, dangerY);
      p.lineTo(width - WALL_THICKNESS, dangerY);
      return p;
    }, [width, dangerY]);

    const ghostCx =
      pointerX !== null
        ? clamp(pointerX, WALL_THICKNESS + nextDef.radius, width - WALL_THICKNESS - nextDef.radius)
        : null;

    const guidePath = useMemo(() => {
      if (ghostCx === null) return null;
      const p = Skia.Path.Make();
      p.moveTo(ghostCx, dangerY);
      p.lineTo(ghostCx, height - WALL_THICKNESS);
      return p;
    }, [ghostCx, dangerY, height]);

    if (engineError) {
      return (
        <View style={[styles.errorContainer, { width, height, backgroundColor: colors.surface }]}>
          <Text style={[styles.errorText, { color: colors.textMuted }]}>
            {t("game.engineUnsupported")}
          </Text>
        </View>
      );
    }

    const panGesture = Gesture.Pan()
      .runOnJS(true)
      .minDistance(0)
      .onBegin((e) => setPointerX(e.x / scale))
      .onChange((e) => setPointerX(e.x / scale))
      .onEnd((e) => {
        if (pointerX !== null) onTap(e.x / scale);
      })
      .onFinalize(() => setPointerX(null));
    const tapGesture = Gesture.Tap()
      .runOnJS(true)
      .onEnd((e, ok) => {
        if (ok) onTap(e.x / scale);
      });
    const composed = Gesture.Exclusive(panGesture, tapGesture);

    const displayW = Math.round(width * scale);
    const displayH = Math.round(height * scale);

    return (
      <GestureDetector gesture={composed}>
        <Canvas
          style={{ width: displayW, height: displayH, borderRadius: 12, overflow: "hidden" }}
          accessibilityLabel={t("game.canvasLabel")}
          accessibilityRole="none"
        >
          <Group transform={[{ scale }]}>
            <Fill color={colors.fruitBackground} />
            <Rect x={0} y={0} width={WALL_THICKNESS} height={height} color={colors.border} />
            <Rect
              x={width - WALL_THICKNESS}
              y={0}
              width={WALL_THICKNESS}
              height={height}
              color={colors.border}
            />
            <Rect
              x={0}
              y={height - WALL_THICKNESS}
              width={width}
              height={WALL_THICKNESS}
              color={colors.border}
            />
            <Path path={dangerPath} color="rgba(239,68,68,0.4)" style="stroke" strokeWidth={1}>
              <DashPathEffect intervals={[6, 4]} phase={0} />
            </Path>
            {ghostCx !== null && guidePath !== null && (
              <Group opacity={0.7}>
                <Path
                  path={guidePath}
                  color="rgba(255,255,255,0.25)"
                  style="stroke"
                  strokeWidth={1.5}
                >
                  <DashPathEffect intervals={[4, 6]} phase={0} />
                </Path>
                <Circle
                  cx={ghostCx + 2}
                  cy={DROP_Y + 3}
                  r={nextDef.radius + 1}
                  color="rgba(0,0,0,0.25)"
                />
                <FruitBodySkia
                  x={ghostCx}
                  y={DROP_Y}
                  radius={nextDef.radius}
                  color={nextDef.color}
                  image={images[nextDef.tier] ?? null}
                  angle={0}
                  bakedClipR={nextDef.bakedClipR ?? 1}
                />
              </Group>
            )}
            {bodies.map((body) => {
              const def = fruitSet.fruits[body.tier];
              if (!def) return null;
              return (
                <FruitBodySkia
                  key={body.id}
                  x={body.x}
                  y={body.y}
                  radius={def.radius}
                  color={def.color}
                  image={images[body.tier] ?? null}
                  angle={body.angle}
                  bakedClipR={def.bakedClipR ?? 1}
                />
              );
            })}
          </Group>
        </Canvas>
      </GestureDetector>
    );
  }
);

GameCanvas.displayName = "GameCanvas";
export default GameCanvas;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

const styles = StyleSheet.create({
  errorContainer: {
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
  },
  errorText: {
    fontSize: 14,
    textAlign: "center",
    paddingHorizontal: 24,
  },
});
