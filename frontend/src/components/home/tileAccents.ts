/**
 * Each game's fixed accent on its lobby tile (#4007).
 *
 * A tile used to take `cardGradients[index % 4]`, so hiding a game or reordering the lobby
 * recoloured every tile after it. The pair now belongs to the game. The four pairs are the
 * original ones, of theme tokens only:
 *
 *   0  tertiary -> secondary      1  secondary -> accent
 *   2  accent -> accentBright     3  accentBright -> tertiary
 *
 * Assignment (2 columns, across and down; no two touching tiles share a pair):
 *
 *   store build, 7 tiles          row 1: daily_word 0, yacht 1
 *                                 row 2: twenty48 3,   solitaire 2
 *                                 row 3: freecell 1,   sudoku 0
 *                                 row 4: sort 3
 *
 * The other five (cascade 2, blackjack 0, hearts 3, starswarm 1, mahjong 2) are picked so the
 * 12-game internal lobby also has no touching pair, in 2 columns and in 1. A game's pair never
 * depends on which others are visible. `Record<GameType, ...>` makes a new game without an
 * accent fail to compile.
 *
 * Label: the Play label is `textOnAccent` (dark ink) on every pair, in both themes. In the
 * light theme `secondary` (#a34fc4) reaches only 4.1:1 under that ink and no ink reaches 4.5:1
 * on it together with the lime or teal stop, so there the fill uses the dark theme's lighter
 * magenta (`dark.secondary`, 7.2:1 under the ink). Ratios are pinned in tileAccents.test.ts.
 */
import type { GameType } from "../../api/vocab";
import { dark, type Colors, type Theme } from "../../theme/ThemeContext";

type PairIndex = 0 | 1 | 2 | 3;

export const TILE_ACCENT_PAIR: Readonly<Record<GameType, PairIndex>> = {
  daily_word: 0,
  yacht: 1,
  cascade: 2,
  blackjack: 0,
  twenty48: 3,
  solitaire: 2,
  freecell: 1,
  hearts: 3,
  sudoku: 0,
  starswarm: 1,
  mahjong: 2,
  sort: 3,
};

export interface TileAccent {
  /** Left and right stop of the top stripe and the Play button. */
  readonly stops: readonly [string, string];
  /** Ink of the Play label; holds 4.5:1 on both stops. */
  readonly label: string;
}

export function tileAccent(slug: GameType, colors: Colors, theme: Theme): TileAccent {
  // Light `secondary` is too dark for the dark ink; see the header.
  const secondary = theme === "light" ? dark.secondary : colors.secondary;
  const pairs: readonly (readonly [string, string])[] = [
    [colors.tertiary, secondary],
    [secondary, colors.accent],
    [colors.accent, colors.accentBright],
    [colors.accentBright, colors.tertiary],
  ];
  return { stops: pairs[TILE_ACCENT_PAIR[slug]]!, label: colors.textOnAccent };
}
