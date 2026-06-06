import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";
import { View } from "react-native";
import { Asset } from "expo-asset";
import { useTranslation } from "react-i18next";
import * as Sentry from "@sentry/react-native";
import {
  initStarSwarm,
  tick,
  applyPowerUp,
  POWERUP_DURATION,
  HIT_FLASH_DURATION,
  BULLET_C_W,
  difficultyLabel,
  difficultyMultiplier,
} from "../../game/starswarm/engine";
import { initStarfield, tickStarfield } from "../../game/starswarm/starfield";
import type { StarfieldState } from "../../game/starswarm/starfield";
import type { StarSwarmState, PowerUpType, DifficultyTier } from "../../game/starswarm/types";

import playerShipSrc from "../../../assets/starswarm/player-ship.webp";
import buddyShipSrc from "../../../assets/starswarm/buddy-ship.webp";
import enemyGruntSrc from "../../../assets/starswarm/enemy-grunt.webp";
import enemyEliteSrc from "../../../assets/starswarm/enemy-elite.webp";
import enemyBossSrc from "../../../assets/starswarm/enemy-boss.webp";
import bulletPlayerSrc from "../../../assets/starswarm/bullet-player.webp";
import bulletEnemySrc from "../../../assets/starswarm/bullet-enemy.webp";
import bulletChargeSrc from "../../../assets/starswarm/bullet-charge.webp";
import puShieldSrc from "../../../assets/starswarm/powerups/shield_gold.png";
import puBombSrc from "../../../assets/starswarm/powerups/space-missiles-018.png";
import puBuddySrc from "../../../assets/starswarm/powerups/player-life.png";
import puLightningSrc from "../../../assets/starswarm/powerups/bolt_gold.png";
import ef00 from "../../../assets/starswarm/explosion/frame00.png";
import ef01 from "../../../assets/starswarm/explosion/frame01.png";
import ef02 from "../../../assets/starswarm/explosion/frame02.png";
import ef03 from "../../../assets/starswarm/explosion/frame03.png";
import ef04 from "../../../assets/starswarm/explosion/frame04.png";
import ef05 from "../../../assets/starswarm/explosion/frame05.png";
import ef06 from "../../../assets/starswarm/explosion/frame06.png";
import ef07 from "../../../assets/starswarm/explosion/frame07.png";
import ef08 from "../../../assets/starswarm/explosion/frame08.png";
import ef09 from "../../../assets/starswarm/explosion/frame09.png";
import ef10 from "../../../assets/starswarm/explosion/frame10.png";
import ef11 from "../../../assets/starswarm/explosion/frame11.png";
import ef12 from "../../../assets/starswarm/explosion/frame12.png";
import ef13 from "../../../assets/starswarm/explosion/frame13.png";
import ef14 from "../../../assets/starswarm/explosion/frame14.png";
import ef15 from "../../../assets/starswarm/explosion/frame15.png";
import ef16 from "../../../assets/starswarm/explosion/frame16.png";
import ef17 from "../../../assets/starswarm/explosion/frame17.png";
import ef18 from "../../../assets/starswarm/explosion/frame18.png";
import ef19 from "../../../assets/starswarm/explosion/frame19.png";

const EXPLOSION_SRCS = [
  ef00,
  ef01,
  ef02,
  ef03,
  ef04,
  ef05,
  ef06,
  ef07,
  ef08,
  ef09,
  ef10,
  ef11,
  ef12,
  ef13,
  ef14,
  ef15,
  ef16,
  ef17,
  ef18,
  ef19,
] as const;

const EXPLOSION_DRAW_SIZE = 48;
const DT_CAP_MS = 33;
const INVINCIBLE_BLINK_INTERVAL = 120; // ms

