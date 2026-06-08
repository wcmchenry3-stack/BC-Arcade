import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  Canvas,
  Circle,
  Fill,
  Group,
  Image as SkiaImage,
  Path,
  Rect,
} from "@shopify/react-native-skia";
import { useTranslation } from "react-i18next";
import * as Sentry from "@sentry/react-native";
import {
  initStarSwarm,
  tick,
  applyPowerUp,
  BULLET_C_W,
  HIT_FLASH_DURATION,
  POWERUP_DURATION,
  difficultyLabel,
  difficultyMultiplier,
} from "../../game/starswarm/engine";
import { initStarfield, tickStarfield } from "../../game/starswarm/starfield";
import type { StarfieldState } from "../../game/starswarm/starfield";
import { useStarSwarmImages } from "../../game/starswarm/assets";
import type { StarSwarmState, PowerUpType, DifficultyTier } from "../../game/starswarm/types";

const EXPLOSION_DRAW_SIZE = 48;
const DT_CAP_MS = 33;
const INVINCIBLE_BLINK_INTERVAL = 120; // ms

const C = {
  buddyShip: "rgba(0,120,255,0.8)",
} as const;

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
}

export interface GameCanvasHandle {
  setPlayerX: (x: number) => void;
  setFire: (fire: boolean) => void;
  /** Inject a power-up activation mid-game for dev-panel testing (#1039). */
  triggerPowerUp: (type: PowerUpType) => void;
  /** Return the current engine state snapshot — used by StarSwarmScreen to save paused state (#1367). */
  getState: () => StarSwarmState;
}

