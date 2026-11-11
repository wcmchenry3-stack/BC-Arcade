import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { AccessibilityInfo, View } from "react-native";
import { Asset } from "expo-asset";
import { useTranslation } from "react-i18next";
import * as Sentry from "@sentry/react-native";
import {
  initStarSwarm,
  tick,
  applyPowerUp,
  POWERUP_DURATION,
  difficultyMultiplier,
  MISSION_COMPLETE_FADE_MS,
  decayMissionCompleteTimer,
  showMissionCompleteBanner,
  isBossWave,
  routJustStarted,
  bombJustDetonated,
  powerUpCollected,
  fleeingCount,
  carrierJustExposed,
  isCarrierArmored,
  throwAsteroid,
  killEscorts,
  carrierBeamJustStarted,
  carrierBeamJustFired,
  carrierAttackRunJustStarted,
  carrierFinalStandJustStarted,
  reinforcementBayJustOpened,
  upgradeEvents,
  waveJustCleared,
  isAutopilot,
  PLAYER_W,
} from "../../game/starswarm/engine";
import { WAVE_COUNTDOWN_MS } from "../../game/starswarm/engine";
import { devRevert } from "../../game/starswarm/waveEvents";
import { drawPickupOps, PICKUP_SPRITES, pickupOps } from "../../game/starswarm/render/pickups";
import type { PickupSpriteKey } from "../../game/starswarm/render/pickups";
import { buddyOps } from "../../game/starswarm/render/buddy";
import { carrierOps } from "../../game/starswarm/render/carrier";
import { prebuildShipGlows, shipGlow } from "../../game/starswarm/render/outlineGlow";
import type { GlowCache } from "../../game/starswarm/render/outlineGlow";
import { playerEffectOps } from "../../game/starswarm/render/playerFx";
import {
  armourLevel,
  DEFAULT_SHIP_ID,
  playerFallbackOp,
  SHIP_ART_SCALE,
  SHIP_BASE_SPRITE,
  SHIP_SPRITE_PAD,
  shipStack,
} from "../../game/starswarm/render/ship";
import type { ShipId, ShipSpriteKey } from "../../game/starswarm/render/ship";
import type { DrawOp } from "../../game/starswarm/render/frame";
import { lightningBeamOps } from "../../game/starswarm/render/lightningBeam";
import { drawEnemyOps, ENEMY_SPRITES, enemyOps } from "../../game/starswarm/render/enemies";
import { SHOT_SPRITES, shotOps } from "../../game/starswarm/render/shots";
import type { ShotSpriteKey } from "../../game/starswarm/render/shots";
import type { EnemySpriteKey } from "../../game/starswarm/render/enemies";
import { showCollectPowerUpsCue, showCrackAsteroidsCue } from "../../game/starswarm/render/hud";
import {
  HUD_LAYOUT,
  HUD_TEXT,
  gunsChipText,
  hullChipText,
} from "../../game/starswarm/render/hudStyle";
import { PICKUP_SPRITE } from "../../game/starswarm/render/pickups";
import { beginHudText, drawWebHud, endHudText, loadHudFonts, resetHudTextCache } from "./webHud";
import type { WebHudFrame } from "./webHud";
import {
  asteroidOps,
  ROCK_BODY_LIST,
  rockBodySlot,
  ROCK_SPRITES,
} from "../../game/starswarm/render/asteroids";
import type { RockSpriteKey } from "../../game/starswarm/render/asteroids";
import {
  drawRockOps,
  prebuildRockTints,
  rockBodyBaked,
} from "../../game/starswarm/render/rockTint";
import type { RockTintCache } from "../../game/starswarm/render/rockTint";
import { BG_RGB, BUDDY_SHIP_RGB } from "../../game/starswarm/render/palette";
import { effectOps } from "../../game/starswarm/render/explosions";
import { buildWebBackdrop } from "../../game/starswarm/render/nebula";
import { cssHex, cssRgba } from "../../game/starswarm/render/color";
import { STARSWARM_ACCENT } from "../../theme/theme.starswarm";
import {
  pickupCues,
  pickupCueFrame,
  pickupCueLabelKey,
  pickupCueA11yKey,
  collectCueTop,
  cueColor,
} from "../../game/starswarm/render/pickupCue";
import type { PickupCue } from "../../game/starswarm/render/pickupCue";
import { initStarfield, starY, tickStarfield } from "../../game/starswarm/starfield";
import type { StarfieldState } from "../../game/starswarm/starfield";
import { newLoopFlags, updateLoops, type StarSwarmLoop } from "../../game/starswarm/soundLoops";
import {
  emitSoundCues,
  emitTickSounds,
  type TickSoundSinks,
  type StarSwarmCue,
} from "../../game/starswarm/soundCues";
import type {
  StarSwarmState,
  PowerUpType,
  DifficultyTier,
  CarrierEvent,
  UpgradeEvent,
} from "../../game/starswarm/types";

import p1BaseSrc from "../../../assets/starswarm/player/p1-base.webp";
import p1Guns2Src from "../../../assets/starswarm/player/p1-guns2.webp";
import p1Guns3Src from "../../../assets/starswarm/player/p1-guns3.webp";
import p1Plating1Src from "../../../assets/starswarm/player/p1-plating1.webp";
import p1Plating2Src from "../../../assets/starswarm/player/p1-plating2.webp";
import p2BaseSrc from "../../../assets/starswarm/player/p2-base.webp";
import p2Guns2Src from "../../../assets/starswarm/player/p2-guns2.webp";
import p2Guns3Src from "../../../assets/starswarm/player/p2-guns3.webp";
import p2Plating1Src from "../../../assets/starswarm/player/p2-plating1.webp";
import p2Plating2Src from "../../../assets/starswarm/player/p2-plating2.webp";
import p3BaseSrc from "../../../assets/starswarm/player/p3-base.webp";
import p3Guns2Src from "../../../assets/starswarm/player/p3-guns2.webp";
import p3Guns3Src from "../../../assets/starswarm/player/p3-guns3.webp";
import p3Plating1Src from "../../../assets/starswarm/player/p3-plating1.webp";
import p3Plating2Src from "../../../assets/starswarm/player/p3-plating2.webp";
import buddyShipSrc from "../../../assets/starswarm/buddy-escort.webp";
import enemyGruntSrc from "../../../assets/starswarm/enemy/grunt.webp";
import enemyEliteSrc from "../../../assets/starswarm/enemy/elite.webp";
import enemyEliteAttackSrc from "../../../assets/starswarm/enemy/elite-attack.webp";
import enemyEliteHurtSrc from "../../../assets/starswarm/enemy/elite-hurt.webp";
import enemyGuardianSrc from "../../../assets/starswarm/enemy/guardian.webp";
import enemyGuardianPlateSrc from "../../../assets/starswarm/enemy/guardian-plate.webp";
import enemyGuardianCracksSrc from "../../../assets/starswarm/enemy/guardian-cracks.webp";
import enemyGuardianPlate2Src from "../../../assets/starswarm/enemy/guardian-plate2.webp";
import enemyCarrierSrc from "../../../assets/starswarm/enemy/carrier.webp";
import enemyCarrierCracksSrc from "../../../assets/starswarm/enemy/carrier-cracks.webp";
import shotPlayerSrc from "../../../assets/starswarm/shot/player.webp";
import shotBuddySrc from "../../../assets/starswarm/shot/buddy.webp";
import shotEnemySrc from "../../../assets/starswarm/shot/enemy.webp";
import shotFlakSrc from "../../../assets/starswarm/shot/flak.webp";
import shotCarrierSrc from "../../../assets/starswarm/shot/carrier.webp";
import puShieldSrc from "../../../assets/starswarm/pickup/shield.webp";
import puLightningSrc from "../../../assets/starswarm/pickup/lightning.webp";
import puBuddySrc from "../../../assets/starswarm/pickup/buddy.webp";
import puBombSrc from "../../../assets/starswarm/pickup/bomb.webp";
import puSalvageSrc from "../../../assets/starswarm/pickup/salvage.webp";
import puHullSrc from "../../../assets/starswarm/pickup/hull.webp";
import rockLarge1Src from "../../../assets/starswarm/rock/large-1.webp";
import rockLarge1VeinsSrc from "../../../assets/starswarm/rock/large-1-veins.webp";
import rockLarge2Src from "../../../assets/starswarm/rock/large-2.webp";
import rockLarge2VeinsSrc from "../../../assets/starswarm/rock/large-2-veins.webp";
import rockSmall1Src from "../../../assets/starswarm/rock/small-1.webp";
import rockSmall2Src from "../../../assets/starswarm/rock/small-2.webp";