const C = {
  bg: "#000010",
  star: "#ffffff",
  bulletEnemy: "#ff4422",
  bulletPlayer: "#00ffcc",
  enemyGrunt: "#8888ff",
  enemyElite: "#ff88ff",
  enemyBoss: "#ffff44",
  hitFlash: "#ff2200",
  pipFilled: "#ffffff",
  pipEmpty: "rgba(255,255,255,0.2)",
  player: "#00ffcc",
  superTint: "#ffee00",
  shieldAura: "rgba(0,170,255,0.25)",
  shieldRing: "rgba(0,170,255,0.8)",
  buddyShip: "rgba(0,120,255,0.8)",
  powerUpLightning: "#ffee00",
  powerUpShield: "rgba(0,170,255,0.9)",
  powerUpBomb: "rgba(255,80,0,0.9)",
  powerUpBuddy: "rgba(0,255,200,0.9)",
  powerBarFillShield: "#00aaff",
  buddyTint: "rgba(255,238,0,0.5)",
  explosionHot: "#ffcc00",
  explosionCool: "#ff4400",
  hudText: "#ffffff",
  hudDiff: "#aaffee",
  lives: "#00ffcc",
  powerBarBg: "rgba(255,255,255,0.18)",
  powerBarFill: "#ffee00",
  waveClear: "#00ffcc",
  freeFireZone: "#ffdd00",
  gameOverText: "#ff4422",
  gameOverOverlay: "rgba(0,0,0,0.65)",
} as const;

interface Images {
  playerShip: HTMLImageElement | null;
  buddyShip: HTMLImageElement | null;
  enemyGrunt: HTMLImageElement | null;
  enemyElite: HTMLImageElement | null;
  enemyBoss: HTMLImageElement | null;
  bulletPlayer: HTMLImageElement | null;
  bulletEnemy: HTMLImageElement | null;
  bulletCharge: HTMLImageElement | null;
  explosionFrames: (HTMLImageElement | null)[];
  puShield: HTMLImageElement | null;
  puBomb: HTMLImageElement | null;
  puBuddy: HTMLImageElement | null;
  puLightning: HTMLImageElement | null;
}

export interface DevOptions {
  wave?: number;
  infiniteLives?: boolean;
  stragglerEnabled?: boolean;
  pauseStraggler?: boolean;
  /** Override difficulty tier for this game (#1037). */
  difficulty?: DifficultyTier;
}