interface Props {
  highScore?: number;
  onGameOver?: (finalScore: number, wave: number) => void;
  onScoreChange?: (score: number) => void;
  onPlayerHit?: () => void;
  onWaveClear?: () => void;
  onLaserFire?: () => void;
  onExplosion?: () => void;
  onFreeFireZone?: () => void;
  /** Called once when all enemies in a Free Fire Zone are hit (#1022). */
  onFreeFirePerfect?: () => void;
  onBonusLife?: () => void;
  onPowerUpCollect?: (type: PowerUpType) => void;
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

interface RenderState {
  game: StarSwarmState;
  sf: StarfieldState;
  countdownDigit: number | null;
  /** True when the active countdown follows a WinTransition (shows wave banner). */
  winTransitionCountdown: boolean;
}

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
      onFreeFireZone,
      onFreeFirePerfect,
      onBonusLife,
      onPowerUpCollect,
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
    const countdownMsRef = useRef<number | null>(initialState ? null : 3000);
    // True when the active countdown follows a WinTransition (shows wave banner + 5 beats).
    // Tracked as a separate boolean so it doesn't depend on the countdown duration value.
    const winTransitionCountdownRef = useRef(false);
    const pendingFreeFireZoneRef = useRef(false);
    const lastFrameTimeRef = useRef(0);
    const prevScoreRef = useRef(0);
    const prevLivesRef = useRef(gameRef.current.player.lives);
    const prevPhaseRef = useRef(gameRef.current.phase);
    const isPausedRef = useRef(isPaused);
    const onGameOverRef = useRef(onGameOver);
    const onScoreChangeRef = useRef(onScoreChange);
    const onPlayerHitRef = useRef(onPlayerHit);
    const onWaveClearRef = useRef(onWaveClear);
    const onLaserFireRef = useRef(onLaserFire);
    const onExplosionRef = useRef(onExplosion);
    const onFreeFireZoneRef = useRef(onFreeFireZone);
    const onFreeFirePerfectRef = useRef(onFreeFirePerfect);
    const onBonusLifeRef = useRef(onBonusLife);
    const onPowerUpCollectRef = useRef(onPowerUpCollect);
    const prevActivePowerUpRef = useRef<string | null>(null); // type of active power-up last frame
    const triggerPowerUpRef = useRef<PowerUpType | null>(null);
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
      onFreeFireZoneRef.current = onFreeFireZone;
    }, [onFreeFireZone]);
    useEffect(() => {
      onFreeFirePerfectRef.current = onFreeFirePerfect;
    }, [onFreeFirePerfect]);
    useEffect(() => {
      onBonusLifeRef.current = onBonusLife;
    }, [onBonusLife]);
    useEffect(() => {
      onPowerUpCollectRef.current = onPowerUpCollect;
    }, [onPowerUpCollect]);

    const [renderState, setRenderState] = useState<RenderState>({
      game: gameRef.current,
      sf: sfRef.current,
      countdownDigit: initialState ? null : 3,
      winTransitionCountdown: false,
    });

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
        getState() {
          return gameRef.current;
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
      countdownMsRef.current = 3000;
      lastFrameTimeRef.current = 0;
      inputRef.current.playerX = width / 2;
      inputRef.current.fire = true;
      prevScoreRef.current = 0;
      prevLivesRef.current = gameRef.current.player.lives;
      prevPhaseRef.current = gameRef.current.phase;
      prevBonusLivesRef.current = gameRef.current.bonusLivesAwarded;
      bonusFlashEndRef.current = 0;
      pendingFreeFireZoneRef.current = false;
      winTransitionCountdownRef.current = false;
      setRenderState({
        game: gameRef.current,
        sf: sfRef.current,
        countdownDigit: 3,
        winTransitionCountdown: false,
      });
    }, [resetTick, width, height]);

    // RAF game loop — drives both engine tick and Skia re-renders
    useEffect(() => {
      let id: number;

      function loop(timestamp: number) {
        if (lastFrameTimeRef.current === 0) lastFrameTimeRef.current = timestamp;
        const dtMs = Math.min(timestamp - lastFrameTimeRef.current, DT_CAP_MS);
        lastFrameTimeRef.current = timestamp;

        // #1039: apply dev-panel power-up injection before regular tick
        if (triggerPowerUpRef.current) {
          const type = triggerPowerUpRef.current;
          triggerPowerUpRef.current = null;
          gameRef.current = applyPowerUp(gameRef.current, type);
        }

        const prev = gameRef.current;
        if (prev.phase !== "GameOver" && !isPausedRef.current) {
          if (countdownMsRef.current !== null) {
            // Pre-wave countdown: freeze engine, tick the timer only
            countdownMsRef.current = Math.max(0, countdownMsRef.current - dtMs);
            if (countdownMsRef.current === 0) {
              countdownMsRef.current = null;
              if (pendingFreeFireZoneRef.current) {
                pendingFreeFireZoneRef.current = false;
                onFreeFireZoneRef.current?.();
              }
            }
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
              // WinTransition replaces WaveClear for all normal/free-fire clears
              if (applied.phase === "WinTransition" && prevPhaseRef.current !== "WinTransition") {
                onWaveClearRef.current?.();
                if (applied.freeFirePerfect) onFreeFirePerfectRef.current?.();
              }
              if (applied.phase === "WaveClear" && prevPhaseRef.current !== "WaveClear") {
                onWaveClearRef.current?.();
                if (applied.freeFirePerfect) onFreeFirePerfectRef.current?.();
              }
              // Start countdown when WaveClear or WinTransition ends.
              // WinTransition gets a 5-beat countdown; legacy WaveClear keeps 3 s.
              // Evaluated before phase callbacks so onFreeFireZone fires after countdown expires.
              // prevPhaseRef.current is updated below — after this check.
              const fromWaveClear =
                prevPhaseRef.current === "WaveClear" &&
                applied.phase !== "WaveClear" &&
                applied.phase !== "GameOver";
              const fromWinTransition =
                prevPhaseRef.current === "WinTransition" && applied.phase === "SwoopIn";
              const startingCountdown = fromWaveClear || fromWinTransition;
              if (startingCountdown) {
                countdownMsRef.current = fromWinTransition ? 5000 : 3000;
                winTransitionCountdownRef.current = fromWinTransition;
                if (fromWinTransition) {
                  // Sync input to where AI parked the ship
                  inputRef.current.playerX = applied.player.x;
                }
              }
              if (applied.phase === "FreeFireZone" && prevPhaseRef.current !== "FreeFireZone") {
                if (fromWaveClear) {
                  pendingFreeFireZoneRef.current = true;
                } else {
                  onFreeFireZoneRef.current?.();
                }
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
        // Starfield scrolls continuously
        sfRef.current = tickStarfield(sfRef.current, dtMs);

        const countdownDigit =
          countdownMsRef.current !== null
            ? Math.max(1, Math.ceil(countdownMsRef.current / 1000))
            : null;
        setRenderState({
          game: gameRef.current,
          sf: sfRef.current,
          countdownDigit,
          winTransitionCountdown: winTransitionCountdownRef.current,
        });
        id = requestAnimationFrame(loop);
      }

      id = requestAnimationFrame(loop);
      return () => cancelAnimationFrame(id);
    }, []); // intentionally empty — loop lives for component lifetime

    const { game: state, sf, countdownDigit, winTransitionCountdown } = renderState;
    const { player } = state;
    const playerDisplayY =
      state.phase === "WinTransition" ? player.y - state.playerYOffset : player.y;
    const shipVisible = playerDisplayY + player.height > 0;
    const displayW = Math.round(width * scale);
    const displayH = Math.round(height * scale);
    const hs = Math.max(highScore, state.score);
    const showBonusFlash = Date.now() < bonusFlashEndRef.current;

    const blink =
      player.invincibleTimer > 0 &&
      Math.floor(player.invincibleTimer / INVINCIBLE_BLINK_INTERVAL) % 2 === 1;

    return (
      <View style={{ width: displayW, height: displayH }}>
        <Canvas
          style={[styles.canvas, { width: displayW, height: displayH }]}
          accessibilityLabel={t("game.canvasLabel")}
          accessibilityRole="none"
        >
          <Group transform={[{ scale }]}>
            <Fill color="#000010" />

            {/* Starfield */}
            {sf.stars.map((star) => (
              <Circle
                key={`star-${star.id}`}
                cx={star.x}
                cy={star.y}
                r={star.r}
                color={`rgba(255,255,255,${star.opacity})`}
              />
            ))}

            {/* Enemy bullets */}
            {state.enemyBullets.map((b) => (
              <Rect
                key={b.id}
                x={b.x - b.width / 2}
                y={b.y - b.height / 2}
                width={b.width}
                height={b.height}
                color="#ff4422"
              />
            ))}

            {/* Player bullets — charge bullets (wider) rendered as a distinct cyan beam */}
            {state.playerBullets.map((b) =>
              b.width >= BULLET_C_W ? (
                <Rect
                  key={b.id}
                  x={b.x - b.width / 2}
                  y={b.y - b.height / 2}
                  width={b.width}
                  height={b.height}
                  color="#00f0ff"
                />
              ) : images.bulletPlayer ? (
                <SkiaImage
                  key={b.id}
                  image={images.bulletPlayer}
                  x={b.x - b.width / 2}
                  y={b.y - b.height / 2}
                  width={b.width}
                  height={b.height}
                  fit="fill"
                />
              ) : (
                <Rect
                  key={b.id}
                  x={b.x - b.width / 2}
                  y={b.y - b.height / 2}
                  width={b.width}
                  height={b.height}
                  color="#00ffcc"
                />
              )
            )}

            {/* Enemies */}
            {state.enemies.map((enemy) => {
              if (!enemy.isAlive) return null;
              const img =
                enemy.tier === "Grunt"
                  ? images.enemyGrunt
                  : enemy.tier === "Elite"
                    ? images.enemyElite
                    : images.enemyBoss;
              const fallbackColor =
                enemy.tier === "Grunt" ? "#8888ff" : enemy.tier === "Elite" ? "#ff88ff" : "#ffff44";
              return (
                <Group key={enemy.id}>
                  {img ? (
                    <SkiaImage
                      image={img}
                      x={enemy.x - enemy.width / 2}
                      y={enemy.y - enemy.height / 2}
                      width={enemy.width}
                      height={enemy.height}
                      fit="fill"
                    />
                  ) : (
                    <Rect
                      x={enemy.x - enemy.width / 2}
                      y={enemy.y - enemy.height / 2}
                      width={enemy.width}
                      height={enemy.height}
                      color={fallbackColor}
                    />
                  )}
                  {enemy.hitFlashTimer > 0 &&
                    (() => {
                      const progress = 1 - enemy.hitFlashTimer / HIT_FLASH_DURATION;
                      const refR = Math.max(enemy.width, enemy.height) * 1.2;
                      const r = refR * (0.6 + 0.5 * progress);
                      const a = enemy.hitFlashTimer / HIT_FLASH_DURATION; // 1→0 as burst plays
                      return (
                        <Group>
                          <Circle
                            cx={enemy.x}
                            cy={enemy.y}
                            r={r}
                            color={`rgba(0,170,255,${(a * 0.25).toFixed(3)})`}
                            style="fill"
                          />
                          <Circle
                            cx={enemy.x}
                            cy={enemy.y}
                            r={r}
                            color={`rgba(0,170,255,${(a * 0.75).toFixed(3)})`}
                            style="stroke"
                            strokeWidth={3}
                          />
                        </Group>
                      );
                    })()}
                </Group>
              );
            })}

            {/* Player — hidden once off-screen during WinTransition */}
            {!blink &&
              shipVisible &&
              (images.playerShip ? (
                <SkiaImage
                  image={images.playerShip}
                  x={player.x - player.width / 2}
                  y={playerDisplayY - player.height / 2}
                  width={player.width}
                  height={player.height}
                  fit="fill"
                />
              ) : (
                <Rect
                  x={player.x - player.width / 2}
                  y={playerDisplayY - player.height / 2}
                  width={player.width}
                  height={player.height}
                  color="#00ffcc"
                />
              ))}

            {/* #1033 Shield aura — glowing ring when shield is active */}
            {!blink && shipVisible && state.activePowerUp?.type === "shield" && (
              <Circle
                cx={player.x}
                cy={playerDisplayY}
                r={player.width * 0.8}
                color="rgba(0,170,255,0.25)"
                style="fill"
              />
            )}
            {!blink && shipVisible && state.activePowerUp?.type === "shield" && (
              <Circle
                cx={player.x}
                cy={playerDisplayY}
                r={player.width * 0.8}
                color="rgba(0,170,255,0.75)"
                style="stroke"
                strokeWidth={2}
              />
            )}

            {/* Lightning super-state electric tint on player ship */}
            {!blink && shipVisible && state.activePowerUp?.type === "lightning" && (
              <Rect
                x={player.x - player.width / 2}
                y={playerDisplayY - player.height / 2}
                width={player.width}
                height={player.height}
                color="rgba(255,238,0,0.45)"
              />
            )}

            {/* #1035 Buddy ships */}
            {state.buddyShips.map((buddy) =>
              images.buddyShip ? (
                <Group
                  key={buddy.id}
                  transform={
                    buddy.fromLeft
                      ? []
                      : [{ translateX: buddy.x }, { scaleX: -1 }, { translateX: -buddy.x }]
                  }
                >
                  <SkiaImage
                    image={images.buddyShip}
                    x={buddy.x - 17}
                    y={buddy.y - 17}
                    width={34}
                    height={34}
                    fit="fill"
                  />
                </Group>
              ) : (
                <Rect
                  key={buddy.id}
                  x={buddy.x - 17}
                  y={buddy.y - 17}
                  width={34}
                  height={34}
                  color={C.buddyShip}
                />
              )
            )}

            {/* Power-ups — Kenney CC0 sprites with procedural fallback */}
            {state.powerUps.map((pu) => {
              const lx = pu.x - pu.width / 2;
              const ly = pu.y - pu.height / 2;
              const pw = pu.width;
              const ph = pu.height;
              const spriteMap = {
                shield: images.puShield,
                bomb: images.puBomb,
                buddy: images.puBuddy,
                lightning: images.puLightning,
              } as const;
              const sprite = spriteMap[pu.type] ?? null;
              if (sprite) {
                return (
                  <SkiaImage key={pu.id} image={sprite} x={lx} y={ly} width={pw} height={ph} />
                );
              }
              // fallback procedural shapes when sprite not yet loaded
              if (pu.type === "shield") {
                return (
                  <Circle
                    key={pu.id}
                    cx={pu.x}
                    cy={pu.y}
                    r={pw * 0.4}
                    color="rgba(0,170,255,0.9)"
                  />
                );
              }
              if (pu.type === "bomb") {
                return (
                  <Circle key={pu.id} cx={pu.x} cy={pu.y} r={pw * 0.4} color="rgba(255,80,0,0.9)" />
                );
              }
              if (pu.type === "buddy") {
                return (
                  <Rect
                    key={pu.id}
                    x={lx + pw * 0.2}
                    y={ly + ph * 0.2}
                    width={pw * 0.6}
                    height={ph * 0.6}
                    color="rgba(0,255,200,0.9)"
                  />
                );
              }
              const boltPath =
                `M${lx + pw * 0.625},${ly} ` +
                `L${lx + pw * 0.125},${ly + ph * 0.542} ` +
                `L${lx + pw * 0.458},${ly + ph * 0.542} ` +
                `L${lx + pw * 0.375},${ly + ph} ` +
                `L${lx + pw * 0.875},${ly + ph * 0.458} ` +
                `L${lx + pw * 0.542},${ly + ph * 0.458} Z`;
              return <Path key={pu.id} path={boltPath} color="#ffee00" />;
            })}

            {/* Explosions */}
            {state.explosions.map((exp) => {
              const frameImg = images.explosionFrames[exp.frame] ?? null;
              const half = EXPLOSION_DRAW_SIZE / 2;
              if (frameImg) {
                return (
                  <SkiaImage
                    key={exp.id}
                    image={frameImg}
                    x={exp.x - half}
                    y={exp.y - half}
                    width={EXPLOSION_DRAW_SIZE}
                    height={EXPLOSION_DRAW_SIZE}
                    fit="fill"
                  />
                );
              }
              const progress = exp.frame / 20;
              return (
                <Circle
                  key={exp.id}
                  cx={exp.x}
                  cy={exp.y}
                  r={6 + progress * 18}
                  color={progress < 0.4 ? "#ffcc00" : "#ff4400"}
                  opacity={1 - progress}
                />
              );
            })}
            {/* #1034 Bomb flash — full-screen white overlay fading out */}
            {state.bombFlashTimer > 0 && (
              <Rect
                x={0}
                y={0}
                width={width}
                height={height}
                color={`rgba(255,255,255,${(state.bombFlashTimer / 300) * 0.75})`}
              />
            )}
          </Group>
        </Canvas>

        {/* HUD overlay — React Native Text over the Skia canvas */}
        <View style={styles.hud} pointerEvents="none">
          <View style={styles.hudTop}>
            <Text style={styles.hudText}>{`${t("hud.score")} ${state.score}`}</Text>
            <Text style={styles.hudText}>{`${t("hud.best")} ${hs}`}</Text>
            <Text style={styles.hudText}>{`${t("hud.wave")} ${state.wave}`}</Text>
          </View>
          <View style={styles.hudDifficulty}>
            <Text style={styles.hudDifficultyText}>
              {`${difficultyLabel(state.difficulty)} ×${difficultyMultiplier(state.difficulty)}`}
            </Text>
          </View>

          {showBonusFlash && (
            <View style={styles.bonusLifeOverlay} pointerEvents="none">
              <Text style={styles.bonusLifeText}>1UP</Text>
            </View>
          )}

          {countdownDigit !== null && (
            <View style={styles.phaseOverlay} pointerEvents="none">
              {winTransitionCountdown && (
                <Text style={styles.waveIncomingText}>{`— ${t("hud.wave")} ${state.wave} —`}</Text>
              )}
              <Text style={styles.countdownText}>{countdownDigit}</Text>
            </View>
          )}

          {state.phase === "WinTransition" && (
            <View style={styles.phaseOverlay} pointerEvents="none">
              <Text
                style={[
                  styles.overlayTitle,
                  {
                    opacity: Math.min(1, Math.max(0, (state.winTransitionElapsed - 200) / 400)),
                  },
                ]}
              >
                {t("phase.missionComplete")}
              </Text>
              {state.freeFirePerfect && (
                <Text
                  style={[
                    styles.perfectBanner,
                    {
                      opacity: Math.min(1, Math.max(0, (state.winTransitionElapsed - 400) / 400)),
                    },
                  ]}
                >
                  {t("phase.perfect")}
                </Text>
              )}
            </View>
          )}

          {state.phase === "WaveClear" && countdownDigit === null && (
            <View style={styles.phaseOverlay}>
              <Text style={styles.overlayTitle}>{t("phase.waveClear")}</Text>
              {state.freeFirePerfect && (
                <Text style={styles.perfectBanner}>{t("phase.perfect")}</Text>
              )}
            </View>
          )}

          {state.phase === "FreeFireZone" && countdownDigit === null && (
            <View style={styles.phaseOverlay}>
              <Text style={[styles.overlayTitle, styles.challengingTitle]}>
                {t("phase.freeFireZone")}
              </Text>
              <Text style={styles.overlaySubtitle}>
                {t("phase.hits", { count: state.freeFireHits })}
              </Text>
            </View>
          )}

          {state.phase === "GameOver" && (
            <View style={[styles.phaseOverlay, styles.gameOverOverlay]}>
              <Text style={styles.gameOverTitle}>{t("phase.gameOver")}</Text>
              <Text style={styles.gameOverScore}>{`${t("hud.score")} ${state.score}`}</Text>
            </View>
          )}

          {/* Lives rendered last so they always appear on top of phase overlays */}
          <View style={styles.hudBottom}>
            {Array.from({ length: player.lives }, (_, i) => (
              <View key={i} style={styles.lifeIndicator} />
            ))}
          </View>

          {/* Power-up indicator — independent bottom-left block, above the lives row */}
          {state.activePowerUp !== null && (
            <View style={styles.powerUpIndicator} pointerEvents="none">
              <Text
                style={[
                  styles.powerUpLabel,
                  { color: state.activePowerUp.type === "shield" ? "#00aaff" : "#ffee00" },
                ]}
              >
                {state.activePowerUp.type === "shield" ? "SHIELD" : "LIGHTNING"}
              </Text>
              <View style={styles.powerUpBarWrap}>
                <View
                  style={[
                    styles.powerUpBar,
                    {
                      width: 60 * (state.activePowerUp.remainingMs / POWERUP_DURATION),
                      backgroundColor:
                        state.activePowerUp.type === "shield" ? "#00aaff" : "#ffee00",
                    },
                  ]}
                />
              </View>
            </View>
          )}
        </View>
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
    ...StyleSheet.absoluteFillObject,
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
    bottom: 8,
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
    width: 60,
    height: 6,
    backgroundColor: "rgba(255,255,255,0.18)",
    borderRadius: 3,
    overflow: "hidden",
  },
  powerUpBar: {
    height: 6,
    borderRadius: 3,
  },
  phaseOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  overlayTitle: {
    color: "#00ffcc",
    fontSize: 22,
    fontWeight: "bold",
    textAlign: "center",
  },
  challengingTitle: {
    color: "#ffdd00",
  },
  overlaySubtitle: {
    color: "#ffffff",
    fontSize: 14,
    textAlign: "center",
    marginTop: 8,
  },
  perfectBanner: {
    color: "#ffdd00",
    fontSize: 20,
    fontWeight: "bold",
    textAlign: "center",
    marginTop: 6,
    textShadowColor: "#ff8800",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
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
  gameOverOverlay: {
    backgroundColor: "rgba(0,0,0,0.65)",
  },
  gameOverTitle: {
    color: "#ff4422",
    fontSize: 28,
    fontWeight: "bold",
    textAlign: "center",
  },
  gameOverScore: {
    color: "#ffffff",
    fontSize: 18,
    textAlign: "center",
    marginTop: 16,
    fontVariant: ["tabular-nums"],
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
