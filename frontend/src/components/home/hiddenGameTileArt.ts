/**
 * Lobby tile art for the games in HIDDEN_GAMES or DISABLED_GAMES
 * (`entitlements/gameVisibility.ts`), kept apart from `HomeScreen.tsx` so a store bundle can
 * leave it out (#4011, #4017).
 *
 * HomeScreen ships in every build, and Metro packages every image it imports statically, whether
 * the tile renders or not: `starswarm-tile.webp` was packaged in store builds although Star
 * Swarm is hidden there. In a store bundle `metro/storeBundle.js` resolves this module to
 * `hiddenGameTileArt.store.ts`, which imports no image, so the art is not packaged. The tiles
 * that would show it are filtered out of a store build's lobby, so nothing draws the stand-in.
 *
 * Add a hidden or disabled game's tile image here, never as a static import in HomeScreen. A
 * free game's tile image belongs in HomeScreen. `storeBundle.test.ts` checks both.
 */
import type { ImageSourcePropType } from "react-native";

import blackjackTile from "../../../assets/home/blackjack-tile.webp";
import cascadeTile from "../../../assets/home/cascade-tile.webp";
import heartsTile from "../../../assets/home/hearts-tile.webp";
import mahjongTile from "../../../assets/home/mahjong-tile.webp";
import starSwarmTile from "../../../assets/home/starswarm-tile.webp";

/** The hidden games' gameplay scenes (#4013), drawn by tools/assets/draw_lobby_tile_art.py. */
export type HiddenGameTileArt = Readonly<
  Record<"blackjack" | "cascade" | "hearts" | "mahjong" | "starswarm", ImageSourcePropType>
>;

export const HIDDEN_GAME_TILE_ART: HiddenGameTileArt = {
  blackjack: blackjackTile,
  cascade: cascadeTile,
  hearts: heartsTile,
  mahjong: mahjongTile,
  starswarm: starSwarmTile,
};
