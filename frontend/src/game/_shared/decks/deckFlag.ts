/**
 * `BC_DECK_ENABLED` (#3577) — gates the in-house Arcade, Parlor and Synthwave decks.
 *
 * Same rule as `SHOW_HIDDEN_GAMES` (entitlements/gameVisibility.ts): a compiled constant keyed
 * off the build flavour, on in internal builds (dev, e2e, pre-launch API) and off in store
 * builds, and off wherever a test forces a store build. When it is off the decks are not listed
 * in Settings and a saved selection of one falls back to the default deck.
 */
import { IS_INTERNAL_BUILD, isStoreBuildForced } from "../buildFlavour";

export const BC_DECK_ENABLED: boolean = IS_INTERNAL_BUILD;

/** The decks the flag gates. Classic, Minimal and Neon are never gated. */
export const BC_DECK_IDS: ReadonlySet<string> = new Set(["arcade", "parlor", "synthwave"]);

/** True when the gated decks may be listed and selected in this build. */
export function isBcDeckEnabled(): boolean {
  return BC_DECK_ENABLED && !isStoreBuildForced();
}

/** True when `id` may be listed and loaded: any ungated deck, or a gated one with the flag on. */
export function isDeckSelectable(id: string): boolean {
  return !BC_DECK_IDS.has(id) || isBcDeckEnabled();
}
