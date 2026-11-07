// Star Swarm's sound registry (#3526). The key -> file -> trigger table, with default volumes,
// is in docs/games/starswarm.md "Sound"; credits are in assets/sounds/SOUND_CREDITS.md.
// Intentional shares: the pickup sound (six keys, one file) and bosswave (boss sighted + the
// Carrier's final stand).
const PICKUP = require("../../../assets/sounds/starswarm-pickup.ogg");

export const STARSWARM_SOUNDS: Record<string, number> = {
  "starswarm.laser": require("../../../assets/sounds/starswarm-laser.ogg"),
  "starswarm.explosion": require("../../../assets/sounds/starswarm-explosion.ogg"),
  "starswarm.playerhit": require("../../../assets/sounds/starswarm-playerhit.ogg"),
  "starswarm.gameover": require("../../../assets/sounds/starswarm-gameover.ogg"),
  "starswarm.waveclear": require("../../../assets/sounds/starswarm-waveclear.ogg"),
  "starswarm.bonuslife": require("../../../assets/sounds/starswarm-bonuslife.ogg"),
  // Pickup: collecting an item (banked or not) — one sound for every ordinary power-up and both
  // ladder crates. The effect running has its own sound (bombblast, the loops, the gun riffs).
  "starswarm.poweruplightning": PICKUP,
  "starswarm.powerupshield": PICKUP,
  "starswarm.powerupbuddy": PICKUP,
  "starswarm.powerupbomb": PICKUP,
  "starswarm.salvage": PICKUP,
  "starswarm.hullup": PICKUP,
  // Action: the Smart Bomb detonating, and the loops that run while a condition holds
  "starswarm.bombblast": require("../../../assets/sounds/starswarm-bombblast.ogg"),
  "starswarm.shieldloop": require("../../../assets/sounds/starswarm-shield-loop.ogg"),
  "starswarm.buddyloop": require("../../../assets/sounds/starswarm-buddy-loop.ogg"),
  // #2489 grunt rout — a loop while any grunt is Fleeing (the ROUT! banner's condition)
  "starswarm.rout": require("../../../assets/sounds/starswarm-rout-loop.ogg"),
  // Gun ladder change: a riff of 1/2/3 shots, picked by the new level
  "starswarm.guns1": require("../../../assets/sounds/starswarm-guns-1.ogg"),
  "starswarm.guns2": require("../../../assets/sounds/starswarm-guns-2.ogg"),
  "starswarm.guns3": require("../../../assets/sounds/starswarm-guns-3.ogg"),
  "starswarm.hullhit": require("../../../assets/sounds/starswarm-hullhit.ogg"),
  // #2490 boss wave sighted — also the Carrier's final stand
  "starswarm.bosswave": require("../../../assets/sounds/starswarm-freefirezone.ogg"),
  // #2485 Carrier actions
  "starswarm.beamcharge": require("../../../assets/sounds/starswarm-beamcharge.ogg"),
  "starswarm.attackrun": require("../../../assets/sounds/starswarm-attackrun.ogg"),
  "starswarm.beamfire": require("../../../assets/sounds/starswarm-beamfire.ogg"),
  "starswarm.reinforce": require("../../../assets/sounds/starswarm-reinforce.ogg"),
  // Background music tracks
  "starswarm.bg1": require("../../../assets/sounds/starswarm-bg-1.mp3"),
  "starswarm.bg2": require("../../../assets/sounds/starswarm-bg-2.mp3"),
  "starswarm.bg3": require("../../../assets/sounds/starswarm-bg-3.mp3"),
  "starswarm.bg4": require("../../../assets/sounds/starswarm-bg-4.mp3"),
};
