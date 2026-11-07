import { useCallback, useEffect, useRef } from "react";
import { useSound } from "../game/_shared/useSound";
import { useLoopSound } from "../game/_shared/useLoopSound";
import { useBackgroundMusic } from "../game/_shared/useBackgroundMusic";
import { STARSWARM_SOUNDS } from "../game/starswarm/sounds";
import type { StarSwarmLoop } from "../game/starswarm/soundLoops";
import type { StarSwarmCue } from "../game/starswarm/soundCues";
import type { CarrierEvent, PowerUpType, UpgradeEvent } from "../game/starswarm/types";

const LOOP_NAMES = ["shield", "buddy", "rout", "lightning"] as const;
const BG_KEYS = ["starswarm.bg1", "starswarm.bg2", "starswarm.bg3", "starswarm.bg4"] as const;

export interface SfxVolumes {
  poweruplightning: number;
  powerupshield: number;
  powerupbuddy: number;
  powerupbomb: number;
  explosion: number;
  playerhit: number;
  waveclear: number;
  gameover: number;
  bosswave: number;
  bonuslife: number;
  beamcharge: number;
  attackrun: number;
  beamfire: number;
  reinforce: number;
  salvage: number;
  hullup: number;
  hullhit: number;
  rout: number;
  bombblast: number;
  shieldon: number;
  shieldloop: number;
  shieldwarn: number;
  shieldoff: number;
  buddyin: number;
  buddyloop: number;
  buddyout: number;
  buddydown: number;
  lightningloop: number;
  /** One volume for the three gun riffs (guns1-3). */
  guns: number;
}

export const DEFAULT_SFX_VOLUMES: SfxVolumes = {
  poweruplightning: 0.8,
  powerupshield: 0.8,
  powerupbuddy: 0.8,
  powerupbomb: 0.8,
  explosion: 0.45,
  playerhit: 0.7,
  waveclear: 0.8,
  gameover: 0.8,
  bosswave: 0.8,
  bonuslife: 0.9,
  beamcharge: 0.7,
  attackrun: 0.9,
  beamfire: 0.5,
  reinforce: 0.6,
  salvage: 0.8,
  hullup: 0.8,
  hullhit: 0.7,
  rout: 0.5,
  bombblast: 0.8,
  // #3560: the Shield and Buddy parts are mixed relative to each other in the files themselves
  // (shield-on is the loudest, the hums are baked quiet), so related keys share a default.
  shieldon: 0.8,
  shieldloop: 0.8,
  shieldwarn: 0.8,
  shieldoff: 0.8,
  buddyin: 0.7,
  buddyloop: 0.7,
  buddyout: 0.7,
  buddydown: 0.8,
  lightningloop: 0.7,
  guns: 0.7,
};

