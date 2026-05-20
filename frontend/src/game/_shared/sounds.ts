// Shared/UI sound registry — navigation clicks, global SFX.
// Per-game sounds live in each game's own sounds.ts.
//
// Shared audio cross-references (#1025): some game registries point at the same file.
//   blackjack-win.ogg      → blackjack.win, solitaire.foundationComplete
//   cascade-game-over.ogg  → cascade.gameOver, mahjong.deadlock, twenty48.gameOver, hearts.gameOver
//   starswarm-waveclear.ogg → starswarm.waveclear, starswarm.bonuslife, cascade.cascadeCombo
//   solitaire-invalid-move.ogg → solitaire.invalidMove, sudoku.errorEntered, freecell.invalidMove
export type SoundKey = string;

export const SHARED_SOUNDS: Record<string, number> = {};
