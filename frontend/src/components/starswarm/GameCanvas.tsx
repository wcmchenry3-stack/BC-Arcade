import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
} from "react-native-reanimated";
import { StyleSheet, Text, View } from "react-native";
import {
  Canvas,
  Circle,
  Fill,
  Group,
  Image as SkiaImage,
  Path,
  Picture,
  Rect,
  createPicture,
} from "@shopify/react-native-skia";
import { useTranslation } from "react-i18next";
import * as Sentry from "@sentry/react-native";
import {
  initStarSwarm,
  tick,
  applyPowerUp,
  difficultyLabel,
  difficultyMultiplier,
  decayMissionCompleteTimer,
  isBossWave,
  routJustStarted,
  fleeingCount,
  carrierJustExposed,
  throwAsteroid,
  killEscorts,
  carrierBeamJustStarted,
  carrierBeamJustFired,
  reinforcementsJustLaunched,
  upgradeEvents,
} from "../../game/starswarm/engine";
import { WAVE_COUNTDOWN_MS } from "../../game/starswarm/constants";
import { areTestHooksEnabled, isPreLaunchApiBuild } from "../../game/_shared/envFlags";
import {
  createFrameStats,
  recordCommit,
  recordFrame,
  summarizeFrameStats,
} from "../../game/starswarm/render/frameStats";
import type { FrameStatsSummary } from "../../game/starswarm/render/frameStats";
import { initStarfield, tickStarfield } from "../../game/starswarm/starfield";
import { sameFrame, starfieldRuns } from "../../game/starswarm/render/publish";
import { deriveHud, hudCues, publishHud, POWERUP_BAR_WIDTH } from "../../game/starswarm/render/hud";
import type { HudState, HudCues } from "../../game/starswarm/render/hud";
import type { FrameInputs } from "../../game/starswarm/render/publish";
import type { StarfieldState } from "../../game/starswarm/starfield";
import {
  useStarSwarmImages,
  loadedSprites,
  drawImagesOf,
  sameDrawImages,
} from "../../game/starswarm/assets";
import { drawFrame } from "../../game/starswarm/render/drawFrame";
import type { DrawImages } from "../../game/starswarm/render/drawFrame";
import type { StarSwarmImages } from "../../game/starswarm/assets";
import { buildFrame, polyPath, mirrorAxisX } from "../../game/starswarm/render/frame";
import type { DrawOp } from "../../game/starswarm/render/frame";
import type {
  StarSwarmState,
  PowerUpType,
  DifficultyTier,
  CarrierEvent,
  UpgradeEvent,
} from "../../game/starswarm/types";

const DT_CAP_MS = 33;

export interface DevOptions {
  wave?: number;
  infiniteLives?: boolean;
  stragglerEnabled?: boolean;
  /** Suppress straggler aggression for easier wave-end testing (#1039). */
  pauseStraggler?: boolean;
  /** Override difficulty tier for this game (#1037). */
  difficulty?: DifficultyTier;
  /** Suppress player bullet spawning (#1311). */
  playerFireDisabled?: boolean;
  /** Suppress enemy bullet spawning (#1311). */
  enemyFireDisabled?: boolean;
  /** Suppress timed asteroid spawns (#2486). */
  asteroidsDisabled?: boolean;
  /** Enemies never roll to dodge a rock (#2491). */
  dodgeDisabled?: boolean;
  /** Enemies never fire flak at a rock (#2491). */
  flakDisabled?: boolean;
  /** Grunts never rout when the leaders die (#2489). */
  routDisabled?: boolean;
  /**
   * #2565: "picture" (default) draws the frame on the UI thread as one Skia Picture; "react" is
   * the phase-2 declarative path, kept for side-by-side comparison until phase 5 (#2567).
   */
  rendererMode?: RendererMode;
}

export type RendererMode = "picture" | "react";

export interface GameCanvasHandle {
  setPlayerX: (x: number) => void;
  setFire: (fire: boolean) => void;
  /** Inject a power-up activation mid-game for dev-panel testing (#1039). */
  triggerPowerUp: (type: PowerUpType) => void;
  /** Throw an asteroid now — dev-panel testing (#2486). */
  throwAsteroid: () => void;
  /** Destroy every escort so the Carrier is exposed at once — dev-panel testing (#2491). */
  killEscorts: () => void;
  /** Return the current engine state snapshot — used by StarSwarmScreen to save paused state (#1367). */
  getState: () => StarSwarmState;
  /** #2567: the last second of frame times and React commits, or null when sampling is off. */
  getFrameStats: () => FrameStatsSummary | null;
}

/**
 * #2567: frame-time sampling runs in dev builds, internal pre-launch builds (TestFlight / Play
 * test, where the numbers are measured) and E2E test builds — never in a store build.
 */
const FRAME_STATS_ENABLED = __DEV__ || isPreLaunchApiBuild() || areTestHooksEnabled();

