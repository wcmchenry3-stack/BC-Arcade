import { useCallback } from "react";
import { useSound } from "../game/_shared/useSound";
import { useBackgroundMusic } from "../game/_shared/useBackgroundMusic";
import { STARSWARM_SOUNDS } from "../game/starswarm/sounds";
import type { CarrierEvent, PowerUpType } from "../game/starswarm/types";

const BG_KEYS = ["starswarm.bg1", "starswarm.bg2", "starswarm.bg3", "starswarm.bg4"] as const;

export interface SfxVolumes {
  laser: number;
  poweruplightning: number;
  powerupshield: number;
  powerupbuddy: number;
  powerupbomb: number;
  explosion: number;
  playerhit: number;
  waveclear: number;
  gameover: number;
  freefirezone: number;
  bonuslife: number;
  perfectbonus: number;
  beamcharge: number;
  beamfire: number;
  reinforce: number;
}

export const DEFAULT_SFX_VOLUMES: SfxVolumes = {
  laser: 0.6,
  poweruplightning: 0.8,
  powerupshield: 0.8,
  powerupbuddy: 0.8,
  powerupbomb: 0.9,
  explosion: 0.45,
  playerhit: 0.7,
  waveclear: 0.8,
  gameover: 0.8,
  freefirezone: 0.8,
  bonuslife: 0.9,
  perfectbonus: 1.0,
  beamcharge: 0.7,
  beamfire: 0.5,
  reinforce: 0.6,
};

// bgMusicActive should be false when the game is over so the track stops.
// newGameTick should increment on every new-game start (e.g. resetTick from the screen)
// to guarantee a fresh music session even when bgMusicActive doesn't transition false→true.
export function useStarSwarmAudio(
  bgMusicActive: boolean,
  volumes?: Partial<SfxVolumes>,
  newGameTick?: number
) {
  useBackgroundMusic(BG_KEYS as unknown as string[], STARSWARM_SOUNDS, bgMusicActive, newGameTick);

  const v = { ...DEFAULT_SFX_VOLUMES, ...volumes };

  const { play: playLaser } = useSound("starswarm.laser", STARSWARM_SOUNDS, v.laser);
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
  const { play: playFreeFireZone } = useSound(
    "starswarm.freefirezone",
    STARSWARM_SOUNDS,
    v.freefirezone
  );
  const { play: playBonusLife } = useSound("starswarm.bonuslife", STARSWARM_SOUNDS, v.bonuslife);
  const { play: playPerfect, stop: stopPerfect } = useSound(
    "starswarm.perfectbonus",
    STARSWARM_SOUNDS,
    v.perfectbonus
  );

  const { play: playBeamCharge } = useSound("starswarm.beamcharge", STARSWARM_SOUNDS, v.beamcharge);
  const { play: playBeamFire } = useSound("starswarm.beamfire", STARSWARM_SOUNDS, v.beamfire);
  const { play: playReinforce } = useSound("starswarm.reinforce", STARSWARM_SOUNDS, v.reinforce);

  // #2485: one entry point for the Carrier's moments
  const playCarrierEvent = useCallback(
    (kind: CarrierEvent) => {
      if (kind === "beamCharge") playBeamCharge();
      else if (kind === "beamFire") playBeamFire();
      else playReinforce();
    },
    [playBeamCharge, playBeamFire, playReinforce]
  );

  const playPowerUpCollect = useCallback(
    (type: PowerUpType) => {
      if (type === "lightning") playPowerUpLightning();
      else if (type === "shield") playPowerUpShield();
      else if (type === "buddy") playPowerUpBuddy();
      else playPowerUpBomb();
    },
    [playPowerUpLightning, playPowerUpShield, playPowerUpBuddy, playPowerUpBomb]
  );

  return {
    playLaser,
    playPowerUpCollect,
    playExplosion,
    playPlayerHit,
    playWaveClear,
    playGameOver,
    playFreeFireZone,
    playBonusLife,
    playPerfect,
    stopPerfect,
    playCarrierEvent,
  };
}