// bgMusicActive should be false when the game is over so the track stops.
// newGameTick should increment on every new-game start (e.g. resetTick from the screen)
// to guarantee a fresh music session even when bgMusicActive doesn't transition false→true.
// paused holds the current track while the run is paused, and resumes it on unpause.
export function useStarSwarmAudio(
  bgMusicActive: boolean,
  volumes?: Partial<SfxVolumes>,
  newGameTick?: number,
  paused = false,
  // Holds only the loops (the difficulty picker over a live run freezes the canvas; the music
  // keeps playing over it by design, so `paused` is not set).
  loopsHeld = false
) {
  useBackgroundMusic(
    BG_KEYS as unknown as string[],
    STARSWARM_SOUNDS,
    bgMusicActive,
    newGameTick,
    paused
  );

  const v = { ...DEFAULT_SFX_VOLUMES, ...volumes };

  const { play: playPowerUpLightning } = useSound(
    "starswarm.poweruplightning",
    STARSWARM_SOUNDS,
    v.poweruplightning
  );
  const { play: playPowerUpShield } = useSound(
    "starswarm.powerupshield",
    STARSWARM_SOUNDS,
    v.powerupshield
  );
  const { play: playPowerUpBuddy } = useSound(
    "starswarm.powerupbuddy",
    STARSWARM_SOUNDS,
    v.powerupbuddy
  );
  const { play: playPowerUpBomb } = useSound(
    "starswarm.powerupbomb",
    STARSWARM_SOUNDS,
    v.powerupbomb
  );
  const { play: playExplosion } = useSound("starswarm.explosion", STARSWARM_SOUNDS, v.explosion);
  const { play: playPlayerHit } = useSound("starswarm.playerhit", STARSWARM_SOUNDS, v.playerhit);
  const { play: playWaveClear } = useSound("starswarm.waveclear", STARSWARM_SOUNDS, v.waveclear);
  const { play: playGameOver } = useSound("starswarm.gameover", STARSWARM_SOUNDS, v.gameover);
  const { play: playBossWave } = useSound("starswarm.bosswave", STARSWARM_SOUNDS, v.bosswave); // #2490
  const { play: playBonusLife } = useSound("starswarm.bonuslife", STARSWARM_SOUNDS, v.bonuslife);

  const { play: playBeamCharge } = useSound("starswarm.beamcharge", STARSWARM_SOUNDS, v.beamcharge);
  const { play: playAttackRun } = useSound("starswarm.attackrun", STARSWARM_SOUNDS, v.attackrun);
  const { play: playBeamFire } = useSound("starswarm.beamfire", STARSWARM_SOUNDS, v.beamfire);
  const { play: playReinforce } = useSound("starswarm.reinforce", STARSWARM_SOUNDS, v.reinforce);

  // Pickup sound: salvage and hullup share the file of the four power-up keys
  const { play: playSalvage } = useSound("starswarm.salvage", STARSWARM_SOUNDS, v.salvage);
  const { play: playHullUp } = useSound("starswarm.hullup", STARSWARM_SOUNDS, v.hullup);
  const { play: playHullHit } = useSound("starswarm.hullhit", STARSWARM_SOUNDS, v.hullhit);
  const { play: playBombBlast } = useSound("starswarm.bombblast", STARSWARM_SOUNDS, v.bombblast);
  // #3560: Shield and Buddy one-shots
  const { play: playShieldOn } = useSound("starswarm.shieldon", STARSWARM_SOUNDS, v.shieldon);
  const { play: playShieldWarn } = useSound("starswarm.shieldwarn", STARSWARM_SOUNDS, v.shieldwarn);
  const { play: playShieldOff } = useSound("starswarm.shieldoff", STARSWARM_SOUNDS, v.shieldoff);
  const { play: playBuddyIn } = useSound("starswarm.buddyin", STARSWARM_SOUNDS, v.buddyin);
  const { play: playBuddyOut } = useSound("starswarm.buddyout", STARSWARM_SOUNDS, v.buddyout);
  const { play: playBuddyDown } = useSound("starswarm.buddydown", STARSWARM_SOUNDS, v.buddydown);
  const { play: playGuns1 } = useSound("starswarm.guns1", STARSWARM_SOUNDS, v.guns);
  const { play: playGuns2 } = useSound("starswarm.guns2", STARSWARM_SOUNDS, v.guns);
  const { play: playGuns3 } = useSound("starswarm.guns3", STARSWARM_SOUNDS, v.guns);

  // Loops (#3526). The canvas reports each condition's edges through `setLoop`; the hook
  // decides whether the loop may sound: never while paused or after game over, and a new run
  // starts with all of them off.
  const shieldLoop = useLoopSound("starswarm.shieldloop", STARSWARM_SOUNDS, v.shieldloop);
  const buddyLoop = useLoopSound("starswarm.buddyloop", STARSWARM_SOUNDS, v.buddyloop);
  const routLoop = useLoopSound("starswarm.rout", STARSWARM_SOUNDS, v.rout); // #2489
  const lightningLoop = useLoopSound("starswarm.lightningloop", STARSWARM_SOUNDS, v.lightningloop); // #3560
  const wantedRef = useRef<Record<StarSwarmLoop, boolean>>({
    shield: false,
    buddy: false,
    rout: false,
    lightning: false,
  });
  const mayLoopRef = useRef(bgMusicActive && !paused && !loopsHeld);
  const loopsRef = useRef({
    shield: shieldLoop,
    buddy: buddyLoop,
    rout: routLoop,
    lightning: lightningLoop,
  });
  loopsRef.current = {
    shield: shieldLoop,
    buddy: buddyLoop,
    rout: routLoop,
    lightning: lightningLoop,
  };

  const applyLoops = useCallback(() => {
    for (const name of LOOP_NAMES) {
      const loop = loopsRef.current[name];
      if (wantedRef.current[name] && mayLoopRef.current) loop.start();
      else loop.stop();
    }
  }, []);

  const setLoop = useCallback(
    (name: StarSwarmLoop, on: boolean) => {
      wantedRef.current[name] = on;
      applyLoops();
    },
    [applyLoops]
  );

  // A new run forgets every condition (declared before the effect below, so a restart from game
  // over never briefly sounds a stale loop); the canvas re-reports from scratch.
  useEffect(() => {
    wantedRef.current = { shield: false, buddy: false, rout: false, lightning: false };
    applyLoops();
  }, [newGameTick, applyLoops]);

  // Pause, the difficulty picker and game over silence the loops; unpausing resumes the ones still wanted.
  useEffect(() => {
    mayLoopRef.current = bgMusicActive && !paused && !loopsHeld;
    applyLoops();
  }, [bgMusicActive, paused, loopsHeld, applyLoops]);

  // #2488: ladder changes. Gun changes play a riff of as many shots as the NEW level, up or
  // down (a gunsDown comes with a lost life, so it is not the hull-hit sting). The pickup sound
  // of a crate or plating is not here: it comes from the collection (playPowerUpCollect), so a
  // pickup at the top of a ladder, which fires no upgrade event, still sounds, once.
  const playUpgrade = useCallback(
    (ev: UpgradeEvent) => {
      if (ev.kind === "gunsUp" || ev.kind === "gunsDown") {
        if (ev.guns === 1) playGuns1();
        else if (ev.guns === 2) playGuns2();
        else playGuns3();
      } else if (ev.kind === "hullHit") playHullHit();
    },
    [playHullHit, playGuns1, playGuns2, playGuns3]
  );

  // #2485: one entry point for the Carrier's moments. Each has its own sound except the final
  // stand, which reuses the boss-wave sting (#2843).
  const playCarrierEvent = useCallback(
    (kind: CarrierEvent) => {
      if (kind === "beamCharge") playBeamCharge();
      else if (kind === "attackRun") playAttackRun();
      else if (kind === "beamFire") playBeamFire();
      else if (kind === "finalStand") playBossWave();
      else playReinforce();
    },
    [playBeamCharge, playAttackRun, playBeamFire, playBossWave, playReinforce]
  );

  // The pickup sound for every pickup (power-ups banked or not, salvage crates, plating), all one
  // file. The effect (bomb blast, loops, gun riff) sounds separately when it actually runs.
  const playPowerUpCollect = useCallback(
    (type: PowerUpType) => {
      if (type === "lightning") playPowerUpLightning();
      else if (type === "shield") playPowerUpShield();
      else if (type === "buddy") playPowerUpBuddy();
      else if (type === "bomb") playPowerUpBomb();
      else if (type === "salvage") playSalvage();
      else if (type === "hull") playHullUp();
    },
    [
      playPowerUpLightning,
      playPowerUpShield,
      playPowerUpBuddy,
      playPowerUpBomb,
      playSalvage,
      playHullUp,
    ]
  );

  // #3560: one entry point for the Shield / Buddy one-shots the canvas detects on the tick.
  const playCue = useCallback(
    (cue: StarSwarmCue) => {
      if (cue === "shieldOn") playShieldOn();
      else if (cue === "shieldWarn") playShieldWarn();
      else if (cue === "shieldOff") playShieldOff();
      else if (cue === "buddyIn") playBuddyIn();
      else playBuddyOut();
    },
    [playShieldOn, playShieldWarn, playShieldOff, playBuddyIn, playBuddyOut]
  );

  return {
    playCue,
    playBuddyDown,
    playPowerUpCollect,
    playExplosion,
    playPlayerHit,
    playWaveClear,
    playGameOver,
    playBossWave,
    playBombBlast,
    setLoop,
    playBonusLife,
    playCarrierEvent,
    playUpgrade,
  };
}