/** #2565: a throw inside the UI-thread renderer is reported once, on the JS thread. */
function reportDrawError(message: string): void {
  Sentry.captureMessage(`starswarm.drawFrame: ${message}`, {
    level: "error",
    tags: { subsystem: "starswarm.render" },
  });
}

/**
 * #2565: hand the latest display list to the UI-thread renderer. Built on the JS thread (where
 * every drawing decision is made and tested) and copied across once per published frame.
 */
function publishPicture(
  frameSV: { value: readonly DrawOp[] },
  inputs: FrameInputs,
  loaded: ReturnType<typeof loadedSprites>,
  width: number,
  height: number
): void {
  frameSV.value = buildFrame(inputs.game, inputs.sf, { loaded, width, height });
}

/** #2564: one Skia element per display-list op. No decisions here — buildFrame made them. */
function renderOp(op: DrawOp, images: StarSwarmImages): React.ReactElement | null {
  switch (op.k) {
    case "fill":
      return <Fill key={op.key} color={op.color} />;
    case "rect":
      return (
        <Rect
          key={op.key}
          x={op.x}
          y={op.y}
          width={op.w}
          height={op.h}
          color={op.color}
          {...(op.opacity !== undefined ? { opacity: op.opacity } : {})}
        />
      );
    case "circle":
      return (
        <Circle
          key={op.key}
          cx={op.cx}
          cy={op.cy}
          r={op.r}
          color={op.color}
          {...(op.opacity !== undefined ? { opacity: op.opacity } : {})}
          {...(op.stroke !== undefined ? { style: "stroke", strokeWidth: op.stroke } : {})}
        />
      );
    case "image": {
      const image =
        op.sprite === "explosion" ? images.explosionFrames[op.frame ?? 0] : images[op.sprite];
      if (!image) return null; // buildFrame only emits loaded sprites; belt and braces
      const el = (
        <SkiaImage
          key={op.key}
          image={image}
          x={op.x}
          y={op.y}
          width={op.w}
          height={op.h}
          fit={op.fit}
        />
      );
      if (!op.flipX) return el;
      const cx = mirrorAxisX(op);
      return (
        <Group key={op.key} transform={[{ translateX: cx }, { scaleX: -1 }, { translateX: -cx }]}>
          {el}
        </Group>
      );
    }
    case "poly": {
      return (
        <Path
          key={op.key}
          path={polyPath(op.points)}
          color={op.color}
          {...(op.stroke !== undefined ? { style: "stroke", strokeWidth: op.stroke } : {})}
        />
      );
    }
  }
}

interface Props {
  highScore?: number;
  onGameOver?: (finalScore: number, wave: number) => void;
  onScoreChange?: (score: number) => void;
  onPlayerHit?: () => void;
  onWaveClear?: () => void;
  onLaserFire?: () => void;
  onExplosion?: () => void;
  /** #2490: called once when a boss wave (the Carrier and its escorts, nothing else) begins. */
  onBossWave?: () => void;
  /** #2489: called once when the wave's grunts rout, with how many are fleeing. */
  onRout?: (count: number) => void;
  onBonusLife?: () => void;
  onPowerUpCollect?: (type: PowerUpType) => void;
  /** #2484: called once when the last Boss escort dies and the Carrier's armor drops. */
  onCarrierExposed?: () => void;
  /** #2485: beam telegraph, beam firing, reinforcement launch. */
  onCarrierEvent?: (kind: CarrierEvent) => void;
  /** #2488: a gun or hull ladder change (pickup collected, plating hit, level lost). */
  onUpgrade?: (ev: UpgradeEvent) => void;
  isPaused?: boolean;
  onPause?: () => void;
  width: number;
  height: number;
  scale: number;
  /** Increments each time a new game is requested — triggers an internal reset. */
  resetTick?: number;
  /** Active difficulty tier — passed from the pre-game selector (#1037). */
  difficulty?: DifficultyTier;
  /** Dev options applied on each reset (wave, infiniteLives). Passed as prop so reset
   *  is reactive and doesn't depend on the imperative ref being non-null. */
  devOptions?: DevOptions;
  /** Seed the engine with an existing state instead of initialState() — used to restore a paused session (#1367). */
  initialState?: StarSwarmState;
}

/** #2563: what the render reads each frame — see render/publish.ts for when it is published. */
type RenderState = FrameInputs;

