import { useCallback } from "react";
import { useSound } from "../game/_shared/useSound";
import { useBackgroundMusic } from "../game/_shared/useBackgroundMusic";
import type { PowerUpType } from "../game/starswarm/types";

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
  challengingstage: number;
  bonuslife: number;
  perfectbonus: number;
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
  challengingstage: 0.8,
  bonuslife: 0.9,
  perfectbonus: 1.0,
};

// bgMusicActive should be false when the game is over so the track stops.
// newGameTick should increment on every new-game start (e.g. resetTick from the screen)
// to guarantee a fresh music session even when bgMusicActive doesn't transition false→true.
export function useStarSwarmAudio(
  bgMusicActive: boolean,
  volumes?: Partial<SfxVolumes>,
  newGameTick?: number
) {
  useBackgroundMusic(BG_KEYS as unknown as string[], bgMusicActive, newGameTick);

  const v = { ...DEFAULT_SFX_VOLUMES, ...volumes };

  const { play: playLaser } = useSound("starswarm.laser", v.laser);
  const { play: playPowerUpLightning } = useSound("starswarm.poweruplightning", v.poweruplightning);
  const { play: playPowerUpShield } = useSound("starswarm.powerupshield", v.powerupshield);
  const { play: playPowerUpBuddy } = useSound("starswarm.powerupbuddy", v.powerupbuddy);
  const { play: playPowerUpBomb } = useSound("starswarm.powerupbomb", v.powerupbomb);
  const { play: playExplosion } = useSound("starswarm.explosion", v.explosion);
  const { play: playPlayerHit } = useSound("starswarm.playerhit", v.playerhit);
  const { play: playWaveClear } = useSound("starswarm.waveclear", v.waveclear);
  const { play: playGameOver } = useSound("starswarm.gameover", v.gameover);
  const { play: playChallengingStage } = useSound("starswarm.challengingstage", v.challengingstage);
  const { play: playBonusLife } = useSound("starswarm.bonuslife", v.bonuslife);
  const { play: playPerfect } = useSound("blackjack.blackjack", v.perfectbonus);

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
    playChallengingStage,
    playBonusLife,
    playPerfect,
  };
}