/** #3596: each rock image's module (the bodies are tinted per palette once they load). */
const ROCK_SRCS: Record<RockSpriteKey, number> = {
  rockLarge1: rockLarge1Src as number,
  rockLarge1Veins: rockLarge1VeinsSrc as number,
  rockLarge2: rockLarge2Src as number,
  rockLarge2Veins: rockLarge2VeinsSrc as number,
  rockSmall1: rockSmall1Src as number,
  rockSmall2: rockSmall2Src as number,
};

/** One value per rock image, from its key and its index in `ROCK_SPRITES`. */
function rockRecord<T>(value: (key: RockSpriteKey, i: number) => T): Record<RockSpriteKey, T> {
  return Object.fromEntries(ROCK_SPRITES.map((k, i) => [k, value(k, i)])) as Record<
    RockSpriteKey,
    T
  >;
}

/** #3593: each enemy sprite's image module. */
const ENEMY_SRCS: Record<EnemySpriteKey, number> = {
  enemyGrunt: enemyGruntSrc as number,
  enemyElite: enemyEliteSrc as number,
  enemyEliteAttack: enemyEliteAttackSrc as number,
  enemyEliteHurt: enemyEliteHurtSrc as number,
  enemyGuardian: enemyGuardianSrc as number,
  enemyGuardianPlate: enemyGuardianPlateSrc as number,
  enemyGuardianCracks: enemyGuardianCracksSrc as number,
  enemyGuardianPlate2: enemyGuardianPlate2Src as number,
  enemyCarrier: enemyCarrierSrc as number,
  enemyCarrierCracks: enemyCarrierCracksSrc as number,
};

/** #3594: each shot sprite's image module. */
const SHOT_SRCS: Record<ShotSpriteKey, number> = {
  shotPlayer: shotPlayerSrc as number,
  shotBuddy: shotBuddySrc as number,
  shotEnemy: shotEnemySrc as number,
  shotFlak: shotFlakSrc as number,
  shotCarrier: shotCarrierSrc as number,
};

/** #3595: each pickup sprite's image module. */
const PICKUP_SRCS: Record<PickupSpriteKey, number> = {
  puShield: puShieldSrc as number,
  puLightning: puLightningSrc as number,
  puBuddy: puBuddySrc as number,
  puBomb: puBombSrc as number,
  puSalvage: puSalvageSrc as number,
  puHull: puHullSrc as number,
};

/** One value per pickup sprite, from its key and its index in `PICKUP_SPRITES`. */
function pickupRecord<T>(
  value: (key: PickupSpriteKey, i: number) => T
): Record<PickupSpriteKey, T> {
  return Object.fromEntries(PICKUP_SPRITES.map((k, i) => [k, value(k, i)])) as Record<
    PickupSpriteKey,
    T
  >;
}

/** One value per shot sprite, from its key and its index in `SHOT_SPRITES`. */
function shotRecord<T>(value: (key: ShotSpriteKey, i: number) => T): Record<ShotSpriteKey, T> {
  return Object.fromEntries(SHOT_SPRITES.map((k, i) => [k, value(k, i)])) as Record<
    ShotSpriteKey,
    T
  >;
}

/** One value per enemy sprite, from its key and its index in `ENEMY_SPRITES`. */
function enemyRecord<T>(value: (key: EnemySpriteKey, i: number) => T): Record<EnemySpriteKey, T> {
  return Object.fromEntries(ENEMY_SPRITES.map((k, i) => [k, value(k, i)])) as Record<
    EnemySpriteKey,
    T
  >;
}
const DT_CAP_MS = 33;
const INVINCIBLE_BLINK_INTERVAL = 120; // ms

/** #3597: each star tint's CSS form, made once, so a frame builds no colour strings. */
const STAR_CSS = new Map<number, string>();
function starCss(rgb: number): string {
  let css = STAR_CSS.get(rgb);
  if (css === undefined) {
    css = cssHex(rgb);
    STAR_CSS.set(rgb, css);
  }
  return css;
}

const C = {
  bg: cssHex(BG_RGB),
  buddyShip: cssRgba(BUDDY_SHIP_RGB, 0.8),
  lives: STARSWARM_ACCENT,
};

/** How long the 1UP flash stays up after a bonus life, ms (as on native). */
const BONUS_FLASH_MS = 1500;

/** #3598: one centred line of HUD banner / cue text in its brand font and glow. */
function drawHudLine(
  ctx: CanvasRenderingContext2D,
  kind:
    "missionComplete" | "bossBanner" | "waveIncoming" | "countdown" | "collectCue" | "bonusLife",
  text: string,
  x: number,
  y: number,
  maxWidth?: number
) {
  beginHudText(ctx, kind);
  if (maxWidth === undefined) ctx.fillText(text, x, y);
  else ctx.fillText(text, x, y, maxWidth);
  endHudText(ctx);
}