const GameCanvas = forwardRef<GameCanvasHandle, Props>(
  (
    {
      highScore = 0,
      onGameOver,
      onScoreChange,
      onPlayerHit,
      onWaveClear,
      onLaserFire,
      onExplosion,
      onBossWave,
      onRout,
      onBonusLife,
      onPowerUpCollect,
      onCarrierExposed,
      onCarrierEvent,
      onUpgrade,
      isPaused = false,
      width,
      height,
      scale,
      resetTick,
      difficulty: difficultyProp = "LieutenantJG",
      devOptions,
      initialState,
    },
    ref
  ) => {
    const { t } = useTranslation("starswarm");
    const images = useStarSwarmImages();
    // #2565: a stable image set for the UI thread — a new object only when an image loads, so
    // the picture worklet (which captures it) is rebuilt only when there is something to add.
    const drawImagesRef = useRef<DrawImages>(drawImagesOf(images));
    const nextDrawImages = drawImagesOf(images);
    if (!sameDrawImages(drawImagesRef.current, nextDrawImages)) {
      drawImagesRef.current = nextDrawImages;
    }
    const drawImages = drawImagesRef.current;
    const loadedRef = useRef(loadedSprites(images));
    loadedRef.current = loadedSprites(images);
    const sizeRef = useRef({ width, height });
    sizeRef.current = { width, height };
    const rendererMode: RendererMode = devOptions?.rendererMode ?? "picture";

    const gameRef = useRef<StarSwarmState>(
      initialState ??
        initStarSwarm(
          width,
          height,
          1,
          (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0,
          difficultyProp
        )
    );
    const sfRef = useRef<StarfieldState>(initStarfield(width, height));
    const inputRef = useRef({ playerX: width / 2, fire: true });
    const infiniteLivesRef = useRef(false);
    // Assign during render (not via effect) so the reset effect always reads the
    // latest devOptions even though devOptions is not in its dependency array.
    const devOptionsRef = useRef<DevOptions | undefined>(devOptions);
    devOptionsRef.current = devOptions;
    const difficultyRef = useRef<DifficultyTier>(difficultyProp);
    difficultyRef.current = difficultyProp;
    // ms remaining in pre-wave countdown; null = no countdown active.
    // Restored sessions skip the countdown; new games and each new wave get 3 s.
    // countdownDigit in renderState must be initialized consistently with this value.
    const countdownMsRef = useRef<number | null>(initialState ? null : WAVE_COUNTDOWN_MS);
    // True when the active countdown follows a wave clear (shows the "— WAVE N —" banner).
    // Tracked as a separate boolean so it doesn't depend on the countdown duration value.
    const waveBannerCountdownRef = useRef(false);
    const lastFrameTimeRef = useRef(0);
    const frameStatsRef = useRef(FRAME_STATS_ENABLED ? createFrameStats() : null);
    // #2567: count this component's React commits for the "Frame" readout (no deps: every commit)
    useEffect(() => {
      if (frameStatsRef.current) recordCommit(frameStatsRef.current, performance.now());
    });
    const prevScoreRef = useRef(0);
    const prevLivesRef = useRef(gameRef.current.player.lives);
    const prevPhaseRef = useRef(gameRef.current.phase);
    // #2352: wave clear now advances the wave in the same tick (no WinTransition phase to
    // detect) — the wave counter bumping is the signal that a clear just happened.
    const prevWaveRef = useRef(gameRef.current.wave);
    const isPausedRef = useRef(isPaused);
    const onGameOverRef = useRef(onGameOver);
    const onScoreChangeRef = useRef(onScoreChange);
    const onPlayerHitRef = useRef(onPlayerHit);
    const onWaveClearRef = useRef(onWaveClear);
    const onLaserFireRef = useRef(onLaserFire);
    const onExplosionRef = useRef(onExplosion);
    const onBossWaveRef = useRef(onBossWave);
    const onRoutRef = useRef(onRout);
    const onBonusLifeRef = useRef(onBonusLife);
    const onPowerUpCollectRef = useRef(onPowerUpCollect);
    const onCarrierExposedRef = useRef(onCarrierExposed);
    const onCarrierEventRef = useRef(onCarrierEvent);
    const onUpgradeRef = useRef(onUpgrade);
    const prevActivePowerUpRef = useRef<string | null>(null); // type of active power-up last frame
    const triggerPowerUpRef = useRef<PowerUpType | null>(null);
    const throwAsteroidRef = useRef(false); // #2486
    const killEscortsRef = useRef(false); // #2491
    const prevBonusLivesRef = useRef(gameRef.current.bonusLivesAwarded);
    const bonusFlashEndRef = useRef(0); // ms timestamp when 1UP flash expires

    useEffect(() => {
      const wasPaused = isPausedRef.current;
      isPausedRef.current = isPaused;
      if (wasPaused && !isPaused) lastFrameTimeRef.current = 0; // prevent delta spike on resume
    }, [isPaused]);
    useEffect(() => {
      onGameOverRef.current = onGameOver;
    }, [onGameOver]);
    useEffect(() => {
      onScoreChangeRef.current = onScoreChange;
    }, [onScoreChange]);
    useEffect(() => {
      onPlayerHitRef.current = onPlayerHit;
    }, [onPlayerHit]);
    useEffect(() => {
      onWaveClearRef.current = onWaveClear;
    }, [onWaveClear]);
    useEffect(() => {
      onLaserFireRef.current = onLaserFire;
    }, [onLaserFire]);
    useEffect(() => {
      onExplosionRef.current = onExplosion;
    }, [onExplosion]);
    useEffect(() => {
      onBossWaveRef.current = onBossWave;
    }, [onBossWave]);
    useEffect(() => {
      onRoutRef.current = onRout;
    }, [onRout]);
    useEffect(() => {
      onBonusLifeRef.current = onBonusLife;
    }, [onBonusLife]);
    useEffect(() => {
      onPowerUpCollectRef.current = onPowerUpCollect;
    }, [onPowerUpCollect]);
    useEffect(() => {
      onCarrierExposedRef.current = onCarrierExposed;
    }, [onCarrierExposed]);
    useEffect(() => {
      onCarrierEventRef.current = onCarrierEvent;
    }, [onCarrierEvent]);
    useEffect(() => {
      onUpgradeRef.current = onUpgrade;
    }, [onUpgrade]);

    const [renderState, setRenderState] = useState<RenderState>(() => ({
      game: gameRef.current,
      sf: sfRef.current,
      countdownDigit: initialState ? null : Math.ceil(WAVE_COUNTDOWN_MS / 1000),
      waveBannerCountdown: false,
      bonusFlash: false,
    }));
    // #2566: the HUD, published to React only when a value in it changes — a few commits a second
    // in steady play (score ticks), none while paused. `renderState` above now feeds only the
    // legacy declarative renderer (dev switch), and goes away with it in phase 5 (#2567).
    const [hud, setHud] = useState<HudState>(() =>
      deriveHud(renderState.game, {
        countdownDigit: renderState.countdownDigit,
        waveBannerCountdown: renderState.waveBannerCountdown,
        bonusFlash: renderState.bonusFlash,
      })
    );
    const hudRef = useRef<HudState>(hud);
    // #2566: the two HUD values that move every frame drive animated styles on the UI thread.
    const [initialCues] = useState<HudCues>(() => hudCues(renderState.game));
    const missionOpacitySV = useSharedValue(initialCues.missionOpacity);
    const powerUpSV = useSharedValue(initialCues.powerUpFraction);
    const cueSVRef = useRef({ mission: missionOpacitySV, powerUp: powerUpSV });
    cueSVRef.current = { mission: missionOpacitySV, powerUp: powerUpSV };
    const cuesRef = useRef<HudCues>(initialCues);
    const missionStyle = useAnimatedStyle(() => ({ opacity: missionOpacitySV.value }));
    // translateX, not width: a transform stays off the layout path; the wrap's overflow clips it
    const powerUpBarStyle = useAnimatedStyle(() => ({
      transform: [{ translateX: -POWERUP_BAR_WIDTH * (1 - powerUpSV.value) }],
    }));
    // #2563: the frame last published — to the Picture (#2565) or, under the legacy renderer, to
    // React. The loop publishes only when the next one differs, so a paused or finished game
    // stops publishing instead of reconciling ~60×/s.
    const publishedRef = useRef<RenderState>(renderState);

    // #2565: the display list for the UI-thread renderer, and the Picture recorded from it. The
    // derived value re-records only when the list, the image set or the canvas size changes.
    // Seeded with the first frame so the Picture is never blank before the first publish.
    const [initialOps] = useState(() =>
      buildFrame(renderState.game, renderState.sf, { loaded: loadedRef.current, width, height })
    );
    const frameSV = useSharedValue<readonly DrawOp[]>(initialOps);
    // Effects and the loop write through a ref: the shared value's identity is stable in the app,
    // and a ref keeps them correct (and out of dependency lists) even where it isn't.
    const frameSVRef = useRef(frameSV);
    frameSVRef.current = frameSV;
    const drawErrorReported = useSharedValue(false);
    const picture = useDerivedValue(() => {
      const ops = frameSV.value;
      return createPicture(
        (canvas) => {
          try {
            drawFrame(canvas, ops, drawImages);
          } catch (e) {
            // whatever drew before the throw stays; report once, never take down the UI thread
            if (!drawErrorReported.value) {
              drawErrorReported.value = true;
              runOnJS(reportDrawError)(String(e));
            }
          }
        },
        { width, height }
      );
    }, [drawImages, width, height]);

    // #2565: republish when sprites finish loading or the dev renderer switch flips — without
    // this a paused game would keep its fallback shapes until it resumed. A layout effect, so the
    // legacy path's catch-up render lands before paint instead of flashing a stale frame.
    useLayoutEffect(() => {
      if (rendererMode !== "picture") {
        // #2566: the legacy path reads the full frame state, which picture mode stops updating
        setRenderState(publishedRef.current);
        return;
      }
      const { width: w, height: h } = sizeRef.current;
      publishPicture(frameSVRef.current, publishedRef.current, loadedRef.current, w, h);
    }, [drawImages, rendererMode]);

    useImperativeHandle(
      ref,
      () => ({
        setPlayerX(x) {
          inputRef.current.playerX = x;
        },
        setFire(fire) {
          inputRef.current.fire = fire;
        },
        triggerPowerUp(type) {
          triggerPowerUpRef.current = type;
        },
        throwAsteroid() {
          throwAsteroidRef.current = true;
        },
        killEscorts() {
          killEscortsRef.current = true;
        },
        getState() {
          return gameRef.current;
        },
        getFrameStats() {
          const stats = frameStatsRef.current;
          return stats ? summarizeFrameStats(stats, performance.now()) : null;
        },
      }),
      []
    );

    // Prop-driven reset: fires when resetTick increments (new game requested from parent).
    // devOptionsRef.current is assigned during render so it's always current here.
    useEffect(() => {
      if (!resetTick) return;
      const opts = devOptionsRef.current;
      infiniteLivesRef.current = opts?.infiniteLives ?? false;
      gameRef.current = initStarSwarm(
        width,
        height,
        opts?.wave ?? 1,
        (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0,
        opts?.difficulty ?? difficultyRef.current
      );
      sfRef.current = initStarfield(width, height);
      countdownMsRef.current = WAVE_COUNTDOWN_MS;
      lastFrameTimeRef.current = 0;
      inputRef.current.playerX = width / 2;
      inputRef.current.fire = true;
      prevScoreRef.current = 0;
      prevLivesRef.current = gameRef.current.player.lives;
      prevPhaseRef.current = gameRef.current.phase;
      prevWaveRef.current = gameRef.current.wave;
      prevBonusLivesRef.current = gameRef.current.bonusLivesAwarded;
      bonusFlashEndRef.current = 0;
      waveBannerCountdownRef.current = false;
      // #2490: a game that opens on a boss wave (dev wave jump) is announced like a cleared-into one
      if (isBossWave(gameRef.current.wave) && !isPausedRef.current) onBossWaveRef.current?.();
      const fresh: RenderState = {
        game: gameRef.current,
        sf: sfRef.current,
        countdownDigit: Math.ceil(WAVE_COUNTDOWN_MS / 1000),
        waveBannerCountdown: false,
        bonusFlash: false,
      };
      publishedRef.current = fresh;
      if ((devOptionsRef.current?.rendererMode ?? "picture") === "picture") {
        publishPicture(frameSVRef.current, fresh, loadedRef.current, width, height);
      } else {
        setRenderState(fresh);
      }
      publishHud(fresh, hudRef, setHud, cuesRef, cueSVRef.current);
    }, [resetTick, width, height]);

    // RAF game loop — drives the engine tick, and publishes a frame to the Skia render only when
    // something drawn changed (#2563)
    useEffect(() => {
      let id: number;

      function loop(timestamp: number) {
        if (lastFrameTimeRef.current === 0) lastFrameTimeRef.current = timestamp;
        // #2567: the raw interval, before the engine's cap — a long frame is what we want to see
        const intervalMs = timestamp - lastFrameTimeRef.current;
        if (frameStatsRef.current && intervalMs > 0) {
          recordFrame(frameStatsRef.current, performance.now(), intervalMs);
        }
        const dtMs = Math.min(intervalMs, DT_CAP_MS);
        lastFrameTimeRef.current = timestamp;

        // #1039: apply dev-panel power-up injection before regular tick
        if (triggerPowerUpRef.current) {
          const type = triggerPowerUpRef.current;
          triggerPowerUpRef.current = null;
          gameRef.current = applyPowerUp(gameRef.current, type);
        }
        if (throwAsteroidRef.current) {
          throwAsteroidRef.current = false;
          gameRef.current = throwAsteroid(gameRef.current); // #2486
        }
        if (killEscortsRef.current) {
          killEscortsRef.current = false;
          gameRef.current = killEscorts(gameRef.current); // #2491
        }

        const prev = gameRef.current;
        if (prev.phase !== "GameOver" && !isPausedRef.current) {
          if (countdownMsRef.current !== null) {
            // Pre-wave countdown: freeze engine, tick the timer only. #2352: the cosmetic
            // missionCompleteTimer still needs to decay in real time here — tick() (which
            // normally decrements it) never runs while the countdown is active, so without
            // this it would stay pinned at full opacity for the whole countdown instead of
            // fading out on its own schedule.
            countdownMsRef.current = Math.max(0, countdownMsRef.current - dtMs);
            if (gameRef.current.missionCompleteTimer > 0) {
              gameRef.current = {
                ...gameRef.current,
                missionCompleteTimer: decayMissionCompleteTimer(
                  gameRef.current.missionCompleteTimer,
                  dtMs
                ),
              };
            }
            if (countdownMsRef.current === 0) countdownMsRef.current = null;
          } else {
            try {
              const prevCooldown = prev.player.shootCooldown;
              // #1039: apply pauseStraggler from devOptions each tick
              const pauseStraggler = devOptionsRef.current?.pauseStraggler ?? false;
              const playerFireDisabled = devOptionsRef.current?.playerFireDisabled ?? false;
              const enemyFireDisabled = devOptionsRef.current?.enemyFireDisabled ?? false;
              let tickInput =
                prev.pauseStraggler !== pauseStraggler ? { ...prev, pauseStraggler } : prev;
              if (tickInput.playerFireDisabled !== playerFireDisabled)
                tickInput = { ...tickInput, playerFireDisabled };
              if (tickInput.enemyFireDisabled !== enemyFireDisabled)
                tickInput = { ...tickInput, enemyFireDisabled };
              const asteroidsDisabled = devOptionsRef.current?.asteroidsDisabled ?? false; // #2486
              if (tickInput.asteroidsDisabled !== asteroidsDisabled)
                tickInput = { ...tickInput, asteroidsDisabled };
              const dodgeDisabled = devOptionsRef.current?.dodgeDisabled ?? false; // #2491
              if (tickInput.dodgeDisabled !== dodgeDisabled)
                tickInput = { ...tickInput, dodgeDisabled };
              const flakDisabled = devOptionsRef.current?.flakDisabled ?? false; // #2491
              if (tickInput.flakDisabled !== flakDisabled)
                tickInput = { ...tickInput, flakDisabled };
              const routDisabled = devOptionsRef.current?.routDisabled ?? false; // #2489
              if (tickInput.routDisabled !== routDisabled)
                tickInput = { ...tickInput, routDisabled };
              const next = tick(tickInput, dtMs, {
                playerX: inputRef.current.playerX,
                fire: inputRef.current.fire,
              });

              // Dev: when infinite lives is on, intercept any lives decrement and
              // restore lives + phase so the game never transitions to GameOver.
              let applied = next;
              if (infiniteLivesRef.current && next.player.lives < prevLivesRef.current) {
                applied = {
                  ...next,
                  phase: next.phase === "GameOver" ? prevPhaseRef.current : next.phase,
                  player: { ...next.player, lives: prevLivesRef.current, invincibleTimer: 2000 },
                };
              }

              gameRef.current = applied;
              if (applied.score !== prevScoreRef.current) {
                prevScoreRef.current = applied.score;
                onScoreChangeRef.current?.(applied.score);
              }
              if (
                applied.player.shootCooldown > prevCooldown &&
                applied.activePowerUp?.type === "lightning"
              ) {
                onLaserFireRef.current?.();
              }
              if (applied.explosions.length > prev.explosions.length) {
                onExplosionRef.current?.();
              }
              if (applied.player.lives < prevLivesRef.current) {
                if (applied.phase !== "GameOver") onPlayerHitRef.current?.();
              }
              prevLivesRef.current = applied.player.lives;
              if (applied.bonusLivesAwarded > prevBonusLivesRef.current) {
                onBonusLifeRef.current?.();
                bonusFlashEndRef.current = Date.now() + 1500;
              }
              prevBonusLivesRef.current = applied.bonusLivesAwarded;
              const nowType = applied.activePowerUp?.type ?? null;
              if (prevActivePowerUpRef.current === null && nowType !== null) {
                onPowerUpCollectRef.current?.(nowType);
              }
              prevActivePowerUpRef.current = nowType;
              // #2484: the Carrier's armor dropping has no on-screen text — surface it as an event.
              // Judged against the previous tick, and only while the Carrier is still alive.
              if (carrierJustExposed(prev, applied)) onCarrierExposedRef.current?.();
              // #2485
              if (carrierBeamJustStarted(prev, applied)) onCarrierEventRef.current?.("beamCharge");
              if (carrierBeamJustFired(prev, applied)) onCarrierEventRef.current?.("beamFire");
              if (reinforcementsJustLaunched(prev, applied))
                onCarrierEventRef.current?.("reinforce");
              for (const ev of upgradeEvents(prev, applied)) onUpgradeRef.current?.(ev); // #2488
              if (routJustStarted(prev, applied)) onRoutRef.current?.(fleeingCount(applied)); // #2489
              // #2352: wave clear no longer freezes gameplay behind a WinTransition phase —
              // the wave counter bumps in the same tick the last enemy dies. Detect that bump
              // directly instead of watching for a phase transition.
              const waveJustCleared = applied.wave > prevWaveRef.current;
              prevWaveRef.current = applied.wave;
              if (waveJustCleared) {
                onWaveClearRef.current?.();
                // #2490: a boss wave announces itself on top of the wave-clear jingle
                if (isBossWave(applied.wave)) onBossWaveRef.current?.();
              }
              // A fresh clear starts the pre-wave countdown immediately (every wave opens on SwoopIn).
              if (waveJustCleared && applied.phase === "SwoopIn") {
                countdownMsRef.current = WAVE_COUNTDOWN_MS;
                waveBannerCountdownRef.current = true;
              }
              prevPhaseRef.current = applied.phase;
              if (applied.phase === "GameOver") {
                onGameOverRef.current?.(applied.score, applied.wave);
              }
            } catch (e) {
              Sentry.captureException(e, { tags: { subsystem: "starswarm.loop" } });
            }
          }
        }
        // Starfield scrolls while the game is live; paused or over, the frame holds still (#2563)
        if (starfieldRuns(gameRef.current.phase, isPausedRef.current)) {
          sfRef.current = tickStarfield(sfRef.current, dtMs);
        }

        const countdownDigit =
          countdownMsRef.current !== null
            ? Math.max(1, Math.ceil(countdownMsRef.current / 1000))
            : null;
        const next: RenderState = {
          game: gameRef.current,
          sf: sfRef.current,
          countdownDigit,
          waveBannerCountdown: waveBannerCountdownRef.current,
          bonusFlash: Date.now() < bonusFlashEndRef.current,
        };
        // #2563: an unchanged frame is not handed to React — that is every frame while paused
        // (unless a dev-panel injection or the 1UP flash expiring changes something) and every
        // frame after game over. Live play still publishes each frame: the starfield moves.
        if (!sameFrame(publishedRef.current, next)) {
          publishedRef.current = next;
          // #2565: the scene goes to the UI thread as data. #2566: React hears about a frame only
          // when the HUD changed — or every frame under the legacy renderer, which draws from it.
          if ((devOptionsRef.current?.rendererMode ?? "picture") === "picture") {
            const { width: w, height: h } = sizeRef.current;
            publishPicture(frameSVRef.current, next, loadedRef.current, w, h);
          } else {
            setRenderState(next);
          }
          publishHud(next, hudRef, setHud, cuesRef, cueSVRef.current);
        }
        id = requestAnimationFrame(loop);
      }

      id = requestAnimationFrame(loop);
      return () => cancelAnimationFrame(id);
    }, []); // intentionally empty — loop lives for component lifetime

    const { game: state, sf } = renderState; // #2566: legacy renderer only — the HUD reads `hud`
    // #2564: every drawing decision (sprites vs fallbacks, rings, flashes, the beam, the #2334
    // hidden-ship-at-game-over rule, the invincibility blink) lives in buildFrame — tested there.
    // #2565: only the legacy declarative renderer builds it here; the Picture path builds it in
    // the loop and draws it on the UI thread.
    const legacyFrame =
      rendererMode === "react"
        ? buildFrame(state, sf, { loaded: loadedRef.current, width, height })
        : null;
    const displayW = Math.round(width * scale);
    const displayH = Math.round(height * scale);
    const hs = Math.max(highScore, hud.score);

    return (
      <View style={{ width: displayW, height: displayH }}>
        <Canvas
          style={[styles.canvas, { width: displayW, height: displayH }]}
          accessibilityLabel={t("game.canvasLabel")}
          accessibilityRole="none"
        >
          <Group transform={[{ scale }]}>
            {/* #2565: the whole scene as one UI-thread Picture; the phase-2 declarative path is
                kept behind the "Legacy renderer" dev switch until phase 5 (#2567) */}
            {legacyFrame ? (
              legacyFrame.map((op) => renderOp(op, images))
            ) : (
              <Picture picture={picture} />
            )}
          </Group>
        </Canvas>

        {/* HUD overlay — React Native Text over the Skia canvas */}
        <View style={styles.hud} pointerEvents="none">
          <View style={styles.hudTop}>
            <Text style={styles.hudText}>{t("hud.scoreValue", { score: hud.score })}</Text>
            <Text style={styles.hudText}>{t("hud.bestValue", { best: hs })}</Text>
            <Text style={styles.hudText}>{t("hud.waveValue", { wave: hud.wave })}</Text>
          </View>
          <View style={styles.hudDifficulty}>
            <Text style={styles.hudDifficultyText}>
              {`${difficultyLabel(hud.difficulty)} ×${difficultyMultiplier(hud.difficulty)}`}
            </Text>
            {/* #2488 upgrade ladders */}
            <Text style={styles.hudDifficultyText}>
              {`${t("hud.guns")}${hud.guns} · ${t("hud.hull")} ${"◆".repeat(hud.hull) || "–"}`}
            </Text>
          </View>

          {hud.bonusFlash && (
            <View style={styles.bonusLifeOverlay} pointerEvents="none">
              <Text style={styles.bonusLifeText}>1UP</Text>
            </View>
          )}

          {hud.countdownDigit !== null && (
            <View style={styles.phaseOverlay} pointerEvents="none">
              {hud.waveBannerCountdown && (
                <Text
                  style={styles.waveIncomingText}
                >{`— ${t("hud.waveValue", { wave: hud.wave })} —`}</Text>
              )}
              <Text style={styles.countdownText}>{hud.countdownDigit}</Text>
            </View>
          )}

          {/* #2352: purely cosmetic wave-clear acknowledgment — gameplay behind it never
              pauses. Fades out over its last MISSION_COMPLETE_FADE_MS instead of blocking on
              a freeze. See showMissionCompleteBanner() for the full suppression rationale —
              also skipped while the pre-wave countdown overlay (above) is showing, since both
              render full-screen and centered and would otherwise garble together. */}
          {hud.missionComplete && (
            <View style={styles.phaseOverlay} pointerEvents="none">
              {/* #2566: the fade runs on the UI thread from a shared value */}
              <Animated.Text style={[styles.overlayTitle, missionStyle]}>
                {t("phase.missionComplete")}
              </Animated.Text>
            </View>
          )}

          {/* #2489: rout banner — up while grunts are running for the edge */}
          {hud.rout && (
            <View style={styles.phaseOverlay} pointerEvents="none">
              <Text style={[styles.overlayTitle, styles.bossWaveTitle]}>{t("phase.rout")}</Text>
            </View>
          )}

          {/* #2490: boss-wave telegraph — up while the Carrier and its escorts swoop in */}
          {hud.bossWave && (
            <View style={styles.phaseOverlay} pointerEvents="none">
              <Text style={[styles.overlayTitle, styles.bossWaveTitle]}>{t("phase.bossWave")}</Text>
            </View>
          )}

          {/* Game over is the shared result card in StarSwarmScreen (#2516); the
              canvas keeps its final frame behind it. */}
        </View>

        {/* Lives — outside hud to avoid stacking-context conflicts with phaseOverlay children */}
        <View style={styles.hudBottom} pointerEvents="none">
          {Array.from({ length: hud.lives }, (_, i) => (
            <View key={i} style={styles.lifeIndicator} />
          ))}
        </View>

        {/* Power-up indicator — outside hud for the same reason as lives */}
        {hud.powerUp !== null && (
          <View style={styles.powerUpIndicator} pointerEvents="none">
            <Text
              style={[
                styles.powerUpLabel,
                { color: hud.powerUp === "shield" ? "#00aaff" : "#ffee00" },
              ]}
            >
              {hud.powerUp === "shield" ? "SHIELD" : "LIGHTNING"}
            </Text>
            <View style={styles.powerUpBarWrap}>
              {/* #2566: the bar drains on the UI thread from a shared value */}
              <Animated.View
                style={[
                  styles.powerUpBar,
                  { backgroundColor: hud.powerUp === "shield" ? "#00aaff" : "#ffee00" },
                  powerUpBarStyle,
                ]}
              />
            </View>
          </View>
        )}
      </View>
    );
  }
);

GameCanvas.displayName = "GameCanvas";
export default GameCanvas;

const styles = StyleSheet.create({
  canvas: {
    position: "absolute",
    top: 0,
    left: 0,
  },
  hud: {
    ...StyleSheet.absoluteFill,
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 8,
  },
  hudTop: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  hudText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "bold",
    fontVariant: ["tabular-nums"],
  },
  hudBottom: {
    position: "absolute",
    bottom: 48,
    left: 10,
    flexDirection: "row",
    gap: 6,
  },
  lifeIndicator: {
    width: 10,
    height: 14,
    backgroundColor: "#00ffcc",
  },
  powerUpIndicator: {
    position: "absolute",
    bottom: 26,
    left: 10,
  },
  powerUpLabel: {
    fontSize: 8,
    fontWeight: "bold",
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  powerUpBarWrap: {
    width: POWERUP_BAR_WIDTH,
    height: 6,
    backgroundColor: "rgba(255,255,255,0.18)",
    borderRadius: 3,
    overflow: "hidden",
  },
  powerUpBar: {
    width: POWERUP_BAR_WIDTH,
    height: 6,
    borderRadius: 3,
  },
  phaseOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
  },
  overlayTitle: {
    color: "#00ffcc",
    fontSize: 22,
    fontWeight: "bold",
    textAlign: "center",
  },
  bossWaveTitle: {
    color: "#ffdd00",
  },
  waveIncomingText: {
    color: "#00ffcc",
    fontSize: 16,
    fontWeight: "bold",
    textAlign: "center",
    letterSpacing: 1,
    marginBottom: 12,
  },
  countdownText: {
    color: "#00ffcc",
    fontSize: 96,
    fontWeight: "bold",
    textShadowColor: "#00ffcc",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 24,
  },
  bonusLifeOverlay: {
    position: "absolute",
    top: "40%",
    alignSelf: "center",
  },
  bonusLifeText: {
    color: "#ffff00",
    fontSize: 36,
    fontWeight: "bold",
    textShadowColor: "#ff8800",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
  },
  hudDifficulty: {
    alignSelf: "center",
    marginTop: 2,
  },
  hudDifficultyText: {
    color: "#aaffee",
    fontSize: 10,
    fontWeight: "bold",
    textAlign: "center",
  },
});