export interface GameCanvasHandle {
  setPlayerX: (x: number) => void;
  setFire: (fire: boolean) => void;
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
  onPowerUpCollect?: (type: PowerUpType) => void;
  isPaused?: boolean;
  onPause?: () => void;
  width: number;
  height: number;
  scale: number;
  resetTick?: number;
  /** Active difficulty tier — passed from the pre-game selector (#1037). */
  difficulty?: DifficultyTier;
  devOptions?: DevOptions;
  /** Seed the engine with an existing state instead of initialState() — used to restore a paused session (#1367). */
  initialState?: StarSwarmState;
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
      onPowerUpCollect,
      isPaused = false,
      onPause,
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
    const tRef = useRef(t);
    useEffect(() => {
      tRef.current = t;
    }, [t]);

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const scaleRef = useRef(scale);
    const difficultyRef = useRef<DifficultyTier>(difficultyProp);
    const stateRef = useRef<StarSwarmState>(
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
    const devOptionsRef = useRef<DevOptions | undefined>(devOptions);
    devOptionsRef.current = devOptions;
    const lastFrameTimeRef = useRef(0);
    const highScoreRef = useRef(highScore);
    const onGameOverRef = useRef(onGameOver);
    const onScoreChangeRef = useRef(onScoreChange);
    const onPlayerHitRef = useRef(onPlayerHit);
    const onWaveClearRef = useRef(onWaveClear);
    const onLaserFireRef = useRef(onLaserFire);
    const onExplosionRef = useRef(onExplosion);
    const onFreeFireZoneRef = useRef(onFreeFireZone);
    const onFreeFirePerfectRef = useRef(onFreeFirePerfect);
    const onPowerUpCollectRef = useRef(onPowerUpCollect);
    const onPauseRef = useRef(onPause);
    const prevActivePowerUpRef = useRef<string | null>(null);
    const triggerPowerUpRef = useRef<PowerUpType | null>(null);
    const isPausedRef = useRef(isPaused);
    const prevScoreRef = useRef(0);
    const prevLivesRef = useRef(stateRef.current.player.lives);
    const prevPhaseRef = useRef(stateRef.current.phase);
    // Pre-wave countdown: null = no countdown, positive ms = ticking, drives the 5-beat visual
    const countdownMsRef = useRef<number | null>(null);
    const imagesRef = useRef<Images>({
      playerShip: null,
      buddyShip: null,
      enemyGrunt: null,
      enemyElite: null,
      enemyBoss: null,
      bulletPlayer: null,
      bulletEnemy: null,
      bulletCharge: null,
      explosionFrames: Array(20).fill(null) as null[],
      puShield: null,
      puBomb: null,
      puBuddy: null,
      puLightning: null,
    });

    useEffect(() => {
      scaleRef.current = scale;
    }, [scale]);
    useEffect(() => {
      difficultyRef.current = difficultyProp;
    }, [difficultyProp]);
    useEffect(() => {
      highScoreRef.current = highScore;
    }, [highScore]);
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
      onPowerUpCollectRef.current = onPowerUpCollect;
    }, [onPowerUpCollect]);
    useEffect(() => {
      onPauseRef.current = onPause;
    }, [onPause]);
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
      const wasPaused = isPausedRef.current;
      isPausedRef.current = isPaused;
      if (wasPaused && !isPaused) lastFrameTimeRef.current = 0;
    }, [isPaused]);

    useEffect(() => {
      let cancelled = false;

      async function loadImg(src: number): Promise<HTMLImageElement | null> {
        try {
          const asset = Asset.fromModule(src);
          await asset.downloadAsync();
          const uri = asset.localUri ?? asset.uri;
          if (!uri) return null;
          return new Promise((resolve) => {
            const img = new window.Image();
            img.crossOrigin = "anonymous";
            img.src = uri;
            img.onload = () => resolve(img);
            img.onerror = () => resolve(null);
          });
        } catch {
          return null;
        }
      }

      (async () => {
        const results = await Promise.all([
          loadImg(playerShipSrc as number),
          loadImg(buddyShipSrc as number),
          loadImg(enemyGruntSrc as number),
          loadImg(enemyEliteSrc as number),
          loadImg(enemyBossSrc as number),
          loadImg(bulletPlayerSrc as number),
          loadImg(bulletEnemySrc as number),
          loadImg(bulletChargeSrc as number),
          loadImg(puShieldSrc as number),
          loadImg(puBombSrc as number),
          loadImg(puBuddySrc as number),
          loadImg(puLightningSrc as number),
          ...EXPLOSION_SRCS.map((s) => loadImg(s as number)),
        ]);
        if (cancelled) return;
        const [
          playerShip,
          buddyShip,
          enemyGrunt,
          enemyElite,
          enemyBoss,
          bulletPlayer,
          bulletEnemy,
          bulletCharge,
          puShield,
          puBomb,
          puBuddy,
          puLightning,
          ...frames
        ] = results;
        imagesRef.current = {
          playerShip: playerShip ?? null,
          buddyShip: buddyShip ?? null,
          enemyGrunt: enemyGrunt ?? null,
          enemyElite: enemyElite ?? null,
          enemyBoss: enemyBoss ?? null,
          bulletPlayer: bulletPlayer ?? null,
          bulletEnemy: bulletEnemy ?? null,
          bulletCharge: bulletCharge ?? null,
          explosionFrames: frames.map((f) => f ?? null),
          puShield: puShield ?? null,
          puBomb: puBomb ?? null,
          puBuddy: puBuddy ?? null,
          puLightning: puLightning ?? null,
        };
      })();

      return () => {
        cancelled = true;
      };
    }, []);

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
          return stateRef.current;
        },
      }),
      []
    );

    useEffect(() => {
      if (!resetTick) return;
      const opts = devOptionsRef.current;
      infiniteLivesRef.current = opts?.infiniteLives ?? false;
      stateRef.current = initStarSwarm(
        width,
        height,
        opts?.wave ?? 1,
        (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0,
        opts?.difficulty ?? difficultyRef.current
      );
      sfRef.current = initStarfield(width, height);
      lastFrameTimeRef.current = 0;
      inputRef.current.playerX = width / 2;
      inputRef.current.fire = true;
      prevScoreRef.current = 0;
      prevLivesRef.current = stateRef.current.player.lives;
      prevPhaseRef.current = stateRef.current.phase;
      prevActivePowerUpRef.current = null;
      triggerPowerUpRef.current = null;
      countdownMsRef.current = null;
    }, [resetTick, width, height]);

    const draw = useCallback(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const s = scaleRef.current;
      const state = stateRef.current;
      const sf = sfRef.current;
      const imgs = imagesRef.current;
      const t = tRef.current;
      const hs = Math.max(highScoreRef.current, state.score);
      const { player } = state;
      // During WinTransition the ship flies upward; offset its rendered Y accordingly
      const playerDisplayY =
        state.phase === "WinTransition" ? player.y - state.playerYOffset : player.y;
      const shipVisible = playerDisplayY + player.height > 0;
      // Countdown digit (null = no countdown active)
      const cMs = countdownMsRef.current;
      const countdownDigit = cMs !== null ? Math.max(1, Math.ceil(cMs / 1000)) : null;

      const displayW = width * s;
      const displayH = height * s;
      ctx.clearRect(0, 0, displayW, displayH);
      ctx.save();
      ctx.scale(s, s);

      // Background
      ctx.fillStyle = C.bg;
      ctx.fillRect(0, 0, width, height);

      // Starfield
      for (const star of sf.stars) {
        ctx.globalAlpha = star.opacity;
        ctx.fillStyle = C.star;
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // Enemy bullets
      ctx.fillStyle = C.bulletEnemy;
      for (const b of state.enemyBullets) {
        ctx.fillRect(b.x - b.width / 2, b.y - b.height / 2, b.width, b.height);
      }

      // Player bullets — charge bullets (wider) use bulletCharge sprite / cyan fallback
      for (const b of state.playerBullets) {
        const isCharged = b.width >= BULLET_C_W;
        const img = isCharged ? imgs.bulletCharge : imgs.bulletPlayer;
        if (img) {
          ctx.drawImage(img, b.x - b.width / 2, b.y - b.height / 2, b.width, b.height);
        } else {
          ctx.fillStyle = isCharged ? "#00f0ff" : C.bulletPlayer;
          ctx.fillRect(b.x - b.width / 2, b.y - b.height / 2, b.width, b.height);
        }
      }

      // Enemies
      for (const enemy of state.enemies) {
        if (!enemy.isAlive) continue;
        const img =
          enemy.tier === "Grunt"
            ? imgs.enemyGrunt
            : enemy.tier === "Elite"
              ? imgs.enemyElite
              : imgs.enemyBoss;
        if (img) {
          ctx.drawImage(
            img,
            enemy.x - enemy.width / 2,
            enemy.y - enemy.height / 2,
            enemy.width,
            enemy.height
          );
        } else {
          ctx.fillStyle =
            enemy.tier === "Grunt"
              ? C.enemyGrunt
              : enemy.tier === "Elite"
                ? C.enemyElite
                : C.enemyBoss;
          ctx.fillRect(
            enemy.x - enemy.width / 2,
            enemy.y - enemy.height / 2,
            enemy.width,
            enemy.height
          );
        }
        if (enemy.hitFlashTimer > 0) {
          const progress = 1 - enemy.hitFlashTimer / HIT_FLASH_DURATION;
          const refR = Math.max(enemy.width, enemy.height) * 1.2;
          const r = refR * (0.6 + 0.5 * progress);
          const a = enemy.hitFlashTimer / HIT_FLASH_DURATION;
          ctx.beginPath();
          ctx.arc(enemy.x, enemy.y, r, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(0,170,255,${(a * 0.25).toFixed(3)})`;
          ctx.fill();
          ctx.beginPath();
          ctx.arc(enemy.x, enemy.y, r, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(0,170,255,${(a * 0.75).toFixed(3)})`;
          ctx.lineWidth = 3;
          ctx.stroke();
        }

        // HP pips — Elite (2) and Boss (4); Grunt always has 1 HP so pips are omitted
        if (enemy.tier !== "Grunt") {
          const totalPips = enemy.tier === "Elite" ? 2 : 4;
          const pipW = 4;
          const pipH = 4;
          const pipGap = 2;
          const rowW = totalPips * pipW + (totalPips - 1) * pipGap;
          const rowX = enemy.x - rowW / 2;
          const rowY = enemy.y - enemy.height / 2 - 8;
          for (let p = 0; p < totalPips; p++) {
            ctx.fillStyle = p < enemy.hp ? C.pipFilled : C.pipEmpty;
            ctx.fillRect(rowX + p * (pipW + pipGap), rowY, pipW, pipH);
          }
        }
      }

      // Player (blink during invincibility; hidden once off-screen during WinTransition)
      const blink =
        player.invincibleTimer > 0 &&
        Math.floor(player.invincibleTimer / INVINCIBLE_BLINK_INTERVAL) % 2 === 1;
      if (!blink && shipVisible) {
        const img = imgs.playerShip;
        if (img) {
          ctx.drawImage(
            img,
            player.x - player.width / 2,
            playerDisplayY - player.height / 2,
            player.width,
            player.height
          );
        } else {
          ctx.fillStyle = C.player;
          ctx.beginPath();
          ctx.moveTo(player.x, playerDisplayY - player.height / 2);
          ctx.lineTo(player.x - player.width / 2, playerDisplayY + player.height / 2);
          ctx.lineTo(player.x + player.width / 2, playerDisplayY + player.height / 2);
          ctx.closePath();
          ctx.fill();
        }
        // #1033 Shield aura — glowing ring
        if (state.activePowerUp?.type === "shield") {
          ctx.globalAlpha = 0.25;
          ctx.fillStyle = C.shieldAura;
          ctx.beginPath();
          ctx.arc(player.x, playerDisplayY, player.width * 0.8, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 0.8;
          ctx.strokeStyle = C.shieldRing;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(player.x, playerDisplayY, player.width * 0.8, 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = 1;
          ctx.lineWidth = 1;
        }

        // Lightning super-state electric tint
        if (state.activePowerUp?.type === "lightning") {
          ctx.globalAlpha = 0.45;
          ctx.fillStyle = C.superTint;
          ctx.fillRect(
            player.x - player.width / 2,
            playerDisplayY - player.height / 2,
            player.width,
            player.height
          );
          ctx.globalAlpha = 1;
        }
      }

      // #1035 Buddy ships — blue ship sprite; flip for right-entry
      for (const buddy of state.buddyShips) {
        const img = imgs.buddyShip;
        ctx.save();
        if (!buddy.fromLeft) {
          ctx.translate(buddy.x, 0);
          ctx.scale(-1, 1);
          ctx.translate(-buddy.x, 0);
        }
        if (img) {
          ctx.drawImage(img, buddy.x - 17, buddy.y - 17, 34, 34);
        } else {
          ctx.fillStyle = C.buddyShip;
          ctx.fillRect(buddy.x - 17, buddy.y - 17, 34, 34);
        }
        ctx.restore();
      }

      // Power-ups — Kenney CC0 sprites with procedural fallback
      for (const pu of state.powerUps) {
        const lx = pu.x - pu.width / 2;
        const ly = pu.y - pu.height / 2;
        const pw = pu.width;
        const ph = pu.height;
        const spriteMap: Record<string, HTMLImageElement | null> = {
          shield: imgs.puShield,
          bomb: imgs.puBomb,
          buddy: imgs.puBuddy,
          lightning: imgs.puLightning,
        };
        const sprite = spriteMap[pu.type] ?? null;
        if (sprite) {
          ctx.drawImage(sprite, lx, ly, pw, ph);
        } else if (pu.type === "shield") {
          ctx.fillStyle = C.powerUpShield;
          ctx.beginPath();
          ctx.arc(pu.x, pu.y, pw * 0.4, 0, Math.PI * 2);
          ctx.fill();
        } else if (pu.type === "bomb") {
          ctx.fillStyle = C.powerUpBomb;
          ctx.beginPath();
          ctx.arc(pu.x, pu.y, pw * 0.4, 0, Math.PI * 2);
          ctx.fill();
        } else if (pu.type === "buddy") {
          ctx.fillStyle = C.powerUpBuddy;
          ctx.fillRect(lx + pw * 0.2, ly + ph * 0.2, pw * 0.6, ph * 0.6);
        } else {
          ctx.fillStyle = C.powerUpLightning;
          ctx.beginPath();
          ctx.moveTo(lx + pw * 0.625, ly);
          ctx.lineTo(lx + pw * 0.125, ly + ph * 0.542);
          ctx.lineTo(lx + pw * 0.458, ly + ph * 0.542);
          ctx.lineTo(lx + pw * 0.375, ly + ph);
          ctx.lineTo(lx + pw * 0.875, ly + ph * 0.458);
          ctx.lineTo(lx + pw * 0.542, ly + ph * 0.458);
          ctx.closePath();
          ctx.fill();
        }
      }

      // #1034 Bomb flash — full-screen white overlay fading out
      if (state.bombFlashTimer > 0) {
        ctx.globalAlpha = (state.bombFlashTimer / 300) * 0.75;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);
        ctx.globalAlpha = 1;
      }

      // Explosions
      for (const exp of state.explosions) {
        const frameImg = imgs.explosionFrames[exp.frame] ?? null;
        const half = EXPLOSION_DRAW_SIZE / 2;
        if (frameImg) {
          ctx.drawImage(
            frameImg,
            exp.x - half,
            exp.y - half,
            EXPLOSION_DRAW_SIZE,
            EXPLOSION_DRAW_SIZE
          );
        } else {
          const progress = exp.frame / 20;
          ctx.globalAlpha = 1 - progress;
          ctx.fillStyle = progress < 0.4 ? C.explosionHot : C.explosionCool;
          ctx.beginPath();
          ctx.arc(exp.x, exp.y, 6 + progress * 18, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }

      // HUD
      ctx.font = "bold 13px 'Courier New', monospace";
      ctx.textBaseline = "top";
      ctx.fillStyle = C.hudText;
      ctx.textAlign = "left";
      ctx.fillText(`${t("hud.score")} ${state.score}`, 10, 8);
      ctx.textAlign = "center";
      ctx.fillText(`${t("hud.best")} ${hs}`, width / 2, 8);
      ctx.textAlign = "right";
      ctx.fillText(`${t("hud.wave")} ${state.wave}`, width - 10, 8);

      // Difficulty tier — centered below score row
      ctx.font = "bold 10px 'Courier New', monospace";
      ctx.textAlign = "center";
      ctx.fillStyle = C.hudDiff;
      ctx.fillText(
        `${difficultyLabel(state.difficulty)} ×${difficultyMultiplier(state.difficulty)}`,
        width / 2,
        26
      );

      // Lives — small cyan rectangles at bottom-left
      for (let i = 0; i < player.lives; i++) {
        ctx.fillStyle = C.lives;
        ctx.fillRect(10 + i * 16, height - 18, 10, 14);
      }

      // Power-up countdown bar — above lives
      if (state.activePowerUp !== null) {
        const ratio = state.activePowerUp.remainingMs / POWERUP_DURATION;
        ctx.fillStyle = C.powerBarBg;
        ctx.fillRect(10, height - 26, 60, 4);
        ctx.fillStyle = C.powerBarFill;
        ctx.fillRect(10, height - 26, 60 * ratio, 4);
      }

      // Phase overlays
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      if (state.phase === "WaveClear") {
        ctx.font = "bold 22px 'Courier New', monospace";
        ctx.fillStyle = C.waveClear;
        ctx.fillText(t("phase.waveClear"), width / 2, height / 2);
        if (state.freeFirePerfect) {
          ctx.font = "bold 18px 'Courier New', monospace";
          ctx.fillStyle = "#ffdd00";
          ctx.shadowColor = "#ff8800";
          ctx.shadowBlur = 8;
          ctx.fillText(t("phase.perfect"), width / 2, height / 2 + 30);
          ctx.shadowBlur = 0;
        }
      }

      if (state.phase === "WinTransition") {
        // MISSION COMPLETE fades in 200ms after the freeze starts
        const bannerAlpha = Math.min(
          1,
          Math.max(0, (state.winTransitionElapsed - 200) / 400)
        );
        if (bannerAlpha > 0) {
          ctx.globalAlpha = bannerAlpha;
          ctx.font = "bold 26px 'Courier New', monospace";
          ctx.fillStyle = C.waveClear;
          ctx.shadowColor = C.waveClear;
          ctx.shadowBlur = 18;
          ctx.fillText(t("phase.missionComplete"), width / 2, height / 2);
          ctx.shadowBlur = 0;
          if (state.freeFirePerfect) {
            ctx.font = "bold 18px 'Courier New', monospace";
            ctx.fillStyle = "#ffdd00";
            ctx.shadowColor = "#ff8800";
            ctx.shadowBlur = 8;
            ctx.fillText(t("phase.perfect"), width / 2, height / 2 + 34);
            ctx.shadowBlur = 0;
          }
          ctx.globalAlpha = 1;
        }
      }

      if (state.phase === "FreeFireZone") {
        ctx.font = "bold 20px 'Courier New', monospace";
        ctx.fillStyle = C.freeFireZone;
        ctx.fillText(t("phase.freeFireZone"), width / 2, height / 2 - 18);
        ctx.font = "14px 'Courier New', monospace";
        ctx.fillStyle = C.hudText;
        ctx.fillText(t("phase.hits", { count: state.freeFireHits }), width / 2, height / 2 + 12);
      }

      if (state.phase === "GameOver") {
        ctx.fillStyle = C.gameOverOverlay;
        ctx.fillRect(0, 0, width, height);
        ctx.font = "bold 28px 'Courier New', monospace";
        ctx.fillStyle = C.gameOverText;
        ctx.fillText(t("phase.gameOver"), width / 2, height / 2 - 22);
        ctx.font = "16px 'Courier New', monospace";
        ctx.fillStyle = C.hudText;
        ctx.fillText(`${t("hud.score")} ${state.score}`, width / 2, height / 2 + 18);
      }

      // Pre-wave countdown (after WinTransition flies off)
      if (countdownDigit !== null) {
        // Wave incoming banner above the digit
        ctx.font = "bold 16px 'Courier New', monospace";
        ctx.fillStyle = C.waveClear;
        ctx.fillText(`— ${t("hud.wave")} ${state.wave} —`, width / 2, height / 2 - 64);
        // Large countdown digit
        ctx.font = "bold 96px 'Courier New', monospace";
        ctx.fillStyle = C.waveClear;
        ctx.shadowColor = C.waveClear;
        ctx.shadowBlur = 20;
        ctx.fillText(String(countdownDigit), width / 2, height / 2);
        ctx.shadowBlur = 0;
      }

      ctx.restore();
    }, [width, height]);

    const drawRef = useRef(draw);
    useEffect(() => {
      drawRef.current = draw;
    }, [draw]);

    // Single long-lived RAF loop — reads all mutable game state from refs
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
          stateRef.current = applyPowerUp(stateRef.current, type);
        }

        const prev = stateRef.current;
        if (prev.phase !== "GameOver" && !isPausedRef.current) {
          if (countdownMsRef.current !== null) {
            // Pre-wave countdown: freeze the engine, just tick the timer
            countdownMsRef.current = Math.max(0, countdownMsRef.current - dtMs);
            if (countdownMsRef.current === 0) countdownMsRef.current = null;
          } else {
            try {
              const prevCooldown = prev.player.shootCooldown;
              const pauseStraggler = devOptionsRef.current?.pauseStraggler ?? false;
              const tickInput =
                prev.pauseStraggler !== pauseStraggler ? { ...prev, pauseStraggler } : prev;
              const next = tick(tickInput, dtMs, {
                playerX: inputRef.current.playerX,
                fire: inputRef.current.fire,
              });
              let applied = next;
              if (infiniteLivesRef.current && next.player.lives < prevLivesRef.current) {
                applied = {
                  ...next,
                  phase: next.phase === "GameOver" ? prevPhaseRef.current : next.phase,
                  player: { ...next.player, lives: prevLivesRef.current, invincibleTimer: 2000 },
                };
              }
              stateRef.current = applied;
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
              const nowType = applied.activePowerUp?.type ?? null;
              if (prevActivePowerUpRef.current === null && nowType !== null) {
                onPowerUpCollectRef.current?.(nowType);
              }
              prevActivePowerUpRef.current = nowType;
              if (applied.explosions.length > prev.explosions.length) {
                onExplosionRef.current?.();
              }
              if (applied.player.lives < prevLivesRef.current) {
                if (applied.phase !== "GameOver") onPlayerHitRef.current?.();
              }
              prevLivesRef.current = applied.player.lives;
              // WinTransition replaces WaveClear for all normal wave clears
              if (applied.phase === "WinTransition" && prevPhaseRef.current !== "WinTransition") {
                onWaveClearRef.current?.();
                if (applied.freeFirePerfect) onFreeFirePerfectRef.current?.();
              }
              if (applied.phase === "WaveClear" && prevPhaseRef.current !== "WaveClear") {
                onWaveClearRef.current?.();
                if (applied.freeFirePerfect) onFreeFirePerfectRef.current?.();
              }
              if (applied.phase === "FreeFireZone" && prevPhaseRef.current !== "FreeFireZone") {
                onFreeFireZoneRef.current?.();
              }
              // WinTransition → SwoopIn: engine has already built the next wave; start countdown
              if (prevPhaseRef.current === "WinTransition" && applied.phase === "SwoopIn") {
                countdownMsRef.current = 5000;
                inputRef.current.playerX = applied.player.x; // stay where AI left the ship
              }
              prevPhaseRef.current = applied.phase;
              if (applied.phase === "GameOver") {
                onGameOverRef.current?.(applied.score, applied.wave);
              }
            } catch (e) {
              Sentry.captureException(e, { tags: { subsystem: "starswarm.loop" } });
            }
          } // end else (countdown not active)
        }
        // Starfield scrolls continuously, even on game over
        sfRef.current = tickStarfield(sfRef.current, dtMs);

        drawRef.current();
        id = requestAnimationFrame(loop);
      }

      function handleVisibilityChange() {
        if (!document.hidden) {
          lastFrameTimeRef.current = 0;
        } else if (stateRef.current.phase === "Playing" && !isPausedRef.current) {
          onPauseRef.current?.();
        }
      }
      document.addEventListener("visibilitychange", handleVisibilityChange);
      id = requestAnimationFrame(loop);
      return () => {
        cancelAnimationFrame(id);
        document.removeEventListener("visibilitychange", handleVisibilityChange);
      };
    }, []); // intentionally empty — loop lives for component lifetime

    const displayW = Math.round(width * scale);
    const displayH = Math.round(height * scale);

    return (
      <View
        style={{ width: displayW, height: displayH }}
        accessibilityLabel={t("game.canvasLabel")}
        accessibilityRole="image"
      >
        <canvas ref={canvasRef} width={displayW} height={displayH} style={{ display: "block" }} />
      </View>
    );
  }
);

GameCanvas.displayName = "GameCanvas";
export default GameCanvas;
