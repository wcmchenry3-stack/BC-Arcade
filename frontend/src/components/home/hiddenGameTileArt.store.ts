/**
 * Store bundles only (#4011): `metro/storeBundle.js` resolves `hiddenGameTileArt.ts` to this
 * file, so the hidden games' tile images are not packaged. A store build's lobby filters those
 * games out, so these empty sources are never drawn. Imports no image, by design.
 */
import type { HiddenGameTileArt } from "./hiddenGameTileArt";

export const HIDDEN_GAME_TILE_ART: HiddenGameTileArt = {
  blackjack: {},
  cascade: {},
  hearts: {},
  mahjong: {},
  starswarm: {},
};