interface Images {
  /** #3592: the player ship's layers. */
  ship: Record<ShipSpriteKey, HTMLImageElement | null>;
  buddyShip: HTMLImageElement | null;
  /** #3593: the hive's sprites and damage layers, by the keys `enemyOps` names. */
  enemy: Record<EnemySpriteKey, HTMLImageElement | null>;
  /** Which of them have loaded (built with `enemy`, so a frame allocates nothing for it). */
  enemyLoaded: Record<EnemySpriteKey, boolean>;
  /** #3594: the projectiles, by the keys `shotOps` names. */
  shot: Record<ShotSpriteKey, HTMLImageElement | null>;
  /** Which of them have loaded (built with `shot`, so a frame allocates nothing for it). */
  shotLoaded: Record<ShotSpriteKey, boolean>;
  /** #3595: the pickups, by the keys `pickupOps` names. */
  pickup: Record<PickupSpriteKey, HTMLImageElement | null>;
  /** Which of them have loaded (built with `pickup`, so a frame allocates nothing for it). */
  pickupLoaded: Record<PickupSpriteKey, boolean>;
  /** #3596: the rock images (neutral bodies and the large ones' veins), by `asteroidOps` key. */
  rock: Record<RockSpriteKey, HTMLImageElement | null>;
  /**
   * Which rock images the frame may use: a body once it and all its palette bakes exist, veins
   * once loaded. Built with `rock`, so a frame allocates nothing for it.
   */
  rockLoaded: Record<RockSpriteKey, boolean>;
}

export interface DevOptions {
  wave?: number;
  infiniteLives?: boolean;
  stragglerEnabled?: boolean;
  pauseStraggler?: boolean;
  /** Override difficulty tier for this game (#1037). */
  difficulty?: DifficultyTier;
  /** Suppress timed asteroid spawns (#2486). */
  asteroidsDisabled?: boolean;
  /** Enemies never roll to dodge a rock (#2491). */
  dodgeDisabled?: boolean;
  /** Enemies never fire flak at a rock (#2491). */
  flakDisabled?: boolean;
  /** Grunts never rout when the leaders die (#2489). */
  routDisabled?: boolean;
  /**
   * #3510: the run was started by the dev panel's New Game: it opens dev-affected
   * (`StarSwarmState.devAffected`). The screen sets it only there, and only in DEV_TOOLS builds.
   */
  devRun?: boolean;
}

export interface GameCanvasHandle {
  setPlayerX: (x: number) => void;
  /** See GameCanvas.tsx — the commanded ship X, current even while the engine is frozen. */
  getPlayerX: () => number;
  setFire: (fire: boolean) => void;
  triggerPowerUp: (type: PowerUpType) => void;
  /** Throw an asteroid now — dev-panel testing (#2486). */
  throwAsteroid: () => void;
  /** Destroy every escort so the Carrier is exposed at once — dev-panel testing (#2491). */
  killEscorts: () => void;
  /**
   * #3510: latch the run's dev flag (`StarSwarmState.devAffected`) now — the dev panel's handlers
   * call it, so the flag (and the screen's Sentry tag) is set on the UI path, not in the frame
   * loop. A no-op once set.
   */
  markDevAffected: () => void;
  /** #2567: native-only frame sampling — always null on web. */
  getFrameStats: () => null;
  /** Return the current engine state snapshot — used by StarSwarmScreen to save paused state (#1367). */
  getState: () => StarSwarmState;
}

interface Props {
  highScore?: number;
  onGameOver?: (finalScore: number, wave: number) => void;
  onScoreChange?: (score: number) => void;
  onPlayerHit?: () => void;
  onWaveClear?: () => void;
  onExplosion?: () => void;
  /** #3526: a Smart Bomb detonated this tick (the generic explosion sound is skipped). */
  onBombBlast?: () => void;
  /** #3560: a rock broke this tick (the bigger kind wins); the generic explosion skips rock breaks. */
  onRockBreak?: (kind: "large" | "small") => void;
  /** #3526: a loop's condition changed (shield active, Buddy on station, grunts fleeing, Lightning active). */
  onLoopChange?: (loop: StarSwarmLoop, on: boolean) => void;
  /** #3560: a Shield / Buddy one-shot moment (Shield on / 1 s left / off, Buddy in / out). */
  onSoundCue?: (cue: StarSwarmCue) => void;
  /** #2490: called once when a boss wave (the Carrier and its escorts, nothing else) begins. */
  onBossWave?: () => void;
  /** #2489: called once when the wave's grunts rout, with how many are fleeing. */
  onRout?: (count: number) => void;
  /** #2845: called once when a Buddy ship is destroyed. */
  onBuddyLost?: () => void;
  /** Called once when a bonus life is awarded (parity with the native canvas, #3560). */
  onBonusLife?: () => void;
  onPowerUpCollect?: (type: PowerUpType) => void;
  /** #2484: called once when the last Guardian dies and the Carrier's armor drops. */
  onCarrierExposed?: () => void;
  /** #2485/#2843: beam charge and release, reinforcements, attack run, final stand. */
  onCarrierEvent?: (kind: CarrierEvent) => void;
  /** #2488: a gun or hull ladder change (pickup collected, plating hit, level lost). */
  onUpgrade?: (ev: UpgradeEvent) => void;
  isPaused?: boolean;
  onPause?: () => void;
  width: number;
  height: number;
  scale: number;
  resetTick?: number;
  /** Active difficulty tier — passed from the pre-game selector (#1037). */
  difficulty?: DifficultyTier;
  /** #3600: the player's chosen ship (cosmetic: only the sprite layers differ). Unset: the default. */
  ship?: ShipId;
  devOptions?: DevOptions;
  /** Seed the engine with an existing state instead of initialState() — used to restore a paused session (#1367). */
  initialState?: StarSwarmState;
  /**
   * #3393: whether a new run records wave timelines (the replay dial), asked once each time the
   * canvas creates a run, never per frame. A restored `initialState` keeps its own. Unset: off.
   */
  timelineEnabled?: () => boolean;
}

