// Sound asset registry.
//
// SoundKey is a string union — add new keys here when wiring a game's sounds.
// The corresponding require() goes in SOUND_REGISTRY.
// Hearts keys (moonShot, heartsBroken, queenOfSpades) are added in #773–#775.
//
// Shared audio (#1025): some keys intentionally point at the same file.
//   blackjack-win.ogg      → blackjack.win, solitaire.foundationComplete
//   cascade-game-over.ogg  → cascade.gameOver, mahjong.deadlock, twenty48.gameOver
//   starswarm-waveclear.ogg → starswarm.waveclear, starswarm.bonuslife, cascade.cascadeCombo
//   solitaire-invalid-move.ogg → solitaire.invalidMove, sudoku.errorEntered, freecell.invalidMove
export type SoundKey = string;

// Metro resolves require() at bundle time so assets must be static literals.
// Each game-specific issue adds its entries here.
export const SOUND_REGISTRY: Partial<Record<SoundKey, number>> = {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "hearts.heartsBroken": require("../../../assets/sounds/hearts-broken.mp3"),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "hearts.moonShot": require("../../../assets/sounds/hearts-moon-shot.mp3"),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "hearts.queenOfSpades": require("../../../assets/sounds/hearts-queen-of-spades.mp3"),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "hearts.cardPlay": require("../../../assets/sounds/solitaire-card-place.ogg"),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "hearts.trickWon": require("../../../assets/sounds/solitaire-card-flip.ogg"),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "hearts.gameOver": require("../../../assets/sounds/cascade-game-over.ogg"),
  // Blackjack (#826)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "blackjack.cardDeal": require("../../../assets/sounds/blackjack-card-deal.ogg"),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "blackjack.blackjack": require("../../../assets/sounds/hearts-moon-shot.mp3"),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "blackjack.bust": require("../../../assets/sounds/blackjack-bust.ogg"),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "blackjack.win": require("../../../assets/sounds/blackjack-win.ogg"),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "blackjack.push": require("../../../assets/sounds/blackjack-push.ogg"),
  // Star Swarm (#803)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "starswarm.laser": require("../../../assets/sounds/starswarm-laser.ogg"),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "starswarm.chargeshot": require("../../../assets/sounds/starswarm-chargeshot.ogg"),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "starswarm.explosion": require("../../../assets/sounds/starswarm-explosion.ogg"),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "starswarm.playerhit": require("../../../assets/sounds/starswarm-playerhit.ogg"),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "starswarm.challengingstage": require("../../../assets/sounds/starswarm-challengingstage.ogg"),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "starswarm.gameover": require("../../../assets/sounds/starswarm-gameover.ogg"),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "starswarm.waveclear": require("../../../assets/sounds/starswarm-waveclear.ogg"),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "starswarm.bonuslife": require("../../../assets/sounds/starswarm-waveclear.ogg"),
  // Power-up type sounds (#1038)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "starswarm.poweruplightning": require("../../../assets/sounds/starswarm-powerup-lightning.ogg"),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "starswarm.powerupshield": require("../../../assets/sounds/starswarm-powerup-shield.ogg"),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "starswarm.powerupbuddy": require("../../../assets/sounds/starswarm-powerup-buddy.ogg"),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "starswarm.powerupbomb": require("../../../assets/sounds/starswarm-powerup-bomb.ogg"),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "starswarm.bg1": require("../../../assets/sounds/starswarm-bg-1.mp3"),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "starswarm.bg2": require("../../../assets/sounds/starswarm-bg-2.mp3"),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "starswarm.bg3": require("../../../assets/sounds/starswarm-bg-3.mp3"),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "starswarm.bg4": require("../../../assets/sounds/starswarm-bg-4.mp3"),
  // Yacht (#827)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "yacht.diceRoll": require("../../../assets/sounds/yacht-dice-roll.ogg"),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "yacht.dieHold": require("../../../assets/sounds/yacht-die-hold.ogg"),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "yacht.yacht": require("../../../assets/sounds/hearts-moon-shot.mp3"),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "yacht.joker": require("../../../assets/sounds/hearts-moon-shot.mp3"),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "yacht.straight": require("../../../assets/sounds/yacht-straight.ogg"),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "yacht.upperBonus": require("../../../assets/sounds/yacht-upper-bonus.ogg"),
  // Twenty48 (#829)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "twenty48.tileMerge": require("../../../assets/sounds/twenty48-tile-merge.ogg"),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "twenty48.tileSpawn": require("../../../assets/sounds/twenty48-tile-spawn.ogg"),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "twenty48.win2048": require("../../../assets/sounds/hearts-moon-shot.mp3"),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "twenty48.gameOver": require("../../../assets/sounds/cascade-game-over.ogg"),
  // Solitaire (#831)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "solitaire.cardFlip": require("../../../assets/sounds/solitaire-card-flip.ogg"),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "solitaire.cardPlace": require("../../../assets/sounds/solitaire-card-place.ogg"),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "solitaire.foundationComplete": require("../../../assets/sounds/blackjack-win.ogg"),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "solitaire.invalidMove": require("../../../assets/sounds/solitaire-invalid-move.ogg"),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "solitaire.gameWin": require("../../../assets/sounds/hearts-moon-shot.mp3"),
  // Sudoku (#833)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "sudoku.digitPlace": require("../../../assets/sounds/sudoku-digit-place.ogg"),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "sudoku.errorEntered": require("../../../assets/sounds/solitaire-invalid-move.ogg"),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "sudoku.unitComplete": require("../../../assets/sounds/sudoku-unit-complete.ogg"),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "sudoku.puzzleComplete": require("../../../assets/sounds/hearts-moon-shot.mp3"),
  // Cascade (#834)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "cascade.fruitMerge": require("../../../assets/sounds/cascade-fruit-merge.ogg"),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "cascade.cascadeCombo": require("../../../assets/sounds/starswarm-waveclear.ogg"),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "cascade.gameOver": require("../../../assets/sounds/cascade-game-over.ogg"),
  // FreeCell (#844)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "freecell.cardPlace": require("../../../assets/sounds/freecell-card-place.mp3"),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "freecell.supermove": require("../../../assets/sounds/freecell-supermove.mp3"),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "freecell.foundationComplete": require("../../../assets/sounds/freecell-foundation-complete.mp3"),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "freecell.gameWin": require("../../../assets/sounds/freecell-game-win.mp3"),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "freecell.invalidMove": require("../../../assets/sounds/solitaire-invalid-move.ogg"),
  // Sort (#1265, #1268)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "sort.pour": require("../../../assets/sounds/cascade-fruit-merge.ogg"),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "sort.win": require("../../../assets/sounds/freecell-game-win.mp3"),
  // Mahjong (#914)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "mahjong.tileSelect": require("../../../assets/sounds/mahjong-tile-select.ogg"),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "mahjong.tileMatch": require("../../../assets/sounds/mahjong-tile-match.ogg"),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "mahjong.shuffle": require("../../../assets/sounds/mahjong-shuffle.ogg"),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "mahjong.win": require("../../../assets/sounds/hearts-moon-shot.mp3"),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "mahjong.deadlock": require("../../../assets/sounds/cascade-game-over.ogg"),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "mahjong.bg1": require("../../../assets/sounds/mahjong-bg-1.mp3"),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "mahjong.bg2": require("../../../assets/sounds/mahjong-bg-2.mp3"),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "mahjong.bg3": require("../../../assets/sounds/mahjong-bg-3.mp3"),
};
