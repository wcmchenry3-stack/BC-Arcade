export const STARSWARM_SOUNDS: Record<string, number> = {
  "starswarm.laser": require("../../../assets/sounds/starswarm-laser.ogg"),
  "starswarm.chargeshot": require("../../../assets/sounds/starswarm-chargeshot.ogg"),
  "starswarm.explosion": require("../../../assets/sounds/starswarm-explosion.ogg"),
  "starswarm.playerhit": require("../../../assets/sounds/starswarm-playerhit.ogg"),
  "starswarm.gameover": require("../../../assets/sounds/starswarm-gameover.ogg"),
  "starswarm.waveclear": require("../../../assets/sounds/starswarm-waveclear.ogg"),
  "starswarm.bonuslife": require("../../../assets/sounds/starswarm-waveclear.ogg"),
  // Power-up type sounds
  "starswarm.poweruplightning": require("../../../assets/sounds/starswarm-powerup-lightning.ogg"),
  "starswarm.powerupshield": require("../../../assets/sounds/starswarm-powerup-shield.ogg"),
  "starswarm.powerupbuddy": require("../../../assets/sounds/starswarm-powerup-buddy.ogg"),
  "starswarm.powerupbomb": require("../../../assets/sounds/starswarm-powerup-bomb.ogg"),
  // #2490 boss wave sighted — the old stage-start sting file, kept (reinforce reuses it too)
  "starswarm.bosswave": require("../../../assets/sounds/starswarm-freefirezone.ogg"),
  // #2485 Carrier actions — reuse existing Kenney CC0 files until dedicated SFX land (#2492)
  "starswarm.beamcharge": require("../../../assets/sounds/starswarm-chargeshot.ogg"),
  "starswarm.beamfire": require("../../../assets/sounds/starswarm-laser.ogg"),
  "starswarm.reinforce": require("../../../assets/sounds/starswarm-freefirezone.ogg"),
  // #2488 in-run upgrades — reuse existing Kenney CC0 files until dedicated SFX land (#2492)
  "starswarm.salvage": require("../../../assets/sounds/starswarm-powerup-lightning.ogg"),
  "starswarm.hullup": require("../../../assets/sounds/starswarm-powerup-shield.ogg"),
  "starswarm.hullhit": require("../../../assets/sounds/starswarm-playerhit.ogg"),
  // #2489 grunt rout — the stage sting again until a dedicated one lands (#2492)
  "starswarm.rout": require("../../../assets/sounds/starswarm-freefirezone.ogg"),
  // Background music tracks
  "starswarm.bg1": require("../../../assets/sounds/starswarm-bg-1.mp3"),
  "starswarm.bg2": require("../../../assets/sounds/starswarm-bg-2.mp3"),
  "starswarm.bg3": require("../../../assets/sounds/starswarm-bg-3.mp3"),
  "starswarm.bg4": require("../../../assets/sounds/starswarm-bg-4.mp3"),
};