const GameCanvas = forwardRef<GameCanvasHandle, Props>(
  (
    {
      highScore = 0,
      ship: shipProp = DEFAULT_SHIP_ID,
      onGameOver,
      onScoreChange,
      onPlayerHit,
      onWaveClear,
      onExplosion,
      onBombBlast,
      onRockBreak,
      onLoopChange,
      onSoundCue,
      onBossWave,
      onRout,
      onBuddyLost,
      onBonusLife,
      onPowerUpCollect,
      onCarrierExposed,
      onCarrierEvent,
      onUpgrade,
      isPaused = false,
      onPause,
      width,
      height,
      scale,
      resetTick,
      difficulty: difficultyProp = "LieutenantJG",
      devOptions,
      initialState,
      timelineEnabled,
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
    const shipRef = useRef<ShipId>(shipProp);
    shipRef.current = shipProp;
    const difficultyRef = useRef<DifficultyTier>(difficultyProp);
    const timelineEnabledRef = useRef(timelineEnabled);
    timelineEnabledRef.current = timelineEnabled;
    // #3393: the first run's timeline flag, asked once per mount (the useState initializer below runs once per
    // mount, #3416; the guard keeps the flag stable)
    const firstTimelineOnRef = useRef<boolean | null>(null);
    if (firstTimelineOnRef.current === null) {
      firstTimelineOnRef.current = !initialState && timelineEnabled?.() === true;
    }
    // #3416: lazy init. A call passed straight to useRef() is evaluated on every render and
    // discarded (reseeding the RNG, consuming entity ids, building a wave); the useState
    // initializer runs once per mount. Typed non-null so the many reads stay unchanged.
    const [firstRun] = useState<StarSwarmState>(
      () =>
        initialState ??
        initStarSwarm(
          width,
          height,
          1,
          (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0,
          difficultyProp,
          undefined,
          undefined,
          { timelineOn: firstTimelineOnRef.current === true }
        )
    );
    const stateRef = useRef<StarSwarmState>(firstRun);
    const [firstStars] = useState<StarfieldState>(() => initStarfield(width, height)); // #3416
    const sfRef = useRef<StarfieldState>(firstStars);
    const inputRef = useRef({ playerX: initialState?.player.x ?? width / 2, fire: true });
    const infiniteLivesRef = useRef(false);
    const devOptionsRef = useRef<DevOptions | undefined>(devOptions);
    devOptionsRef.current = devOptions;
    const lastFrameTimeRef = useRef(0);
    const highScoreRef = useRef(highScore);
    const onGameOverRef = useRef(onGameOver);
    const onScoreChangeRef = useRef(onScoreChange);
    const onPlayerHitRef = useRef(onPlayerHit);
    const onWaveClearRef = useRef(onWaveClear);
    const onExplosionRef = useRef(onExplosion);
    const onBombBlastRef = useRef(onBombBlast);
    const onRockBreakRef = useRef(onRockBreak);
    const onLoopChangeRef = useRef(onLoopChange);
    const onSoundCueRef = useRef(onSoundCue);
    const loopFlagsRef = useRef(newLoopFlags());
    // created once, so the tick allocates no closure to report a loop edge
    const emitLoopRef = useRef((loop: StarSwarmLoop, on: boolean) =>
      onLoopChangeRef.current?.(loop, on)
    );
    // created once, like emitLoopRef, so a cue allocates nothing on the tick (#3560)
    const emitCueRef = useRef((cue: StarSwarmCue) => onSoundCueRef.current?.(cue));
    const onBossWaveRef = useRef(onBossWave);
    const onRoutRef = useRef(onRout);
    const onBuddyLostRef = useRef(onBuddyLost);
    // created once so the explosion-family sounds allocate nothing on the tick (#3560)
    const tickSinksRef = useRef<TickSoundSinks>({
      bombBlast: () => onBombBlastRef.current?.(),
      buddyLost: () => onBuddyLostRef.current?.(),
      explosion: () => onExplosionRef.current?.(),
      rockBreak: (kind) => onRockBreakRef.current?.(kind),
    });
    const onBonusLifeRef = useRef(onBonusLife);
    const onPowerUpCollectRef = useRef(onPowerUpCollect);
    const onCarrierExposedRef = useRef(onCarrierExposed);
    const onCarrierEventRef = useRef(onCarrierEvent);
    const onUpgradeRef = useRef(onUpgrade);
    const onPauseRef = useRef(onPause);
    const prevActivePowerUpRef = useRef<string | null>(null);
    const triggerPowerUpRef = useRef<PowerUpType | null>(null);
    const throwAsteroidRef = useRef(false); // #2486
    const killEscortsRef = useRef(false); // #2491
    const isPausedRef = useRef(isPaused);
    const prevScoreRef = useRef(0);
    // #2847: the pickup cue on screen — when it started and what it says
    const pickupCueRef = useRef<{ cue: PickupCue; startedAt: number } | null>(null);
    const prevLivesRef = useRef(stateRef.current.player.lives);
    const prevBonusLivesRef = useRef(stateRef.current.bonusLivesAwarded);
    // #3598: the 1UP flash's end (ms timestamp), as on native; 0 when none is up
    const bonusFlashEndRef = useRef(0);
    // #3598: the HUD's per-frame inputs, one object reused every frame
    const hudFrameRef = useRef<WebHudFrame>({
      width,
      scoreCaption: "",
      score: 0,
      bestCaption: "",
      best: 0,
      difficulty: "",
      waveCaption: "",
      wave: 0,
      gunsText: "",
      hullText: "",
      lives: 0,
      lifeImage: null,
      lifeFallback: C.lives,
      powerUp: null,
      powerUpName: "",
      powerUpFraction: 0,
      powerUpIcon: null,
    });

    // #3598: ask for the brand fonts the canvas draws the HUD in (canvas text never loads a
    // webfont by itself); widths measured in the fallback are dropped once they land
    useEffect(() => {
      let live = true;
      void loadHudFonts().then((ok) => {
        if (!live) return;
        resetHudTextCache();
        if (!ok) {
          Sentry.addBreadcrumb({
            category: "starswarm.fonts",
            level: "warning",
            message: "HUD brand fonts unavailable on the web canvas; drawing in sans-serif",
          });
        }
      });
      return () => {
        live = false;
      };
    }, []);
    const prevPhaseRef = useRef(stateRef.current.phase);
    // #2352: wave clear now advances the wave in the same tick (no WinTransition phase to
    // detect) — the wave counter bumping is the signal that a clear just happened.
    const prevWaveRef = useRef(stateRef.current.wave);
    // Pre-wave countdown: null = no countdown, positive ms = ticking
    const countdownMsRef = useRef<number | null>(initialState ? null : WAVE_COUNTDOWN_MS);
    // #3592: the armour outline glows, built once per gun and hull level (see outlineGlow.ts)
    const glowCacheRef = useRef<GlowCache>([]);
    // The player's effect ops are built into this one array each frame, not a new one
    const playerFxRef = useRef<DrawOp[]>([]);
    // #3594: the shots' ops, built into this one array each frame
    const shotOpsRef = useRef<DrawOp[]>([]);
    // #3595: the pickups' ops, built into this one array each frame
    const pickupOpsRef = useRef<DrawOp[]>([]);
    // #3593: the enemies' ops, built into this one array each frame
    const enemyOpsRef = useRef<DrawOp[]>([]);
    // #3597: the explosions' and bomb flash's ops, built into this one array each frame
    const effectOpsRef = useRef<DrawOp[]>([]);
    // #3596: the rocks' ops, built into this one array each frame
    const rockOpsRef = useRef<DrawOp[]>([]);
    // #3596: every rock body baked into every palette, once, when the images load (rockTint.ts)
    const rockTintsRef = useRef<RockTintCache>([]);
    // #3597: the background and nebula, painted once per canvas size and scale (null: plain fill)
    const backdropRef = useRef<{
      w: number;
      h: number;
      s: number;
      canvas: HTMLCanvasElement | null;
    } | null>(null);
    const imagesRef = useRef<Images>({
      ship: {
        p1Base: null,
        p1Guns2: null,
        p1Guns3: null,
        p1Plating1: null,
        p1Plating2: null,
        p2Base: null,
        p2Guns2: null,
        p2Guns3: null,
        p2Plating1: null,
        p2Plating2: null,
        p3Base: null,
        p3Guns2: null,
        p3Guns3: null,
        p3Plating1: null,
        p3Plating2: null,
      },
      buddyShip: null,
      enemy: enemyRecord(() => null),
      enemyLoaded: enemyRecord(() => false),
      shot: shotRecord(() => null),
      shotLoaded: shotRecord(() => false),
      pickup: pickupRecord(() => null),
      pickupLoaded: pickupRecord(() => false),
      rock: rockRecord(() => null),
      rockLoaded: rockRecord(() => false),
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
    useEffect(() => {
      onPauseRef.current = onPause;
    }, [onPause]);
    useEffect(() => {
      onExplosionRef.current = onExplosion;
    }, [onExplosion]);
    useEffect(() => {
      onBombBlastRef.current = onBombBlast;
    }, [onBombBlast]);
    useEffect(() => {
      onRockBreakRef.current = onRockBreak;
    }, [onRockBreak]);
    useEffect(() => {
      onLoopChangeRef.current = onLoopChange;
    }, [onLoopChange]);
    useEffect(() => {
      onSoundCueRef.current = onSoundCue;
    }, [onSoundCue]);
    useEffect(() => {
      onBossWaveRef.current = onBossWave;
    }, [onBossWave]);
    useEffect(() => {
      onRoutRef.current = onRout;
    }, [onRout]);
    useEffect(() => {
      onBuddyLostRef.current = onBuddyLost;
    }, [onBuddyLost]);
    useEffect(() => {
      onBonusLifeRef.current = onBonusLife;
    }, [onBonusLife]);
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
        const main = Promise.all([
          loadImg(p1BaseSrc as number),
          loadImg(p1Guns2Src as number),
          loadImg(p1Guns3Src as number),
          loadImg(p1Plating1Src as number),
          loadImg(p1Plating2Src as number),
          loadImg(p2BaseSrc as number),
          loadImg(p2Guns2Src as number),
          loadImg(p2Guns3Src as number),
          loadImg(p2Plating1Src as number),
          loadImg(p2Plating2Src as number),
          loadImg(p3BaseSrc as number),
          loadImg(p3Guns2Src as number),
          loadImg(p3Guns3Src as number),
          loadImg(p3Plating1Src as number),
          loadImg(p3Plating2Src as number),
          loadImg(buddyShipSrc as number),
        ]);
        // #3593: the hive's sprites, in `ENEMY_SPRITES` order, started after the rest
        const enemyLoads = Promise.all(ENEMY_SPRITES.map((k) => loadImg(ENEMY_SRCS[k])));
        // #3594: the shots, in `SHOT_SPRITES` order
        const shotLoads = Promise.all(SHOT_SPRITES.map((k) => loadImg(SHOT_SRCS[k])));
        // #3596: the rocks, in `ROCK_SPRITES` order
        const rockLoads = Promise.all(ROCK_SPRITES.map((k) => loadImg(ROCK_SRCS[k])));
        // #3595: the pickups, in `PICKUP_SPRITES` order
        const pickupLoads = Promise.all(PICKUP_SPRITES.map((k) => loadImg(PICKUP_SRCS[k])));
        const results = await main;
        const enemyImgs = await enemyLoads;
        const rockImgs = await rockLoads;
        const shotImgs = await shotLoads;
        const pickupImgs = await pickupLoads;
        if (cancelled) return;
        const [
          p1Base,
          p1Guns2,
          p1Guns3,
          p1Plating1,
          p1Plating2,
          p2Base,
          p2Guns2,
          p2Guns3,
          p2Plating1,
          p2Plating2,
          p3Base,
          p3Guns2,
          p3Guns3,
          p3Plating1,
          p3Plating2,
          buddyShip,
        ] = results;
        imagesRef.current = {
          ship: {
            p1Base: p1Base ?? null,
            p1Guns2: p1Guns2 ?? null,
            p1Guns3: p1Guns3 ?? null,
            p1Plating1: p1Plating1 ?? null,
            p1Plating2: p1Plating2 ?? null,
            p2Base: p2Base ?? null,
            p2Guns2: p2Guns2 ?? null,
            p2Guns3: p2Guns3 ?? null,
            p2Plating1: p2Plating1 ?? null,
            p2Plating2: p2Plating2 ?? null,
            p3Base: p3Base ?? null,
            p3Guns2: p3Guns2 ?? null,
            p3Guns3: p3Guns3 ?? null,
            p3Plating1: p3Plating1 ?? null,
            p3Plating2: p3Plating2 ?? null,
          },
          buddyShip: buddyShip ?? null,
          enemy: enemyRecord((_, i) => enemyImgs[i] ?? null),
          enemyLoaded: enemyRecord((_, i) => !!enemyImgs[i]),
          shot: shotRecord((_, i) => shotImgs[i] ?? null),
          shotLoaded: shotRecord((_, i) => !!shotImgs[i]),
          pickup: pickupRecord((_, i) => pickupImgs[i] ?? null),
          pickupLoaded: pickupRecord((_, i) => !!pickupImgs[i]),
          ...bakeRocks(rockImgs),
        };
        // #3592: build the six armour glows now, not mid-frame when a hull or gun pickup lands
        prebuildShipGlows(
          glowCacheRef.current,
          shipRef.current,
          imagesRef.current.ship,
          SHIP_ART_SCALE
        );
      })();

      /**
       * #3596: the rock images, every body baked into its three palettes now (not mid-frame), and
       * which of them the frame may use — a body without its bakes draws the outline instead.
       */
      function bakeRocks(imgs: (HTMLImageElement | null | undefined)[]) {
        const rock = rockRecord((_, i) => imgs[i] ?? null);
        const tints = rockTintsRef.current;
        prebuildRockTints(
          tints,
          ROCK_BODY_LIST.map((k) => rock[k])
        );
        const rockLoaded = rockRecord((k) => {
          const b = rockBodySlot(k);
          return b < 0 ? !!rock[k] : rockBodyBaked(tints, b);
        });
        return { rock, rockLoaded };
      }

      return () => {
        cancelled = true;
      };
    }, []);

    // #3600: a ship picked after the images loaded gets its glows built now, not mid-frame
    useEffect(() => {
      prebuildShipGlows(glowCacheRef.current, shipProp, imagesRef.current.ship, SHIP_ART_SCALE);
    }, [shipProp]);

    useImperativeHandle(
      ref,
      () => ({
        setPlayerX(x) {
          inputRef.current.playerX = x;
        },
        getPlayerX() {
          const hw = PLAYER_W / 2;
          return Math.max(hw, Math.min(width - hw, inputRef.current.playerX));
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
        markDevAffected() {
          if (!stateRef.current.devAffected)
            stateRef.current = { ...stateRef.current, devAffected: true };
        },
        getState() {
          return stateRef.current;
        },
        getFrameStats() {
          return null;
        },
      }),
      [width]
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
        opts?.difficulty ?? difficultyRef.current,
        opts?.stragglerEnabled,
        undefined,
        {
          timelineOn: timelineEnabledRef.current?.() === true, // #3393: decided once per run
          ...(opts?.devRun === true ? { devAffected: true } : {}), // #3510
        }
      );
      sfRef.current = initStarfield(width, height);
      lastFrameTimeRef.current = 0;
      inputRef.current.playerX = width / 2;
      inputRef.current.fire = true;
      prevScoreRef.current = 0;
      prevLivesRef.current = stateRef.current.player.lives;
      prevBonusLivesRef.current = stateRef.current.bonusLivesAwarded;
      bonusFlashEndRef.current = 0;
      prevPhaseRef.current = stateRef.current.phase;
      prevWaveRef.current = stateRef.current.wave;
      prevActivePowerUpRef.current = null;
      loopFlagsRef.current = newLoopFlags(); // #3526
      triggerPowerUpRef.current = null;
      throwAsteroidRef.current = false;
      countdownMsRef.current = WAVE_COUNTDOWN_MS;
      // #2490: a game that opens on a boss wave (dev wave jump) is announced like a cleared-into one
      if (isBossWave(stateRef.current.wave) && !isPausedRef.current) onBossWaveRef.current?.();
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
      const playerDisplayY = player.y;
      const shipVisible = playerDisplayY + player.height > 0;
      // Countdown digit (null = no countdown active)
      const cMs = countdownMsRef.current;
      const countdownDigit = cMs !== null ? Math.max(1, Math.ceil(cMs / 1000)) : null;

      const displayW = width * s;
      const displayH = height * s;
      ctx.clearRect(0, 0, displayW, displayH);
      ctx.save();
      ctx.scale(s, s);

      // Background and the #3597 nebula: one blit of the canvas painted once per size and scale
      const bd = backdropRef.current;
      if (!bd || bd.w !== width || bd.h !== height || bd.s !== s) {
        backdropRef.current = {
          w: width,
          h: height,
          s,
          canvas: buildWebBackdrop(width, height, s, C.bg),
        };
      }
      const backdrop = backdropRef.current!.canvas;
      if (backdrop) {
        ctx.drawImage(backdrop, 0, 0, width, height);
      } else {
        ctx.fillStyle = C.bg;
        ctx.fillRect(0, 0, width, height);
      }

      // Starfield (#3597: each star tinted by its depth)
      for (const star of sf.stars) {
        ctx.globalAlpha = star.opacity;
        ctx.fillStyle = starCss(star.rgb);
        ctx.beginPath();
        ctx.arc(star.x, starY(star, sf), star.r, 0, Math.PI * 2); // #2963: scrolled by its layer
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // #3594 Shots: the shared ops (enemy fire, then the player's and Buddy's), one sprite each,
      // bolts turned along their travel — replayed on the 2D context
      const shotBuf = shotOpsRef.current;
      shotBuf.length = 0;
      drawEnemyOps(
        ctx,
        shotOps(state.enemyBullets, state.playerBullets, imgs.shotLoaded, shotBuf),
        imgs.shot,
        drawPickupOps
      );

      // Enemies (#3593): the shared ops — sprites by tier, HP and phase, leaning into their travel,
      // the armour ring, the hit flash and the damage effects — replayed on the 2D context
      const enemyBuf = enemyOpsRef.current;
      enemyBuf.length = 0;
      drawEnemyOps(
        ctx,
        enemyOps(
          {
            enemies: state.enemies,
            carrierArmored: isCarrierArmored(state), // #2484
            clock: state.nextDiveTimer,
            loaded: imgs.enemyLoaded,
          },
          enemyBuf
        ),
        imgs.enemy,
        drawPickupOps
      );

      // #2485/#2843 Carrier telegraphs and released beams — the native geometry, replayed
      drawPickupOps(ctx, carrierOps(state));
      // #3562 Lightning's beams — the native geometry, replayed (under the ship)
      drawPickupOps(ctx, lightningBeamOps(state));

      // Player (blink during invincibility)
      const blink =
        player.invincibleTimer > 0 &&
        Math.floor(player.invincibleTimer / INVINCIBLE_BLINK_INTERVAL) % 2 === 1;
      if (!blink && shipVisible) {
        const px = player.x - player.width / 2;
        const py = playerDisplayY - player.height / 2;
        const ship = shipRef.current;
        if (imgs.ship[SHIP_BASE_SPRITE[ship]]) {
          // #3592: the layers of the held gun and hull level, each the box plus its margin; the
          // armour outline (hull 1 and 2) is a cached glow drawn under them
          const stack = shipStack(ship, player.guns, player.hull);
          const level = armourLevel(player.hull);
          const m = SHIP_SPRITE_PAD;
          const sx = px - m;
          const sy = py - m;
          const sw = player.width + 2 * m;
          const sh = player.height + 2 * m;
          if (level) {
            const glow = shipGlow(
              glowCacheRef.current,
              ship,
              imgs.ship,
              player.guns,
              player.hull,
              SHIP_ART_SCALE
            );
            if (glow) ctx.drawImage(glow, sx, sy, sw, sh);
          }
          for (const key of stack) {
            const layer = imgs.ship[key];
            if (layer) ctx.drawImage(layer, sx, sy, sw, sh);
          }
        } else {
          drawPickupOps(ctx, [playerFallbackOp(px, py, player.width, player.height)]);
        }
        // #1033 shield bubble, #2488 plating flash, Lightning aura (shared with native)
        const fx = playerFxRef.current;
        fx.length = 0;
        drawPickupOps(ctx, playerEffectOps(state, fx));
      }

      // #1035 Buddy ships — blue ship sprite, facing its travel; #2845 HP bar (shared ops)
      for (const buddy of state.buddyShips) {
        const img = imgs.buddyShip;
        ctx.save();
        if (!buddy.facingRight) {
          ctx.translate(buddy.x, 0);
          ctx.scale(-1, 1);
          ctx.translate(-buddy.x, 0);
        }
        if (img) {
          // #3592: the sprite is the 34 px box plus its transparent margin
          const m = SHIP_SPRITE_PAD;
          ctx.drawImage(img, buddy.x - 17 - m, buddy.y - 17 - m, 34 + 2 * m, 34 + 2 * m);
        } else {
          ctx.fillStyle = C.buddyShip;
          ctx.fillRect(buddy.x - 17, buddy.y - 17, 34, 34);
        }
        ctx.restore();
        drawPickupOps(ctx, buddyOps(buddy, 34));
      }

      // #3595 Pickups: the shared ops — one sprite each, the upgrades in their pulsing halo; the
      // plain shapes while the art loads — replayed on the 2D context
      const pickupBuf = pickupOpsRef.current;
      pickupBuf.length = 0;
      drawEnemyOps(
        ctx,
        pickupOps(state.powerUps, imgs.pickupLoaded, pickupBuf),
        imgs.pickup,
        drawPickupOps
      );

      // #2486/#3596 Asteroids — the shared ops (tinted rock art, veins, hit flash; the outline
      // while the art loads), drawn from the prebuilt palette bakes
      const rockBuf = rockOpsRef.current;
      rockBuf.length = 0;
      drawRockOps(
        ctx,
        asteroidOps(state.asteroids, imgs.rockLoaded, rockBuf),
        imgs.rock,
        rockTintsRef.current,
        rockBodySlot
      );

      // #3597 Explosions, #3596 a split rock's crack over its dust, then the Smart Bomb flash over
      // the whole playfield — the shared ops,
      // replayed after the rocks, where native draws them too (the flash used to sit under the
      // rocks and explosions here)
      const fxBuf = effectOpsRef.current;
      fxBuf.length = 0;
      drawPickupOps(ctx, effectOps(state, width, height, fxBuf));

      // #3598 HUD (H1-A): the three top columns' inputs; webHud draws them last, below, with
      // native's fonts and gaps
      const hf = hudFrameRef.current;
      hf.width = width;
      hf.scoreCaption = t("hud.scoreLabel");
      hf.score = state.score;
      hf.bestCaption = t("hud.bestLabel");
      hf.best = hs;
      hf.difficulty = `${t(`tier.${state.difficulty}`)} ×${difficultyMultiplier(state.difficulty)}`;
      hf.waveCaption = t("hud.waveLabel");
      hf.wave = state.wave;
      hf.gunsText = gunsChipText(t("hud.guns"), state.player.guns);
      hf.hullText = hullChipText(t("hud.hull"), state.player.hull);
      hf.lives = player.lives;
      hf.lifeImage = imgs.ship[SHIP_BASE_SPRITE[shipRef.current]];
      const pu = state.activePowerUp;
      const puKind = pu?.type === "shield" || pu?.type === "lightning" ? pu.type : null;
      hf.powerUp = puKind;
      if (pu && puKind) {
        hf.powerUpName = t(puKind === "shield" ? "hud.powerUpShield" : "hud.powerUpLightning");
        hf.powerUpFraction = Math.max(0, Math.min(1, pu.remainingMs / POWERUP_DURATION));
        hf.powerUpIcon = imgs.pickup[PICKUP_SPRITE[puKind]];
      }
      // #2847: pickup cue — "GUNS +1" / "HULL +1" / "GUNS MAX" toast under the ladder line
      const pc = pickupCueRef.current;
      if (pc) {
        const f = pickupCueFrame(Date.now() - pc.startedAt);
        if (f) {
          ctx.save();
          ctx.globalAlpha = f.opacity;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          // #3598: Space Grotesk, glowing in the cue's own colour
          beginHudText(ctx, "pickupCue", cueColor(pc.cue));
          ctx.translate(width / 2, HUD_LAYOUT.pickupCueCenterY + f.offsetY);
          ctx.scale(f.scale, f.scale);
          // #3512: one line, capped to 90% of the canvas width, as native's maxWidth
          ctx.fillText(t(pickupCueLabelKey(pc.cue)), 0, 0, (width * 0.9) / f.scale);
          endHudText(ctx);
          ctx.restore();
        } else {
          pickupCueRef.current = null;
        }
      }

      // Phase overlays
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      // #2352: purely cosmetic wave-clear acknowledgment — gameplay behind it never
      // pauses. Fades out over its last MISSION_COMPLETE_FADE_MS instead of blocking on a
      // freeze. See showMissionCompleteBanner() for the full suppression rationale — also
      // skipped while the pre-wave countdown overlay (below) is showing, since both render
      // full-screen and centered and would otherwise garble together.
      if (showMissionCompleteBanner(state, countdownDigit !== null)) {
        const bannerAlpha = Math.min(1, state.missionCompleteTimer / MISSION_COMPLETE_FADE_MS);
        if (bannerAlpha > 0) {
          ctx.globalAlpha = bannerAlpha;
          drawHudLine(ctx, "missionComplete", t("phase.missionComplete"), width / 2, height / 2);
          ctx.globalAlpha = 1;
        }
      }

      // #3187: wave cleared, pickups still out — upper third, clear of the ship, lives and HUD
      if (showCollectPowerUpsCue(state)) {
        const cueY = collectCueTop(height) + HUD_TEXT.collectCue.lineHeight / 2;
        drawHudLine(ctx, "collectCue", t("phase.collectPowerUps"), width / 2, cueY, width - 20);
      } else if (showCrackAsteroidsCue(state)) {
        // #3568: only a rock holds the wave — the same slot and style (the pickup cue wins)
        const cueY = collectCueTop(height) + HUD_TEXT.collectCue.lineHeight / 2;
        drawHudLine(ctx, "collectCue", t("phase.crackAsteroids"), width / 2, cueY, width - 20);
      }

      // #2489: rout banner — up while grunts are running for the edge
      if (fleeingCount(state) > 0 && countdownDigit === null) {
        drawHudLine(ctx, "bossBanner", t("phase.rout"), width / 2, height / 2 - 18);
      }

      // #2490: boss-wave telegraph — up while the Carrier and its escorts swoop in
      if (isBossWave(state.wave) && state.phase === "SwoopIn" && countdownDigit === null) {
        drawHudLine(ctx, "bossBanner", t("phase.bossWave"), width / 2, height / 2 - 18);
      }

      // Game over is the shared result card in StarSwarmScreen (#2516); the
      // canvas keeps drawing its final frame behind it.

      // Pre-wave countdown (starts as soon as the wave clears)
      if (countdownDigit !== null) {
        // Wave incoming banner above the digit
        const waveText = `— ${t("hud.waveValue", { wave: state.wave })} —`;
        drawHudLine(ctx, "waveIncoming", waveText, width / 2, height / 2 - 64);
        // Large countdown digit
        drawHudLine(ctx, "countdown", String(countdownDigit), width / 2, height / 2);
      }

      // #3598: the 1UP flash after a bonus life — native always had it, web now matches
      if (Date.now() < bonusFlashEndRef.current) {
        drawHudLine(
          ctx,
          "bonusLife",
          "1UP",
          width / 2,
          height * 0.4 + HUD_TEXT.bonusLife.lineHeight / 2
        );
      }

      // #3598: the HUD columns last, so they always draw above the phase overlays (as on native)
      drawWebHud(ctx, hf);

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
          const before = stateRef.current;
          stateRef.current = applyPowerUp(before, type);
          // #3526: the dev panel's Smart Bomb detonates outside the tick, so sound it here;
          // #3560: so do its Shield / Buddy (the tick's prev already includes the injection)
          emitSoundCues(before, stateRef.current, emitCueRef.current);
          if (bombJustDetonated(before, stateRef.current)) onBombBlastRef.current?.();
        }
        if (throwAsteroidRef.current) {
          throwAsteroidRef.current = false;
          stateRef.current = throwAsteroid(stateRef.current); // #2486
        }
        if (killEscortsRef.current) {
          killEscortsRef.current = false;
          stateRef.current = killEscorts(stateRef.current); // #2491
        }

        const prev = stateRef.current;
        if (prev.phase !== "GameOver" && !isPausedRef.current) {
          if (countdownMsRef.current !== null) {
            // Pre-wave countdown: freeze the engine, just tick the timer. #2352: the cosmetic
            // missionCompleteTimer still needs to decay in real time here — tick() (which
            // normally decrements it) never runs while the countdown is active, so without
            // this it would stay pinned at full opacity for the whole countdown instead of
            // fading out on its own schedule.
            countdownMsRef.current = Math.max(0, countdownMsRef.current - dtMs);
            if (stateRef.current.missionCompleteTimer > 0) {
              stateRef.current = {
                ...stateRef.current,
                missionCompleteTimer: decayMissionCompleteTimer(
                  stateRef.current.missionCompleteTimer,
                  dtMs
                ),
              };
            }
            if (countdownMsRef.current === 0) countdownMsRef.current = null;
          } else {
            try {
              const pauseStraggler = devOptionsRef.current?.pauseStraggler ?? false;
              let tickInput =
                prev.pauseStraggler !== pauseStraggler ? { ...prev, pauseStraggler } : prev;
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
              let applied = next;
              if (infiniteLivesRef.current && next.player.lives < prevLivesRef.current) {
                // #3251: the wave's stats (and a "died" close the revert undoes) are flagged dev
                applied = devRevert(prev, {
                  ...next,
                  phase: next.phase === "GameOver" ? prevPhaseRef.current : next.phase,
                  player: { ...next.player, lives: prevLivesRef.current, invincibleTimer: 2000 },
                });
              }
              stateRef.current = applied;
              if (applied.score !== prevScoreRef.current) {
                prevScoreRef.current = applied.score;
                onScoreChangeRef.current?.(applied.score);
              }
              const nowType = applied.activePowerUp?.type ?? null;
              // #3526: the pickup sound plays when an ordinary power-up is collected, banked or not. A
              // buff that rises without a collection (the dev panel) still sounds; the banked power-up
              // taking effect on the next wave does not (it sounded when it was banked).
              const collected = powerUpCollected(prev, applied);
              const applyingBanked = prev.bankedPowerUp !== null && applied.bankedPowerUp === null;
              if (collected) onPowerUpCollectRef.current?.(collected);
              else if (
                prevActivePowerUpRef.current === null &&
                nowType !== null &&
                !applyingBanked
              ) {
                onPowerUpCollectRef.current?.(nowType);
              }
              prevActivePowerUpRef.current = nowType;
              // #2484: the Carrier's armor dropping has no on-screen text — surface it as an event.
              // Judged against the previous tick, and only while the Carrier is still alive.
              if (carrierJustExposed(prev, applied)) onCarrierExposedRef.current?.();
              // #2485
              if (carrierBeamJustStarted(prev, applied)) onCarrierEventRef.current?.("beamCharge");
              if (carrierBeamJustFired(prev, applied)) onCarrierEventRef.current?.("beamFire");
              // #3561: on the bay-open edge (the telegraph), not the launch 400 ms later
              if (reinforcementBayJustOpened(prev, applied))
                onCarrierEventRef.current?.("reinforce");
              // #2843: attack-run telegraph and a final stand after the armor was already down
              if (carrierAttackRunJustStarted(prev, applied))
                onCarrierEventRef.current?.("attackRun");
              if (carrierFinalStandJustStarted(prev, applied))
                onCarrierEventRef.current?.("finalStand");
              for (const ev of upgradeEvents(prev, applied)) onUpgradeRef.current?.(ev); // #2488
              // #2847: the newest cue wins if two land on one tick
              const cues = pickupCues(prev, applied);
              if (cues.length > 0) {
                pickupCueRef.current = { cue: cues[cues.length - 1]!, startedAt: Date.now() };
              }
              // #3512: a power-up banked or applied is announced once (each fires on one tick)
              for (const cue of cues) {
                if (cue.kind !== "banked" && cue.kind !== "applied") continue;
                const a11yKey = pickupCueA11yKey(cue);
                if (a11yKey) AccessibilityInfo.announceForAccessibility(tRef.current(a11yKey));
              }
              if (routJustStarted(prev, applied)) onRoutRef.current?.(fleeingCount(applied)); // #2489
              // #3526: loops start/stop on their condition's edges only
              updateLoops(applied, loopFlagsRef.current, emitLoopRef.current);
              // #3526/#3560: bomb blast, Buddy down (#2845), rock break, generic explosion
              emitTickSounds(prev, applied, tickSinksRef.current);
              emitSoundCues(prev, applied, emitCueRef.current); // #3560, after the tick sounds as on native
              if (applied.player.lives < prevLivesRef.current) {
                if (applied.phase !== "GameOver") onPlayerHitRef.current?.();
              }
              prevLivesRef.current = applied.player.lives;
              // #3560: the web canvas never reported a bonus life, so its sound never played on web
              if (applied.bonusLivesAwarded > prevBonusLivesRef.current) {
                onBonusLifeRef.current?.();
                bonusFlashEndRef.current = Date.now() + BONUS_FLASH_MS; // #3598: 1UP, as on native
              }
              prevBonusLivesRef.current = applied.bonusLivesAwarded;
              // #2842: the wave clears on the last kill (extraction starts); the wave counter
              // bumps later, once the AI has flown the ship out and the field has been reset.
              if (waveJustCleared(prev, applied)) onWaveClearRef.current?.();
              // While the AI flies the ship, keep the input on it so control resumes in place.
              if (isAutopilot(applied)) inputRef.current.playerX = applied.player.x;
              const waveStarted = applied.wave > prevWaveRef.current;
              prevWaveRef.current = applied.wave;
              if (waveStarted) {
                inputRef.current.playerX = applied.player.x; // back on station, centred
                // #2490: a boss wave announces itself as it opens
                if (isBossWave(applied.wave)) onBossWaveRef.current?.();
              }
              // Every new wave opens on SwoopIn behind the countdown.
              if (waveStarted && applied.phase === "SwoopIn") {
                countdownMsRef.current = WAVE_COUNTDOWN_MS;
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
        } else if (
          // #3132: the pickup wait is player-flown too, so hiding the tab pauses it
          (stateRef.current.phase === "Playing" ||
            stateRef.current.phase === "ClearAwaitingPickups") &&
          !isPausedRef.current
        ) {
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
      <View style={{ width: displayW, height: displayH }}>
        <View
          style={{ width: displayW, height: displayH }}
          accessibilityLabel={t("game.canvasLabel")}
          accessibilityRole="image"
        >
          <canvas ref={canvasRef} width={displayW} height={displayH} style={{ display: "block" }} />
        </View>
      </View>
    );
  }
);

GameCanvas.displayName = "GameCanvas";
export default GameCanvas;
